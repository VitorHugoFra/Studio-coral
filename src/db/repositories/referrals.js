const { defineTable, isUuid, scopeId } = require('../mapper');
const { Repository } = require('./base');
const { MessagingProvider } = require('../../messaging/MessagingProvider');

const table = defineTable({
  name: 'referral_links',
  columns: ['restaurantId', 'contactId', 'slug', 'name', 'phone', 'message', 'clicks'],
  hidden: ['phoneKey', 'editToken'],
  unique: {
    referral_links_slug: 'Este apelido já está em uso. Escolha outro.',
    referral_links_phone: 'Este WhatsApp já tem um link de indicação.',
  },
});

/** Links de indicação do cliente final (/i/<restaurante>/<apelido>). */
class ReferralsRepo extends Repository {
  constructor(db) {
    super(db, table);
  }

  beforeWrite(data) {
    return data.phone !== undefined ? { ...data, phoneKey: MessagingProvider.phoneKey(data.phone) } : data;
  }

  async bySlug(restaurantId, slug) {
    if (!isUuid(restaurantId) || !slug) return null;
    return this.first('restaurant_id = $1 AND slug = $2', [restaurantId, String(slug).toLowerCase()]);
  }

  async byPhone(restaurantId, phone) {
    if (!isUuid(restaurantId)) return null;
    return this.first('restaurant_id = $1 AND phone_key = $2', [restaurantId, MessagingProvider.phoneKey(phone)]);
  }

  async slugTaken(restaurantId, slug, ignoreId = null) {
    const row = await this.db.one('SELECT 1 FROM referral_links WHERE restaurant_id = $1 AND slug = $2 AND ($3::uuid IS NULL OR id <> $3::uuid)', [restaurantId, slug, isUuid(ignoreId) ? ignoreId : null]);
    return !!row;
  }

  /** Confere a chave de edição sem nunca devolvê-la (coluna interna). */
  async checkToken(id, token) {
    if (!isUuid(id) || !token) return false;
    return !!(await this.db.one('SELECT 1 FROM referral_links WHERE id = $1 AND edit_token = $2', [id, String(token)]));
  }

  async registerClick(id) {
    if (!isUuid(id)) return;
    await this.db.query('UPDATE referral_links SET clicks = clicks + 1 WHERE id = $1', [id]);
  }

  /** Links com os números do painel: pedidos indicados (não cancelados), faturamento e cupons. */
  async withStats(restaurantId = null) {
    const rows = await this.db.many(`
      SELECT l.*, r.name AS restaurant,
        (SELECT count(*)::int FROM orders o WHERE o.referral_id = l.id AND o.status <> 'canceled') AS orders,
        (SELECT COALESCE(sum(value), 0) FROM orders o WHERE o.referral_id = l.id AND o.status <> 'canceled') AS revenue,
        (SELECT count(*)::int FROM coupons k WHERE k.referral_id = l.id) AS rewards
      FROM referral_links l JOIN restaurants r ON r.id = l.restaurant_id
      WHERE ($1::uuid IS NULL OR l.restaurant_id = $1::uuid)
      ORDER BY l.created_at DESC, l.id`, [scopeId(restaurantId)]);
    return rows.map(({ orders, revenue, rewards, restaurant, ...row }) => ({ ...this.map(row), restaurant, orders, revenue: Number(revenue), rewards }));
  }
}

module.exports = { ReferralsRepo, table };
