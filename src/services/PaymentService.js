const crypto = require('crypto');
const { invalid } = require('./orderInput');
const { SecretBox } = require('../payments/secretBox');
const { PaymentError } = require('../payments/PaymentGateway');
const { AsaasGateway } = require('../payments/providers/AsaasGateway');
const { SimulatedGateway } = require('../payments/providers/SimulatedGateway');

const PROVIDERS = new Set(['asaas', 'simulated']);
const ONLINE = new Set(['pix', 'card']);
const CHECK_EVERY_MS = 15000; // consulta de reserva ao gateway enquanto o pagamento está pendente

/**
 * Etapa 5 — pagamento online (Pix e cartão) na conta do restaurante, atrás do contrato PaymentGateway.
 * Configuração e chave cifrada, criação da cobrança depois do pedido, confirmação (webhook, consulta de reserva
 * ou simulador), prazo vencido, estorno ao cancelar e o webhook do Asaas.
 */
class PaymentService {
  constructor({ repos, config, events, logger = console, factories = {}, simulator = new SimulatedGateway() }) {
    this.repos = repos;
    this.config = config;
    this.events = events;
    this.logger = logger;
    this.simulator = simulator;
    this.factories = { asaas: (opts) => new AsaasGateway(opts), ...factories };
    const secret = config.payments?.encryptionKey || config.sessionSecret;
    if (!config.payments?.encryptionKey && process.env.NODE_ENV === 'production') {
      logger.warn('⚠ ENCRYPTION_KEY não definida: as chaves de pagamento são cifradas com o SESSION_SECRET.');
    }
    this.box = new SecretBox(secret);
    this.timer = null;
  }

  // ── Configuração ───────────────────────────────────────────
  /**
   * Configuração vinda do painel → { payment, paymentSecret? }. A chave só é trocada quando vem preenchida;
   * o que fica visível é o final dela.
   */
  async configPatch(restaurant, raw = {}) {
    if (!raw || typeof raw !== 'object') return {};
    const provider = PROVIDERS.has(raw.provider) ? raw.provider : 'simulated';
    const methods = { pix: raw.methods?.pix !== false, card: raw.methods?.card === true };
    const split = raw.splitPercent === '' || raw.splitPercent === null || raw.splitPercent === undefined ? null : Number(String(raw.splitPercent).replace(',', '.'));
    if (split !== null && (!Number.isFinite(split) || split < 0 || split > 50)) throw invalid('Repasse para a agência: de 0 a 50%.');
    const timeout = raw.timeoutMinutes === '' || raw.timeoutMinutes === undefined ? 30 : Number(raw.timeoutMinutes);
    if (!Number.isInteger(timeout) || timeout < 5 || timeout > 1440) throw invalid('Prazo para pagar: de 5 a 1440 minutos.');
    const apiKey = String(raw.apiKey || '').trim();
    const current = restaurant?.payment || {};
    const payment = {
      enabled: raw.enabled === true,
      provider,
      environment: raw.environment === 'production' ? 'production' : 'sandbox',
      methods,
      splitPercent: split || null,
      timeoutMinutes: timeout,
      apiKeyLast4: apiKey ? apiKey.slice(-4) : current.apiKeyLast4 || null,
      // Trocar de ambiente com a mesma chave não funciona (o Asaas recusa): o painel avisa pela falta da chave
      hasKey: !!(apiKey || current.hasKey),
    };
    if (payment.enabled && !payment.methods.pix && !payment.methods.card) throw invalid('Escolha ao menos uma forma de pagamento online.');
    if (payment.enabled && provider === 'asaas' && !payment.hasKey) throw invalid('Cole a chave de API do Asaas do restaurante.');
    return apiKey ? { payment, paymentSecret: { apiKeyEnc: this.box.seal(apiKey) } } : { payment };
  }

  webhookToken(restaurantId) {
    return this.box.sign(`asaas-webhook:${restaurantId}`);
  }

  webhookUrl(restaurantId) {
    return `${this.config.publicUrl}/webhooks/asaas/${restaurantId}`;
  }

  /** Formas aceitas no site (nada se o pagamento online estiver desligado). */
  publicInfo(restaurant) {
    const p = restaurant?.payment;
    if (!p?.enabled) return null;
    return { methods: ['pix', 'card'].filter((m) => p.methods?.[m]), simulated: p.provider === 'simulated', timeoutMinutes: p.timeoutMinutes || 30 };
  }

