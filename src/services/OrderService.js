const crypto = require('crypto');
const input = require('./orderInput');
const { MessagingProvider } = require('../messaging/MessagingProvider');
const { PaymentService } = require('./PaymentService');

/** Caminho do pedido, na ordem. Cancelado fica fora: dá para cancelar de qualquer passo antes do fim. */
const FLOW = ['new', 'preparing', 'dispatched', 'completed'];
const FINAL = new Set(['completed', 'canceled']);
const STATUSES = new Set([...FLOW, 'canceled']);
const SOURCES = new Set(['site', 'campaign', 'import', 'referral']);
const DISCOUNT_RATE = 0.1; // cupom do site: 10%, como no site de demonstração desde a etapa 1
const MAX_IMPORT_ROWS = 5000;

const { invalid, round2, text } = input;
const notFound = (message) => Object.assign(new Error(message), { status: 404 });
const conflict = (message) => Object.assign(new Error(message), { status: 409 });

/** Pedido repetido no checkout: desfaz a transação (inclusive o número reservado) e devolve o pedido que já existe. */
class DuplicateOrder extends Error {}

/**
 * Regras do pedido: checkout do site, contato do cliente final, status (painel do restaurante),
 * pedidos de sites externos e importação de planilhas. As rotas só traduzem HTTP para cá.
 */
class OrderService {
  constructor({ repos, events, config, referrals = null, payments = null, logger = console }) {
    this.repos = repos;
    this.events = events;
    this.config = config;
    this.referrals = referrals; // indicação e cupons (etapa 4)
    this.payments = payments; // pagamento online (etapa 5)
    this.logger = logger;
  }

  static get STATUSES() { return [...STATUSES]; }

  static get SOURCES() { return [...SOURCES]; }

  /** Só para a frente (pode pular passos) ou para cancelado; concluído e cancelado são finais. */
  static canMove(from, to) {
    if (FINAL.has(from) || !STATUSES.has(to) || from === to) return false;
    return to === 'canceled' || FLOW.indexOf(to) > FLOW.indexOf(from);
  }

  trackingUrl(order) {
    return order.trackingCode ? `${this.config.publicUrl}/pedido/${order.trackingCode}` : null;
  }

  /** Itens da sacola com o preço do cardápio: o preço nunca vem do navegador. */
  static priceItems(items, menu = []) {
    if (!Array.isArray(items) || !items.length) throw invalid('A sacola está vazia.');
    if (items.length > 50) throw invalid('Pedido com itens demais.');
    const byId = new Map(menu.map((m) => [String(m.id), m]));
    return items.map((it) => {
      const m = byId.get(String(it?.id));
      if (!m) throw invalid('Um item da sacola não está mais no cardápio. Atualize a página e tente de novo.');
      const qty = Number(it.qty);
      if (!Number.isInteger(qty) || qty < 1 || qty > 50) throw invalid(`Quantidade inválida para ${m.name}.`);
      return { id: m.id, name: m.name, qty, price: round2(Number(m.price) || 0), note: text(it.note, 200) };
    });
  }

  /** Dados do checkout validados (sem tocar no banco). */
  static checkout(body, restaurant) {
    const customer = body.customer && typeof body.customer === 'object' ? body.customer : {};
    const name = text(customer.name, 120);
    if (!name) throw invalid('Informe seu nome.');
    const fulfillment = body.fulfillment === 'pickup' ? 'pickup' : body.fulfillment === 'delivery' ? 'delivery' : null;
    if (!fulfillment) throw invalid('Escolha entrega ou retirada.');
    const items = OrderService.priceItems(body.items, restaurant.menu || []);
    const orderKey = /^[A-Za-z0-9_-]{8,64}$/.test(String(body.orderKey || '')) ? String(body.orderKey) : null;
    return {
      name,
      phone: input.phone(customer.phone),
      cpf: input.cpf(customer.cpf),
      birthday: input.birthday(customer),
      fulfillment,
      address: fulfillment === 'delivery' ? input.address(body.address) : null,
      notes: text(body.notes, 500) || null,
      items,
      marketingOptIn: body.marketingOptIn === true,
      orderId: orderKey ? `site-${orderKey}` : null,
      // Indicação (apelido do link) e cupom digitado: a regra fica no ReferralService
      referral: text(body.referral, 40).toLowerCase() || null,
      // Forma de pagamento: na entrega/retirada (padrão), Pix ou cartão (etapa 5)
      paymentMethod: String(body.payment || 'on_delivery'),
      couponCode: text(body.couponCode, 20).replace(/\s/g, '').toUpperCase() || null,
    };
  }

