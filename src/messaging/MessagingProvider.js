const { EventEmitter } = require('events');

/**
 * CONTRATO DE ENVIO DE MENSAGENS
 * ───────────────────────────────
 * Toda a plataforma (campanhas, fila de disparo, testes) depende apenas desta
 * abstração. Para trocar o canal — por exemplo, sair do WPPConnect e ir para a
 * API Oficial do WhatsApp quando o faturamento começar — basta registrar outra
 * implementação no container (ver src/messaging/index.js). Nada mais muda.
 *
 * Estados de conexão:
 *   'disconnected' | 'starting' | 'qr' | 'connected' | 'error'
 *
 * Eventos emitidos:
 *   'status'   → { state, qr?, me?, message? }
 *   'ack'      → { providerMessageId, status: 'sent'|'delivered'|'read'|'failed', error? }
 *   'incoming' → { from, body, at }
 *   'outbox'   → (somente simulador) mensagem enviada, para o celular virtual
 */
class MessagingProvider extends EventEmitter {
  /** Identificador do provedor, ex.: 'wppconnect'. */
  static key = 'abstract';
  static label = 'Provedor abstrato';
  static description = '';
  /** Recursos que a interface pode exibir/ocultar conforme o provedor. */
  static capabilities = { qrLogin: false, templates: false, media: true, typing: false };

  constructor() {
    super();
    this.state = { state: 'disconnected', qr: null, me: null, message: null, updatedAt: new Date().toISOString() };
  }

  get key() { return this.constructor.key; }
  get label() { return this.constructor.label; }
  get capabilities() { return this.constructor.capabilities; }

  /** Inicia/conecta a sessão. Deve ser idempotente. */
  async start() { throw new Error('start() não implementado'); }

  /** Encerra a conexão mantendo a sessão salva (quando aplicável). */
  async stop() { throw new Error('stop() não implementado'); }

  /** Desconecta e apaga a sessão (exige novo login/QR). */
  async logout() { return this.stop(); }

  /**
   * Envia uma mensagem.
   * @param {{ to: string, text: string,
   *           media?: { url: string, publicUrl: string, path?: string, mimetype: string, filename: string },
   *           template?: { name: string, language?: string, params?: string[] } }} message
   *   media: imagem enviada com o texto como legenda (ver MediaService.resolve)
   * @returns {Promise<{ providerMessageId: string|null, to: string }>}
   */
  // eslint-disable-next-line no-unused-vars
  async send(message) { throw new Error('send() não implementado'); }

  getStatus() {
    return { provider: this.key, label: this.label, capabilities: this.capabilities, ...this.state };
  }

  /** Normaliza telefone brasileiro para apenas dígitos com DDI 55. */
  static normalizePhone(raw) {
    let digits = String(raw || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.startsWith('00')) digits = digits.slice(2);
    if (digits.length <= 11) digits = `55${digits.replace(/^0/, '')}`;
    return digits;
  }

  /** Atualiza o estado e notifica os ouvintes. */
  setState(state, extra = {}) {
    this.state = { ...this.state, qr: null, message: null, ...extra, state, updatedAt: new Date().toISOString() };
    this.emit('status', this.getStatus());
  }
}

class MessagingError extends Error {
  constructor(message, code = 'send_failed') {
    super(message);
    this.code = code;
  }
}

module.exports = { MessagingProvider, MessagingError };
