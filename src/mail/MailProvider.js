/**
 * CONTRATO DE ENVIO DE E-MAIL
 * ───────────────────────────
 * Os acessos (convite e "esqueci minha senha") dependem só desta abstração, como a fila de
 * disparo depende de MessagingProvider. Para ligar um serviço de e-mail (SMTP, SES, Resend…),
 * crie uma classe que estenda MailProvider e registre a factory em src/mail/index.js;
 * a escolha fica em MAIL_PROVIDER no .env. Nada mais muda.
 *
 * Sem serviço configurado (MAIL_PROVIDER=none), `delivers` é falso e os links aparecem na tela
 * de acessos para alguém copiar e mandar.
 */
class MailProvider {
  /** Identificador do provedor, ex.: 'smtp'. */
  static key = 'abstract';
  static label = 'Provedor abstrato';

  get key() { return this.constructor.key; }
  get label() { return this.constructor.label; }

  /** true quando o e-mail sai de verdade; false faz o sistema mostrar o link na tela. */
  get delivers() { return false; }

  /**
   * Envia um e-mail de texto simples.
   * @param {{ to: string, subject: string, text: string }} message
   * @returns {Promise<void>} rejeita com MailError se não conseguir enviar
   */
  // eslint-disable-next-line no-unused-vars
  async send(message) { throw new MailError('send() não implementado'); }
}

class MailError extends Error {
  constructor(message, code = 'send_failed') {
    super(message);
    this.code = code;
  }
}

module.exports = { MailProvider, MailError };
