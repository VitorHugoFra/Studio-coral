const crypto = require('crypto');
const input = require('./orderInput');
const { MessagingProvider } = require('../messaging/MessagingProvider');
const { OrderService } = require('./OrderService');

const { invalid, round2, text } = input;
const notFound = (message) => Object.assign(new Error(message), { status: 404 });

const DEFAULT_INVITE = 'Oi! Eu peço no {{restaurante}} e recomendo. Pelo meu link você ganha {{desconto}} no primeiro pedido pelo site: {{link}}';
const DEFAULT_REWARD = 'Oi, {{primeiro_nome}}! {{indicado}} fez o primeiro pedido no {{restaurante}} pelo seu convite. Seu presente é o cupom *{{cupom}}*, de {{desconto}}{{minimo}}, válido até {{validade}}. Use no site: {{link}}';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O, 1/I, que se confundem ao digitar

// Espaço comum depois do R$ (o toLocaleString usa um espaço especial, que atrapalha quem copia o texto)
const money = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/\u00a0/g, ' ');
const discountText = (type, value) => (type === 'percent' ? `${String(Number(value)).replace('.', ',')}%` : money(value));
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';
const todayKey = () => new Date().toLocaleDateString('sv-SE');

/** Apelido do link: minúsculas, sem acento, letras, números e hífen. */
const slugify = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * Etapa 4 — indicação com desconto. O indicado ganha desconto no primeiro pedido; quando esse pedido é concluído,
 * quem indicou ganha um cupom de uso único pelo WhatsApp. Escolha do desconto no checkout (o maior vale),
 * links do cliente final e cupons.
 */
class ReferralService {
  constructor({ repos, messaging, templates, config, logger }) {
    this.repos = repos;
    this.messaging = messaging;
    this.templates = templates;
    this.config = config;
    this.logger = logger;
  }

  /** Regra do programa, como a agência salva na ficha do restaurante. */
  static normalizeRule(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const kind = (v) => (v === 'percent' ? 'percent' : 'fixed');
    // Vazio vale 0; com o programa ligado, desconto e cupom precisam ser maiores que zero (conferido no fim)
    const amount = (v, label, { max = input.MAX_VALUE } = {}) => {
      if (v === '' || v === undefined || v === null) return 0;
      const n = typeof v === 'number' ? v : input.money(v);
      if (!Number.isFinite(n) || n < 0 || n > max) throw invalid(`${label}: valor inválido.`);
      return n;
    };
    const rule = {
      enabled: raw.enabled === true,
      discountType: kind(raw.discountType),
      rewardType: kind(raw.rewardType),
    };
    rule.discountValue = amount(raw.discountValue, 'Desconto do indicado', { max: rule.discountType === 'percent' ? 100 : input.MAX_VALUE });
    rule.minOrder = amount(raw.minOrder, 'Pedido mínimo do indicado');
    rule.rewardValue = amount(raw.rewardValue, 'Cupom de quem indicou', { max: rule.rewardType === 'percent' ? 100 : input.MAX_VALUE });
    rule.rewardMinOrder = amount(raw.rewardMinOrder, 'Pedido mínimo do cupom');
    const days = raw.rewardValidDays === '' || raw.rewardValidDays === undefined ? 30 : Number(raw.rewardValidDays);
    if (!Number.isInteger(days) || days < 1 || days > 365) throw invalid('Validade do cupom: de 1 a 365 dias.');
    rule.rewardValidDays = days;
    const until = raw.validUntil ? String(raw.validUntil) : '';
    if (until && !input.sheetDate(until)) throw invalid('Validade do programa: data inválida.');
    rule.validUntil = until || null;
    rule.inviteMessage = text(raw.inviteMessage, 500) || DEFAULT_INVITE;
    rule.rewardMessage = String(raw.rewardMessage ?? '').trim().slice(0, 700) || DEFAULT_REWARD;
    if (rule.enabled && (!rule.discountValue || !rule.rewardValue)) throw invalid('Informe o desconto do indicado e o cupom de quem indicou.');
    return rule;
  }

  /** Programa ligado e dentro da validade (a data final vale o dia inteiro). */
  static active(rule) {
    return !!(rule?.enabled && (!rule.validUntil || todayKey() <= rule.validUntil));
  }

