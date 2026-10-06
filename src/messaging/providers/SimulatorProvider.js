const crypto = require('crypto');
const { MessagingProvider, MessagingError } = require('../MessagingProvider');

const rand = (min, max) => Math.floor(min + Math.random() * (max - min));

/**
 * Provedor de DEMONSTRAÇÃO.
 * Nenhuma mensagem sai do servidor: os envios aparecem no "celular virtual"
 * da tela Conexão, com confirmações de entrega e leitura simuladas. Os links
 * rastreáveis funcionam de verdade, então o funil completo pode ser
 * demonstrado (mensagem → clique → site do restaurante → pedido → relatório).
 */
class SimulatorProvider extends MessagingProvider {
  static key = 'simulator';
  static label = 'Simulador (demonstração)';
  static description = 'Nada é enviado de verdade. Ideal para apresentar a plataforma a restaurantes.';
  static capabilities = { qrLogin: false, templates: false, media: true, typing: false, outbox: true };

  constructor({ failRate = 0.03, deliveryRate = 0.96, readRate = 0.72 } = {}) {
    super();
    this.failRate = failRate;
    this.deliveryRate = deliveryRate;
    this.readRate = readRate;
    this.outbox = [];
    this.timers = new Set();
  }

  async start() {
    if (this.state.state === 'connected') return;
    this.setState('starting');
    await new Promise((r) => setTimeout(r, 600));
    this.setState('connected', { me: { name: 'Studio Coral · Simulador', number: '55 31 90000-0000' } });
  }

  async stop() {
    this.timers.forEach(clearTimeout);
    this.timers.clear();
    this.setState('disconnected');
  }

  later(fn, ms) {
    const t = setTimeout(() => { this.timers.delete(t); fn(); }, ms);
    this.timers.add(t);
  }

  async send({ to, text, media }) {
    if (this.state.state !== 'connected') throw new MessagingError('Simulador desconectado. Conecte na tela Conexão.', 'not_connected');
    const number = MessagingProvider.normalizePhone(to);
    if (number.length < 12) throw new MessagingError('Número inválido', 'invalid_number');

    await new Promise((r) => setTimeout(r, rand(120, 400)));
    if (Math.random() < this.failRate) throw new MessagingError('Número não possui WhatsApp', 'not_on_whatsapp');

    const providerMessageId = `sim_${crypto.randomUUID()}`;
    const item = { id: providerMessageId, to: number, text, mediaUrl: media?.url || null, at: new Date().toISOString(), status: 'sent' };
    this.outbox.unshift(item);
    this.outbox.length = Math.min(this.outbox.length, 200);
    this.emit('outbox', item);

    if (Math.random() < this.deliveryRate) {
      this.later(() => {
        item.status = 'delivered';
        this.emit('ack', { providerMessageId, status: 'delivered' });
        if (Math.random() < this.readRate) {
          this.later(() => {
            item.status = 'read';
            this.emit('ack', { providerMessageId, status: 'read' });
          }, rand(2500, 15000));
        }
      }, rand(700, 3000));
    }

    return { providerMessageId, to: number };
  }

  getOutbox() {
    return this.outbox;
  }

  /** Simula uma resposta do cliente (ex.: "SAIR") para testar o descadastro. */
  simulateIncoming(from, body) {
    this.emit('incoming', { from: MessagingProvider.normalizePhone(from), body, at: new Date().toISOString() });
  }
}

module.exports = { SimulatorProvider };