  async gatewayFor(restaurant) {
    const p = restaurant?.payment;
    if (p?.provider === 'simulated') return this.simulator;
    const secret = await this.repos.restaurants.paymentSecret(restaurant.id);
    const apiKey = secret?.apiKeyEnc ? this.box.open(secret.apiKeyEnc) : null;
    return this.factories.asaas({ apiKey, environment: p?.environment || 'sandbox' });
  }

  async testConnection(restaurant) {
    return (await this.gatewayFor(restaurant)).testConnection();
  }

  /** Checkout: a forma escolhida precisa estar aceita, e o online exige CPF (o Asaas exige). */
  static checkoutMethod(restaurant, method, cpf) {
    const chosen = ONLINE.has(method) ? method : 'on_delivery';
    if (chosen === 'on_delivery') return chosen;
    const p = restaurant.payment;
    if (!p?.enabled || !p.methods?.[chosen]) throw invalid('Esta forma de pagamento não está disponível neste restaurante.');
    if (!cpf) throw invalid('Informe o CPF para pagar online.');
    return chosen;
  }

  // ── Cobrança ───────────────────────────────────────────────
  /**
   * Cria a cobrança do pedido recém-gravado. Se o gateway falhar, o pedido é cancelado (com o cupom devolvido)
   * e a pessoa recebe a explicação para tentar de novo ou pagar na entrega.
   */
  async startCharge(order, restaurant) {
    const p = restaurant.payment;
    const split = p.splitPercent && this.config.payments?.agencyWalletId ? { walletId: this.config.payments.agencyWalletId, percent: p.splitPercent } : null;
    let charge;
    try {
      const gateway = await this.gatewayFor(restaurant);
      charge = await gateway.createCharge({
        orderId: order.id,
        number: order.number,
        value: order.value,
        method: order.paymentMethod,
        description: `Pedido #${order.number} · ${restaurant.name}`,
        customer: { name: order.customerName, cpf: order.cpf, phone: order.phone },
        split,
      });
    } catch (err) {
      this.logger.error('[pagamento]', err.message);
      await this.closeUnpaid(order, 'failed', `Pagamento não gerado: ${err.message}`);
      throw new PaymentError('Não foi possível gerar o pagamento agora. Tente de novo ou escolha pagar na entrega.', { status: 502, cause: err });
    }
    return this.repos.orders.setPayment(order, {
      from: ['pending'],
      patch: { paymentProvider: p.provider, paymentId: charge.id, paymentUrl: charge.url, paymentPix: charge.pix, paymentCheckedAt: new Date().toISOString() },
    });
  }

  /** Pagamento que não aconteceu (falha, vencido): cancela o pedido e devolve o cupom. */
  async closeUnpaid(order, status, note) {
    const at = new Date().toISOString();
    const saved = await this.repos.orders.setPayment(order, { from: ['pending'], patch: { paymentStatus: status, paymentError: note } });
    if (!saved) return null;
    if (!['completed', 'canceled'].includes(saved.status)) {
      await this.repos.orders.changeStatus(saved, { from: saved.status, to: 'canceled', entry: { status: 'canceled', at, by: 'Pagamento', note } });
    }
    await this.repos.coupons.release(saved.id);
    this.events.publish('order:update', saved);
    return saved;
  }

  /** Aplica a situação vinda do gateway (webhook, consulta, simulador). Repetida, não faz nada. */
  async applyStatus(order, status) {
    if (status === 'paid') {
      const saved = await this.repos.orders.setPayment(order, { from: ['pending'], patch: { paymentStatus: 'paid', paidAt: new Date().toISOString(), paymentError: null } });
      if (!saved) return order;
      const restaurant = await this.repos.restaurants.get(saved.restaurantId);
      // Só agora o pedido vale para a cozinha: aviso e som no quadro, como um pedido novo
      this.events.publish('order', { ...saved, restaurant: restaurant?.name });
      return saved;
    }
    if (status === 'expired' || status === 'failed') {
      return (await this.closeUnpaid(order, status, status === 'expired' ? 'Pagamento não feito no prazo.' : 'Pagamento recusado.')) || order;
    }
    if (status === 'refunded') {
      return (await this.repos.orders.setPayment(order, { from: ['paid'], patch: { paymentStatus: 'refunded' } })) || order;
    }
    return order;
  }

