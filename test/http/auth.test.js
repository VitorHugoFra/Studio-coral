const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, ADMIN } = require('../helpers/app');

describe('autenticação e perfis de acesso', () => {
  let ctx;
  before(async () => { ctx = await startApp(); });
  after(async () => { await ctx.close(); });

  async function restaurantWithUser(name, email, password) {
    const restaurant = (await ctx.agency.post('/api/restaurants', { name })).data;
    const user = await ctx.agency.post(`/api/restaurants/${restaurant.id}/users`, { name: `Equipe ${name}`, email, password });
    assert.equal(user.status, 201);
    const client = ctx.client();
    assert.equal((await client.login(email, password)).status, 200);
    return { restaurant, user: user.data, client };
  }

  it('agência entra com o login do .env', async () => {
    const api = ctx.client();
    const res = await api.login(ADMIN.email, ADMIN.password);
    assert.equal(res.status, 200);
    assert.equal(res.data.ok, true);
    assert.equal(res.data.user.role, 'agency');
    assert.equal(res.data.user.email, ADMIN.email);
    assert.equal(res.data.user.name, ADMIN.name);
    assert.match(res.headers.get('set-cookie'), /^sc_session=.+HttpOnly/);
    const me = await api.get('/api/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.data.user.role, 'agency');
  });

  it('senha errada devolve 401', async () => {
    const res = await ctx.client().login(ADMIN.email, 'senha-errada');
    assert.equal(res.status, 401);
    assert.equal(res.data.error, 'E-mail ou senha incorretos.');
  });

  it('sem sessão as rotas do painel devolvem 401', async () => {
    const res = await ctx.client().get('/api/restaurants');
    assert.equal(res.status, 401);
    assert.equal(res.data.error, 'Sessão expirada. Entre novamente.');
  });

  it('sair apaga a sessão', async () => {
    const api = ctx.client();
    await api.login(ADMIN.email, ADMIN.password);
    assert.deepEqual((await api.post('/api/auth/logout')).data, { ok: true });
    assert.equal((await api.get('/api/auth/me')).status, 401);
  });

  it('restaurante vê só o próprio restaurante e só as rotas liberadas', async () => {
    const { restaurant, client } = await restaurantWithUser('Cantina Alfa', 'ana@alfa.com.br', 'senha-ana-123');
    await ctx.agency.post('/api/restaurants', { name: 'Cantina Beta' });

    const me = (await client.get('/api/auth/me')).data.user;
    assert.equal(me.role, 'restaurant');
    assert.equal(me.restaurantId, restaurant.id);
    assert.equal(me.restaurant, 'Cantina Alfa');
    assert.deepEqual((await client.get('/api/restaurants')).data.map((r) => r.name), ['Cantina Alfa']);

    for (const [method, url] of [['get', `/api/contacts?restaurantId=${restaurant.id}`], ['post', '/api/restaurants'], ['get', '/api/messaging/status']]) {
      const res = await client[method](url);
      assert.equal(res.status, 403, `${method} ${url}`);
      assert.equal(res.data.error, 'Seu acesso não permite esta ação.');
    }
    assert.deepEqual(Object.keys((await client.get('/api/settings')).data), ['footer']);
  });

  it('e-mail do restaurante ignora maiúsculas e espaços', async () => {
    await restaurantWithUser('Cantina Gama', 'gil@gama.com.br', 'senha-gil-123');
    const res = await ctx.client().login('  GIL@Gama.com.br ', 'senha-gil-123');
    assert.equal(res.status, 200);
    assert.equal(res.data.user.email, 'gil@gama.com.br');
  });

  it('restaurante troca a própria senha', async () => {
    const { client } = await restaurantWithUser('Cantina Delta', 'davi@delta.com.br', 'senha-davi-123');
    const wrong = await client.put('/api/me/password', { current: 'nao-e-essa', password: 'senha-nova-123' });
    assert.equal(wrong.status, 400);
    assert.equal(wrong.data.error, 'Senha atual incorreta.');
    const short = await client.put('/api/me/password', { current: 'senha-davi-123', password: 'curta' });
    assert.equal(short.data.error, 'A senha precisa ter pelo menos 8 caracteres.');
    assert.deepEqual((await client.put('/api/me/password', { current: 'senha-davi-123', password: 'senha-nova-123' })).data, { ok: true });
    assert.equal((await ctx.client().login('davi@delta.com.br', 'senha-davi-123')).status, 401);
    assert.equal((await ctx.client().login('davi@delta.com.br', 'senha-nova-123')).status, 200);
  });

  it('a senha da agência não muda pelo painel', async () => {
    const res = await ctx.agency.put('/api/me/password', { current: ADMIN.password, password: 'outra-senha-123' });
    assert.equal(res.status, 400);
    assert.equal(res.data.error, 'A senha da agência é definida no arquivo .env.');
  });

  it('acesso removido perde a sessão na hora', async () => {
    const { user, client } = await restaurantWithUser('Cantina Épsilon', 'eva@epsilon.com.br', 'senha-eva-123');
    assert.deepEqual((await ctx.agency.del(`/api/users/${user.id}`)).data, { ok: true });
    assert.equal((await client.get('/api/auth/me')).status, 401);
    assert.equal((await ctx.client().login('eva@epsilon.com.br', 'senha-eva-123')).status, 401);
  });
});