  /**
   * Contato do cliente final pelo telefone (mesma chave no restaurante). Novo: entra com a autorização que a
   * caixa de promoções deu. Existente: completa o nome vazio e grava o aniversário; a caixa marcada autoriza
   * quem ainda não estava autorizado, mas nunca desfaz um descadastro.
   */
  static async upsertContact(r, restaurantId, { name, phone, birthday = null, optIn, optInSource }) {
    const found = await r.contacts.findByPhoneKey(restaurantId, phone);
    if (!found) {
      const data = { restaurantId, name, phone, tags: [], optIn, optInSource: optIn ? optInSource : null, optedOut: false, ...(birthday || {}) };
      // Outro pedido do mesmo telefone ao mesmo tempo: o dele criou o contato, este usa o mesmo
      return (await r.contacts.createIfAbsent(data)) || r.contacts.findByPhone(restaurantId, phone);
    }
    const patch = {};
    if (!found.name && name) patch.name = name;
    if (birthday?.birthDay) Object.assign(patch, birthday);
    if (optIn && !found.optIn && !found.optedOut) Object.assign(patch, { optIn: true, optInSource });
    return Object.keys(patch).length ? r.contacts.update(found, patch) : found;
  }

  /** Pedido feito no site do restaurante. Devolve { order, restaurant, duplicated }. */
  async placeSiteOrder(body = {}) {
    const restaurant = await this.repos.restaurants.bySlug(String(body.restaurantSlug || ''));
    if (!restaurant) throw notFound('Restaurante não encontrado.');
    const data = OrderService.checkout(body, restaurant);
    data.paymentMethod = PaymentService.checkoutMethod(restaurant, data.paymentMethod, data.cpf);
    const online = data.paymentMethod !== 'on_delivery';

    // Link da campanha: só vale se for do mesmo restaurante
    const ref = body.ref ? await this.repos.messages.byCode(String(body.ref)) : null;
    const message = ref && ref.restaurantId === restaurant.id ? ref : null;
    const campaign = message ? await this.repos.campaigns.get(message.campaignId) : null;
    const houseCoupon = campaign?.coupon || restaurant.coupon || null;
    const subtotal = round2(data.items.reduce((s, it) => s + it.qty * it.price, 0));
    const at = new Date().toISOString();
    let picked = null;

    try {
      const order = await this.repos.tx(async (r) => {
        // Primeiro o número: a linha do restaurante fica travada até o fim, então a conferência do pedido repetido é segura
        const number = await r.restaurants.nextOrderNumber(restaurant.id);
        if (data.orderId && (await r.orders.findByOrderId(restaurant.id, data.orderId))) throw new DuplicateOrder();
        // Indicação e cupom dependem de quem compra (primeiro pedido, autoindicação): a conta vem antes do contato novo
        const known = await r.contacts.findByPhoneKey(restaurant.id, data.phone);
        picked = this.referrals
          ? await this.referrals.pickDiscount(r, { restaurant, subtotal, phone: data.phone, contactId: known?.id || null, referralSlug: data.referral, couponCode: data.couponCode, houseCoupon })
          : { discount: houseCoupon ? round2(subtotal * DISCOUNT_RATE) : 0, label: houseCoupon, referralId: null, couponId: null, referral: null };
        const discount = Math.min(picked.discount, subtotal);
        const contact = await OrderService.upsertContact(r, restaurant.id, {
          name: data.name, phone: data.phone, birthday: data.birthday, optIn: data.marketingOptIn, optInSource: 'Pedido no site',
        });
        const created = await r.orders.createUnique({
          referralId: picked.referralId,
          couponId: picked.couponId,
          restaurantId: restaurant.id,
          campaignId: message?.campaignId || null,
          messageId: message?.id || null,
          contactId: contact?.id || message?.contactId || null,
          code: message?.code || null,
          customerName: data.name,
          orderId: data.orderId,
          number,
          trackingCode: crypto.randomBytes(9).toString('base64url'),
          source: picked.referralId ? 'referral' : message ? 'campaign' : 'site',
          status: 'new',
          paymentMethod: data.paymentMethod,
          paymentStatus: online ? 'pending' : 'none',
          statusLog: [{ status: 'new', at, by: null }],
          fulfillment: data.fulfillment,
          phone: data.phone,
          cpf: data.cpf,
          address: data.address,
          neighborhood: data.address?.neighborhood || null,
          notes: data.notes,
          items: data.items,
          subtotal,
          discount,
          coupon: discount ? picked.label : null,
          value: Math.max(0, round2(subtotal - discount)),
          createdAt: at,
        });
        if (!created) throw new DuplicateOrder();
        // Cupom de uso único: se outro pedido usou no meio do caminho, este desfaz tudo e a pessoa vê o motivo
        if (picked.couponId && !(await r.coupons.markUsed(picked.couponId, created.id, at))) throw invalid('Este cupom já foi usado.');
        if (message && !message.convertedAt) await r.messages.markConverted(message.id, created.createdAt);
        return created;
      });
      // Online: a cobrança vem depois do pedido gravado; o quadro só recebe o pedido quando ele for pago
      if (online) return { order: await this.payments.startCharge(order, restaurant), restaurant, duplicated: false, referral: picked.referral };
      this.events.publish('order', { ...order, restaurant: restaurant.name });
      return { order, restaurant, duplicated: false, referral: picked.referral };
    } catch (err) {
      if (!(err instanceof DuplicateOrder)) throw err;
      return { order: await this.repos.orders.findByOrderId(restaurant.id, data.orderId), restaurant, duplicated: true };
    }
  }

