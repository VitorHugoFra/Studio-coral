const { defineTable, isUuid, scopeId } = require('../mapper');
const { Repository } = require('./base');
const { MessagingProvider } = require('../../messaging/MessagingProvider');

const table = defineTable({
  name: 'contacts',
  columns: ['restaurantId', 'name', 'phone', 'tags', 'optIn', 'optInSource', 'optedOut', 'optedOutAt', 'notes', 'demo'],
  hidden: ['phoneKey', 'seq'],
  unique: { contacts_restaurant_phone: 'Este telefone já está na base.' },
});

class ContactsRepo extends Repository {
  constructor(db) {
    super(db, table);
  }

  beforeWrite(data) {
    return data.phone !== undefined ? { ...data, phoneKey: MessagingProvider.phoneKey(data.phone) } : data;
  }

  /** Contatos com filtros de restaurante, tag e situação (a busca por texto fica na rota). */
  async listByRestaurant({ restaurantId, tag, status } = {}) {
    const where = [];
    const params = [];
    if (restaurantId) {
      if (!isUuid(restaurantId)) return [];
      where.push(`restaurant_id = $${params.push(restaurantId)}`);
    }
    if (tag) where.push(`$${params.push(String(tag))} = ANY(tags)`);
    if (status === 'authorized') where.push('opt_in AND NOT opted_out');
    if (status === 'optedOut') where.push('opted_out');
    if (status === 'pending') where.push('NOT opt_in');
    return this.where(where.join(' AND ') || 'TRUE', params, 'seq');
  }

  async byRestaurant(restaurantId) {
    return isUuid(restaurantId) ? this.where('restaurant_id = $1', [restaurantId], 'seq') : [];
  }

  async findByPhone(restaurantId, phone) {
    if (!isUuid(restaurantId)) return null;
    return this.first('restaurant_id = $1 AND phone = $2', [restaurantId, phone]);
  }

  /** O mesmo cliente em qualquer restaurante (respostas como "SAIR"). */
  byPhoneKey(key) {
    return this.where('phone_key = $1', [key], 'seq');
  }

  /** Público de uma campanha: autorizados do restaurante, filtrados pelas tags. */
  async audience(restaurantId, segment = {}) {
    if (!isUuid(restaurantId)) return [];
    const tags = (segment.tags || []).filter(Boolean);
    const params = [restaurantId];
    let condition = 'restaurant_id = $1 AND opt_in AND NOT opted_out';
    if (tags.length) condition += ` AND tags ${segment.match === 'all' ? '@>' : '&&'} $${params.push(tags)}::text[]`;
    // ordem de cadastro/importação (seq), como o envio na versão com JSON
    return this.where(condition, params, 'seq');
  }

  async tagCounts(restaurantId) {
    return this.db.many(`
      SELECT tag, count(*)::int AS count
      FROM contacts, unnest(tags) AS tag
      WHERE ($1::uuid IS NULL OR restaurant_id = $1::uuid)
      GROUP BY tag ORDER BY count DESC, tag`, [scopeId(restaurantId)]);
  }

  async markOptedOut(ids, at) {
    // Id que não é UUID não chega ao SQL (o ::uuid[] lançaria erro)
    const valid = ids.filter(isUuid);
    if (!valid.length) return [];
    return this.mapAll(await this.db.many('UPDATE contacts SET opted_out = true, opted_out_at = $2, updated_at = now() WHERE id = ANY($1::uuid[]) RETURNING *', [valid, at]));
  }

  /** Números da base para o painel e o relatório (período opcional para novos e descadastros). */
  async stats({ restaurantId = null, from = null, to = null } = {}) {
    const row = await this.db.one(`
      SELECT count(*)::int AS total,
        count(*) FILTER (WHERE opt_in AND NOT opted_out)::int AS authorized,
        count(*) FILTER (WHERE opted_out)::int AS opted_out,
        count(*) FILTER (WHERE created_at >= $2 AND created_at < $3)::int AS created_in_range,
        count(*) FILTER (WHERE opted_out_at >= $2 AND opted_out_at < $3)::int AS opted_out_in_range
      FROM contacts WHERE ($1::uuid IS NULL OR restaurant_id = $1::uuid)`, [scopeId(restaurantId), from, to]);
    return { total: row.total, authorized: row.authorized, optedOut: row.opted_out, createdInRange: row.created_in_range, optedOutInRange: row.opted_out_in_range };
  }
}

module.exports = { ContactsRepo, table };
