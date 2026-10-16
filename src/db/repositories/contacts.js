const { defineTable, isUuid, scopeId } = require('../mapper');
const { Repository } = require('./base');
const { MessagingProvider } = require('../../messaging/MessagingProvider');
const { birthdayPairs } = require('../../services/audienceFilters');
const { ITEMS, QTY } = require('./orders');

const table = defineTable({
  name: 'contacts',
  columns: ['restaurantId', 'name', 'phone', 'tags', 'optIn', 'optInSource', 'optedOut', 'optedOutAt', 'notes', 'demo', 'birthDay', 'birthMonth', 'birthYear', 'neighborhood'],
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

  /** O cliente do restaurante pelo telefone, mesmo escrito de outro jeito (com ou sem o 9º dígito). */
  async findByPhoneKey(restaurantId, phone) {
    if (!isUuid(restaurantId)) return null;
    return this.first('restaurant_id = $1 AND phone_key = $2', [restaurantId, MessagingProvider.phoneKey(phone)], 'seq');
  }

  /** Cria o contato; se o telefone já estiver no restaurante (outro pedido ao mesmo tempo), devolve null. */
  createIfAbsent(data) {
    return this.create(data, { onConflict: 'ON CONFLICT (restaurant_id, phone) DO NOTHING' });
  }

  /** O mesmo cliente em qualquer restaurante (respostas como "SAIR"). */
  byPhoneKey(key) {
    return this.where('phone_key = $1', [key], 'seq');
  }

  /** Público de uma campanha: autorizados do restaurante, filtrados pelas tags e pelos filtros de compra. */
  async audience(restaurantId, segment = {}) {
    if (!isUuid(restaurantId)) return [];
    return this.search({ restaurantId, tags: segment.tags || [], match: segment.match, filters: segment.filters || {}, authorizedOnly: true });
  }

  /**
   * Contatos com o perfil de compra calculado na hora (pedidos que não foram cancelados) e os filtros de
   * público (src/services/audienceFilters.js, já normalizados). Uma consulta: uma CTE soma os pedidos por
   * contato e outra escolhe o item mais comprado. Ordem de cadastro/importação (seq), que é a ordem de envio.
   * O dia da semana e os limites dos dias seguem o fuso do servidor, como os relatórios.
   */
  async search({ restaurantId = null, id = null, tag, status, tags = [], match = 'any', filters = {}, authorizedOnly = false, now = new Date() } = {}) {
    if ((restaurantId && !isUuid(restaurantId)) || (id && !isUuid(id))) return [];
    const params = [];
    const p = (value) => `$${params.push(value)}`;
    const scope = restaurantId ? p(restaurantId) : null;
    const tz = p(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
    const inScope = scope ? `o.restaurant_id = ${scope}` : 'TRUE';
    const where = [];
    if (scope) where.push(`c.restaurant_id = ${scope}`);
    if (id) where.push(`c.id = ${p(id)}`);
    if (authorizedOnly || status === 'authorized') where.push('c.opt_in AND NOT c.opted_out');
    if (status === 'optedOut') where.push('c.opted_out');
    if (status === 'pending') where.push('NOT c.opt_in');
    if (tag) where.push(`${p(String(tag))} = ANY(c.tags)`);
    const wanted = tags.filter(Boolean);
    if (wanted.length) where.push(`c.tags ${match === 'all' ? '@>' : '&&'} ${p(wanted)}::text[]`);

    const f = filters || {};
    const atLeast = (expr, value) => value !== undefined && where.push(`${expr} >= ${p(value)}`);
    const atMost = (expr, value) => value !== undefined && where.push(`${expr} <= ${p(value)}`);
    atLeast('COALESCE(s.orders, 0)', f.orders?.min);
    atMost('COALESCE(s.orders, 0)', f.orders?.max);
    atLeast('COALESCE(s.spent, 0)', f.spent?.min);
    atMost('COALESCE(s.spent, 0)', f.spent?.max);
    // "No mínimo N dias sem comprar" = a última compra foi antes de agora − N dias (quem nunca comprou não entra)
    const daysAgo = (days) => new Date(now.getTime() - days * 864e5).toISOString();
    if (f.lastOrderDays?.min !== undefined) where.push(`s.last_at <= ${p(daysAgo(f.lastOrderDays.min))}`);
    if (f.lastOrderDays?.max !== undefined) where.push(`s.last_at >= ${p(daysAgo(f.lastOrderDays.max))}`);
    // Datas AAAA-MM-DD: o dia inteiro, da meia-noite (fuso do servidor) até a meia-noite seguinte
    const dayStart = (s, plus = 0) => {
      const [y, m, d] = s.split('-').map(Number);
      return new Date(y, m - 1, d + plus).toISOString();
    };
    for (const [key, col] of [['firstOrder', 's.first_at'], ['lastOrder', 's.last_at']]) {
      if (f[key]?.from) where.push(`${col} >= ${p(dayStart(f[key].from))}`);
      if (f[key]?.to) where.push(`${col} < ${p(dayStart(f[key].to, 1))}`);
    }
    if (f.birthday?.month) where.push(`c.birth_month = ${p(f.birthday.month)}`);
    if (f.birthday?.nextDays) {
      const pairs = birthdayPairs(f.birthday.nextDays, now);
      where.push(`(c.birth_month, c.birth_day) IN (SELECT m, d FROM unnest(${p(pairs.map(([m]) => m))}::int[], ${p(pairs.map(([, d]) => d))}::int[]) AS t(m, d))`);
    }
    if (f.neighborhoods?.length) where.push(`lower(COALESCE(NULLIF(c.neighborhood, ''), s.last_neighborhood)) = ANY(${p(f.neighborhoods.map((n) => n.toLowerCase()))}::text[])`);
    if (f.items?.length) {
      const items = p(f.items);
      where.push(f.itemsMode === 'any'
        ? `EXISTS (SELECT 1 FROM orders o2 CROSS JOIN LATERAL jsonb_array_elements(${ITEMS('o2')}) AS it2 WHERE o2.contact_id = c.id AND o2.status <> 'canceled' AND it2->>'name' = ANY(${items}::text[]))`
        : `t.top_item = ANY(${items}::text[])`);
    }
    if (f.weekdays?.length) where.push(`s.weekday = ANY(${p(f.weekdays)}::int[])`);

    const rows = await this.db.many(`
      WITH stats AS (
        SELECT o.contact_id, count(*)::int AS orders, sum(o.value) AS spent, min(o.created_at) AS first_at, max(o.created_at) AS last_at,
          (array_agg(o.neighborhood ORDER BY o.created_at DESC) FILTER (WHERE o.neighborhood IS NOT NULL AND o.neighborhood <> ''))[1] AS last_neighborhood,
          mode() WITHIN GROUP (ORDER BY extract(dow FROM o.created_at AT TIME ZONE ${tz})::int) AS weekday
        FROM orders o
        WHERE o.contact_id IS NOT NULL AND o.status <> 'canceled' AND ${inScope}
        GROUP BY o.contact_id
      ), bought AS (
        SELECT o.contact_id, it->>'name' AS name, sum(${QTY('it')}) AS qty, max(o.created_at) AS last_at
        FROM orders o CROSS JOIN LATERAL jsonb_array_elements(${ITEMS('o')}) AS it
        WHERE o.contact_id IS NOT NULL AND o.status <> 'canceled' AND ${inScope} AND COALESCE(it->>'name', '') <> ''
        GROUP BY o.contact_id, it->>'name'
      ), top AS (
        -- Item com mais unidades; no empate, o comprado por último
        SELECT DISTINCT ON (contact_id) contact_id, name AS top_item FROM bought ORDER BY contact_id, qty DESC, last_at DESC, name
      )
      SELECT c.*, s.orders AS p_orders, s.spent AS p_spent, s.first_at AS p_first_at, s.last_at AS p_last_at,
        s.last_neighborhood AS p_last_neighborhood, s.weekday AS p_weekday, t.top_item AS p_top_item
      FROM contacts c
      LEFT JOIN stats s ON s.contact_id = c.id
      LEFT JOIN top t ON t.contact_id = c.id
      WHERE ${where.join(' AND ') || 'TRUE'}
      ORDER BY c.seq`, params);
    return rows.map((row) => this.withPurchase(row));
  }

  /** Linha da busca → contato com o perfil de compra em `purchase`. */
  withPurchase({ p_orders: orders, p_spent: spent, p_first_at: firstAt, p_last_at: lastAt, p_last_neighborhood: lastNeighborhood, p_weekday: weekday, p_top_item: topItem, ...row }) {
    const iso = (v) => (v instanceof Date ? v.toISOString() : v ?? null);
    return {
      ...this.map(row),
      purchase: { orders: orders || 0, total: Number(spent || 0), firstAt: iso(firstAt), lastAt: iso(lastAt), lastNeighborhood: lastNeighborhood || null, weekday: weekday ?? null, topItem: topItem || null },
    };
  }

  /** Opções dos filtros: bairros (efetivos) e itens comprados, com quantos clientes cada um tem. */
  async facets(restaurantId = null) {
    const contacts = await this.search({ restaurantId });
    const count = (values) => [...values.reduce((m, v) => m.set(v, (m.get(v) || 0) + 1), new Map())]
      .map(([name, n]) => ({ name, count: n }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    const neighborhoods = contacts.map((c) => c.neighborhood || c.purchase.lastNeighborhood).filter(Boolean);
    const items = await this.db.many(`
      SELECT it->>'name' AS name, count(DISTINCT o.contact_id)::int AS count
      FROM orders o CROSS JOIN LATERAL jsonb_array_elements(${ITEMS('o')}) AS it
      WHERE o.contact_id IS NOT NULL AND o.status <> 'canceled' AND ($1::uuid IS NULL OR o.restaurant_id = $1::uuid) AND COALESCE(it->>'name', '') <> ''
      GROUP BY 1 ORDER BY 2 DESC, 1`, [scopeId(restaurantId)]);
    return { neighborhoods: count(neighborhoods), items };
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
