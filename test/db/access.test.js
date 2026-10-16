const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Database } = require('../../src/db/Database');
const { migrate, MIGRATIONS_DIR } = require('../../src/db/migrate');
const { createRepositories } = require('../../src/db/repositories');
const { AuthService } = require('../../src/services/AuthService');
const { openTestDb } = require('../helpers/db');

const R = '11111111-1111-4111-8111-111111111111';
const U = '44444444-4444-4444-8444-444444444444';

describe('migração 004: acessos', () => {
  it('os acessos de antes viram gerentes, com a senha preservada, e o convite pode ficar sem senha', async () => {
    // Um banco parado na etapa 1 (só 001 e 002), com o acesso criado pela agência
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coral-mig-'));
    for (const f of ['001_esquema_inicial.sql', '002_indices_chaves_estrangeiras.sql']) fs.copyFileSync(path.join(MIGRATIONS_DIR, f), path.join(dir, f));
    const db = await Database.open({ pgliteDir: 'memory://' });
    try {
      await migrate(db, { dir });
      await db.query("INSERT INTO restaurants (id, name, slug) VALUES ($1, 'Casa', 'casa')", [R]);
      await db.query("INSERT INTO users (id, restaurant_id, role, name, email, password_hash) VALUES ($1, $2, 'restaurant', 'Giulia', 'giulia@casa.com.br', $3)",
        [U, R, AuthService.hashPassword('senha-giulia-123')]);

      fs.copyFileSync(path.join(MIGRATIONS_DIR, '004_acessos.sql'), path.join(dir, '004_acessos.sql'));
      assert.deepEqual(await migrate(db, { dir }), ['004_acessos']);
      const repos = createRepositories(db);
      const giulia = await repos.users.get(U);
      assert.equal(giulia.role, 'manager');
      assert.ok(AuthService.checkPassword('senha-giulia-123', giulia.passwordHash));
      assert.equal(giulia.passwordChangedAt, null);
      assert.equal(giulia.resetRequestedAt, null);

      // Convite: sem senha e, sem papel, equipe
      const invited = await repos.users.create({ restaurantId: R, name: 'Marco', email: 'marco@casa.com.br' });
      assert.equal(invited.passwordHash, null);
      assert.equal(invited.role, 'staff');
      await assert.rejects(repos.users.create({ restaurantId: R, role: 'restaurant', name: 'X', email: 'x@casa.com.br' }), /users_role_check/);
    } finally {
      await db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('links de convite e de nova senha (repositório)', () => {
  let db;
  let repos;
  let user;
  const now = () => new Date().toISOString();
  const inHours = (h) => new Date(Date.now() + h * 3600000).toISOString();

  before(async () => {
    db = await openTestDb();
    repos = createRepositories(db);
    await repos.restaurants.create({ id: R, name: 'Casa', slug: 'casa' });
    user = await repos.users.create({ restaurantId: R, role: 'manager', name: 'Giulia', email: 'giulia@casa.com.br' });
  });
  after(async () => { await db.close(); });

  it('um link por pessoa: o novo apaga o anterior', async () => {
    await repos.passwordTokens.issue({ userId: user.id, purpose: 'invite', tokenHash: 'h1', expiresAt: inHours(1) }, { now: now() });
    const second = await repos.passwordTokens.issue({ userId: user.id, purpose: 'reset', tokenHash: 'h2', expiresAt: inHours(1), createdBy: 'Agência' }, { now: now() });
    assert.equal(second.tokenHash, undefined, 'o hash não sai do repositório');
    assert.equal(second.createdBy, 'Agência');
    assert.equal(await repos.passwordTokens.findValid('h1', { now: now() }), null);
    assert.equal((await repos.passwordTokens.findValid('h2', { now: now() })).purpose, 'reset');
  });

  it('usar gasta o link, uma vez só, mesmo com dois usos ao mesmo tempo', async () => {
    await repos.passwordTokens.issue({ userId: user.id, purpose: 'reset', tokenHash: 'h3', expiresAt: inHours(1) }, { now: now() });
    const results = await Promise.all([repos.passwordTokens.redeem('h3', { now: now() }), repos.passwordTokens.redeem('h3', { now: now() })]);
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(results.find(Boolean).userId, user.id);
    assert.equal(await repos.passwordTokens.findValid('h3', { now: now() }), null);
  });

  it('link vencido não vale e sai da tabela quando outro link é gerado', async () => {
    await repos.passwordTokens.issue({ userId: user.id, purpose: 'invite', tokenHash: 'h4', expiresAt: inHours(-1) }, { now: inHours(-2) });
    assert.equal(await repos.passwordTokens.findValid('h4', { now: now() }), null);
    assert.equal(await repos.passwordTokens.redeem('h4', { now: now() }), null);
    const other = await repos.users.create({ restaurantId: R, name: 'Marco', email: 'marco@casa.com.br' });
    await repos.passwordTokens.issue({ userId: other.id, purpose: 'invite', tokenHash: 'h5', expiresAt: inHours(1) }, { now: now() });
    assert.equal((await db.one("SELECT count(*)::int AS n FROM password_tokens WHERE token_hash = 'h4'")).n, 0);
  });

  it('a lista da tela de acessos traz restaurante, senha (sim/não) e link, sem o hash', async () => {
    const list = await repos.users.listWithStatus({ restaurantId: R });
    const marco = list.find((u) => u.email === 'marco@casa.com.br');
    assert.deepEqual([marco.restaurantName, marco.hasPassword, marco.linkPurpose], ['Casa', false, 'invite']);
    assert.ok(list.every((u) => !('passwordHash' in u)));
    assert.deepEqual(await repos.users.listWithStatus({ restaurantId: 'nao-e-uuid' }), []);
  });

  it('pedido de nova senha: um a cada intervalo', async () => {
    const t0 = new Date('2026-10-16T12:00:00Z').toISOString();
    const t1 = new Date('2026-10-16T12:03:00Z').toISOString();
    const t2 = new Date('2026-10-16T12:06:00Z').toISOString();
    const throttleMs = 5 * 60 * 1000;
    assert.equal((await repos.users.requestReset(user.id, { now: t0, throttleMs })).resetRequestedAt, t0);
    assert.equal(await repos.users.requestReset(user.id, { now: t1, throttleMs }), null);
    assert.equal((await repos.users.requestReset(user.id, { now: t2, throttleMs })).resetRequestedAt, t2);
  });

  it('o acesso removido leva os links junto', async () => {
    const temp = await repos.users.create({ restaurantId: R, name: 'Temp', email: 'temp@casa.com.br' });
    await repos.passwordTokens.issue({ userId: temp.id, purpose: 'invite', tokenHash: 'h6', expiresAt: inHours(1) }, { now: now() });
    await repos.users.remove(temp.id);
    assert.equal(await repos.passwordTokens.findValid('h6', { now: now() }), null);
  });
});
