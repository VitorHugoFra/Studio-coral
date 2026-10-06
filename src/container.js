/**
 * Container de injeção de dependência (mínimo, sem bibliotecas).
 *
 * Cada serviço é registrado com uma *factory* que recebe o próprio container
 * e resolve as suas dependências pelo nome. Assim nenhum serviço conhece a
 * implementação concreta do outro — apenas o contrato.
 *
 *   container.register('messaging', (c) => new MessagingManager({ ... }));
 *   const messaging = container.resolve('messaging');
 */
class Container {
  constructor() {
    this.factories = new Map();
    this.instances = new Map();
    this.resolving = new Set();
  }

  register(name, factory, { singleton = true } = {}) {
    this.factories.set(name, { factory, singleton });
    this.instances.delete(name);
    return this;
  }

  /** Registra um valor pronto (config, logger...). */
  value(name, value) {
    return this.register(name, () => value);
  }

  has(name) {
    return this.factories.has(name);
  }

  resolve(name) {
    if (this.instances.has(name)) return this.instances.get(name);
    const entry = this.factories.get(name);
    if (!entry) throw new Error(`[container] Dependência não registrada: "${name}"`);
    if (this.resolving.has(name)) throw new Error(`[container] Dependência circular em "${name}"`);

    this.resolving.add(name);
    try {
      const instance = entry.factory(this);
      if (entry.singleton) this.instances.set(name, instance);
      return instance;
    } finally {
      this.resolving.delete(name);
    }
  }
}

module.exports = { Container };
