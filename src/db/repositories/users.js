const { defineTable, isUuid, scopeId } = require('../mapper');
const { Repository } = require('./base');

const table = defineTable({
  name: 'users',
  columns: ['restaurantId', 'role', 'name', 'email', 'passwordHash', 'lastLoginAt', 'passwordChangedAt', 'resetRequestedAt'],
  unique: { users_email_key: 'Este e-mail já tem acesso.' },
});

class UsersRepo extends Repository {
  constructor(db) {
    super(db, table);
  }

  byEmail(email) {
    return this.first('email = $1', [String(email)]);
  }

  async listByRestaurant(restaurantId) {
    return isUuid(restaurantId) ? this.where('restaurant_id = $1', [restaurantId]) : [];
  }

  /**
   * Tela de acessos: cada acesso com o nome do restaurante, se já tem senha e o link aberto mais
   * recente (`linkPurpose`, `linkExpiresAt`, mesmo vencido). Sem restaurantId, todos os restaurantes.
   * O hash da senha não sai daqui.
   */
  async listWithStatus({ restaurantId } = {}) {
    const rows = await this.db.many(`
      SELECT u.*, r.name AS restaurant_name, (u.password_hash IS NOT NULL) AS has_password,
        t.purpose AS link_purpose, t.expires_at AS link_expires_at
      FROM users u
      JOIN restaurants r ON r.id = u.restaurant_id
      LEFT JOIN LATERAL (
        SELECT purpose, expires_at FROM password_tokens WHERE user_id = u.id ORDER BY created_at DESC, id LIMIT 1
      ) t ON true
      WHERE $1::uuid IS NULL OR u.restaurant_id = $1::uuid`, [scopeId(restaurantId)]);
    return this.mapAll(rows).map(({ passwordHash, ...u }) => u);
  }

  /**
   * Registra o pedido de nova senha, no máximo um a cada `throttleMs`.
   * Devolve o acesso quando o pedido é novo; null quando outro pedido recente já está registrado.
   */
  async requestReset(id, { now, throttleMs }) {
    if (!isUuid(id)) return null;
    const since = new Date(Date.parse(now) - throttleMs).toISOString();
    return this.map(await this.db.one(`
      UPDATE users SET reset_requested_at = $2, updated_at = $2
      WHERE id = $1 AND (reset_requested_at IS NULL OR reset_requested_at < $3)
      RETURNING *`, [id, now, since]));
  }
}

module.exports = { UsersRepo, table };
