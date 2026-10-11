const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('../helpers/app');

describe('contatos', () => {
  let ctx;
  let r;
  const list = async (query = '') => (await ctx.agency.get(`/api/contacts?restaurantId=${r.id}${query}`)).data;
  const byName = async (name) => (await list()).find((c) => c.name === name);

  before(async () => {
    ctx = await startApp();
    r = (await ctx.agency.post('/api/restaurants', { name: 'Cantina dos Testes' })).data;
  });
  after(async () => { await ctx.close(); });

  it('cria normalizando nome, telefone e tags', async () => {
    const res = await ctx.agency.post('/api/contacts', { restaurantId: r.id, name: '  Marina Souza ', phone: '(31) 99999-0001', tags: 'VIP, Família ,vip' });
    assert.equal(res.status, 201);
    assert.equal(res.data.name, 'Marina Souza');
    assert.equal(res.data.phone, '5531999990001');
    assert.deepEqual(res.data.tags, ['vip', 'família']);
    assert.equal(res.data.optIn, true);
    assert.equal(res.data.optedOut, false);
    assert.equal(res.data.optInSource, 'Cadastro manual');
    assert.equal(res.data.notes, '');
    assert.equal(res.data.restaurantId, r.id);
  });

  it('recusa telefone repetido, inválido e restaurante ausente', async () => {
    const dup = await ctx.agency.post('/api/contacts', { restaurantId: r.id, name: 'Outra', phone: '31999990001' });
    assert.equal(dup.status, 400);
    assert.equal(dup.data.error, 'Este telefone já está na base.');
    assert.equal((await ctx.agency.post('/api/contacts', { restaurantId: r.id, name: 'Curto', phone: '123' })).data.error, 'Telefone inválido: 123');
    assert.equal((await ctx.agency.post('/api/contacts', { restaurantId: r.id, name: 'Vazio' })).data.error, 'Telefone inválido: (vazio)');
    assert.equal((await ctx.agency.post('/api/contacts', { name: 'Sem', phone: '31999990009' })).data.error, 'Selecione o restaurante.');
  });

  it('importa contatos: cria, atualiza e aponta inválidos', async () => {
    const res = await ctx.agency.post('/api/contacts/import', {
      restaurantId: r.id,
      tags: 'Importado',
      contacts: [
        { name: 'Bruno Lima', phone: '31 98888-0002', tags: ['almoco'] },
        { name: 'Marina S.', phone: '5531999990001', tags: ['nova'] },
        { name: 'Bruno de novo', phone: '(31) 98888-0002' },
        { name: 'Sem número', phone: '12' },
      ],
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.created, 1);
    assert.equal(res.data.updated, 2);
    assert.equal(res.data.invalid.length, 1);
    assert.equal(res.data.invalid[0].error, 'Telefone inválido: 12');
    assert.equal(res.data.invalid[0].row.name, 'Sem número');

    assert.deepEqual((await byName('Marina S.')).tags, ['vip', 'família', 'nova', 'importado']);
    const bruno = await byName('Bruno Lima');
    assert.equal(bruno.phone, '5531988880002');
    assert.deepEqual(bruno.tags, ['almoco', 'importado']);
    assert.equal(bruno.optIn, true);
    assert.equal(bruno.optInSource, 'Importação');
    assert.equal((await ctx.agency.post('/api/contacts/import', { contacts: [] })).data.error, 'Selecione o restaurante.');
  });

  it('filtra por tag, situação e busca, em ordem alfabética', async () => {
    const carla = (await ctx.agency.post('/api/contacts', { restaurantId: r.id, name: 'Carla Dias', phone: '31977770003', tags: 'vip' })).data;
    await ctx.agency.put(`/api/contacts/${carla.id}`, { optedOut: true });
    await ctx.agency.post('/api/contacts', { restaurantId: r.id, name: 'Dani Rocha', phone: '31966660004', optIn: false });

    assert.deepEqual((await list()).map((c) => c.name), ['Bruno Lima', 'Carla Dias', 'Dani Rocha', 'Marina S.']);
    assert.deepEqual((await list('&tag=vip')).map((c) => c.name), ['Carla Dias', 'Marina S.']);
    assert.deepEqual((await list('&status=authorized')).map((c) => c.name), ['Bruno Lima', 'Marina S.']);
    assert.deepEqual((await list('&status=optedOut')).map((c) => c.name), ['Carla Dias']);
    assert.deepEqual((await list('&status=pending')).map((c) => c.name), ['Dani Rocha']);
    assert.deepEqual((await list('&search=MARI')).map((c) => c.name), ['Marina S.']);
    assert.deepEqual((await list('&search=8888')).map((c) => c.name), ['Bruno Lima']);
    assert.deepEqual(await list('&search=zzz'), []);
  });

  it('conta as tags da base', async () => {
    const res = (await ctx.agency.get(`/api/contacts/tags?restaurantId=${r.id}`)).data;
    assert.deepEqual(Object.fromEntries(res.map((t) => [t.tag, t.count])), { vip: 2, família: 1, nova: 1, importado: 2, almoco: 1 });
    const counts = res.map((t) => t.count);
    assert.deepEqual(counts, counts.slice().sort((a, b) => b - a));
  });

  it('descadastra e recadastra pela edição', async () => {
    const bruno = await byName('Bruno Lima');
    const out = (await ctx.agency.put(`/api/contacts/${bruno.id}`, { optedOut: true })).data;
    assert.equal(out.optedOut, true);
    assert.match(out.optedOutAt, /^\d{4}-\d{2}-\d{2}T/);
    const back = (await ctx.agency.put(`/api/contacts/${bruno.id}`, { optedOut: false, notes: 'Pediu para voltar' })).data;
    assert.equal(back.optedOut, false);
    assert.equal(back.optedOutAt, null);
    assert.equal(back.notes, 'Pediu para voltar');
    assert.equal(back.phone, '5531988880002');
  });

  it('edição valida o telefone e acusa contato inexistente', async () => {
    const bruno = await byName('Bruno Lima');
    const bad = await ctx.agency.put(`/api/contacts/${bruno.id}`, { phone: '1' });
    assert.equal(bad.status, 400);
    assert.equal(bad.data.error, 'Telefone inválido: 1');
    for (const id of ['00000000-0000-4000-8000-000000000000', 'abc']) {
      const res = await ctx.agency.put(`/api/contacts/${id}`, { name: 'X' });
      assert.equal(res.status, 404);
      assert.equal(res.data.error, 'Contato não encontrado');
    }
  });

  it('conta contatos no restaurante e exclui', async () => {
    const before = (await ctx.agency.get(`/api/restaurants/${r.id}`)).data;
    assert.equal(before.contactsCount, 4);
    assert.equal(before.authorizedCount, 2);
    const dani = await byName('Dani Rocha');
    assert.deepEqual((await ctx.agency.del(`/api/contacts/${dani.id}`)).data, { ok: true });
    assert.deepEqual((await ctx.agency.del(`/api/contacts/${dani.id}`)).data, { ok: false });
    assert.deepEqual((await ctx.agency.del('/api/contacts/abc')).data, { ok: false });
    assert.equal((await ctx.agency.get(`/api/restaurants/${r.id}`)).data.contactsCount, 3);
  });
});
