const { PaymentGateway, PaymentError } = require('../PaymentGateway');

const BASE = {
  sandbox: 'https://api-sandbox.asaas.com/v3',
  production: 'https://api.asaas.com/v3',
};

/** Status da cobrança no Asaas → situação no sistema. */
const STATUS = {
  PENDING: 'pending',
  AWAITING_RISK_ANALYSIS: 'pending',
  CONFIRMED: 'paid',
  RECEIVED: 'paid',
  RECEIVED_IN_CASH: 'paid',
  OVERDUE: 'expired',
  REFUNDED: 'refunded',
  REFUND_REQUESTED: 'refunded',
  REFUND_IN_PROGRESS: 'refunded',
};

/** Eventos do webhook → situação no sistema (os outros eventos não mudam nada). */
const EVENTS = {
  PAYMENT_CONFIRMED: 'paid',
  PAYMENT_RECEIVED: 'paid',
  PAYMENT_OVERDUE: 'expired',
  PAYMENT_DELETED: 'expired',
  PAYMENT_REFUNDED: 'refunded',
  PAYMENT_CREDIT_CARD_CAPTURE_REFUSED: 'failed',
  PAYMENT_REPROVED_BY_RISK_ANALYSIS: 'failed',
};

const today = () => new Date().toLocaleDateString('sv-SE');

/**
 * Asaas (API v3), na conta do próprio restaurante. A chave vai no cabeçalho `access_token`; a URL e a chave
 * precisam ser do mesmo ambiente (sandbox ou produção). O cartão é pago na fatura do Asaas (invoiceUrl).
 */
class AsaasGateway extends PaymentGateway {
  static key = 'asaas';

  static label = 'Asaas';

  constructor({ apiKey, environment = 'sandbox', fetchImpl = globalThis.fetch, userAgent = 'StudioCoral/1.0' }) {
    super();
    if (!apiKey) throw new PaymentError('O restaurante ainda não cadastrou a chave do Asaas.', { status: 400 });
    this.apiKey = apiKey;
    this.base = BASE[environment] || BASE.sandbox;
    this.fetch = fetchImpl;
    this.userAgent = userAgent;
  }

  static statusOf(asaasStatus, deleted = false) {
    if (deleted) return 'expired';
    return STATUS[asaasStatus] || 'pending';
  }

  static eventStatus(event) {
    return EVENTS[event] || null;
  }

  async request(method, path, body) {
    let res;
    try {
      res = await this.fetch(`${this.base}${path}`, {
        method,
        headers: { access_token: this.apiKey, 'Content-Type': 'application/json', 'User-Agent': this.userAgent },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15000),
      });
    } catch (err) {
      throw new PaymentError('O Asaas não respondeu. Tente de novo em instantes.', { cause: err });
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) throw new PaymentError('Chave do Asaas inválida ou de outro ambiente (sandbox × produção).', { status: 400 });
    if (!res.ok) throw new PaymentError(`Asaas: ${data?.errors?.[0]?.description || `erro ${res.status}`}`, { status: res.status >= 500 ? 502 : 400 });
    return data;
  }

  /** Cliente pelo CPF: reaproveita o que já existe na conta do restaurante. */
  async ensureCustomer({ name, cpf, phone }) {
    const found = await this.request('GET', `/customers?cpfCnpj=${encodeURIComponent(cpf)}&limit=1`);
    if (found?.data?.[0]?.id) return found.data[0].id;
    const created = await this.request('POST', '/customers', {
      name,
      cpfCnpj: cpf,
      mobilePhone: String(phone || '').replace(/^55/, ''),
      notificationDisabled: true, // o Asaas não manda e-mail ou SMS próprio para cada pedido
    });
    return created.id;
  }

  async createCharge({ orderId, value, method, description, customer, split }) {
    const customerId = await this.ensureCustomer(customer);
    const payment = await this.request('POST', '/payments', {
      customer: customerId,
      billingType: method === 'pix' ? 'PIX' : 'CREDIT_CARD',
      value,
      dueDate: today(),
      description: String(description || '').slice(0, 500),
      externalReference: orderId,
      ...(split ? { split: [{ walletId: split.walletId, percentualValue: split.percent }] } : {}),
    });
    let pix = null;
    if (method === 'pix') {
      const qr = await this.request('GET', `/payments/${payment.id}/pixQrCode`);
      pix = { qrCode: qr.encodedImage ? `data:image/png;base64,${qr.encodedImage}` : null, copyPaste: qr.payload || null, expiresAt: qr.expirationDate || null };
    }
    return { id: payment.id, status: AsaasGateway.statusOf(payment.status), url: payment.invoiceUrl || null, pix };
  }

  async getCharge(id) {
    const payment = await this.request('GET', `/payments/${encodeURIComponent(id)}`);
    return { id: payment.id, status: AsaasGateway.statusOf(payment.status, payment.deleted) };
  }

  async cancelCharge(id) {
    const res = await this.request('DELETE', `/payments/${encodeURIComponent(id)}`);
    return { deleted: !!res.deleted };
  }

  async refund(id) {
    const payment = await this.request('POST', `/payments/${encodeURIComponent(id)}/refund`, { description: 'Pedido cancelado pelo restaurante' });
    return { id: payment.id, status: AsaasGateway.statusOf(payment.status) };
  }

  async testConnection() {
    const balance = await this.request('GET', '/finance/balance');
    return { ok: true, balance: Number(balance.balance) || 0 };
  }
}

module.exports = { AsaasGateway, BASE };
