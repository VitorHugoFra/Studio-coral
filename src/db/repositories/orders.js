const { defineTable, isUuid, scopeId } = require('../mapper');
const { Repository } = require('./base');

/** Status em andamento (quadro de pedidos), na ordem em que o pedido avança. */
const ACTIVE_STATUSES = ['new', 'preparing', 'dispatched'];

// Itens do pedido como array jsonb (pedidos antigos podem ter outra coisa) e a quantidade de cada item (padrão 1)
const ITEMS = (alias) => `CASE WHEN jsonb_typeof(${alias}.items) = 'array' THEN ${alias}.items ELSE '[]'::jsonb END`;
const QTY = (alias) => `CASE WHEN ${alias}->>'qty' ~ '^[0-9]+(\\.[0-9]+)?$' THEN (${alias}->>'qty')::numeric ELSE 1 END`;

const table = defineTable({
  name: 'orders',
  columns: ['restaurantId', 'campaignId', 'messageId', 'contactId', 'code', 'customerName', 'orderId', 'value', 'items',
    'number', 'trackingCode', 'source', 'channel', 'status', 'statusLog', 'fulfillment', 'phone', 'cpf', 'address',
    'neighborhood', 'notes', 'subtotal', 'discount', 'coupon', 'referralId', 'couponId'],
  json: ['items', 'statusLog', 'address'],
  numeric: ['value', 'subtotal', 'discount'],
  unique: {
    orders_tracking_code_key: 'Código de acompanhamento repetido.',
    orders_restaurant_number: 'Número de pedido repetido.',
  },
});

const fromTotals = (row) => ({ orders: row.orders, revenue: Number(row.revenue) });

class OrdersRepo extends Repository {
  constructor(db) {
    super(db, table);
  }

  /** Registra o pedido; número de pedido repetido no restaurante devolve null. */
  createUnique(data) {
    return this.create(data, { onConflict: 'ON CONFLICT (restaurant_id, order_id) WHERE order_id IS NOT NULL DO NOTHING' });
  }

  /** Vários pedidos de uma vez, ignorando os números que o restaurante já tem (importação de planilha). */
  insertUnique(list) {
    return this.insertMany(list, { onConflict: 'ON CONFLICT (restaurant_id, order_id) WHERE order_id IS NOT NULL DO NOTHING' });
  }

  async findByOrderId(restaurantId, orderId) {
    if (!isUuid(restaurantId) || !orderId) return null;
    return this.first('restaurant_id = $1 AND order_id = $2', [restaurantId, String(orderId)]);
  }

  /** Números de pedido que o restaurante já tem, entre os informados (prévia da importação). */
  async existingOrderIds(restaurantId, orderIds) {
    if (!isUuid(restaurantId) || !orderIds.length) return new Set();
    const rows = await this.db.many('SELECT order_id FROM orders WHERE restaurant_id = $1 AND order_id = ANY($2::text[])', [restaurantId, orderIds]);
    return new Set(rows.map((r) => r.order_id));
  }

  byTrackingCode(code) {
    return code ? this.first('tracking_code = $1', [String(code)]) : null;
  }

