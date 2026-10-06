const fs = require('fs');
const path = require('path');

/**
 * Armazenamento em arquivo JSON (data/db.json).
 * Suficiente para o protótipo e sem dependências nativas. Toda leitura/escrita
 * passa pelos repositórios (src/db/repositories.js), então migrar para
 * PostgreSQL/MySQL depois exige trocar apenas esta camada.
 */
class JsonStore {
  constructor(file) {
    this.file = file;
    this.data = {};
    this.timer = null;
    this.load();
  }

  load() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    if (fs.existsSync(this.file)) {
      this.data = JSON.parse(fs.readFileSync(this.file, 'utf8') || '{}');
    }
  }

  collection(name) {
    if (!Array.isArray(this.data[name])) this.data[name] = [];
    return this.data[name];
  }

  object(name) {
    if (!this.data[name] || typeof this.data[name] !== 'object') this.data[name] = {};
    return this.data[name];
  }

  reset() {
    this.data = {};
    this.flush();
  }

  /** Agenda a gravação (agrupa várias alterações em uma escrita). */
  save() {
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), 250);
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { JsonStore };