  /** Consulta de reserva (página de acompanhamento): confirma sem depender do webhook. */
  async refresh(order) {
    if (order?.paymentStatus !== 'pending' || !order.paymentId) return order;
    if (order.paymentCheckedAt && Date.now() - new Date(order.paymentCheckedAt).getTime() < CHECK_EVERY_MS) return order;
    await this.repos.orders.setPayment(order, { from: ['pending'], patch: { paymentCheckedAt: new Date().toISOString() } });
    try {
      const restaurant = await this.repos.restaurants.get(order.restaurantId);
      const charge = await (await this.gatewayFor(restaurant)).getCharge(order.paymentId);
      return await this.applyStatus(order, charge.status);
    } catch (err) {
      this.logger.warn('[pagamento] consulta falhou:', err.message);
      return order;
    }
  }

  /** Prazo vencido: apaga a cobrança e cancela o pedido; se o gateway disser que já foi paga, vale o pagamento. */
  async sweep(now = Date.now()) {
    const candidates = await this.repos.orders.pendingPaymentsBefore(new Date(now - 5 * 60e3).toISOString());
    const restaurants = new Map();
    for (const order of candidates) {
      if (!restaurants.has(order.restaurantId)) restaurants.set(order.restaurantId, await this.repos.restaurants.get(order.restaurantId));
      const restaurant = restaurants.get(order.restaurantId);
      const limit = (restaurant?.payment?.timeoutMinutes || 30) * 60e3;
      if (now - new Date(order.createdAt).getTime() < limit) continue;
      try {
        if (!order.paymentId || !restaurant) { await this.applyStatus(order, 'expired'); continue; }
        const gateway = await this.gatewayFor(restaurant);
        const { deleted } = await gateway.cancelCharge(order.paymentId);
        const status = deleted ? 'expired' : (await gateway.getCharge(order.paymentId)).status;
        await this.applyStatus(order, status === 'pending' ? 'expired' : status);
      } catch (err) {
        this.logger.warn('[pagamento] varredura:', err.message);
      }
    }
  }

  start() {
    const every = (this.config.payments?.sweepSeconds || 60) * 1000;
    if (every > 0 && !this.timer) {
      this.timer = setInterval(() => this.sweep().catch((err) => this.logger.error('[pagamento]', err)), every);
      this.timer.unref();
    }
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  /** Pedido pago cancelado pelo restaurante: estorno total. O erro fica no pedido, sem desfazer o cancelamento. */
  async refundIfPaid(order) {
    if (order?.paymentStatus !== 'paid' || !order.paymentId) return order;
    try {
      const restaurant = await this.repos.restaurants.get(order.restaurantId);
      await (await this.gatewayFor(restaurant)).refund(order.paymentId);
      return (await this.repos.orders.setPayment(order, { from: ['paid'], patch: { paymentStatus: 'refunded', paymentError: null } })) || order;
    } catch (err) {
      this.logger.error('[pagamento] estorno:', err.message);
      return (await this.repos.orders.setPayment(order, { from: ['paid'], patch: { paymentError: `Estorno não feito: ${err.message}` } })) || order;
    }
  }

  /** Demonstração: o botão "Simular pagamento" da página de acompanhamento. */
  async simulatePayment(order) {
    if (order?.paymentProvider !== 'simulated' || order.paymentStatus !== 'pending') throw invalid('Este pedido não tem pagamento simulado pendente.');
    this.simulator.pay(order.paymentId);
    return this.applyStatus(order, 'paid');
  }

  // ── Webhook do Asaas ───────────────────────────────────────
  /** Devolve o código HTTP: 401 com token errado; 200 para o resto (inclusive eventos que não nos interessam). */
  async handleAsaasWebhook(restaurantId, token, body = {}) {
    const expected = Buffer.from(this.webhookToken(restaurantId));
    const got = Buffer.from(String(token || ''));
    if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) return 401;
    const status = AsaasGateway.eventStatus(body.event);
    const paymentId = body.payment?.id;
    if (!status || !paymentId) return 200;
    const order = await this.repos.orders.byPaymentId('asaas', paymentId);
    if (!order || order.restaurantId !== restaurantId) return 200;
    await this.applyStatus(order, status);
    return 200;
  }
}

module.exports = { PaymentService };
