const { EventEmitter } = require('events');

/**
 * Ponto único de acesso ao envio de mensagens.
 *
 * Recebe por injeção um *registro de factories* de provedores
 * ({ simulator, wppconnect, 'whatsapp-cloud' }) e expõe o mesmo contrato de
 * MessagingProvider, delegando ao provedor ativo. Permite trocar o canal em
 * tempo de execução sem que os serviços de campanha percebam.
 */
class MessagingManager extends EventEmitter {
  /**
   * @param {{ factories: Record<string, () => import('./MessagingProvider').MessagingProvider>,
   *           initial: string, onChange?: (key: string) => void }} deps
   */
  constructor({ factories, initial, onChange }) {
    super();
    this.factories = factories;
    this.instances = new Map();
    this.onChange = onChange;
    this.activeKey = factories[initial] ? initial : Object.keys(factories)[0];
  }

  /** Lista os provedores disponíveis (para a tela Conexão). */
  listProviders() {
    return Object.keys(this.factories).map((key) => {
      const p = this.instance(key);
      return {
        key,
        label: p.label,
        description: p.constructor.description,
        capabilities: p.capabilities,
        active: key === this.activeKey,
        state: p.getStatus().state,
      };
    });
  }

  instance(key) {
    if (!this.instances.has(key)) {
      const provider = this.factories[key]();
      // Confirmações e respostas de qualquer provedor continuam valendo
      // (mensagens enviadas antes de uma troca ainda recebem status).
      provider.on('ack', (e) => this.emit('ack', { ...e, provider: key }));
      provider.on('incoming', (e) => this.emit('incoming', { ...e, provider: key }));
      provider.on('outbox', (e) => this.emit('outbox', e));
      provider.on('status', (s) => { if (key === this.activeKey) this.emit('status', s); });
      this.instances.set(key, provider);
    }
    return this.instances.get(key);
  }

  get active() {
    return this.instance(this.activeKey);
  }

  get key() {
    return this.activeKey;
  }

  async use(key) {
    if (!this.factories[key]) throw new Error(`Provedor desconhecido: ${key}`);
    if (key === this.activeKey) return this.getStatus();
    this.activeKey = key;
    this.onChange?.(key);
    this.emit('status', this.getStatus());
    return this.getStatus();
  }

  // ── Contrato MessagingProvider (delegado) ──────────────────
  start() { return this.active.start(); }
  stop() { return this.active.stop(); }
  logout() { return this.active.logout(); }
  send(message) { return this.active.send(message); }
  getStatus() { return this.active.getStatus(); }
  isConnected() { return this.active.getStatus().state === 'connected'; }
  provider(key) { return this.instances.get(key) || null; }
}

module.exports = { MessagingManager };
