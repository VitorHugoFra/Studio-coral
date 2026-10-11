const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, waitFor, phone } = require('../helpers/app');

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

describe('painel, relatório mensal e configurações', () => {
  let ctx;
  let a;
  let b;
  let rest;
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  before(async () => {
    ctx = await startApp();
    a = (await ctx.agency.post('/api/restaurants', { name: 'Restaurante A', requireApproval: false })).data;
    b = (await ctx.agency.post('/api/restaurants', { name: 'Restaurante B' })).data;
    await ctx.agency.post('/api/contacts', { restaurantId: a.id, name: 'Paula Reis', phone: phone(1) });
    await ctx.agency.post('/api/contacts', { restaurantId: a.id, name: 'Rui Alves', phone: phone(2) });
    await ctx.agency.post('/api/contacts', { restaurantId: b.id, name: 'Bia Neves', phone: phone(3) });
    const campaign = (await ctx.agency.post('/api/campaigns', { restaurantId: a.id, name: 'Campanha do Mês', message: 'Oi {{primeiro_nome}} {{link}}' })).data;
    await ctx.agency.post(`/api/campaigns/${campaign.id}/start`, {});
    await waitFor(async () => (await ctx.agency.get(`/api/campaigns/${campaign.id}`)).data.status === 'completed', { message: 'campanha concluída' });
    const [m] = (await ctx.agency.get(`/api/campaigns/${campaign.id}/messages`)).data;
    await fetch(`${ctx.baseUrl}/r/${m.code}`, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0' } });
    const pub = ctx.client();
    await pub.post('/api/public/conversions', { ref: m.code, value: 100, orderId: 'A-1', items: [{ name: 'Pizza', qty: 2, price: 40 }, { name: 'Suco', qty: 1, price: 20 }] });
    await pub.post('/api/public/conversions', { restaurantSlug: a.slug, value: 50, orderId: 'A-2' });
    await ctx.agency.post(`/api/restaurants/${a.id}/users`, { name: 'Dono A', email: 'dono@a.com.br', password: 'senha-dono-123' });
    rest = ctx.client();
    await rest.login('dono@a.com.br', 'senha-dono-123');
  });
  after(async () => { await ctx?.close(); });

  it('painel do restaurante na visão da agência', async () => {
    const d = (await ctx.agency.get(`/api/dashboard?restaurantId=${a.id}`)).data;
    assert.equal(d.totals.audience, 2);
    assert.equal(d.totals.sent, 2);
    assert.equal(d.totals.clicked, 1);
    assert.equal(d.totals.orders, 1);
    assert.equal(d.totals.revenue, 100);
    assert.equal(d.series.length, 14);
    const today = d.series.at(-1);
    assert.equal(today.day, new Date().toLocaleDateString('sv-SE'));
    assert.equal(today.sent, 2);
    assert.equal(today.clicks, 1);
    assert.equal(today.orders, 1);
    assert.equal(today.revenue, 100);
    assert.deepEqual(d.campaigns.map((c) => c.name), ['Campanha do Mês']);
    assert.equal(d.campaigns[0].restaurant, 'Restaurante A');
    assert.equal(d.campaigns[0].stats.orders, 1);
    assert.equal(d.recentOrders.length, 1);
    assert.equal(d.recentOrders[0].campaign, 'Campanha do Mês');
    assert.equal(d.recentOrders[0].restaurant, 'Restaurante A');
    assert.deepEqual(d.contacts, { total: 2, authorized: 2, optedOut: 0 });
    assert.deepEqual(d.counts, { restaurants: 1, campaigns: 1, active: 0 });
  });

  it('painel geral soma todos os restaurantes', async () => {
    const d = (await ctx.agency.get('/api/dashboard')).data;
    assert.equal(d.counts.restaurants, 2);
    assert.equal(d.contacts.total, 3);
    assert.equal(d.totals.orders, 1);
  });

  it('restaurante só enxerga o próprio painel', async () => {
    const d = (await rest.get(`/api/dashboard?restaurantId=${b.id}`)).data;
    assert.equal(d.contacts.total, 2);
    assert.equal(d.totals.orders, 1);
  });

  it('relatório mensal com totais, dias, campanhas e itens', async () => {
    const rep = (await ctx.agency.get(`/api/reports/monthly?restaurantId=${a.id}&month=${month}`)).data;
    assert.equal(rep.month, month);
    assert.equal(rep.monthLabel, `${MONTHS[now.getMonth()]} de ${now.getFullYear()}`);
    assert.equal(rep.restaurant.name, 'Restaurante A');
    assert.equal(rep.totals.sent, 2);
    assert.equal(rep.totals.orders, 1);
    assert.equal(rep.totals.revenue, 100);
    assert.equal(rep.daily.length, new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate());
    assert.deepEqual(rep.daily[now.getDate() - 1], { day: now.getDate(), sent: 2, clicks: 1, orders: 1, revenue: 100 });
    assert.deepEqual(rep.campaigns.map((c) => c.name), ['Campanha do Mês']);
    assert.deepEqual(rep.best, { name: 'Campanha do Mês', revenue: 100, orders: 1 });
    assert.equal(rep.bestWeekday.name, WEEKDAYS[now.getDay()]);
    assert.equal(rep.bestWeekday.orders, 1);
    assert.deepEqual(rep.topItems, [{ name: 'Pizza', qty: 2, revenue: 80 }, { name: 'Suco', qty: 1, revenue: 20 }]);
    assert.deepEqual(rep.base, { authorized: 2, newThisMonth: 2, optOutsThisMonth: 0 });
    assert.equal(rep.previous.orders, 0);
    assert.equal(rep.change.orders, null);
  });

  it('meses disponíveis e validações do relatório', async () => {
    const months = (await ctx.agency.get(`/api/reports/months?restaurantId=${a.id}`)).data;
    assert.ok(months.includes(month), JSON.stringify(months));
    assert.deepEqual(months, months.slice().sort().reverse());
    const bad = await ctx.agency.get(`/api/reports/monthly?restaurantId=${a.id}&month=2026-13`);
    assert.equal(bad.status, 400);
    assert.equal(bad.data.error, 'Mês inválido. Use o formato AAAA-MM.');
    assert.equal((await ctx.agency.get('/api/reports/monthly')).data.error, 'Escolha o restaurante.');
    assert.equal((await rest.get(`/api/reports/monthly?month=${month}`)).data.restaurant.name, 'Restaurante A');
  });

  it('mensageria informa o provedor ativo', async () => {
    const s = (await ctx.agency.get('/api/messaging/status')).data;
    assert.equal(s.state, 'connected');
    assert.deepEqual(s.providers.map((p) => [p.key, p.active]), [['simulator', true]]);
  });

  it('configurações: leitura, limites e visão do restaurante', async () => {
    const s = (await ctx.agency.get('/api/settings')).data;
    assert.equal(s.dailyLimit, 800);
    assert.equal(s.footer, 'Responda SAIR para não receber mais mensagens.');
    const upd = (await ctx.agency.put('/api/settings', { minDelaySeconds: 3, maxDelaySeconds: 2, dailyLimit: 0, footer: 'Rodapé novo', optOutKeywords: 'Sair, PARE', businessHours: { start: '10:00' } })).data;
    assert.equal(upd.minDelaySeconds, 3);
    assert.equal(upd.maxDelaySeconds, 3);
    assert.equal(upd.dailyLimit, 1);
    assert.equal(upd.footer, 'Rodapé novo');
    assert.deepEqual(upd.optOutKeywords, ['sair', 'pare']);
    assert.deepEqual(upd.businessHours, { start: '10:00', end: '21:00' });
    assert.equal((await ctx.agency.get('/api/settings')).data.footer, 'Rodapé novo');
    assert.deepEqual((await rest.get('/api/settings')).data, { footer: 'Rodapé novo' });
  });
});
