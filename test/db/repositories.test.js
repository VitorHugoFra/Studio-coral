const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openTestDb } = require('../helpers/db');
// O caminho termina em /index enquanto o antigo src/db/repositories.js existir:
// o Node acha o arquivo antes da pasta. O arquivo antigo sai na Task 9.
const { createRepositories } = require('../../src/db/repositories/index');

describe('repositórios: restaurantes, acessos e configurações', () => {
  let db;
  let repos;
  before(async () => {
    db = await openTestDb();
    repos = createRepositories(db);
    await repos.settings.load();
  });
  after(() => db.close());

  it('restaurante: padrões, JSON e busca por slug', async () => {
    const r = await repos.restaurants.create({ name: 'Cantina', slug: 'cantina', menu: [{ id: 'm1', name: 'Lasanha', price: 62.9 }] });
    assert.equal(r.requireApproval, true);
    assert.equal(r.demo, false);
    assert.deepEqual(r.banners, []);
    assert.deepEqual(r.menu, [{ id: 'm1', name: 'Lasanha', price: 62.9 }]);
    assert.equal((await repos.restaurants.bySlug('cantina')).id, r.id);
    assert.equal(await repos.restaurants.bySlug('outra'), null);
  });

  it('restaurante: slug ocupado, ignorando o próprio', async () => {
    const r = await repos.restaurants.bySlug('cantina');
    assert.equal(await repos.restaurants.slugTaken('cantina'), true);
    assert.equal(await repos.restaurants.slugTaken('cantina', r.id), false);
    assert.equal(await repos.restaurants.slugTaken('livre'), false);
    await assert.rejects(repos.restaurants.create({ name: 'Outra', slug: 'cantina' }), /Já existe um restaurante com este endereço/);
  });

  it('restaurante: contagens de contatos, autorizados e campanhas', async () => {
    const r = await repos.restaurants.bySlug('cantina');
    const empty = await repos.restaurants.create({ name: 'Vazio', slug: 'vazio' });
    await db.query(`INSERT INTO contacts (id, restaurant_id, phone, phone_key, opt_in, opted_out) VALUES
      (gen_random_uuid(), $1, '5531999000001', '3199000001', true, false),
      (gen_random_uuid(), $1, '5531999000002', '3199000002', true, true),
      (gen_random_uuid(), $1, '5531999000003', '3199000003', false, false)`, [r.id]);
    await db.query("INSERT INTO campaigns (id, restaurant_id, name) VALUES (gen_random_uuid(), $1, 'C1')", [r.id]);
    const counts = await repos.restaurants.counts([r.id, empty.id]);
    assert.deepEqual(counts.get(r.id), { contactsCount: 3, authorizedCount: 1, campaignsCount: 1 });
    assert.deepEqual(counts.get(empty.id), { contactsCount: 0, authorizedCount: 0, campaignsCount: 0 });
    assert.equal((await repos.restaurants.counts([])).size, 0);
  });

  it('acessos: e-mail único, lista por restaurante e exclusão em cascata', async () => {
    const r = await repos.restaurants.create({ name: 'Bistrô', slug: 'bistro' });
    const u = await repos.users.create({ restaurantId: r.id, role: 'restaurant', name: 'Bia', email: 'bia@bistro.com.br', passwordHash: 'scrypt:x:y' });
    assert.equal((await repos.users.byEmail('bia@bistro.com.br')).id, u.id);
    assert.deepEqual((await repos.users.listByRestaurant(r.id)).map((x) => x.email), ['bia@bistro.com.br']);
    assert.deepEqual(await repos.users.listByRestaurant('nao-e-uuid'), []);
    await assert.rejects(repos.users.create({ restaurantId: r.id, name: 'Outra', email: 'bia@bistro.com.br', passwordHash: 'x' }), /Este e-mail já tem acesso/);
    assert.equal(await repos.restaurants.remove(r.id), true);
    assert.equal(await repos.users.get(u.id), null);
  });

  it('configurações: padrões, mescla e persistência', async () => {
    assert.equal(repos.settings.get().dailyLimit, 800);
    const updated = await repos.settings.update({ dailyLimit: 50, footer: 'Novo rodapé' });
    assert.equal(updated.dailyLimit, 50);
    assert.equal(updated.minDelaySeconds, 6);
    await repos.settings.update({ provider: 'simulator' });
    const fresh = createRepositories(db);
    await fresh.settings.load();
    assert.equal(fresh.settings.get().dailyLimit, 50);
    assert.equal(fresh.settings.get().footer, 'Novo rodapé');
    assert.equal(fresh.settings.get().provider, 'simulator');
  });

  it('dentro de repos.tx as configurações só podem ser lidas', async () => {
    await repos.tx(async (r) => {
      assert.equal(r.settings.get().dailyLimit, repos.settings.get().dailyLimit);
      await assert.rejects(r.settings.update({ footer: 'x' }), /não podem ser alteradas dentro de uma transação/);
      await assert.rejects(r.settings.load(), /não podem ser recarregadas dentro de uma transação/);
    });
  });

  it('repos.tx confirma ao terminar e desfaz em erro', async () => {
    await repos.tx(async (r) => { await r.restaurants.create({ name: 'Confirmado', slug: 'confirmado' }); });
    assert.ok(await repos.restaurants.bySlug('confirmado'));
    await assert.rejects(repos.tx(async (r) => {
      await r.restaurants.create({ name: 'Desfeito', slug: 'desfeito' });
      throw new Error('falhou');
    }), /falhou/);
    assert.equal(await repos.restaurants.bySlug('desfeito'), null);
  });

  it('ids que não são UUID não chegam ao SQL', async () => {
    assert.equal((await repos.restaurants.counts(['nao-e-uuid'])).size, 0);
    assert.equal(await repos.restaurants.slugTaken('cantina', 'nao-e-uuid'), true);
  });
});
