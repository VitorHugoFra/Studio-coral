const { defineTable, isUuid } = require('../mapper');
const { Repository } = require('./base');

const table = defineTable({
  name: 'restaurants',
  columns: ['name', 'slug', 'segment', 'city', 'siteUrl', 'phone', 'audience', 'products', 'goals', 'tone', 'color', 'coupon', 'tagline', 'instagram', 'emoji', 'address', 'hours', 'logoUrl', 'menu', 'banners', 'requireApproval', 'demo', 'referral'],
  json: ['menu', 'banners', 'referral'],
  hidden: ['orderSeq'],
  unique: { restaurants_slug_key: 'Já existe um restaurante com este endereço.' },
});

class RestaurantsRepo extends Repository {
  constructor(db) {
    super(db, table);
  }

  bySlug(slug) {
    return this.first('slug = $1', [String(slug)]);
  }

  async slugTaken(slug, ignoreId = null) {
    const row = await this.db.one('SELECT 1 FROM restaurants WHERE slug = $1 AND ($2::uuid IS NULL OR id <> $2::uuid)', [slug, isUuid(ignoreId) ? ignoreId : null]);
    return !!row;
  }

  /**
   * Próximo número de pedido do site (#1, #2…). O UPDATE é atômico e trava a linha do restaurante até o fim da
   * transação: dois pedidos ao mesmo tempo nunca recebem o mesmo número.
   */
  async nextOrderNumber(id) {
    if (!isUuid(id)) return null;
    return (await this.db.one('UPDATE restaurants SET order_seq = order_seq + 1 WHERE id = $1 RETURNING order_seq', [id]))?.order_seq ?? null;
  }

  /** Contagens da lista de restaurantes: contatos, autorizados e campanhas. */
  async counts(ids) {
    if (!ids.length) return new Map();
    const rows = await this.db.many(`
      SELECT r.id,
        (SELECT count(*)::int FROM contacts c WHERE c.restaurant_id = r.id) AS contacts_count,
        (SELECT count(*)::int FROM contacts c WHERE c.restaurant_id = r.id AND c.opt_in AND NOT c.opted_out) AS authorized_count,
        (SELECT count(*)::int FROM campaigns k WHERE k.restaurant_id = r.id) AS campaigns_count
      FROM restaurants r WHERE r.id = ANY($1::uuid[])`, [ids.filter(isUuid)]);
    return new Map(rows.map((r) => [r.id, { contactsCount: r.contacts_count, authorizedCount: r.authorized_count, campaignsCount: r.campaigns_count }]));
  }
}

module.exports = { RestaurantsRepo, table };
