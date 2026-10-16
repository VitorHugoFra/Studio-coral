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
    assert.deepEqual(list.map((r) => r.contactsCount), [48, 34]);
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
});
