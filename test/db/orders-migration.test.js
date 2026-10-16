const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Database } = require('../../src/db/Database');
const { migrate, MIGRATIONS_DIR } = require('../../src/db/migrate');
const { createRepositories } = require('../../src/db/repositories');

const R = '11111111-1111-4111-8111-111111111111';
const K = '22222222-2222-4222-8222-222222222222';
const C1 = '33333333-3333-4333-8333-333333333331';
const C2 = '33333333-3333-4333-8333-333333333332';

describe('migração 003: das conversões da etapa 1 para os pedidos', () => {
  it('mantém os pedidos que existiam, com origem e status, e excluir a campanha não os apaga mais', async () => {
    // Um banco parado na etapa 1: só as migrações 001 e 002
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coral-mig-'));
    for (const f of ['001_esquema_inicial.sql', '002_indices_chaves_estrangeiras.sql']) fs.copyFileSync(path.join(MIGRATIONS_DIR, f), path.join(dir, f));
    const db = await Database.open({ pgliteDir: 'memory://' });
    try {
      await migrate(db, { dir });
      await db.query("INSERT INTO restaurants (id, name, slug) VALUES ($1, 'Casa', 'casa')", [R]);
      await db.query("INSERT INTO campaigns (id, restaurant_id, name, status) VALUES ($1, $2, 'Antiga', 'completed')", [K, R]);
      await db.query(`INSERT INTO conversions (id, created_at, restaurant_id, campaign_id, customer_name, order_id, value, items) VALUES
        ($1, '2026-09-05T19:10:00Z', $3, $4, 'Ana', 'PED-1', 77.4, '[{"name":"Lasanha","qty":1,"price":62.9}]'),
        ($2, '2026-09-06T12:00:00Z', $3, NULL, 'Beto', 'PED-2', 30, '[]')`, [C1, C2, R, K]);

      // Agora o sistema novo sobe e aplica o que falta
      assert.deepEqual(await migrate(db), ['003_pedidos']);
      const repos = createRepositories(db);
      const ana = await repos.orders.get(C1);
      assert.deepEqual(
        [ana.source, ana.status, ana.campaignId, ana.value, ana.createdAt, ana.number, ana.trackingCode, ana.discount, ana.statusLog],
        ['campaign', 'completed', K, 77.4, '2026-09-05T19:10:00.000Z', null, null, 0, []],
      );
      assert.deepEqual(ana.items, [{ name: 'Lasanha', qty: 1, price: 62.9 }]);
      const beto = await repos.orders.get(C2);
      assert.deepEqual([beto.source, beto.status], ['site', 'completed']);
      assert.equal(await db.one("SELECT to_regclass('public.conversions') AS t").then((r) => r.t), null);
      // O número de pedido continua único por restaurante (o índice foi renomeado, não perdido)
      assert.equal(await repos.orders.createUnique({ restaurantId: R, orderId: 'PED-1', value: 1 }), null);
      // O contador do número do site começa do zero
      assert.equal(await repos.restaurants.nextOrderNumber(R), 1);

      await repos.campaigns.remove(K);
      const kept = await repos.orders.get(C1);
      assert.equal(kept.campaignId, null);
      assert.equal(kept.value, 77.4);
    } finally {
      await db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('as regras do banco barram status, origem e aniversário inválidos', async () => {
    const db = await Database.open({ pgliteDir: 'memory://' });
    try {
      await migrate(db);
      const repos = createRepositories(db);
      const r = await repos.restaurants.create({ name: 'Regras', slug: 'regras' });
      await assert.rejects(repos.orders.create({ restaurantId: r.id, value: 1, status: 'perdido' }), (err) => err.code === '23514');
      await assert.rejects(repos.orders.create({ restaurantId: r.id, value: 1, source: 'boato' }), (err) => err.code === '23514');
      await assert.rejects(repos.orders.create({ restaurantId: r.id, value: 1, fulfillment: 'drone' }), (err) => err.code === '23514');
      await assert.rejects(repos.contacts.create({ restaurantId: r.id, phone: '5531999990000', birthDay: 10 }), (err) => err.code === '23514', 'dia sem mês');
      await assert.rejects(repos.contacts.create({ restaurantId: r.id, phone: '5531999990001', birthDay: 10, birthMonth: 13 }), (err) => err.code === '23514');
      const ok = await repos.contacts.create({ restaurantId: r.id, phone: '5531999990002', birthDay: 29, birthMonth: 2, neighborhood: 'Centro' });
      assert.deepEqual([ok.birthDay, ok.birthMonth, ok.birthYear, ok.neighborhood], [29, 2, null, 'Centro']);
      // A coluna interna do contador não aparece no restaurante
      assert.equal('orderSeq' in r, false);
    } finally {
      await db.close();
    }
  });
});