  static amountOf(type, value, subtotal) {
    return type === 'percent' ? round2((subtotal * Number(value)) / 100) : Math.min(round2(Number(value)), subtotal);
  }

  /** O que o site mostra do programa (nada se estiver desligado ou vencido). */
  publicInfo(restaurant) {
    const rule = restaurant?.referral;
    if (!ReferralService.active(rule)) return null;
    return {
      discount: discountText(rule.discountType, rule.discountValue),
      discountType: rule.discountType,
      discountValue: rule.discountValue,
      minOrder: rule.minOrder || 0,
      reward: discountText(rule.rewardType, rule.rewardValue),
      rewardMinOrder: rule.rewardMinOrder || 0,
      rewardValidDays: rule.rewardValidDays,
      validUntil: rule.validUntil,
    };
  }

  linkUrl(restaurant, link) {
    return `${this.config.publicUrl}/i/${restaurant.slug}/${link.slug}`;
  }

  /** Mensagem de convite pronta para compartilhar (a do cliente ou a padrão do restaurante). */
  inviteText(restaurant, link) {
    const rule = restaurant.referral || {};
    const vars = { restaurante: restaurant.name, desconto: discountText(rule.discountType, rule.discountValue), link: this.linkUrl(restaurant, link), nome: link.name, primeiro_nome: firstName(link.name) };
    const message = this.templates.render(link.message || rule.inviteMessage || DEFAULT_INVITE, vars, { spin: false });
    return /\{\{\s*link\s*\}\}/.test(link.message || rule.inviteMessage || DEFAULT_INVITE) ? message : `${message}\n${vars.link}`;
  }

  linkView(restaurant, link, extra = {}) {
    const share = this.inviteText(restaurant, link);
    return {
      id: link.id, slug: link.slug, name: link.name, message: link.message, clicks: link.clicks,
      url: this.linkUrl(restaurant, link), share, whatsappUrl: `https://wa.me/?text=${encodeURIComponent(share)}`, ...extra,
    };
  }

  async activeRestaurant(slug) {
    const restaurant = await this.repos.restaurants.bySlug(String(slug || ''));
    if (!restaurant) throw notFound('Restaurante não encontrado.');
    if (!ReferralService.active(restaurant.referral)) throw invalid('O programa de indicação deste restaurante não está ativo.');
    return restaurant;
  }

  static cleanSlug(raw) {
    const slug = slugify(raw);
    if (slug.length < 3 || slug.length > 30) throw invalid('O apelido do link precisa ter de 3 a 30 letras ou números.');
    return slug;
  }

  /**
   * Cria o link do cliente final. Um link por telefone no restaurante: quem já tem recebe o mesmo de volta
   * (sem a chave de edição). O contato entra sem autorização de marketing, a não ser que marque a caixa.
   */
  async createLink(body = {}) {
    const restaurant = await this.activeRestaurant(body.restaurantSlug);
    const name = text(body.name, 80);
    if (!name) throw invalid('Informe seu nome.');
    const phone = input.phone(body.phone);
    const existing = await this.repos.referrals.byPhone(restaurant.id, phone);
    if (existing) return { restaurant, link: existing, existing: true };
    const wanted = body.slug ? ReferralService.cleanSlug(body.slug) : null;
    const message = text(body.message, 500);
    const editToken = crypto.randomBytes(18).toString('base64url');
    const link = await this.repos.tx(async (r) => {
      let slug = wanted;
      if (slug) {
        if (await r.referrals.slugTaken(restaurant.id, slug)) throw invalid('Este apelido já está em uso. Escolha outro.');
      } else {
        const base = slugify(firstName(name)).slice(0, 24).padEnd(3, '0');
        slug = base;
        for (let i = 2; await r.referrals.slugTaken(restaurant.id, slug); i += 1) slug = `${base}-${i}`;
      }
      const contact = await OrderService.upsertContact(r, restaurant.id, { name, phone, optIn: body.marketingOptIn === true, optInSource: 'Programa de indicação' });
      return r.referrals.create({ restaurantId: restaurant.id, contactId: contact?.id || null, slug, name, phone, message, editToken });
    });
    return { restaurant, link, editToken };
  }

