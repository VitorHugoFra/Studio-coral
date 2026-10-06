const crypto = require('crypto');

const now = () => new Date().toISOString();

class Collection {
  /**
   * @param {import('./JsonStore').JsonStore} store
   * @param {string} name
   * @param {string[]} indexes campos com índice único para busca rápida
   */
  constructor(store, name, indexes = []) {
    this.store = store;
    this.name = name;
    this.indexes = Object.fromEntries(indexes.map((f) => [f, new Map()]));
    this.reindex();
  }

  get rows() {
    return this.store.collection(this.name);
  }

  reindex() {
    for (const [field, map] of Object.entries(this.indexes)) {
      map.clear();
      for (const row of this.rows) if (row[field]) map.set(row[field], row);
    }
  }

  all() { return this.rows; }
  filter(fn) { return this.rows.filter(fn); }
  find(fn) { return this.rows.find(fn); }
  get(id) { return this.rows.find((r) => r.id === id) || null; }
  by(field, value) { return this.indexes[field]?.get(value) || null; }

  create(data) {
    const row = { id: crypto.randomUUID(), createdAt: now(), ...data };
    this.rows.push(row);
    this.track(row);
    this.store.save();
    return row;
  }

  insertMany(list) {
    const rows = list.map((d) => ({ id: crypto.randomUUID(), createdAt: now(), ...d }));
    this.rows.push(...rows);
    rows.forEach((r) => this.track(r));
    this.store.save();
    return rows;
  }

  update(id, patch) {
    const row = typeof id === 'object' ? id : this.get(id);
    if (!row) return null;
    Object.assign(row, patch, { updatedAt: now() });
    this.track(row);
    this.store.save();
    return row;
  }

  remove(id) {
    const idx = this.rows.findIndex((r) => r.id === id);
    if (idx < 0) return false;
    const [row] = this.rows.splice(idx, 1);
    for (const [field, map] of Object.entries(this.indexes)) map.delete(row[field]);
    this.store.save();
    return true;
  }

  removeWhere(fn) {
    const keep = this.rows.filter((r) => !fn(r));
    const removed = this.rows.length - keep.length;
    this.store.data[this.name] = keep;
    this.reindex();
    this.store.save();
    return removed;
  }

  track(row) {
    for (const [field, map] of Object.entries(this.indexes)) if (row[field]) map.set(row[field], row);
  }
}

const DEFAULT_SETTINGS = {
  provider: null,
  minDelaySeconds: 6,
  maxDelaySeconds: 14,
  dailyLimit: 800,
  businessHoursOnly: false,
  businessHours: { start: '09:00', end: '21:00' },
  optOutKeywords: ['sair', 'parar', 'pare', 'cancelar', 'descadastrar', 'stop'],
  optOutReply: 'Pronto, você não vai mais receber nossas mensagens promocionais.',
  footer: 'Responda SAIR para não receber mais mensagens.',
};

class SettingsRepo {
  constructor(store) { this.store = store; }
  get() { return { ...DEFAULT_SETTINGS, ...this.store.object('settings') }; }
  update(patch) {
    Object.assign(this.store.object('settings'), patch);
    this.store.save();
    return this.get();
  }
}

function createRepositories(store) {
  return {
    store,
    restaurants: new Collection(store, 'restaurants', ['slug']),
    contacts: new Collection(store, 'contacts'),
    campaigns: new Collection(store, 'campaigns'),
    messages: new Collection(store, 'messages', ['code', 'providerMessageId']),
    conversions: new Collection(store, 'conversions'),
    settings: new SettingsRepo(store),
    reindexAll() {
      [this.restaurants, this.contacts, this.campaigns, this.messages, this.conversions].forEach((c) => c.reindex());
    },
  };
}

module.exports = { createRepositories, DEFAULT_SETTINGS };
