const { defineTable, isUuid, scopeId } = require('../mapper');
const { Repository } = require('./base');

const table = defineTable({
  name: 'campaigns',
  columns: ['restaurantId', 'name', 'objective', 'occasion', 'message', 'mediaUrl', 'destinationUrl', 'coupon', 'notes', 'segment', 'includeFooter', 'cloudTemplate', 'status', 'approval', 'approvalLog', 'provider', 'audienceSize', 'scheduledAt', 'startedAt', 'completedAt', 'waitingReason', 'lastError', 'demo'],
  json: ['segment', 'cloudTemplate', 'approval', 'approvalLog'],
});

class CampaignsRepo extends Repository {
  constructor(db) {
    super(db, table);
  }

  async list({ restaurantId } = {}) {
    if (!restaurantId) return this.all();
    return isUuid(restaurantId) ? this.where('restaurant_id = $1', [restaurantId]) : [];
  }

  byStatus(status) {
    return this.where('status = $1', [status], 'started_at, created_at, id');
  }

  dueScheduled(now) {
    return this.where("status = 'scheduled' AND scheduled_at <= $1", [now], 'scheduled_at, id');
  }

  /**
   * Muda a campanha só se ela ainda estiver num dos status esperados.
   * Evita corridas (dois disparos ao mesmo tempo, conclusão sobre uma pausa).
   */
  async transition(target, from, patch) {
    const id = target && typeof target === 'object' ? target.id : target;
    if (!isUuid(id)) return null;
    const map = this.table.toColumns({ ...patch, updatedAt: new Date().toISOString() });
    const params = [id, from];
    const sets = [...map].map(([col, value]) => `${col} = $${params.push(value)}`);
    const row = this.map(await this.db.one(`UPDATE campaigns SET ${sets.join(', ')} WHERE id = $1 AND status = ANY($2::text[]) RETURNING *`, params));
    if (row && target && typeof target === 'object') Object.assign(target, row);
    return row;
  }

  async hasActive(restaurantId) {
    if (!isUuid(restaurantId)) return false;
    return !!(await this.db.one("SELECT 1 FROM campaigns WHERE restaurant_id = $1 AND status IN ('sending', 'scheduled') LIMIT 1", [restaurantId]));
  }

  async anySending() {
    return !!(await this.db.one("SELECT 1 FROM campaigns WHERE status = 'sending' LIMIT 1"));
  }

  async mediaInUse(url) {
    return !!(await this.db.one("SELECT 1 FROM campaigns WHERE media_url = $1 AND status IN ('sending', 'paused', 'scheduled') LIMIT 1", [url]));
  }

  /** Campanhas iniciadas no período (relatório mensal), da mais antiga para a mais nova. */
  startedBetween(restaurantId, from, to) {
    return this.where('restaurant_id = $1 AND started_at >= $2 AND started_at < $3', [scopeId(restaurantId), from, to], 'started_at, id');
  }

  /** Campanhas que já saíram do rascunho (ranking do painel). */
  launched(restaurantId = null) {
    return this.where("status <> 'draft' AND ($1::uuid IS NULL OR restaurant_id = $1::uuid)", [scopeId(restaurantId)]);
  }

  async counts(restaurantId = null) {
    return this.db.one(`
      SELECT count(*)::int AS campaigns,
        count(*) FILTER (WHERE status IN ('sending', 'scheduled', 'paused'))::int AS active
      FROM campaigns WHERE ($1::uuid IS NULL OR restaurant_id = $1::uuid)`, [scopeId(restaurantId)]);
  }
}

module.exports = { CampaignsRepo, table };
