const DAY = 24 * 60 * 60 * 1000;
const dayKey = (iso) => (iso ? new Date(iso).toLocaleDateString('sv-SE') : null);
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);

/**
 * Etapa 8 do fluxo — Análise. Indicadores de desempenho das campanhas.
 */
class AnalyticsService {
  constructor({ repos }) {
    this.repos = repos;
  }

  summarize(messages, conversions) {
    const s = { audience: messages.length, queued: 0, sent: 0, delivered: 0, read: 0, failed: 0, skipped: 0, clicked: 0, clicks: 0, replied: 0, optOuts: 0 };
    for (const m of messages) {
      if (m.status === 'queued' || m.status === 'sending') s.queued += 1;
      if (m.sentAt) s.sent += 1;
      if (m.deliveredAt || m.status === 'delivered' || m.status === 'read') s.delivered += 1;
      if (m.readAt || m.status === 'read') s.read += 1;
      if (m.status === 'failed') s.failed += 1;
      if (m.status === 'skipped') s.skipped += 1;
      if (m.clickedAt) s.clicked += 1;
      s.clicks += m.clicks || 0;
      if (m.repliedAt) s.replied += 1;
      if (m.optOut) s.optOuts += 1;
    }
    s.orders = conversions.length;
    s.revenue = Math.round(conversions.reduce((sum, c) => sum + (Number(c.value) || 0), 0) * 100) / 100;
    s.processed = s.audience - s.queued;
    s.progress = pct(s.processed, s.audience);
    s.deliveryRate = pct(s.delivered, s.sent);
    s.readRate = pct(s.read, s.delivered);
    s.clickRate = pct(s.clicked, s.delivered);
    s.conversionRate = pct(s.orders, s.clicked);
    s.ticket = s.orders ? Math.round((s.revenue / s.orders) * 100) / 100 : 0;
    return s;
  }

  campaignStats(campaignId) {
    return this.summarize(
      this.repos.messages.filter((m) => m.campaignId === campaignId),
      this.repos.conversions.filter((c) => c.campaignId === campaignId),
    );
  }

  overview({ restaurantId, days = 14 } = {}) {
    const inScope = (r) => !restaurantId || r.restaurantId === restaurantId;
    const messages = this.repos.messages.filter(inScope);
    // Só entram pedidos atribuídos a campanhas (vindos de um link rastreável)
    const conversions = this.repos.conversions.filter((c) => inScope(c) && c.campaignId);
    const campaigns = this.repos.campaigns.filter(inScope);
    const contacts = this.repos.contacts.filter(inScope);

    const totals = this.summarize(messages, conversions);

    // Série diária
    const series = [];
    const index = {};
    for (let i = days - 1; i >= 0; i -= 1) {
      const key = dayKey(new Date(Date.now() - i * DAY).toISOString());
      const row = { day: key, sent: 0, read: 0, clicks: 0, orders: 0, revenue: 0 };
      index[key] = row;
      series.push(row);
    }
    for (const m of messages) {
      if (index[dayKey(m.sentAt)]) index[dayKey(m.sentAt)].sent += 1;
      if (index[dayKey(m.readAt)]) index[dayKey(m.readAt)].read += 1;
      if (index[dayKey(m.clickedAt)]) index[dayKey(m.clickedAt)].clicks += 1;
    }
    for (const c of conversions) {
      const row = index[dayKey(c.createdAt)];
      if (row) { row.orders += 1; row.revenue += Number(c.value) || 0; }
    }

    const restaurants = this.repos.restaurants.all();
    const ranking = campaigns
      .filter((c) => c.status !== 'draft')
      .map((c) => ({
        id: c.id,
        name: c.name,
        status: c.status,
        restaurant: restaurants.find((r) => r.id === c.restaurantId)?.name || '—',
        startedAt: c.startedAt,
        stats: this.campaignStats(c.id),
      }))
      .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));

    const recentOrders = conversions
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 6)
      .map((c) => ({
        ...c,
        campaign: campaigns.find((x) => x.id === c.campaignId)?.name || 'Pedido direto',
        restaurant: restaurants.find((r) => r.id === c.restaurantId)?.name || '',
      }));

    return {
      totals,
      series,
      campaigns: ranking,
      recentOrders,
      contacts: {
        total: contacts.length,
        authorized: contacts.filter((c) => c.optIn && !c.optedOut).length,
        optedOut: contacts.filter((c) => c.optedOut).length,
      },
      counts: {
        restaurants: restaurantId ? 1 : restaurants.length,
        campaigns: campaigns.length,
        active: campaigns.filter((c) => ['sending', 'scheduled', 'paused'].includes(c.status)).length,
      },
    };
  }
}

module.exports = { AnalyticsService };
