const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openTestDb } = require('../helpers/db');
const { createRepositories } = require('../../src/db/repositories/index');
const { MessagingProvider } = require('../../src/messaging/MessagingProvider');

describe('repositório de contatos', () => {
  let db;
  let repos;
  let r1;
  let r2;
  const names = (list) => list.map((c) => c.name).sort();

  before(async () => {
    db = await openTestDb();
    repos = createRepositories(db);
    r1 = await repos.restaurants.create({ name: 'Um', slug: 'um' });
    r2 = await repos.restaurants.create({ name: 'Dois', slug: 'dois' });
    await repos.contacts.insertMany([
      { restaurantId: r1.id, name: 'Ana', phone: '5531999000001', tags: ['vip'], optIn: true },
      { restaurantId: r1.id, name: 'Beto', phone: '5531999000002', tags: ['vip', 'familia'], optIn: true },
      { restaurantId: r1.id, name: 'Cris', phone: '5531999000003', tags: ['familia'], optIn: true },
      { restaurantId: r1.id, name: 'Duda', phone: '5531999000004', tags: ['vip'], optIn: true, optedOut: true },
      { restaurantId: r1.id, name: 'Edu', phone: '5531999000005', tags: ['vip'], optIn: false },
      { restaurantId: r2.id, name: 'Ana em outro restaurante', phone: '5531999000001', tags: [], optIn: true },
    ]);
  });
  after(() => db.close());

  it('phoneKey ignora o 55 e o nono dígito', () => {
    assert.equal(MessagingProvider.phoneKey('5531999000001'), '3199000001');
    assert.equal(MessagingProvider.phoneKey('(31) 9900-0001'), '3199000001');
  });

  it('grava a chave do telefone sem expor a coluna', async () => {
    const ana = await repos.contacts.findByPhone(r1.id, '5531999000001');
    assert.equal(ana.phoneKey, undefined);
    assert.equal((await db.one('SELECT phone_key FROM contacts WHERE id = $1', [ana.id])).phone_key, '3199000001');
  });

  it('lista com filtros de tag e situação', async () => {
    const list = async (f) => names(await repos.contacts.listByRestaurant({ restaurantId: r1.id, ...f }));
    assert.deepEqual(await list({}), ['Ana', 'Beto', 'Cris', 'Duda', 'Edu']);
    assert.deepEqual(await list({ tag: 'vip' }), ['Ana', 'Beto', 'Duda', 'Edu']);
    assert.deepEqual(await list({ status: 'authorized' }), ['Ana', 'Beto', 'Cris']);
    assert.deepEqual(await list({ status: 'optedOut' }), ['Duda']);
    assert.deepEqual(await list({ status: 'pending' }), ['Edu']);
    assert.deepEqual(await repos.contacts.listByRestaurant({ restaurantId: 'xyz' }), []);
    assert.equal((await repos.contacts.listByRestaurant({})).length, 6);
    assert.equal((await repos.contacts.byRestaurant(r2.id)).length, 1);
  });

  it('público da campanha: só autorizados, com "qualquer" e "todas"', async () => {
    const audience = async (segment) => names(await repos.contacts.audience(r1.id, segment));
    assert.deepEqual(await audience({}), ['Ana', 'Beto', 'Cris']);
    assert.deepEqual(await audience({ tags: ['vip'] }), ['Ana', 'Beto']);
    assert.deepEqual(await audience({ tags: ['vip', 'familia'], match: 'any' }), ['Ana', 'Beto', 'Cris']);
    assert.deepEqual(await audience({ tags: ['vip', 'familia'], match: 'all' }), ['Beto']);
    assert.deepEqual(await repos.contacts.audience('xyz', {}), []);
  });

  it('busca por telefone no restaurante e pela chave em todos', async () => {
    assert.equal((await repos.contacts.findByPhone(r1.id, '5531999000002')).name, 'Beto');
    assert.equal(await repos.contacts.findByPhone(r1.id, '5531999009999'), null);
    assert.equal(await repos.contacts.findByPhone('xyz', '5531999000002'), null);
    assert.deepEqual(names(await repos.contacts.byPhoneKey('3199000001')), ['Ana', 'Ana em outro restaurante']);
  });

  it('telefone repetido no mesmo restaurante vira mensagem amigável', async () => {
    await assert.rejects(repos.contacts.create({ restaurantId: r1.id, name: 'X', phone: '5531999000001' }), /Este telefone já está na base/);
    const beto = await repos.contacts.findByPhone(r1.id, '5531999000002');
    await assert.rejects(repos.contacts.update(beto, { phone: '5531999000001' }), /Este telefone já está na base/);
  });

  it('atualizar o telefone recalcula a chave', async () => {
    const cris = await repos.contacts.findByPhone(r1.id, '5531999000003');
    await repos.contacts.update(cris, { phone: '5531988887777' });
    assert.equal((await db.one('SELECT phone_key FROM contacts WHERE id = $1', [cris.id])).phone_key, '3188887777');
  });

  it('contagem de tags ordenada por uso e por nome', async () => {
    assert.deepEqual(await repos.contacts.tagCounts(r1.id), [{ tag: 'vip', count: 4 }, { tag: 'familia', count: 2 }]);
    assert.deepEqual(await repos.contacts.tagCounts('xyz'), []);
    assert.equal((await repos.contacts.tagCounts(null))[0].tag, 'vip');
  });

  it('descadastro em lote e números da base', async () => {
    const from = new Date(Date.now() - 60000).toISOString();
    const to = new Date(Date.now() + 60000).toISOString();
    const ana = await repos.contacts.findByPhone(r1.id, '5531999000001');
    const [changed] = await repos.contacts.markOptedOut([ana.id], new Date().toISOString());
    assert.equal(changed.optedOut, true);
    assert.deepEqual(await repos.contacts.markOptedOut([], new Date().toISOString()), []);
    assert.deepEqual(await repos.contacts.stats({ restaurantId: r1.id, from, to }), { total: 5, authorized: 2, optedOut: 2, createdInRange: 5, optedOutInRange: 1 });
    assert.equal((await repos.contacts.stats()).total, 6);
    assert.deepEqual(await repos.contacts.stats({ restaurantId: 'xyz' }), { total: 0, authorized: 0, optedOut: 0, createdInRange: 0, optedOutInRange: 0 });
  });

  it('descadastro ignora ids que não são UUID', async () => {
    const guarda = await repos.restaurants.create({ name: 'Guarda', slug: 'guarda' });
    const [gui] = await repos.contacts.insertMany([{ restaurantId: guarda.id, name: 'Gui', phone: '5531966660001', optIn: true }]);
    assert.deepEqual(await repos.contacts.markOptedOut(['nao-e-uuid'], new Date().toISOString()), []);
    const changed = await repos.contacts.markOptedOut([gui.id, 'nao-e-uuid'], new Date().toISOString());
    assert.equal(changed.length, 1);
    assert.equal(changed[0].id, gui.id);
    assert.equal(changed[0].optedOut, true);
  });

  it('público sai na ordem de cadastro, não pela data de criação', async () => {
    const ordem = await repos.restaurants.create({ name: 'Ordem', slug: 'ordem' });
    await repos.contacts.insertMany([
      { restaurantId: ordem.id, name: 'Terceiro', phone: '5531977770001', optIn: true, createdAt: '2026-01-03T00:00:00.000Z' },
      { restaurantId: ordem.id, name: 'Primeiro', phone: '5531977770002', optIn: true, createdAt: '2026-01-02T00:00:00.000Z' },
      { restaurantId: ordem.id, name: 'Segundo', phone: '5531977770003', optIn: true, createdAt: '2026-01-01T00:00:00.000Z' },
    ]);
    const publico = await repos.contacts.audience(ordem.id, {});
    assert.deepEqual(publico.map((c) => c.name), ['Terceiro', 'Primeiro', 'Segundo']);
    assert.ok(publico.every((c) => !Object.hasOwn(c, 'seq')));
  });

  it('período das estatísticas: início incluído, fim excluído', async () => {
    const periodo = await repos.restaurants.create({ name: 'Período', slug: 'periodo' });
    const from = '2026-02-01T00:00:00.000Z';
    const to = '2026-02-02T00:00:00.000Z';
    await repos.contacts.insertMany([
      { restaurantId: periodo.id, name: 'No início', phone: '5531955550001', createdAt: from },
      { restaurantId: periodo.id, name: 'No fim', phone: '5531955550002', createdAt: to },
    ]);
    assert.equal((await repos.contacts.stats({ restaurantId: periodo.id, from, to })).createdInRange, 1);
  });

  it('excluir o restaurante apaga os contatos dele', async () => {
    await repos.restaurants.remove(r2.id);
    assert.deepEqual(names(await repos.contacts.byPhoneKey('3199000001')), ['Ana']);
  });
});
