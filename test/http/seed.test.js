const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('../helpers/app');

describe('dados de demonstração', () => {
  let ctx;
  before(async () => { ctx = await startApp({ seed: true }); });
  after(async () => { await ctx?.close(); });

  it('a primeira execução cria os dois restaurantes de exemplo', async () => {
    const list = (await ctx.agency.get('/api/restaurants')).data;
    assert.deepEqual(list.map((r) => r.name), ['Cantina Bella Nonna', 'Sabor de Minas']);
    // A base autorizada e mais os clientes que pediram sem marcar a caixa de promoções
    assert.deepEqual(list.map((r) => r.contactsCount), [88, 64]);
    assert.deepEqual(list.map((r) => r.campaignsCount), [4, 3]);
    assert.ok(list.every((r) => r.demo === true && r.menu.length > 0 && r.banners.length === 2));
  });

  it('os acessos de demonstração funcionam', async () => {
    const giulia = ctx.client();
    const login = await giulia.login('giulia@bellanonna.com.br', 'bellanonna');
    assert.equal(login.status, 200);
    assert.equal(login.data.user.restaurant, 'Cantina Bella Nonna');
    assert.equal(login.data.user.teamRole, 'manager');
    const marco = await ctx.client().login('marco@bellanonna.com.br', 'marco-nonna');
    assert.equal(marco.data.user.teamRole, 'staff', 'alguém da equipe, para a tela Equipe não abrir só com a gerente');
    const campaigns = (await giulia.get('/api/campaigns')).data;
    assert.equal(campaigns.find((c) => c.name === 'Clientes VIP · Menu Degustação').approval.status, 'pending');
    assert.equal(campaigns.filter((c) => c.status === 'completed').length, 3);
  });

  it('o histórico de campanhas aparece no painel', async () => {
    const [nonna] = (await ctx.agency.get('/api/restaurants')).data;
    const d = (await ctx.agency.get(`/api/dashboard?restaurantId=${nonna.id}`)).data;
    assert.ok(d.totals.sent > 100);
    assert.ok(d.totals.orders > 0);
    assert.equal(d.campaigns.length, 3);
  });

  it('cerca de seis meses de pedidos, com o quadro de hoje já em andamento', async () => {
    const [nonna, minas] = (await ctx.agency.get('/api/restaurants')).data;
    const board = (await ctx.agency.get(`/api/orders?restaurantId=${nonna.id}&active=1`)).data;
    assert.deepEqual(board.map((o) => o.status), ['dispatched', 'preparing', 'new', 'new']);
    assert.ok(board.every((o) => o.number && o.trackingUrl && o.customerName));
    const old = new Date(Date.now() - 150 * 864e5).toLocaleDateString('sv-SE');
    assert.ok((await ctx.agency.get(`/api/orders?restaurantId=${nonna.id}&to=${old}`)).data.length > 50, 'há pedidos de cinco meses atrás');
    for (const source of ['site', 'campaign', 'import']) {
      assert.ok((await ctx.agency.get(`/api/orders?restaurantId=${minas.id}&source=${source}&limit=1`)).data.length, `há pedidos de origem ${source}`);
    }
    const contacts = (await ctx.agency.get(`/api/contacts?restaurantId=${nonna.id}`)).data;
    assert.ok(contacts.filter((c) => c.purchase.orders >= 10).length >= 3, 'clientes que voltam sempre');
    assert.ok(contacts.some((c) => c.birthDay) && contacts.some((c) => !c.optIn && c.purchase.orders));
    // Os pedidos de campanha seguem atribuídos (só eles contam no painel das campanhas)
    const d = (await ctx.agency.get(`/api/dashboard?restaurantId=${nonna.id}`)).data;
    assert.equal(d.totals.orders, (await ctx.agency.get(`/api/orders?restaurantId=${nonna.id}&source=campaign`)).data.length);
  });
});
