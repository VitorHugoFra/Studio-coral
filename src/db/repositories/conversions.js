const { defineTable, isUuid, scopeId } = require('../mapper');
const { Repository } = require('./base');

const table = defineTable({
  name: 'conversions',
  columns: ['restaurantId', 'campaignId', 'messageId', 'contactId', 'code', 'customerName', 'orderId', 'value', 'items'],
  json: ['items'],
  numeric: ['value'],
});

const fromTotals = (row) => ({ orders: row.orders, revenue: Number(row.revenue) });

class ConversionsRepo extends Repository {
  constructor(db) {
    super(db, table);
  }

  /** Registra o pedido; número de pedido repetido no restaurante devolve null. */
  createUnique(data) {
    return this.create(data, { onConflict: 'ON CONFLICT (restaurant_id, order_id) WHERE order_id IS NOT NULL DO NOTHING' });
  }

  async summary({ restaurantId, campaignId, attributedOnly = false, from, to } = {}) {
    const where = ['TRUE'];
    const params = [];
    if (restaurantId) where.push(`restaurant_id = $${params.push(scopeId(restaurantId))}`);
    if (campaignId) where.push(`campaign_id = $${params.push(scopeId(campaignId))}`);
    if (attributedOnly) where.push('campaign_id IS NOT NULL');
    if (from) where.push(`created_at >= $${params.push(from)}`);
    if (to) where.push(`created_at < $${params.push(to)}`);
    return fromTotals(await this.db.one(`SELECT count(*)::int AS orders, COALESCE(sum(value), 0) AS revenue FROM conversions WHERE ${where.join(' AND ')}`, params));
  }

  async summaryByCampaign(campaignIds) {
    const ids = campaignIds.filter(isUuid);
    if (!ids.length) return new Map();
    const rows = await this.db.many('SELECT campaign_id, count(*)::int AS orders, COALESCE(sum(value), 0) AS revenue FROM conversions WHERE campaign_id = ANY($1::uuid[]) GROUP BY campaign_id', [ids]);
    return new Map(rows.map((r) => [r.campaign_id, fromTotals(r)]));
  }

  /** Pedidos atribuídos a campanhas a partir de um instante (série do painel). */
  attributedSince({ restaurantId, since }) {
    return this.where('campaign_id IS NOT NULL AND ($1::uuid IS NULL OR restaurant_id = $1::uuid) AND created_at >= $2', [scopeId(restaurantId), since]);
  }

  /** Últimos pedidos atribuídos a campanhas. */
  async recentAttributed({ restaurantId, limit = 6 }) {
    return this.mapAll(await this.db.many('SELECT * FROM conversions WHERE campaign_id IS NOT NULL AND ($1::uuid IS NULL OR restaurant_id = $1::uuid) ORDER BY created_at DESC LIMIT $2', [scopeId(restaurantId), limit]));
  }

  /** Pedidos atribuídos no período (relatório mensal). */
  attributedBetween(restaurantId, from, to) {
    return this.where('restaurant_id = $1 AND campaign_id IS NOT NULL AND created_at >= $2 AND created_at < $3', [scopeId(restaurantId), from, to]);
  }
}

module.exports = { ConversionsRepo, table };
