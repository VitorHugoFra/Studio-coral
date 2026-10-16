const { defineTable, isUuid, scopeId } = require('../mapper');
const { Repository } = require('./base');
const { MessagingProvider } = require('../../messaging/MessagingProvider');

/** Ordem dos status de envio: uma confirmação nunca faz o status voltar. */
const STATUS_ORDER = ['queued', 'sending', 'sent', 'delivered', 'read'];

const table = defineTable({
  name: 'messages',
  columns: ['campaignId', 'restaurantId', 'contactId', 'name', 'phone', 'demo', 'code', 'status', 'text', 'error', 'provider', 'providerMessageId', 'queuedAt', 'sentAt', 'deliveredAt', 'readAt', 'failedAt', 'clickedAt', 'lastClickAt', 'repliedAt', 'convertedAt', 'clicks', 'reply', 'optOut'],
  hidden: ['phoneKey', 'seq'],
});

/** Regras de contagem do painel (eram o summarize() em JavaScript). */
const SUMMARY_COLUMNS = `
  count(*)::int AS audience,
  count(*) FILTER (WHERE status IN ('queued', 'sending'))::int AS queued,
  count(*) FILTER (WHERE sent_at IS NOT NULL)::int AS sent,
  count(*) FILTER (WHERE delivered_at IS NOT NULL OR status IN ('delivered', 'read'))::int AS delivered,
  count(*) FILTER (WHERE read_at IS NOT NULL OR status = 'read')::int AS read,
  count(*) FILTER (WHERE status = 'failed')::int AS failed,
  count(*) FILTER (WHERE status = 'skipped')::int AS skipped,
  count(*) FILTER (WHERE clicked_at IS NOT NULL)::int AS clicked,
  COALESCE(sum(clicks), 0)::int AS clicks,
  count(*) FILTER (WHERE replied_at IS NOT NULL)::int AS replied,
  count(*) FILTER (WHERE opt_out)::int AS opt_outs`;

const fromSummary = (r) => ({
  audience: r.audience, queued: r.queued, sent: r.sent, delivered: r.delivered, read: r.read, failed: r.failed,
  skipped: r.skipped, clicked: r.clicked, clicks: r.clicks, replied: r.replied, optOuts: r.opt_outs,
});

class MessagesRepo extends Repository {
  constructor(db) {
    super(db, table);
  }

  beforeWrite(data) {
    return data.phone !== undefined ? { ...data, phoneKey: MessagingProvider.phoneKey(data.phone) } : data;
  }

  async byCampaign(campaignId) {
    return isUuid(campaignId) ? this.where('campaign_id = $1', [campaignId], 'seq') : [];
  }

  /** Campanhas que o cliente recebeu, da mais nova para a mais antiga (ficha do cliente). */
  async byContact(contactId, limit = 50) {
    if (!isUuid(contactId)) return [];
    const rows = await this.db.many(`
      SELECT m.campaign_id, k.name AS campaign, m.status, m.sent_at, m.delivered_at, m.read_at, m.clicked_at, m.converted_at, m.replied_at, m.opt_out
      FROM messages m JOIN campaigns k ON k.id = m.campaign_id
      WHERE m.contact_id = $1
      ORDER BY COALESCE(m.sent_at, m.created_at) DESC, m.seq DESC LIMIT $2`, [contactId, limit]);
    return this.mapAll(rows);
  }

  byCode(code) {
    return this.first('code = $1', [String(code)]);
  }

  async byProviderId(providerMessageId) {
    return providerMessageId ? this.first('provider_message_id = $1', [String(providerMessageId)]) : null;
  }

  /** Ao subir o servidor: o que ficou "enviando" volta para a fila. */
  async requeueSending() {
    const res = await this.db.query("UPDATE messages SET status = 'queued', updated_at = now() WHERE status = 'sending'");
    return res.rowCount ?? res.affectedRows ?? 0;
  }

  /** Reserva a próxima mensagem da fila (atômico: a mesma nunca é entregue duas vezes). */
  async claimNext(campaignId) {
    if (!isUuid(campaignId)) return null;
    return this.map(await this.db.one(`
      UPDATE messages SET status = 'sending', updated_at = now()
      WHERE id = (
        SELECT id FROM messages WHERE campaign_id = $1 AND status = 'queued'
        ORDER BY seq LIMIT 1 FOR UPDATE SKIP LOCKED
      )
      RETURNING *`, [campaignId]));
  }

  async hasQueued(campaignId) {
    if (!isUuid(campaignId)) return false;
    return !!(await this.db.one("SELECT 1 FROM messages WHERE campaign_id = $1 AND status = 'queued' LIMIT 1", [campaignId]));
  }

  async skipQueued(campaignId, error) {
    if (!isUuid(campaignId)) return [];
    return this.mapAll(await this.db.many("UPDATE messages SET status = 'skipped', error = $2, updated_at = now() WHERE campaign_id = $1 AND status = 'queued' RETURNING *", [campaignId, error]));
  }

  async countSentSince(since) {
    return (await this.db.one('SELECT count(*)::int AS n FROM messages WHERE sent_at >= $1', [since])).n;
  }