  /** Muda o apelido ou a mensagem: só com a chave entregue na criação. */
  async updateLink(id, body = {}) {
    const link = await this.repos.referrals.get(id);
    if (!link || !(await this.repos.referrals.checkToken(link.id, body.editToken))) throw Object.assign(new Error('Este link só pode ser alterado no aparelho em que foi criado.'), { status: 403 });
    const restaurant = await this.repos.restaurants.get(link.restaurantId);
    const patch = {};
    if (body.slug !== undefined) {
      const slug = ReferralService.cleanSlug(body.slug);
      if (slug !== link.slug && (await this.repos.referrals.slugTaken(restaurant.id, slug, link.id))) throw invalid('Este apelido já está em uso. Escolha outro.');
      patch.slug = slug;
    }
    if (body.message !== undefined) patch.message = text(body.message, 500);
    return { restaurant, link: await this.repos.referrals.update(link, patch) };
  }

  /** Link pelo apelido, para a faixa do site e para o redirecionamento /i/. */
  async resolve(restaurantSlug, slug) {
    const restaurant = await this.repos.restaurants.bySlug(String(restaurantSlug || ''));
    const link = restaurant && (await this.repos.referrals.bySlug(restaurant.id, slug));
    if (!link) throw notFound('Link de indicação não encontrado.');
    return { restaurant, link };
  }

  /**
   * Escolhe o desconto do pedido, dentro da transação do checkout: cupom da casa ou da campanha, indicação e
   * cupom digitado não acumulam; vale o maior (no empate: cupom digitado, depois indicação). Cupom digitado
   * inválido é erro (a pessoa corrige); indicação que não vale só não dá desconto, e o motivo volta.
   */
  async pickDiscount(r, { restaurant, subtotal, phone, contactId, referralSlug, couponCode, houseCoupon }) {
    const options = [];
    if (houseCoupon) options.push({ kind: 'house', amount: round2(subtotal * 0.1), label: houseCoupon, rank: 0 });

    let referral = null;
    if (referralSlug) {
      const rule = restaurant.referral;
      const link = await r.referrals.bySlug(restaurant.id, referralSlug);
      const reason = (() => {
        if (!link) return 'O link de indicação não existe mais.';
        if (!ReferralService.active(rule)) return 'O programa de indicação não está ativo.';
        if (MessagingProvider.phoneKey(link.phone) === MessagingProvider.phoneKey(phone)) return 'O desconto de indicação não vale para quem indicou.';
        return null;
      })();
      referral = { applied: false, by: link ? firstName(link.name) : null, reason };
      if (!reason) {
        const previous = contactId ? (await r.db.one("SELECT count(*)::int AS n FROM orders WHERE contact_id = $1 AND status <> 'canceled'", [contactId])).n : 0;
        if (previous) referral.reason = 'O desconto de indicação vale só no primeiro pedido.';
        else if (subtotal < (rule.minOrder || 0)) referral.reason = `O desconto de indicação vale para pedidos a partir de ${money(rule.minOrder)}.`;
        else options.push({ kind: 'referral', amount: ReferralService.amountOf(rule.discountType, rule.discountValue, subtotal), label: `INDICAÇÃO ${firstName(link.name).toUpperCase()}`, linkId: link.id, rank: 1 });
      }
    }

    let coupon = null;
    if (couponCode) {
      coupon = await r.coupons.byCode(restaurant.id, couponCode);
      if (!coupon) throw invalid('Cupom não encontrado.');
      if (coupon.usedAt) throw invalid('Este cupom já foi usado.');
      if (coupon.expiresAt && new Date(coupon.expiresAt) < new Date()) throw invalid('Este cupom venceu.');
      if (subtotal < (coupon.minOrder || 0)) throw invalid(`Este cupom vale para pedidos a partir de ${money(coupon.minOrder)}.`);
      options.push({ kind: 'coupon', amount: ReferralService.amountOf(coupon.discountType, coupon.discountValue, subtotal), label: coupon.code, couponId: coupon.id, rank: 2 });
    }

    const best = options.sort((a, b) => b.amount - a.amount || b.rank - a.rank)[0] || null;
    if (referral && best?.kind === 'referral') referral.applied = true;
    else if (referral && !referral.reason && best) referral.reason = 'Outro desconto maior já foi aplicado (os descontos não acumulam).';
    return {
      discount: best ? Math.min(best.amount, subtotal) : 0,
      label: best?.label || null,
      referralId: best?.kind === 'referral' ? best.linkId : null,
      couponId: best?.kind === 'coupon' ? best.couponId : null,
      referral,
      couponApplied: coupon ? best?.kind === 'coupon' : null,
    };
  }

