const { defineTable, isUuid, scopeId } = require('../mapper');
const { Repository } = require('./base');

const table = defineTable({
  name: 'coupons',
  columns: ['restaurantId', 'contactId', 'referralId', 'code', 'discountType', 'discountValue', 'minOrder', 'expiresAt', 'originOrderId', 'usedAt', 'usedOrderId', 'sentAt', 'sendError'],
  numeric: ['discountValue', 'minOrder'],
  unique: { coupons_code: 'Código de cupom repetido.' },
});

/** Cupons de uso único (recompensa de quem indicou). */
class CouponsRepo extends Repository {
  constructor(db) {
    super(db, table);
  }

  async byCode(restaurantId, code) {
    if (!isUuid(restaurantId) || !code) return null;
    return this.first('restaurant_id = $1 AND code = $2', [restaurantId, String(code).trim().toUpperCase()]);
  }

  /** Cria o cupom do pedido indicado; se esse pedido já gerou um (índice único), devolve null. */
  createForOrder(data) {
    return this.create(data, { onConflict: 'ON CONFLICT (origin_order_id) DO NOTHING' });
  }

  /** Marca o uso só se ninguém usou antes: dois pedidos ao mesmo tempo com o mesmo cupom, um ganha. */
  async markUsed(id, orderId, at) {
    if (!isUuid(id)) return null;
    return this.map(await this.db.one('UPDATE coupons SET used_at = $3, used_order_id = $2, updated_at = now() WHERE id = $1 AND used_at IS NULL RETURNING *', [id, orderId, at]));
  }

  async list(restaurantId = null) {
    const rows = await this.db.many(`
      SELECT k.*, c.name AS contact_name, c.phone AS contact_phone, l.slug AS referral_slug, r.name AS restaurant
      FROM coupons k
      JOIN restaurants r ON r.id = k.restaurant_id
      LEFT JOIN contacts c ON c.id = k.contact_id
      LEFT JOIN referral_links l ON l.id = k.referral_id
      WHERE ($1::uuid IS NULL OR k.restaurant_id = $1::uuid)
      ORDER BY k.created_at DESC, k.id`, [scopeId(restaurantId)]);
    return rows.map(({ contact_name: contactName, contact_phone: contactPhone, referral_slug: referralSlug, restaurant, ...row }) => ({ ...this.map(row), contactName, contactPhone, referralSlug, restaurant }));
  }
}

module.exports = { CouponsRepo, table };
