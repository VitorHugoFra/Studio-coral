const { MailProvider, MailError } = require('../MailProvider');

/** Nenhum serviço de e-mail: nada sai do servidor e os links ficam na tela de acessos. */
class NoMailProvider extends MailProvider {
  static key = 'none';
  static label = 'Sem e-mail (links mostrados na tela)';

  get delivers() { return false; }

  async send() {
    throw new MailError('Nenhum serviço de e-mail configurado (MAIL_PROVIDER).', 'not_configured');
  }
}

module.exports = { NoMailProvider };