  static newCode() {
    return Array.from({ length: 8 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join('');
  }

  /**
   * Pedido indicado concluído: cria o cupom de quem indicou (um por pedido) e manda pelo WhatsApp sem segurar a
   * resposta do painel. Devolve o cupom criado (ou null se não havia o que criar).
   */
  async onOrderCompleted(order) {
    if (!order?.referralId) return null;
    const link = await this.repos.referrals.get(order.referralId);
    const restaurant = link && (await this.repos.restaurants.get(link.restaurantId));
    const rule = restaurant?.referral;
    if (!link || !rule?.rewardValue) return null;
    const end = new Date();
    end.setDate(end.getDate() + rule.rewardValidDays);
    end.setHours(23, 59, 59, 999);
    let coupon = null;
    for (let attempt = 0; attempt < 3 && !coupon; attempt += 1) {
      try {
        coupon = await this.repos.coupons.createForOrder({
          restaurantId: restaurant.id,
          contactId: link.contactId,
          referralId: link.id,
          code: ReferralService.newCode(),
          discountType: rule.rewardType,
          discountValue: rule.rewardValue,
          minOrder: rule.rewardMinOrder || 0,
          expiresAt: end.toISOString(),
          originOrderId: order.id,
        });
        if (!coupon) return null; // o pedido já tinha gerado o cupom
      } catch (err) {
        if (!/Código de cupom repetido/.test(err.message)) throw err; // código sorteado repetido: sorteia outro
      }
    }
    this.sendReward(coupon, { order }).catch((err) => this.logger.error('[indicação]', err));
    return coupon;
  }

  /** Envia (ou reenvia) o cupom para quem indicou. Grava sentAt ou o motivo de não ter ido. */
  async sendReward(coupon, { order = null } = {}) {
    const [link, contact, restaurant, origin] = await Promise.all([
      this.repos.referrals.get(coupon.referralId),
      coupon.contactId ? this.repos.contacts.get(coupon.contactId) : null,
      this.repos.restaurants.get(coupon.restaurantId),
      order || (coupon.originOrderId ? this.repos.orders.get(coupon.originOrderId) : null),
    ]);
    const phone = contact?.phone || link?.phone;
    const skip = !phone ? 'Sem telefone para enviar.'
      : contact?.optedOut ? 'Descadastrado: o cupom não foi enviado.'
        : contact?.demo && this.messaging.key !== 'simulator' ? 'Contato fictício (só é enviado no simulador).'
          : null;
    if (skip) return this.repos.coupons.update(coupon, { sendError: skip });
    const rule = restaurant.referral || {};
    const text = this.templates.render(rule.rewardMessage || DEFAULT_REWARD, {
      nome: contact?.name || link?.name || '',
      primeiro_nome: firstName(contact?.name || link?.name) || 'cliente',
      indicado: firstName(origin?.customerName) || 'Seu amigo',
      restaurante: restaurant.name,
      cupom: coupon.code,
      desconto: discountText(coupon.discountType, coupon.discountValue),
      minimo: coupon.minOrder ? ` em pedidos a partir de ${money(coupon.minOrder)}` : '',
      validade: coupon.expiresAt ? new Date(coupon.expiresAt).toLocaleDateString('pt-BR') : 'sem prazo',
      link: `${this.config.publicUrl}/demo/${restaurant.slug}?cupom=${coupon.code}`,
    }, { spin: false });
    try {
      await this.messaging.send({ to: phone, text });
      return this.repos.coupons.update(coupon, { sentAt: new Date().toISOString(), sendError: null });
    } catch (err) {
      return this.repos.coupons.update(coupon, { sendError: err.message || 'Falha no envio.' });
    }
  }
}

ReferralService.slugify = slugify;

module.exports = { ReferralService, DEFAULT_INVITE, DEFAULT_REWARD, discountText, slugify };
