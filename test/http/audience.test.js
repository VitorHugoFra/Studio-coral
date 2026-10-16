const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, waitFor, phone } = require('../helpers/app');

const DAY = 864e5;
const MENU = [
  { id: 'm1', name: 'Lasanha', price: 62.9 },
  { id: 'm2', name: 'Suco', price: 10 },
  { id: 'm3', name: 'Pizza', price: 45 },
];
/** Meio-dia (fuso do servidor) de N dias atrás: longe da virada do dia. */
const daysAgo = (n) => { const d = new Date(Date.now() - n * DAY); d.setHours(12, 0, 0, 0); return d; };
const ymd = (d) => d.toLocaleDateString('sv-SE');
const line = (name, qty) => ({ name, qty, price: MENU.find((m) => m.name === name).price });

describe('filtros de público, ficha do cliente e vendas no relatório', () => {
  let ctx;
  let repos;
  let r;
  const ids = {};
  const today = new Date();
  const inThree = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 3);
  const inForty = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 40);

  const order = (contact, ago, items, extra = {}) => repos.orders.create({
    restaurantId: r.id,
    contactId: contact ? ids[contact] : null,
    customerName: contact,
    value: items.reduce((s, it) => s + it.qty * it.price, 0),
    items,
    status: 'completed',
    createdAt: (typeof ago === 'number' ? daysAgo(ago) : ago).toISOString(),
    ...extra,
  });
  const preview = async (filters, segment = {}) => {
    const res = await ctx.agency.post('/api/audience/preview', { restaurantId: r.id, segment: { tags: [], ...segment, filters } });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    return res;
  };
  const audience = async (filters, segment) => {
    const { count } = (await preview(filters, segment)).data;
    // A amostra mostra até 5: aqui o público é sempre menor que isso
    const names = (await preview(filters, segment)).data.sample.map((s) => s.name).sort();
    assert.equal(names.length, count);
    return names;
  };

  before(async () => {
    ctx = await startApp();
    repos = ctx.container.resolve('repos');
    r = (await ctx.agency.post('/api/restaurants', { name: 'Casa Filtros', menu: MENU, requireApproval: false })).data;
    const add = async (name, i, extra = {}) => {
      ids[name] = (await ctx.agency.post('/api/contacts', { restaurantId: r.id, name, phone: phone(i), ...extra })).data.id;
    };
    await add('Ana', 1, { tags: 'vip', birthDay: inThree.getDate(), birthMonth: inThree.getMonth() + 1 });
    await add('Bia', 2, { tags: 'vip', birthDay: inForty.getDate(), birthMonth: inForty.getMonth() + 1 });
    await add('Caio', 3, { neighborhood: 'Savassi' });
    await add('Duda', 4);
    await add('Edu', 5, { optIn: false });
    await ctx.agency.put(`/api/contacts/${ids.Duda}`, { optedOut: true });

    // Ana: 3 pedidos; dois caem no mesmo dia da semana de hoje (98 e 49 dias atrás) e o último foi há 40 dias, em Lourdes
    await order('Ana', 98, [line('Lasanha', 2)], { neighborhood: 'Savassi' });
    await order('Ana', 49, [line('Lasanha', 1)]);
    await order('Ana', 40, [line('Suco', 1)], { neighborhood: 'Lourdes' });
    // Bia: um pedido há 5 dias, no Centro; o cancelado (cinco lasanhas) não conta para nada
    await order('Bia', 5, [line('Pizza', 1)], { neighborhood: 'Centro' });
    await order('Bia', 2, [line('Lasanha', 5)], { status: 'canceled', neighborhood: 'Savassi' });
    // Duda (descadastrada) e Edu (sem autorização) compram, mas nunca entram no público
    await order('Duda', 3, [line('Suco', 1)]);
    await order('Duda', 4, [line('Suco', 1)]);
    for (let k = 0; k < 6; k += 1) await order('Edu', 10 + k, [line('Pizza', 1)]);
  });
  after(async () => { await ctx?.close(); });

  it('sem filtro, o público é a base autorizada', async () => {
    assert.deepEqual(await audience({}), ['Ana', 'Bia', 'Caio']);
  });

  it('quantidade de pedidos e total gasto (cancelados fora; máximo 0 é quem nunca comprou)', async () => {
    assert.deepEqual(await audience({ orders: { min: 2 } }), ['Ana']);
    assert.deepEqual(await audience({ orders: { min: 1, max: 1 } }), ['Bia']);
    assert.deepEqual(await audience({ orders: { max: 0 } }), ['Caio']);
    assert.deepEqual(await audience({ spent: { min: 100 } }), ['Ana']);
    assert.deepEqual(await audience({ spent: { max: 50 } }), ['Bia', 'Caio']);
  });

  it('dias desde a última compra e períodos da primeira e da última compra', async () => {
    assert.deepEqual(await audience({ lastOrderDays: { min: 30 } }), ['Ana'], 'quem nunca comprou não entra');
    assert.deepEqual(await audience({ lastOrderDays: { max: 7 } }), ['Bia']);
    assert.deepEqual(await audience({ lastOrderDays: { min: 39, max: 41 } }), ['Ana']);
    assert.deepEqual(await audience({ lastOrder: { from: ymd(daysAgo(10)) } }), ['Bia']);
    assert.deepEqual(await audience({ lastOrder: { from: ymd(daysAgo(40)), to: ymd(daysAgo(40)) } }), ['Ana'], 'o dia inteiro conta');
    assert.deepEqual(await audience({ firstOrder: { to: ymd(daysAgo(90)) } }), ['Ana']);
  });

  it('aniversário no mês ou nos próximos dias', async () => {
    assert.deepEqual(await audience({ birthday: { nextDays: 7 } }), ['Ana']);
    assert.deepEqual(await audience({ birthday: { month: inForty.getMonth() + 1 } }), ['Bia']);
    assert.deepEqual(await audience({ birthday: { nextDays: 60 } }), ['Ana', 'Bia']);
  });

  it('bairro do contato ou, se vazio, do último pedido com bairro (sem diferenciar maiúsculas)', async () => {
    assert.deepEqual(await audience({ neighborhoods: ['savassi'] }), ['Caio']);
    assert.deepEqual(await audience({ neighborhoods: ['Lourdes'] }), ['Ana']);
    assert.deepEqual(await audience({ neighborhoods: ['Centro', 'Lourdes'] }), ['Ana', 'Bia']);
  });

  it('item mais comprado ou já comprado; dia da semana preferido', async () => {
    assert.deepEqual(await audience({ items: ['Lasanha'] }), ['Ana'], 'as lasanhas canceladas da Bia não contam');
    assert.deepEqual(await audience({ items: ['Suco'] }), []);
    assert.deepEqual(await audience({ items: ['Suco'], itemsMode: 'any' }), ['Ana']);
    assert.deepEqual(await audience({ items: ['Pizza', 'Lasanha'] }), ['Ana', 'Bia']);
    assert.deepEqual(await audience({ weekdays: [today.getDay()] }), ['Ana']);
    assert.deepEqual(await audience({ weekdays: [daysAgo(5).getDay()] }), ['Bia']);
  });

  it('filtros combinados entre si e com as tags', async () => {
    assert.deepEqual(await audience({ orders: { min: 1 }, lastOrderDays: { max: 7 } }), ['Bia']);
    assert.deepEqual(await audience({ orders: { min: 2 } }, { tags: ['vip'] }), ['Ana']);
    assert.deepEqual(await audience({ orders: { max: 0 } }, { tags: ['vip'] }), []);
  });

  it('filtro inválido é recusado com a explicação', async () => {
    const res = await ctx.agency.post('/api/audience/preview', { restaurantId: r.id, segment: { filters: { orders: { min: 5, max: 1 } } } });
    assert.equal(res.status, 400);
    assert.equal(res.data.error, 'Quantidade de pedidos: o mínimo é maior que o máximo.');
    const list = await ctx.agency.get(`/api/contacts?restaurantId=${r.id}&filters=nao-e-json`);
    assert.equal(list.status, 400);
    assert.equal(list.data.error, 'Filtros inválidos.');
  });

  it('lista de contatos com filtros: todas as situações, com o perfil de compra', async () => {
    const list = async (filters, extra = '') => (await ctx.agency.get(`/api/contacts?restaurantId=${r.id}${extra}&filters=${encodeURIComponent(JSON.stringify(filters))}`)).data;
    assert.deepEqual((await list({ orders: { min: 2 } })).map((c) => c.name), ['Ana', 'Duda', 'Edu']);
    assert.deepEqual((await list({ orders: { min: 2 } }, '&status=authorized')).map((c) => c.name), ['Ana']);
    const [ana] = await list({ items: ['Lasanha'] });
    assert.equal(ana.purchase.orders, 3);
    assert.equal(ana.purchase.topItem, 'Lasanha');
    assert.equal(ana.purchase.lastNeighborhood, 'Lourdes');
    assert.equal(ana.purchase.weekday, today.getDay());
  });

  it('opções dos filtros: bairros efetivos e itens comprados', async () => {
    const { neighborhoods, items } = (await ctx.agency.get(`/api/contacts/facets?restaurantId=${r.id}`)).data;
    assert.deepEqual(neighborhoods, [{ name: 'Centro', count: 1 }, { name: 'Lourdes', count: 1 }, { name: 'Savassi', count: 1 }]);
    assert.deepEqual(items, [{ name: 'Pizza', count: 2 }, { name: 'Suco', count: 2 }, { name: 'Lasanha', count: 1 }]);
  });

  it('campanha com filtro: grava os filtros, envia só para quem passa e mudar o filtro zera a aprovação', async () => {
    const created = await ctx.agency.post('/api/campaigns', { restaurantId: r.id, name: 'Volta', message: 'Oi {{link}}', segment: { tags: [], filters: { lastOrderDays: { min: 30 }, orders: { min: '' } } } });
    assert.deepEqual(created.data.segment, { tags: [], match: 'any', filters: { lastOrderDays: { min: 30 } } });
    assert.equal((await ctx.agency.get(`/api/campaigns/${created.data.id}`)).data.audiencePreview, 1);
    await ctx.agency.post(`/api/campaigns/${created.data.id}/start`, {});
    await waitFor(async () => (await ctx.agency.get(`/api/campaigns/${created.data.id}`)).data.status === 'completed', { message: 'campanha concluída' });
    assert.deepEqual((await ctx.agency.get(`/api/campaigns/${created.data.id}/messages`)).data.map((m) => m.name), ['Ana']);

    const copy = (await ctx.agency.post(`/api/campaigns/${created.data.id}/duplicate`, {})).data;
    assert.deepEqual(copy.segment.filters, { lastOrderDays: { min: 30 } }, 'a cópia leva os filtros');

    const strict = (await ctx.agency.post('/api/restaurants', { name: 'Casa Aprovação', menu: MENU })).data;
    const c = (await ctx.agency.post('/api/campaigns', { restaurantId: strict.id, name: 'Aprovar', message: 'Oi {{link}}' })).data;
    await ctx.agency.post(`/api/campaigns/${c.id}/request-approval`, {});
    const same = await ctx.agency.put(`/api/campaigns/${c.id}`, { segment: { tags: [], match: 'any' } });
    assert.equal(same.data.approval.status, 'pending', 'o mesmo público não mexe na aprovação');
    const changed = await ctx.agency.put(`/api/campaigns/${c.id}`, { segment: { tags: [], filters: { orders: { min: 1 } } } });
    assert.equal(changed.data.approval, null);
  });

  it('ficha do cliente: números, itens, pedidos e campanhas recebidas', async () => {
    const res = await ctx.agency.get(`/api/contacts/${ids.Ana}`);
    assert.equal(res.status, 200);
    const f = res.data;
    assert.equal(f.name, 'Ana');
    assert.equal(f.restaurant, 'Casa Filtros');
    assert.equal(f.profile.orders, 3);
    assert.equal(f.profile.total, 198.7);
    assert.equal(f.profile.ticket, 66.23);
    // Dias inteiros desde o meio-dia de 40 dias atrás: 39 se a bateria rodar de manhã
    assert.equal(f.profile.daysSinceLast, Math.floor((Date.now() - daysAgo(40).getTime()) / DAY));
    assert.equal(f.profile.neighborhood, 'Lourdes');
    assert.equal(f.profile.weekday, today.getDay());
    assert.equal(f.profile.topItem, 'Lasanha');
    assert.deepEqual(f.topItems, [{ name: 'Lasanha', qty: 3 }, { name: 'Suco', qty: 1 }]);
    assert.equal(f.orders.length, 3);
    assert.ok(f.orders[0].createdAt > f.orders[2].createdAt, 'do mais novo para o mais antigo');
    assert.deepEqual(f.messages.map((m) => m.campaign), ['Volta']);
    assert.ok(f.messages[0].sentAt);

    const bia = (await ctx.agency.get(`/api/contacts/${ids.Bia}`)).data;
    assert.equal(bia.orders.length, 2, 'a ficha mostra também o cancelado');
    assert.equal(bia.profile.orders, 1, 'mas ele não conta nos números');
    const caio = (await ctx.agency.get(`/api/contacts/${ids.Caio}`)).data;
    assert.deepEqual([caio.profile.orders, caio.profile.daysSinceLast, caio.profile.neighborhood], [0, null, 'Savassi']);

    assert.equal((await ctx.agency.get('/api/contacts/00000000-0000-4000-8000-000000000000')).status, 404);
    assert.equal((await ctx.agency.get('/api/contacts/xyz')).status, 404);
    await ctx.agency.post(`/api/restaurants/${r.id}/users`, { name: 'Dona', email: 'dona@filtros.com.br', password: 'senha-dona-123' });
    const owner = ctx.client();
    await owner.login('dona@filtros.com.br', 'senha-dona-123');
    assert.equal((await owner.get(`/api/contacts/${ids.Ana}`)).status, 403, 'o restaurante não vê a base');
    assert.equal((await owner.get(`/api/contacts/facets?restaurantId=${r.id}`)).status, 403);
  });

  it('relatório mensal: vendas de todos os canais, novos e recorrentes, bairros, itens e reativação', async () => {
    const s = (await ctx.agency.post('/api/restaurants', { name: 'Casa Relatório', menu: MENU })).data;
    const cid = async (name, i, extra) => (await ctx.agency.post('/api/contacts', { restaurantId: s.id, name, phone: phone(100 + i), ...extra })).data.id;
    const xis = await cid('Xis', 1);
    const ypsilon = await cid('Ypsilon', 2);
    const ze = await cid('Zé', 3, { optIn: false });
    const at = (m, d) => new Date(2026, m - 1, d, 12).toISOString();
    const add = (contactId, createdAt, value, extra = {}) => repos.orders.create({ restaurantId: s.id, contactId, value, items: [], status: 'completed', createdAt, ...extra });
    await add(ze, at(1, 15), 20);
    await add(xis, at(2, 10), 30);
    await add(xis, at(3, 1), 40, { source: 'site', neighborhood: 'Centro', items: [line('Lasanha', 2)] });
    await add(ypsilon, at(3, 12), 50, { source: 'campaign', neighborhood: 'Centro', items: [line('Suco', 3)] });
    await add(ypsilon, at(3, 20), 60, { source: 'site', neighborhood: 'Savassi', items: [line('Lasanha', 1)] });
    await add(null, at(3, 15), 25, { source: 'import', channel: 'Caixa' });
    await add(ypsilon, at(3, 18), 999, { status: 'canceled', neighborhood: 'Lourdes' });

    const rep = (await ctx.agency.get(`/api/reports/monthly?restaurantId=${s.id}&month=2026-03`)).data;
    assert.equal(rep.sales.orders, 4);
    assert.equal(rep.sales.revenue, 175);
    assert.equal(rep.sales.ticket, 43.75);
    assert.deepEqual(rep.sales.customers, { buyers: 2, new: 1, returning: 1 });
    assert.deepEqual(rep.sales.bySource, [
      { source: 'site', orders: 2, revenue: 100 },
      { source: 'campaign', orders: 1, revenue: 50 },
      { source: 'import', orders: 1, revenue: 25 },
    ]);
    assert.deepEqual(rep.sales.neighborhoods, [{ name: 'Centro', orders: 2 }, { name: 'Savassi', orders: 1 }]);
    assert.deepEqual(rep.sales.items, [{ name: 'Lasanha', qty: 3 }, { name: 'Suco', qty: 3 }]);
    // No fim de março: Xis comprou pela última vez em 01/03 (31 dias antes) e Zé em janeiro; Ypsilon, em 20/03
    assert.deepEqual(rep.sales.inactive, { total: 2, authorized: 1 });
    assert.deepEqual(rep.sales.previous, { orders: 1, revenue: 30 });
    assert.deepEqual(rep.sales.change, { orders: 300, revenue: 483.3 });
  });
});
