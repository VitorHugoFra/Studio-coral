const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, ADMIN } = require('../helpers/app');

const MISSING = '00000000-0000-4000-8000-000000000000';

describe('restaurantes e acessos', () => {
  let ctx;
  before(async () => { ctx = await startApp(); });
  after(async () => { await ctx.close(); });

  it('cria com valores padrão, slug e contagens zeradas', async () => {
    const res = await ctx.agency.post('/api/restaurants', { name: 'Pizzaria do Zé', city: 'Belo Horizonte – MG' });
    assert.equal(res.status, 201);
    const r = res.data;
    assert.match(r.id, /^[0-9a-f-]{36}$/);
    assert.equal(r.slug, 'pizzaria-do-ze');
    assert.equal(r.city, 'Belo Horizonte – MG');
    assert.equal(r.color, '#73350c');
    assert.equal(r.emoji, '🍽️');
    assert.deepEqual(r.menu, []);
    assert.equal(r.contactsCount, 0);
    assert.equal(r.authorizedCount, 0);
    assert.equal(r.campaignsCount, 0);
    assert.equal(r.demoUrl, `${ctx.config.publicUrl}/demo/pizzaria-do-ze`);
    assert.match(r.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('nome repetido ganha sufixo no slug', async () => {
    assert.equal((await ctx.agency.post('/api/restaurants', { name: 'Pizzaria do Zé' })).data.slug, 'pizzaria-do-ze-2');
  });

  it('exige nome', async () => {
    const res = await ctx.agency.post('/api/restaurants', { city: 'BH' });
    assert.equal(res.status, 400);
    assert.equal(res.data.error, 'Informe o nome do restaurante.');
  });

  it('ignora campos que não são do restaurante', async () => {
    const res = await ctx.agency.post('/api/restaurants', { name: 'Bar Só Campos', hacker: true, id: 'x' });
    assert.equal(res.status, 201);
    assert.equal(res.data.hacker, undefined);
    assert.notEqual(res.data.id, 'x');
  });

  it('renomear muda o slug e mantém o resto', async () => {
    const created = (await ctx.agency.post('/api/restaurants', { name: 'Lanchonete Velha', coupon: 'VELHA10' })).data;
    const res = await ctx.agency.put(`/api/restaurants/${created.id}`, { name: 'Lanchonete Nova', menu: [{ id: 'x1', name: 'Coxinha', price: 8.5 }], requireApproval: false });
    assert.equal(res.status, 200);
    assert.equal(res.data.slug, 'lanchonete-nova');
    assert.equal(res.data.coupon, 'VELHA10');
    assert.deepEqual(res.data.menu, [{ id: 'x1', name: 'Coxinha', price: 8.5 }]);
    assert.equal(res.data.requireApproval, false);
    const again = (await ctx.agency.get(`/api/restaurants/${created.id}`)).data;
    assert.equal(again.name, 'Lanchonete Nova');
    assert.ok(again.updatedAt);
  });

  it('restaurante inexistente devolve 404, inclusive com id inválido', async () => {
    for (const id of [MISSING, 'nao-existe']) {
      const get = await ctx.agency.get(`/api/restaurants/${id}`);
      assert.equal(get.status, 404);
      assert.equal(get.data.error, 'Restaurante não encontrado');
      assert.equal((await ctx.agency.put(`/api/restaurants/${id}`, { name: 'X' })).status, 404);
    }
  });

  it('lista em ordem alfabética, respeitando acentos', async () => {
    for (const name of ['Zeta Grill', 'Ébano Bistrô', 'Alfa Burger']) await ctx.agency.post('/api/restaurants', { name });
    const names = (await ctx.agency.get('/api/restaurants')).data.map((r) => r.name);
    assert.deepEqual(names, names.slice().sort((a, b) => a.localeCompare(b)));
    assert.ok(names.indexOf('Alfa Burger') < names.indexOf('Ébano Bistrô'));
    assert.ok(names.indexOf('Ébano Bistrô') < names.indexOf('Zeta Grill'));
  });

  it('acessos do restaurante: criação e validações', async () => {
    const r = (await ctx.agency.post('/api/restaurants', { name: 'Sushi Kai' })).data;
    const url = `/api/restaurants/${r.id}/users`;
    const cases = [
      [{ email: 'sem-arroba', password: 'senha-boa-123' }, 'Informe um e-mail válido.'],
      [{ email: 'kai@sushi.com.br', password: 'curta' }, 'A senha precisa ter pelo menos 8 caracteres.'],
      [{ email: ADMIN.email, password: 'senha-boa-123' }, 'Este e-mail já tem acesso.'],
    ];
    for (const [body, error] of cases) {
      const res = await ctx.agency.post(url, body);
      assert.equal(res.status, 400);
      assert.equal(res.data.error, error);
    }
    const ok = await ctx.agency.post(url, { name: '', email: 'Kai@Sushi.com.br', password: 'senha-boa-123' });
    assert.equal(ok.status, 201);
    assert.equal(ok.data.email, 'kai@sushi.com.br');
    assert.equal(ok.data.name, 'kai@sushi.com.br');
    assert.equal(ok.data.role, 'staff'); // sem papel informado, o menor acesso
    assert.equal(ok.data.restaurantId, r.id);
    assert.equal(ok.data.passwordHash, undefined);
    assert.equal((await ctx.agency.post(url, { email: 'kai@sushi.com.br', password: 'senha-boa-123' })).data.error, 'Este e-mail já tem acesso.');
    const list = (await ctx.agency.get(url)).data;
    assert.deepEqual(list.map((u) => u.email), ['kai@sushi.com.br']);
    assert.equal(list[0].passwordHash, undefined);
    const missing = await ctx.agency.post(`/api/restaurants/${MISSING}/users`, { email: 'x@y.com', password: 'senha-boa-123' });
    assert.equal(missing.data.error, 'Restaurante não encontrado.');
  });

  it('agência redefine a senha de um acesso', async () => {
    const r = (await ctx.agency.post('/api/restaurants', { name: 'Taco Loco' })).data;
    const user = (await ctx.agency.post(`/api/restaurants/${r.id}/users`, { email: 'tito@taco.com.br', password: 'senha-velha-123' })).data;
    assert.equal((await ctx.agency.put(`/api/users/${user.id}/password`, { password: '123' })).data.error, 'A senha precisa ter pelo menos 8 caracteres.');
    assert.deepEqual((await ctx.agency.put(`/api/users/${user.id}/password`, { password: 'senha-nova-123' })).data, { ok: true });
    assert.equal((await ctx.client().login('tito@taco.com.br', 'senha-nova-123')).status, 200);
    const missing = await ctx.agency.put(`/api/users/${MISSING}/password`, { password: 'senha-nova-123' });
    assert.equal(missing.status, 404);
    assert.equal(missing.data.error, 'Usuário não encontrado.');
  });
});
