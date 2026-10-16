const { NoMailProvider } = require('./providers/NoMailProvider');

/**
 * Registro dos provedores de e-mail no container de DI.
 *
 * ➜ Para ligar um serviço de e-mail, crie uma classe que estenda MailProvider
 *   (src/mail/MailProvider.js), inclua a factory abaixo e defina MAIL_PROVIDER no .env.
 */
function registerMail(container) {
  container.register('mail.factories', () => ({
    none: () => new NoMailProvider(),
  }));

  container.register('mail', (c) => {
    const factories = c.resolve('mail.factories');
    const key = c.resolve('config').mail?.provider || 'none';
    if (!factories[key]) throw new Error(`Provedor de e-mail desconhecido em MAIL_PROVIDER: "${key}". Disponíveis: ${Object.keys(factories).join(', ')}.`);
    return factories[key]();
  });
}

module.exports = { registerMail };
