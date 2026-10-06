const { MessagingManager } = require('./MessagingManager');
const { SimulatorProvider } = require('./providers/SimulatorProvider');
const { WppConnectProvider } = require('./providers/WppConnectProvider');
const { WhatsAppCloudProvider } = require('./providers/WhatsAppCloudProvider');

/**
 * Registro dos provedores de mensagem no container de DI.
 *
 * ➜ Para adicionar um novo canal (ex.: Z-API, Twilio, SMS), crie uma classe
 *   que estenda MessagingProvider e inclua uma factory abaixo.
 * ➜ Para trocar o canal padrão, altere MESSAGING_PROVIDER no .env
 *   (ou use a tela "Conexão" no painel).
 */
function registerMessaging(container) {
  container.register('messaging.factories', (c) => {
    const { messaging } = c.resolve('config');
    return {
      simulator: () => new SimulatorProvider(),
      wppconnect: () => new WppConnectProvider({ ...messaging.wppconnect, logger: c.resolve('logger') }),
      'whatsapp-cloud': () => new WhatsAppCloudProvider(messaging.whatsappCloud),
    };
  });

  container.register('messaging', (c) => {
    const settings = c.resolve('repos').settings;
    const envProvider = c.resolve('config').messaging.provider;
    const saved = settings.get();
    // A escolha feita na tela Conexão vale até o MESSAGING_PROVIDER do .env ser alterado.
    const initial = saved.provider && saved.providerEnvBase === envProvider ? saved.provider : envProvider;
    return new MessagingManager({
      factories: c.resolve('messaging.factories'),
      initial,
      onChange: (key) => settings.update({ provider: key, providerEnvBase: envProvider }),
    });
  });
}

module.exports = { registerMessaging };
