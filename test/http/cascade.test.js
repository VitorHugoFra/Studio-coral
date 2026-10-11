const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, waitFor, phone } = require('../helpers/app');

describe('exclusões em cascata', () => {
  let ctx;
  before(async () => { ctx = await startApp(); });
  after(async () => { await ctx?.close(); });

  const location = async (code) => (await fetch(`${ctx.baseUrl}/r/${code}`, { redirect: 'manual' })).headers.get('location');

  async function completedCampaign(restaurant, i) {
    await ctx.agency.post('/api/contacts', { restaurantId: restaurant.id, name: `Cliente ${i}`, phone: phone(i) });
    const c = (await ctx.agency.post('/api/campaigns', { restaurantId: restaurant.id, name: `Campanha ${i}`, message: 'Oi {{link}}' })).data;
    await ctx.agency.post(`/api/campaigns/${c.id}/start`, {});
    await waitFor(async () => (await ctx.agency.get(`/api/campaigns/${c.id}`)).data.status === 'completed', { message: 'campanha concluída' });
    const [m] = (await ctx.agency.get(`/api/campaigns/${c.id}/messages`)).data;
    await ctx.client().post('/api/public/conversions', { ref: m.code, value: 42, orderId: `PED-${i}` });
    return { campaign: c, message: m };
  }

  it('excluir campanha apaga as mensagens e os pedidos dela', async () => {
    const r = (await ctx.agency.post('/api/restaurants', { name: 'Casa Um', requireApproval: false })).data;
    const { campaign, message } = await completedCampaign(r, 1);
    assert.equal((await ctx.agency.get(`/api/dashboard?restaurantId=${r.id}`)).data.totals.orders, 1);
    assert.deepEqual((await ctx.agency.del(`/api/campaigns/${campaign.id}`)).data, { ok: true });
    assert.equal((await ctx.agency.get(`/api/campaigns/${campaign.id}`)).status, 404);
    assert.equal(await location(message.code), '/');
    const d = (await ctx.agency.get(`/api/dashboard?restaurantId=${r.id}`)).data;
    assert.equal(d.totals.orders, 0);
    assert.equal(d.totals.audience, 0);
    // o número do pedido volta a ser aceito, porque o pedido anterior foi apagado junto
    assert.equal((await ctx.client().post('/api/public/conversions', { restaurantSlug: r.slug, value: 42, orderId: 'PED-1' })).status, 201);
  });

  it('não exclui restaurante com campanha em andamento', async () => {
    const r = (await ctx.agency.post('/api/restaurants', { name: 'Casa Dois', requireApproval: false })).data;
    await ctx.agency.post('/api/contacts', { restaurantId: r.id, name: 'Cliente 20', phone: phone(20) });
    await ctx.agency.post('/api/messaging/stop', {});
    try {
      const c = (await ctx.agency.post('/api/campaigns', { restaurantId: r.id, name: 'Travada', message: 'Oi' })).data;
      await ctx.agency.post(`/api/campaigns/${c.id}/start`, {});
      const blocked = await ctx.agency.del(`/api/restaurants/${r.id}`);
      assert.equal(blocked.status, 400);
      assert.equal(blocked.data.error, 'Há campanhas em andamento para este restaurante.');
      await ctx.agency.post(`/api/campaigns/${c.id}/cancel`, {});
      assert.deepEqual((await ctx.agency.del(`/api/restaurants/${r.id}`)).data, { ok: true });
    } finally {
      await ctx.agency.post('/api/messaging/start', {});
      await waitFor(async () => (await ctx.agency.get('/api/messaging/status')).data.state === 'connected', { message: 'reconectar' });
    }
  });

  it('excluir restaurante apaga contatos, campanhas, pedidos e acessos', async () => {
    const r = (await ctx.agency.post('/api/restaurants', { name: 'Casa Três', requireApproval: false })).data;
    const { message } = await completedCampaign(r, 30);
    await ctx.agency.post(`/api/restaurants/${r.id}/users`, { email: 'dono@casatres.com.br', password: 'senha-dono-123' });
    const owner = ctx.client();
    await owner.login('dono@casatres.com.br', 'senha-dono-123');

    assert.deepEqual((await ctx.agency.del(`/api/restaurants/${r.id}`)).data, { ok: true });
    assert.equal((await ctx.agency.get(`/api/restaurants/${r.id}`)).status, 404);
    assert.deepEqual((await ctx.agency.get(`/api/contacts?restaurantId=${r.id}`)).data, []);
    assert.deepEqual((await ctx.agency.get(`/api/campaigns?restaurantId=${r.id}`)).data, []);
    const d = (await ctx.agency.get(`/api/dashboard?restaurantId=${r.id}`)).data;
    assert.equal(d.totals.audience, 0);
    assert.equal(d.totals.orders, 0, 'os pedidos saem junto com o restaurante');
    assert.equal(await location(message.code), '/');
    assert.equal((await owner.get('/api/auth/me')).status, 401);
    assert.equal((await ctx.client().login('dono@casatres.com.br', 'senha-dono-123')).status, 401);
  });
});