  /**
   * Pedido informado por um site externo (script /t.js ou POST /api/public/conversions): só a venda,
   * já concluída, atribuída à campanha quando vem com o código do link. Devolve null se o número já existe.
   */
  async recordConversion(body = {}) {
    const { ref, value, orderId, items, restaurantSlug, customerName } = body;
    const message = ref ? await this.repos.messages.byCode(String(ref)) : null;
    const restaurant = message
      ? await this.repos.restaurants.get(message.restaurantId)
      : await this.repos.restaurants.bySlug(String(restaurantSlug || ''));
    if (!restaurant) throw notFound('Referência ou restaurante não encontrado.');
    // Número de pedido repetido no restaurante é ignorado (índice único, sem corrida)
    const order = await this.repos.orders.createUnique({
      restaurantId: restaurant.id,
      campaignId: message?.campaignId || null,
      messageId: message?.id || null,
      contactId: message?.contactId || null,
      code: message?.code || null,
      customerName: customerName || message?.name || null,
      orderId: orderId ? String(orderId) : null,
      value: Math.min(Math.max(0, Number(value) || 0), input.MAX_VALUE),
      items: Array.isArray(items) ? items.slice(0, 50) : [],
      source: message ? 'campaign' : 'site',
      status: 'completed',
    });
    if (!order) return null;
    if (message && !message.convertedAt) await this.repos.messages.markConverted(message.id, order.createdAt);
    this.events.publish('order', { ...order, restaurant: restaurant.name });
    return order;
  }

