const { AnalyticsService } = require('./AnalyticsService');

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

const monthRange = (month) => {
  const [y, m] = String(month).split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) throw new Error('Mês inválido. Use o formato AAAA-MM.');
  return { start: new Date(y, m - 1, 1), end: new Date(y, m, 1), y, m };
};
const shift = (month, delta) => {
  const { y, m } = monthRange(month);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const variation = (now, before) => (before ? Math.round(((now - before) / before) * 1000) / 10 : null);

/**
 * Relatório mensal do restaurante (enviado em PDF pela agência).
 */
class ReportService {
  constructor({ repos, analytics }) {
    this.repos = repos;
    this.analytics = analytics;
  }

  static currentMonth() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  /** Meses que têm algum envio para o restaurante (para o seletor). */
  async availableMonths(restaurantId) {
    const set = new Set([ReportService.currentMonth()]);
    for (const m of await this.repos.messages.sentMonths(restaurantId)) set.add(m);
    return [...set].sort().reverse();
  }

  async totals(restaurantId, month) {
    const { start, end } = monthRange(month);
    const from = start.toISOString();
    const to = end.toISOString();
    const [counts, sales] = await Promise.all([
      this.repos.messages.summary({ restaurantId, sentFrom: from, sentTo: to }),
      this.repos.orders.summary({ restaurantId, attributedOnly: true, from, to }),
    ]);
    return { summary: AnalyticsService.withRates(counts, sales), start, end, from, to };
  }

  async monthly({ restaurantId, month = ReportService.currentMonth() }) {
    const restaurant = await this.repos.restaurants.get(restaurantId);
    if (!restaurant) throw Object.assign(new Error('Restaurante não encontrado.'), { status: 404 });

    const cur = await this.totals(restaurantId, month);
    const prev = (await this.totals(restaurantId, shift(month, -1))).summary;
    const { y, m } = monthRange(month);
    const s = cur.summary;
    const inMonth = (iso) => iso && new Date(iso) >= cur.start && new Date(iso) < cur.end;

    // Vendas de todas as origens (página 3): a reativação olha o fim do mês, ou agora se o mês não acabou
    const prevRange = monthRange(shift(month, -1));
    const ref = new Date(Math.min(cur.end.getTime(), Date.now())).toISOString();
    const [sent, orders, started, base, sales, prevSales] = await Promise.all([
      this.repos.messages.sentBetween(restaurantId, cur.from, cur.to),
      this.repos.orders.attributedBetween(restaurantId, cur.from, cur.to),
      this.repos.campaigns.startedBetween(restaurantId, cur.from, cur.to),
      this.repos.contacts.stats({ restaurantId, from: cur.from, to: cur.to }),
      this.repos.orders.monthSales(restaurantId, cur.from, cur.to, ref),
      this.repos.orders.monthSales(restaurantId, prevRange.start.toISOString(), prevRange.end.toISOString()),
    ]);

    // Dia a dia
    const days = new Date(y, m, 0).getDate();
    const daily = Array.from({ length: days }, (_, i) => ({ day: i + 1, sent: 0, clicks: 0, orders: 0, revenue: 0 }));
    for (const msg of sent) {
      daily[new Date(msg.sentAt).getDate() - 1].sent += 1;
      if (inMonth(msg.clickedAt)) daily[new Date(msg.clickedAt).getDate() - 1].clicks += 1;
    }
    const weekdays = WEEKDAYS.map((name) => ({ name, orders: 0, revenue: 0 }));
    const items = {};
    for (const c of orders) {
      const d = new Date(c.createdAt);
      daily[d.getDate() - 1].orders += 1;
      daily[d.getDate() - 1].revenue += Number(c.value) || 0;
      weekdays[d.getDay()].orders += 1;
      weekdays[d.getDay()].revenue += Number(c.value) || 0;
      for (const it of c.items || []) {
        const k = it.name || 'Item';
        items[k] = items[k] || { name: k, qty: 0, revenue: 0 };
        items[k].qty += Number(it.qty) || 1;
        items[k].revenue += (Number(it.price) || 0) * (Number(it.qty) || 1);
      }
    }

    const stats = await this.analytics.statsForCampaigns(started.map((c) => c.id));
    const campaigns = started.map((c) => ({ id: c.id, name: c.name, objective: c.objective, startedAt: c.startedAt, mediaUrl: c.mediaUrl || null, stats: stats.get(c.id) }));
    const best = campaigns.slice().sort((a, b) => b.stats.revenue - a.stats.revenue)[0] || null;
    const bestDay = weekdays.slice().sort((a, b) => b.orders - a.orders)[0];

    return {
      generatedAt: new Date().toISOString(),
      month,
      monthLabel: `${MONTHS[m - 1]} de ${y}`,
      restaurant: { id: restaurant.id, name: restaurant.name, segment: restaurant.segment, city: restaurant.city, color: restaurant.color, coupon: restaurant.coupon },
      totals: s,
      previous: { month: shift(month, -1), sent: prev.sent, clicked: prev.clicked, orders: prev.orders, revenue: prev.revenue },
      change: {
        sent: variation(s.sent, prev.sent),
        clicked: variation(s.clicked, prev.clicked),
        orders: variation(s.orders, prev.orders),
        revenue: variation(s.revenue, prev.revenue),
      },
      daily,
      campaigns,
      best: best && best.stats.revenue > 0 ? { name: best.name, revenue: best.stats.revenue, orders: best.stats.orders } : null,
      bestWeekday: bestDay && bestDay.orders ? bestDay : null,
      topItems: Object.values(items).sort((a, b) => b.qty - a.qty).slice(0, 6),
      base: { authorized: base.authorized, newThisMonth: base.createdInRange, optOutsThisMonth: base.optedOutInRange },
      sales: {
        ...sales,
        revenue: Math.round(sales.revenue * 100) / 100,
        ticket: sales.orders ? Math.round((sales.revenue / sales.orders) * 100) / 100 : 0,
        previous: { orders: prevSales.orders, revenue: Math.round(prevSales.revenue * 100) / 100 },
        change: { orders: variation(sales.orders, prevSales.orders), revenue: variation(sales.revenue, prevSales.revenue) },
      },
    };
  }
}

module.exports = { ReportService };
