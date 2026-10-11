const DAY = 24 * 60 * 60 * 1000;
const dayKey = (iso) => (iso ? new Date(iso).toLocaleDateString('sv-SE') : null);
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const round2 = (v) => Math.round(v * 100) / 100;

const EMPTY_COUNTS = { audience: 0, queued: 0, sent: 0, delivered: 0, read: 0, failed: 0, skipped: 0, clicked: 0, clicks: 0, replied: 0, optOuts: 0 };
const NO_SALES = { orders: 0, revenue: 0 };

/** Meia-noite (fuso do servidor) do primeiro dia de uma série de `days` dias. */
const seriesStart = (days) => {
  const d = new Date(Date.now() - (days - 1) * DAY);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};

/**
 * Etapa 8 do fluxo — Análise. Indicadores de desempenho das campanhas.
 * As regras de contagem ficam no SQL (messages.summary e conversions.summary);
 * aqui se calculam as taxas e se montam as séries diárias.
 */
class AnalyticsService {
  constructor({ repos }) {
    this.repos = repos;
  }

  /** Taxas a partir das contagens brutas (mesmo formato do antigo summarize()). */
  static withRates(counts = EMPTY_COUNTS, sales = NO_SALES) {
    const s = { ...EMPTY_COUNTS, ...counts };
    s.orders = sales.orders;
    s.revenue = round2(sales.revenue);
    s.processed = s.audience - s.queued;
    s.progress = pct(s.processed, s.audience);
    s.deliveryRate = pct(s.delivered, s.sent);
    s.readRate = pct(s.read, s.delivered);
    s.clickRate = pct(s.clicked, s.delivered);
    s.conversionRate = pct(s.orders, s.clicked);
    s.ticket = s.orders ? round2(s.revenue / s.orders) : 0;
    return s;
  }

  async campaignStats(campaignId) {
    return (await this.statsForCampaigns([campaignId])).get(campaignId);
  }

  /** Estatísticas de várias campanhas com duas consultas agrupadas. */
  async statsForCampaigns(ids) {
    const [counts, sales] = await Promise.all([
      this.repos.messages.summaryByCampaign(ids),
      this.repos.conversions.summaryByCampaign(ids),
    ]);
    return new Map(ids.map((id) => [id, AnalyticsService.withRates(counts.get(id), sales.get(id))]));
  }

  async overview({ restaurantId, days = 14 } = {}) {
    const scope = restaurantId || null;
    const since = seriesStart(days);
    // Só entram pedidos atribuídos a campanhas (vindos de um link rastreável)
    const [counts, sales, timeline, orders, launched, recent, base, campaignCounts, restaurants] = await Promise.all([
      this.repos.messages.summary({ restaurantId: scope }),
      this.repos.conversions.summary({ restaurantId: scope, attributedOnly: true }),
      this.repos.messages.timelineSince({ restaurantId: scope, since }),
      this.repos.conversions.attributedSince({ restaurantId: scope, since }),
      this.repos.campaigns.launched(scope),
      this.repos.conversions.recentAttributed({ restaurantId: scope, limit: 6 }),
      this.repos.contacts.stats({ restaurantId: scope }),
      this.repos.campaigns.counts(scope),
      this.repos.restaurants.all(),
    ]);

    // Série diária
    const series = [];
    const index = {};
    for (let i = days - 1; i >= 0; i -= 1) {
      const key = dayKey(new Date(Date.now() - i * DAY).toISOString());
      const row = { day: key, sent: 0, read: 0, clicks: 0, orders: 0, revenue: 0 };
      index[key] = row;
      series.push(row);
    }
    for (const m of timeline) {
      if (index[dayKey(m.sentAt)]) index[dayKey(m.sentAt)].sent += 1;
      if (index[dayKey(m.readAt)]) index[dayKey(m.readAt)].read += 1;
      if (index[dayKey(m.clickedAt)]) index[dayKey(m.clickedAt)].clicks += 1;
    }
    for (const c of orders) {
      const row = index[dayKey(c.createdAt)];
      if (row) { row.orders += 1; row.revenue += Number(c.value) || 0; }
    }

    const names = new Map(restaurants.map((r) => [r.id, r.name]));
    const stats = await this.statsForCampaigns(launched.map((c) => c.id));
    const ranking = launched
      .map((c) => ({
        id: c.id,
        name: c.name,
        status: c.status,
        restaurant: names.get(c.restaurantId) || '—',
        startedAt: c.startedAt,
        stats: stats.get(c.id),
      }))
      .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));

    const campaignNames = new Map(launched.map((c) => [c.id, c.name]));
    const recentOrders = recent.map((c) => ({
      ...c,
      campaign: campaignNames.get(c.campaignId) || 'Pedido direto',
      restaurant: names.get(c.restaurantId) || '',
    }));

    return {
      totals: AnalyticsService.withRates(counts, sales),
      series,
      campaigns: ranking,
      recentOrders,
      contacts: { total: base.total, authorized: base.authorized, optedOut: base.optedOut },
      counts: {
        restaurants: restaurantId ? 1 : restaurants.length,
        campaigns: campaignCounts.campaigns,
        active: campaignCounts.active,
      },
    };
  }
}

module.exports = { AnalyticsService };
