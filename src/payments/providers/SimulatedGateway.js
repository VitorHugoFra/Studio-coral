const crypto = require('crypto');
const { PaymentGateway, PaymentError } = require('../PaymentGateway');

/** QR Code de mentira (desenho), só para a demonstração mostrar onde o Pix aparece. */
const DEMO_QR = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" fill="#fff"/><g fill="#1d1710"><rect x="8" y="8" width="30" height="30"/><rect x="82" y="8" width="30" height="30"/><rect x="8" y="82" width="30" height="30"/><rect x="48" y="48" width="24" height="24"/><rect x="48" y="12" width="8" height="8"/><rect x="62" y="24" width="8" height="8"/><rect x="88" y="52" width="8" height="8"/><rect x="52" y="90" width="8" height="8"/><rect x="74" y="78" width="8" height="8"/><rect x="96" y="96" width="12" height="12"/></g><g fill="#fff"><rect x="14" y="14" width="18" height="18"/><rect x="88" y="14" width="18" height="18"/><rect x="14" y="88" width="18" height="18"/></g><text x="60" y="64" font-size="9" text-anchor="middle" fill="#fff" font-family="sans-serif">DEMO</text></svg>')}`;

/**
 * Simulador: nada sai do servidor e nada é cobrado. Guarda as cobranças em memória; "Simular pagamento" na
 * página de acompanhamento (ou pay() nos testes) confirma. Serve para a demonstração e para os testes.
 */
class SimulatedGateway extends PaymentGateway {
  static key = 'simulated';

  static label = 'Simulador';

  constructor({ fail = false } = {}) {
    super();
    this.charges = new Map();
    this.fail = fail; // nos testes: simula o gateway fora do ar
  }

  async createCharge({ orderId, value, method }) {
    if (this.fail) throw new PaymentError('O gateway de pagamento não respondeu. Tente de novo em instantes.');
    const id = `sim_${crypto.randomBytes(6).toString('hex')}`;
    const charge = { id, orderId, value, method, status: 'pending' };
    this.charges.set(id, charge);
    return {
      id,
      status: 'pending',
      url: null, // no simulador, o cartão também é "pago" pelo botão da página de acompanhamento
      pix: method === 'pix' ? { qrCode: DEMO_QR, copyPaste: `00020126SIMULADO${id.toUpperCase()}5204000053039865802BR`, expiresAt: null } : null,
    };
  }

  async getCharge(id) {
    const charge = this.charges.get(id);
    return { id, status: charge ? charge.status : 'expired' };
  }

  async cancelCharge(id) {
    const charge = this.charges.get(id);
    if (charge?.status === 'paid') return { deleted: false };
    if (charge) charge.status = 'expired';
    return { deleted: true };
  }

  async refund(id) {
    const charge = this.charges.get(id);
    if (!charge || charge.status !== 'paid') throw new PaymentError('Só cobranças pagas podem ser estornadas.', { status: 400 });
    charge.status = 'refunded';
    return { id, status: 'refunded' };
  }

  async testConnection() {
    return { ok: true, balance: 0 };
  }

  /** Confirma o pagamento (botão da demonstração e testes). */
  pay(id) {
    const charge = this.charges.get(id);
    if (!charge) throw new PaymentError('Cobrança não encontrada.', { status: 404 });
    if (charge.status === 'pending') charge.status = 'paid';
    return charge;
  }
}

module.exports = { SimulatedGateway };