  /**
   * Pedidos com filtros (histórico e quadro). Busca por nome, telefone, número ou número externo.
   * active: só os em andamento, do mais antigo para o mais novo (a ordem da cozinha).
   */
  async list({ restaurantId, status, source, search, from, to, active = false, limit = 200 } = {}) {
    const where = ['TRUE'];
    const params = [];
    if (restaurantId) where.push(`restaurant_id = $${params.push(scopeId(restaurantId))}`);
    if (active) where.push(`status = ANY($${params.push(ACTIVE_STATUSES)}::text[])`);
    else if (status) where.push(`status = $${params.push(String(status))}`);
    if (source) where.push(`source = $${params.push(String(source))}`);
    if (from) where.push(`created_at >= $${params.push(from)}`);
    if (to) where.push(`created_at < $${params.push(to)}`);
    const q = String(search || '').trim().toLowerCase();
    if (q) {
      const p = params.push(q);
      const digits = q.replace(/\D/g, '');
      const or = [`position($${p} in lower(COALESCE(customer_name, ''))) > 0`, `position($${p} in lower(COALESCE(order_id, ''))) > 0`];
      // Telefone com pelo menos 4 dígitos; o número do pedido só quando a busca é um número ("12" ou "#12")
      if (digits.length >= 4) or.push(`phone LIKE '%' || $${params.push(digits)} || '%'`);
      if (/^#?\d{1,9}$/.test(q)) or.push(`number = $${params.push(Number(digits))}`);
      where.push(`(${or.join(' OR ')})`);
    }
    const order = active ? 'created_at, id' : 'created_at DESC, id';
    const max = Math.min(Math.max(1, Number(limit) || 200), 500);
    return this.mapAll(await this.db.many(`SELECT * FROM orders WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ${max}`, params));
  }

  /**
   * Muda o status só se o pedido ainda estiver no status que a pessoa viu, e acrescenta a entrada
   * ao histórico no próprio SQL: duas pessoas no painel ao mesmo tempo não se atropelam.
   */
  async changeStatus(target, { from, to, entry }) {
    const id = target && typeof target === 'object' ? target.id : target;
    if (!isUuid(id)) return null;
    const row = this.map(await this.db.one(`
      UPDATE orders SET status = $3, status_log = status_log || $4::jsonb, updated_at = now()
      WHERE id = $1 AND status = $2 RETURNING *`, [id, from, to, JSON.stringify([entry])]));
    if (row && target && typeof target === 'object') Object.assign(target, row);
    return row;
  }

  /** Pedidos de um cliente, do mais novo para o mais antigo (ficha do cliente). */
  async byContact(contactId, limit = 100) {
    if (!isUuid(contactId)) return [];
    return this.mapAll(await this.db.many('SELECT * FROM orders WHERE contact_id = $1 ORDER BY created_at DESC, id LIMIT $2', [contactId, limit]));
  }

  /** Itens que o cliente mais pediu (unidades), sem os pedidos cancelados. */
  async topItemsOfContact(contactId, limit = 5) {
    if (!isUuid(contactId)) return [];
    const rows = await this.db.many(`
      SELECT it->>'name' AS name, sum(${QTY('it')})::float AS qty
      FROM orders o CROSS JOIN LATERAL jsonb_array_elements(${ITEMS('o')}) AS it
      WHERE o.contact_id = $1 AND o.status <> 'canceled' AND COALESCE(it->>'name', '') <> ''
      GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT $2`, [contactId, limit]);
    return rows.map((r) => ({ name: r.name, qty: r.qty }));
  }

  /**
   * Vendas do restaurante no período, de todas as origens, sem os cancelados (página 3 do relatório).
   * `ref` é o instante de referência da reativação: o fim do período, ou agora se o período não acabou.
   */
  async monthSales(restaurantId, from, to, ref = to) {
    const scope = scopeId(restaurantId);
    const base = "restaurant_id = $1 AND status <> 'canceled' AND created_at >= $2 AND created_at < $3";
    const [totals, bySource, customers, neighborhoods, items, inactive] = await Promise.all([
      this.db.one(`SELECT count(*)::int AS orders, COALESCE(sum(value), 0) AS revenue FROM orders WHERE ${base}`, [scope, from, to]),
      this.db.many(`SELECT source, count(*)::int AS orders, COALESCE(sum(value), 0) AS revenue FROM orders WHERE ${base} GROUP BY source ORDER BY 2 DESC, 1`, [scope, from, to]),
      this.db.one(`
        WITH buyers AS (SELECT DISTINCT contact_id FROM orders WHERE ${base} AND contact_id IS NOT NULL),
        firsts AS (SELECT contact_id, min(created_at) AS first_at FROM orders WHERE restaurant_id = $1 AND status <> 'canceled' AND contact_id IS NOT NULL GROUP BY contact_id)
        SELECT count(*)::int AS buyers, count(*) FILTER (WHERE f.first_at >= $2)::int AS new FROM buyers b JOIN firsts f USING (contact_id)`, [scope, from, to]),
      this.db.many(`SELECT neighborhood AS name, count(*)::int AS orders FROM orders WHERE ${base} AND COALESCE(neighborhood, '') <> '' GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 5`, [scope, from, to]),
      this.db.many(`
        SELECT it->>'name' AS name, sum(${QTY('it')})::float AS qty
        FROM orders o CROSS JOIN LATERAL jsonb_array_elements(${ITEMS('o')}) AS it
        WHERE o.restaurant_id = $1 AND o.status <> 'canceled' AND o.created_at >= $2 AND o.created_at < $3 AND COALESCE(it->>'name', '') <> ''
        GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 6`, [scope, from, to]),
      // Já compraram, mas a última compra (até a referência) foi há mais de 30 dias
      this.db.one(`
        SELECT count(*)::int AS total, count(*) FILTER (WHERE c.opt_in AND NOT c.opted_out)::int AS authorized
        FROM (SELECT contact_id, max(created_at) AS last_at FROM orders
              WHERE restaurant_id = $1 AND status <> 'canceled' AND contact_id IS NOT NULL AND created_at < $2
              GROUP BY contact_id) x
        JOIN contacts c ON c.id = x.contact_id
        WHERE x.last_at < $3`, [scope, ref, new Date(new Date(ref).getTime() - 30 * 864e5).toISOString()]),
    ]);
    return {
      orders: totals.orders,
      revenue: Number(totals.revenue),
      bySource: bySource.map((r) => ({ source: r.source, orders: r.orders, revenue: Number(r.revenue) })),
      customers: { buyers: customers.buyers, new: customers.new, returning: customers.buyers - customers.new },
      neighborhoods,
      items: items.map((r) => ({ name: r.name, qty: r.qty })),
      inactive,
    };
  }

  async summary({ restaurantId, campaignId, attributedOnly = false, from, to } = {}) {
    const where = ['TRUE'];
    const params = [];
    if (restaurantId) where.push(`restaurant_id = $${params.push(scopeId(restaurantId))}`);
    if (campaignId) where.push(`campaign_id = $${params.push(scopeId(campaignId))}`);
    if (attributedOnly) where.push('campaign_id IS NOT NULL');
    if (from) where.push(`created_at >= $${params.push(from)}`);
    if (to) where.push(`created_at < $${params.push(to)}`);
    return fromTotals(await this.db.one(`SELECT count(*)::int AS orders, COALESCE(sum(value), 0) AS revenue FROM orders WHERE ${where.join(' AND ')}`, params));
  }

  async summaryByCampaign(campaignIds) {
    const ids = campaignIds.filter(isUuid);
    if (!ids.length) return new Map();
    const rows = await this.db.many('SELECT campaign_id, count(*)::int AS orders, COALESCE(sum(value), 0) AS revenue FROM orders WHERE campaign_id = ANY($1::uuid[]) GROUP BY campaign_id', [ids]);
    return new Map(rows.map((r) => [r.campaign_id, fromTotals(r)]));
  }

  /** Pedidos atribuídos a campanhas a partir de um instante (série do painel). */
  attributedSince({ restaurantId, since }) {
    return this.where('campaign_id IS NOT NULL AND ($1::uuid IS NULL OR restaurant_id = $1::uuid) AND created_at >= $2', [scopeId(restaurantId), since]);
  }

  /** Últimos pedidos atribuídos a campanhas. */
  async recentAttributed({ restaurantId, limit = 6 }) {
    return this.mapAll(await this.db.many('SELECT * FROM orders WHERE campaign_id IS NOT NULL AND ($1::uuid IS NULL OR restaurant_id = $1::uuid) ORDER BY created_at DESC, id LIMIT $2', [scopeId(restaurantId), limit]));
  }

  /** Pedidos atribuídos no período (relatório mensal). */
  attributedBetween(restaurantId, from, to) {
    return this.where('restaurant_id = $1 AND campaign_id IS NOT NULL AND created_at >= $2 AND created_at < $3', [scopeId(restaurantId), from, to]);
  }
}

module.exports = { OrdersRepo, table, ACTIVE_STATUSES, ITEMS, QTY };