  /** Muda o status (painel). Quem viu uma versão antiga e perdeu a corrida recebe 409. */
  async changeStatus(order, to, user) {
    if (!STATUSES.has(to)) throw invalid('Status inválido.');
    if (order.status === to) return order;
    if (FINAL.has(order.status)) throw invalid(order.status === 'canceled' ? 'Este pedido foi cancelado e não muda mais.' : 'Este pedido já foi concluído e não muda mais.');
    if (!OrderService.canMove(order.status, to)) throw invalid('O pedido só avança. Para desfazer, cancele.');
    if (order.paymentStatus === 'pending' && to !== 'canceled') throw invalid('Este pedido ainda está esperando o pagamento do cliente.');
    const entry = { status: to, at: new Date().toISOString(), by: user?.name || null };
    const saved = await this.repos.orders.changeStatus(order, { from: order.status, to, entry });
    if (!saved) throw conflict('O pedido foi atualizado por outra pessoa. Recarregue para ver a situação atual.');
    this.events.publish('order:update', saved);
    // Pedido indicado concluído: o cupom de quem indicou. Falha aqui não desfaz a mudança de status
    // Pedido pago cancelado: estorno total (o erro do estorno fica no pedido, sem desfazer o cancelamento)
    if (to === 'canceled' && this.payments) {
      if (saved.paymentStatus === 'paid') return this.payments.refundIfPaid(saved);
      if (saved.paymentStatus === 'pending') return (await this.payments.closeUnpaid(saved, 'expired', 'Pedido cancelado pelo restaurante.')) || saved;
    }
    if (to === 'completed' && saved.referralId && this.referrals) {
      try { await this.referrals.onOrderCompleted(saved); } catch (err) { this.logger.error('[indicação]', err); }
    }
    return saved;
  }

  /** O que a página de acompanhamento mostra: o andamento, sem telefone, CPF nem endereço. */
  trackingView(order, restaurant) {
    return {
      number: order.number,
      status: order.status,
      fulfillment: order.fulfillment,
      createdAt: order.createdAt,
      firstName: String(order.customerName || '').split(/\s+/)[0] || '',
      neighborhood: order.fulfillment === 'delivery' ? order.neighborhood : null,
      statusLog: (order.statusLog || []).map(({ status, at }) => ({ status, at })),
      items: (order.items || []).map(({ name, qty, price, note }) => ({ name, qty, price, note: note || '' })),
      subtotal: order.subtotal ?? order.value,
      discount: order.discount || 0,
      coupon: order.coupon || null,
      total: order.value,
      restaurant: { name: restaurant.name, slug: restaurant.slug, color: restaurant.color, phone: restaurant.phone || null },
      payment: {
        method: order.paymentMethod || 'on_delivery',
        status: order.paymentStatus || 'none',
        url: order.paymentStatus === 'pending' ? order.paymentUrl : null,
        pix: order.paymentStatus === 'pending' ? order.paymentPix : null,
        simulated: order.paymentProvider === 'simulated',
        paidAt: order.paidAt || null,
      },
    };
  }

  // ── Importação de planilha ─────────────────────────────────
  /** Valida as linhas e separa o que entra, o que já existe e os erros (sem gravar nada). */
  async prepareImport({ restaurantId, rows }) {
    const restaurant = await this.repos.restaurants.get(restaurantId);
    if (!restaurant) throw invalid('Selecione o restaurante.');
    if (!Array.isArray(rows) || !rows.length) throw invalid('A planilha não tem pedidos.');
    if (rows.length > MAX_IMPORT_ROWS) throw invalid(`Importe no máximo ${MAX_IMPORT_ROWS.toLocaleString('pt-BR')} pedidos por vez.`);
    const valid = [];
    const errors = [];
    const seen = new Set();
    let repeated = 0;
    rows.forEach((row, i) => {
      const line = Number.isInteger(row?.line) ? row.line : i + 1;
      try {
        const order = input.sheetOrder(row || {});
        if (seen.has(order.orderId)) { repeated += 1; return; }
        seen.add(order.orderId);
        valid.push(order);
      } catch (err) {
        errors.push({ line, orderId: text(row?.orderId, 60) || null, error: err.message });
      }
    });
    const existing = await this.repos.orders.existingOrderIds(restaurant.id, valid.map((o) => o.orderId));
    const fresh = valid.filter((o) => !existing.has(o.orderId));
    const known = new Set((await this.repos.contacts.byRestaurant(restaurant.id)).map((c) => MessagingProvider.phoneKey(c.phone)));
    const newPhones = new Set(fresh.filter((o) => o.phone && !known.has(MessagingProvider.phoneKey(o.phone))).map((o) => MessagingProvider.phoneKey(o.phone)));
    return { restaurant, fresh, duplicated: existing.size + repeated, errors, newContacts: newPhones.size };
  }