  /** Envio aceito pelo provedor; uma confirmação que já chegou (entregue/lida) é mantida. */
  async markSent(id, { provider, providerMessageId, sentAt }) {
    if (!isUuid(id)) return null;
    return this.map(await this.db.one(`
      UPDATE messages SET
        status = CASE WHEN status IN ('delivered', 'read') THEN status ELSE 'sent' END,
        provider = $2, provider_message_id = $3, sent_at = $4, error = NULL, updated_at = now()
      WHERE id = $1 RETURNING *`, [id, provider, providerMessageId, sentAt]));
  }

  /** Confirmação de entrega ou leitura. Fora de ordem, nunca faz o status voltar. */
  async applyAck(providerMessageId, status, at) {
    return this.map(await this.db.one(`
      UPDATE messages SET
        status = $2,
        delivered_at = CASE WHEN $2 IN ('delivered', 'read') THEN COALESCE(delivered_at, $3) ELSE delivered_at END,
        read_at = CASE WHEN $2 = 'read' THEN $3 ELSE read_at END,
        updated_at = now()
      WHERE provider_message_id = $1
        AND COALESCE(array_position($4::text[], status), 0) < array_position($4::text[], $2)
      RETURNING *`, [providerMessageId, status, at, STATUS_ORDER]));
  }

  async markFailedByProvider(providerMessageId, error, at) {
    return this.map(await this.db.one("UPDATE messages SET status = 'failed', error = $2, failed_at = $3, updated_at = now() WHERE provider_message_id = $1 RETURNING *", [providerMessageId, error, at]));
  }

  async registerClick(id, at) {
    if (!isUuid(id)) return null;
    return this.map(await this.db.one('UPDATE messages SET clicks = clicks + 1, clicked_at = COALESCE(clicked_at, $2), last_click_at = $2, updated_at = now() WHERE id = $1 RETURNING *', [id, at]));
  }

  lastSentToPhoneKey(key) {
    return this.first('phone_key = $1 AND sent_at IS NOT NULL', [key], 'sent_at DESC, seq');
  }

  async registerReply(id, { reply, optOut, at }) {
    if (!isUuid(id)) return null;
    return this.map(await this.db.one('UPDATE messages SET replied_at = $2, reply = $3, opt_out = $4, updated_at = now() WHERE id = $1 AND replied_at IS NULL RETURNING *', [id, at, reply, optOut]));
  }

  async markConverted(id, at) {
    if (!isUuid(id)) return null;
    return this.map(await this.db.one('UPDATE messages SET converted_at = $2, updated_at = now() WHERE id = $1 AND converted_at IS NULL RETURNING *', [id, at]));
  }

  /** Contagens brutas para um filtro (restaurante, campanha e/ou período de envio). */
  async summary({ restaurantId, campaignId, sentFrom, sentTo } = {}) {
    const where = ['TRUE'];
    const params = [];
    if (restaurantId) where.push(`restaurant_id = $${params.push(scopeId(restaurantId))}`);
    if (campaignId) where.push(`campaign_id = $${params.push(scopeId(campaignId))}`);
    if (sentFrom) where.push(`sent_at >= $${params.push(sentFrom)}`);
    if (sentTo) where.push(`sent_at < $${params.push(sentTo)}`);
    return fromSummary(await this.db.one(`SELECT ${SUMMARY_COLUMNS} FROM messages WHERE ${where.join(' AND ')}`, params));
  }

  /** Contagens por campanha, numa consulta só. */
  async summaryByCampaign(campaignIds) {
    const ids = campaignIds.filter(isUuid);
    if (!ids.length) return new Map();
    const rows = await this.db.many(`SELECT campaign_id, ${SUMMARY_COLUMNS} FROM messages WHERE campaign_id = ANY($1::uuid[]) GROUP BY campaign_id`, [ids]);
    return new Map(rows.map((r) => [r.campaign_id, fromSummary(r)]));
  }

  /** Envios, leituras e cliques a partir de um instante (série diária do painel). */
  async timelineSince({ restaurantId, since }) {
    const rows = await this.db.many(`
      SELECT sent_at, read_at, clicked_at FROM messages
      WHERE ($1::uuid IS NULL OR restaurant_id = $1::uuid)
        AND (sent_at >= $2 OR read_at >= $2 OR clicked_at >= $2)`, [scopeId(restaurantId), since]);
    return this.mapAll(rows);
  }

  /** Envios do período (relatório mensal): data de envio e de clique. */
  async sentBetween(restaurantId, from, to) {
    const rows = await this.db.many('SELECT sent_at, clicked_at FROM messages WHERE restaurant_id = $1 AND sent_at >= $2 AND sent_at < $3', [scopeId(restaurantId), from, to]);
    return this.mapAll(rows);
  }

  /** Meses (AAAA-MM, em UTC, como o antigo sentAt.slice(0, 7)) com algum envio. */
  async sentMonths(restaurantId) {
    const rows = await this.db.many("SELECT DISTINCT to_char(sent_at AT TIME ZONE 'UTC', 'YYYY-MM') AS month FROM messages WHERE restaurant_id = $1 AND sent_at IS NOT NULL", [scopeId(restaurantId)]);
    return rows.map((r) => r.month);
  }
}

module.exports = { MessagesRepo, table, STATUS_ORDER };
