/**
 * CONTRATO DE PAGAMENTO
 * ─────────────────────
 * O checkout, o webhook e o painel só conhecem esta abstração (como a mensageria conhece o MessagingProvider).
 * Trocar de gateway é escrever outra implementação e registrá-la em src/payments/index.js.
 *
 * Situação da cobrança, já traduzida para o sistema:
 *   'pending' | 'paid' | 'expired' | 'refunded' | 'failed'
 */
class PaymentGateway {
  static key = 'abstract';

  static label = 'Gateway abstrato';

  get key() { return this.constructor.key; }

  /**
   * Cria a cobrança de um pedido.
   * @param {{ orderId: string, number: number|null, value: number, method: 'pix'|'card', description: string,
   *           customer: { name: string, cpf: string, phone: string }, split?: { walletId: string, percent: number } }} charge
   * @returns {Promise<{ id: string, status: string, url: string|null, pix: { qrCode: string, copyPaste: string, expiresAt: string|null }|null }>}
   */
  // eslint-disable-next-line no-unused-vars
  async createCharge(charge) { throw new Error('createCharge() não implementado'); }

  /** @returns {Promise<{ id: string, status: string }>} */
  // eslint-disable-next-line no-unused-vars
  async getCharge(id) { throw new Error('getCharge() não implementado'); }

  /** Apaga a cobrança ainda não paga (prazo vencido). */
  // eslint-disable-next-line no-unused-vars
  async cancelCharge(id) { throw new Error('cancelCharge() não implementado'); }

  /** Estorno total. */
  // eslint-disable-next-line no-unused-vars
  async refund(id) { throw new Error('refund() não implementado'); }

  /** Confere a chave e devolve algo para mostrar (ex.: saldo). */
  async testConnection() { throw new Error('testConnection() não implementado'); }
}

class PaymentError extends Error {
  constructor(message, { status = 502, cause } = {}) {
    super(message, { cause });
    this.status = status;
  }
}

module.exports = { PaymentGateway, PaymentError };
