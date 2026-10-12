const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('../helpers/app');
const { legacyJson } = require('../helpers/legacy-json');

describe('primeira subida com um data/db.json antigo', () => {
  let ctx;
  before(async () => { ctx = await startApp({ seed: true, legacyJson: legacyJson() }); });
  after(async () => { await ctx.close(); });

  it('importa o JSON em vez de criar a demonstração', async () => {
    const list = (await ctx.agency.get('/api/restaurants')).data;
    assert.deepEqual(list.map((r) => r.name), ['Cantina Antiga']);
    assert.equal(list[0].contactsCount, 2);
    assert.equal(list[0].campaignsCount, 1);
  });

  it('acessos, configurações e números vêm junto', async () => {
    assert.equal((await ctx.client().login('giulia@antiga.com.br', 'senha-giulia-123')).status, 200);
    assert.equal((await ctx.agency.get('/api/settings')).data.footer, 'Rodapé antigo');
    const [r] = (await ctx.agency.get('/api/restaurants')).data;
    const d = (await ctx.agency.get(`/api/dashboard?restaurantId=${r.id}`)).data;
    assert.equal(d.totals.audience, 2);
    assert.equal(d.totals.orders, 1);
    assert.equal(d.totals.revenue, 77.4);
  });

  it('um provedor salvo que não existe neste ambiente cai no simulador', async () => {
    assert.equal((await ctx.agency.get('/api/messaging/status')).data.state, 'connected');
  });
});