  async previewImport({ restaurantId, rows }) {
    const { fresh, duplicated, errors, newContacts } = await this.prepareImport({ restaurantId, rows });
    return {
      total: rows.length,
      toImport: fresh.length,
      duplicated,
      newContacts,
      revenue: round2(fresh.reduce((s, o) => s + o.value, 0)),
      errorCount: errors.length,
      errors: errors.slice(0, 100),
      sample: fresh.slice(0, 5).map(({ orderId, createdAt, customerName, value }) => ({ orderId, createdAt, customerName, value })),
    };
  }

  /**
   * Grava a planilha numa transação. Telefone sem contato cria o contato, autorizado só com o consentimento
   * confirmado pela agência; contatos que já existem não mudam de autorização.
   */
  async runImport({ restaurantId, rows, channel, consent = false }) {
    const { restaurant, fresh, duplicated, errors } = await this.prepareImport({ restaurantId, rows });
    const label = text(channel, 40) || null;
    const result = await this.repos.tx(async (r) => {
      const byKey = async () => new Map((await r.contacts.byRestaurant(restaurant.id)).map((c) => [MessagingProvider.phoneKey(c.phone), c]));
      let contacts = await byKey();
      const toCreate = new Map();
      const toName = new Map(); // contato que já existia, mas sem nome: ganha o da planilha
      for (const o of fresh) {
        if (!o.phone) continue;
        const key = MessagingProvider.phoneKey(o.phone);
        const existing = contacts.get(key);
        if (existing) {
          if (!existing.name && o.customerName && !toName.has(existing.id)) toName.set(existing.id, o.customerName);
          continue;
        }
        const pending = toCreate.get(key);
        if (!pending) toCreate.set(key, { restaurantId: restaurant.id, name: o.customerName || '', phone: o.phone, tags: [], optIn: !!consent, optInSource: consent ? `Importação de pedidos${label ? ` (${label})` : ''}` : null, optedOut: false });
        else if (!pending.name && o.customerName) pending.name = o.customerName;
      }
      for (const [id, name] of toName) await r.contacts.update(id, { name });
      const created = await r.contacts.insertMany([...toCreate.values()], { onConflict: 'ON CONFLICT (restaurant_id, phone) DO NOTHING' });
      if (toCreate.size) contacts = await byKey();
      const inserted = await r.orders.insertUnique(fresh.map((o) => ({
        restaurantId: restaurant.id,
        orderId: o.orderId,
        createdAt: o.createdAt,
        customerName: o.customerName,
        phone: o.phone,
        contactId: o.phone ? contacts.get(MessagingProvider.phoneKey(o.phone))?.id || null : null,
        value: o.value,
        subtotal: o.subtotal,
        discount: o.discount,
        neighborhood: o.neighborhood,
        items: o.items,
        source: 'import',
        channel: label,
        status: 'completed',
      })));
      return { imported: inserted.length, contactsCreated: created.length, raced: fresh.length - inserted.length };
    });
    return {
      imported: result.imported,
      duplicated: duplicated + result.raced,
      contactsCreated: result.contactsCreated,
      errorCount: errors.length,
      errors: errors.slice(0, 100),
    };
  }
}

module.exports = { OrderService, FLOW };
