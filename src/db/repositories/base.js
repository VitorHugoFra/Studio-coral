const crypto = require('crypto');
const { isUuid } = require('../mapper');

const CHUNK = 500; // linhas por INSERT (o PostgreSQL aceita até 65.535 parâmetros)

/**
 * Operações comuns a todos os repositórios; cada repositório acrescenta as
 * consultas próprias. Condições e ordenações recebidas como texto são de uso
 * interno (nunca vêm do usuário).
 */
class Repository {
  constructor(db, table) {
    this.db = db;
    this.table = table;
  }

  get name() {
    return this.table.name;
  }

  /** Gancho para calcular colunas derivadas antes de gravar (ex.: phone_key). */
  beforeWrite(data) {
    return data;
  }

  map(row) {
    return this.table.fromRow(row);
  }

  mapAll(rows) {
    return rows.map((row) => this.table.fromRow(row));
  }

  /** Executa uma escrita traduzindo violações de unicidade em mensagens amigáveis. */
  async write(fn) {
    try {
      return await fn();
    } catch (err) {
      const friendly = err.code === '23505' && this.table.unique[err.constraint];
      if (friendly) throw Object.assign(new Error(friendly), { status: 400, cause: err });
      throw err;
    }
  }

  async get(id) {
    if (!isUuid(id)) return null;
    return this.map(await this.db.one(`SELECT * FROM ${this.name} WHERE id = $1`, [id]));
  }

  async all(order = 'created_at, id') {
    return this.mapAll(await this.db.many(`SELECT * FROM ${this.name} ORDER BY ${order}`));
  }

  async count() {
    return (await this.db.one(`SELECT count(*)::int AS n FROM ${this.name}`)).n;
  }

  async where(condition, params = [], order = 'created_at, id') {
    return this.mapAll(await this.db.many(`SELECT * FROM ${this.name} WHERE ${condition} ORDER BY ${order}`, params));
  }

  async first(condition, params = [], order = 'created_at, id') {
    return this.map(await this.db.one(`SELECT * FROM ${this.name} WHERE ${condition} ORDER BY ${order} LIMIT 1`, params));
  }

  async create(data, options) {
    const [row] = await this.insertMany([data], options);
    return row || null;
  }

  /**
   * Insere várias linhas, em lotes. Campos ausentes recebem o DEFAULT da coluna.
   * options.onConflict: trecho "ON CONFLICT … DO NOTHING"; linhas ignoradas não voltam.
   */
  async insertMany(list, { onConflict = '' } = {}) {
    if (!list.length) return [];
    const now = new Date().toISOString();
    const maps = list.map((d) => this.table.toColumns(this.beforeWrite({ id: crypto.randomUUID(), createdAt: now, ...d })));
    const out = [];
    for (let i = 0; i < maps.length; i += CHUNK) {
      const chunk = maps.slice(i, i + CHUNK);
      const cols = [...new Set(chunk.flatMap((m) => [...m.keys()]))];
      const params = [];
      const tuples = chunk.map((m) => `(${cols.map((c) => (m.has(c) ? `$${params.push(m.get(c))}` : 'DEFAULT')).join(', ')})`);
      const sql = `INSERT INTO ${this.name} (${cols.join(', ')}) VALUES ${tuples.join(', ')} ${onConflict} RETURNING *`;
      out.push(...this.mapAll(await this.write(() => this.db.many(sql, params))));
    }
    return out;
  }

  /**
   * Atualiza e devolve a linha. Recebendo o objeto (e não só o id), copia nele
   * o resultado: quem guardou a referência continua vendo o estado atual.
   */
  async update(target, patch) {
    const id = target && typeof target === 'object' ? target.id : target;
    if (!isUuid(id)) return null;
    const map = this.table.toColumns(this.beforeWrite({ ...patch, updatedAt: new Date().toISOString() }));
    map.delete('id');
    const params = [id];
    const sets = [...map].map(([col, value]) => `${col} = $${params.push(value)}`);
    const row = this.map(await this.write(() => this.db.one(`UPDATE ${this.name} SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, params)));
    if (row && target && typeof target === 'object') Object.assign(target, row);
    return row;
  }

  async remove(id) {
    if (!isUuid(id)) return false;
    const res = await this.db.query(`DELETE FROM ${this.name} WHERE id = $1`, [id]);
    return (res.rowCount ?? res.affectedRows ?? 0) > 0;
  }
}

module.exports = { Repository };
