const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openTestDb } = require('../helpers/db');
const { legacyJson, ID } = require('../helpers/legacy-json');
const { importJson, formatReport, shortSummary } = require('../../src/db/importJson');
const { createRepositories } = require('../../src/db/repositories');
const { AuthService } = require('../../src/services/AuthService');

describe('importação do antigo db.json', () => {
  let db;
  let repos;
  let first;
  before(async () => {
    db = await openTestDb();
    repos = createRepositories(db);
    first = await importJson(db, legacyJson());
  });
  after(() => db.close());

  it('relata o que entrou, o que já existia, o que foi ignorado e o que foi ajustado', () => {
    assert.deepEqual(first.collections, {
      restaurants: { read: 1, inserted: 1, existing: 0, ignored: 0, adjusted: 0 },
      users: { read: 1, inserted: 1, existing: 0, ignored: 0, adjusted: 0 },
      contacts: { read: 4, inserted: 2, existing: 1, ignored: 1, adjusted: 0 },
      campaigns: { read: 1, inserted: 1, existing: 0, ignored: 0, adjusted: 0 },
      messages: { read: 3, inserted: 2, existing: 0, ignored: 1, adjusted: 1 },
      conversions: { read: 2, inserted: 2, existing: 0, ignored: 0, adjusted: 1 },
    });
    assert.deepEqual(first.warnings, ['contacts: campos desconhecidos ignorados (campoAntigo)']);
    assert.deepEqual(first.settings, ['provider', 'providerEnvBase', 'footer']);
    assert.equal(shortSummary(first), '1 restaurantes, 1 acessos, 2 contatos, 1 campanhas, 2 mensagens, 2 pedidos');
    assert.ok(formatReport(first).some((line) => line.includes('Contatos') && line.includes('1 já existiam') && line.includes('1 ignorados')));
  });

  it('referências quebradas: mensagem perde o contato, pedido perde campanha, mensagem e contato', async () => {
    assert.equal((await repos.messages.get(ID.m2)).contactId, null);
    assert.equal(await repos.messages.get(ID.m3), null);
    const v2 = await repos.conversions.get(ID.v2);
    assert.equal(v2.campaignId, null);
    assert.equal(v2.messageId, null);
    assert.equal(v2.contactId, null);
    assert.equal(v2.value, 30);
  });

  it('mantém ids, datas, JSON, senha e configurações', async () => {
    const r = await repos.restaurants.get(ID.restaurant);
    assert.equal(r.createdAt, '2026-09-01T12:00:00.000Z');
    assert.deepEqual(r.menu, [{ id: 'm1', name: 'Lasanha', price: 62.9 }]);
    const u = await repos.users.get(ID.user);
    assert.ok(AuthService.checkPassword('senha-giulia-123', u.passwordHash));
    assert.equal((await repos.conversions.get(ID.v1)).value, 77.4);
    assert.equal((await db.one('SELECT phone_key FROM contacts WHERE id = $1', [ID.ana])).phone_key, '3199000001');
    await repos.settings.load();
    assert.equal(repos.settings.get().footer, 'Rodapé antigo');
    assert.equal(repos.settings.get().dailyLimit, 800);
  });

  it('rodar de novo não duplica nada', async () => {
    const again = await importJson(db, legacyJson());
    for (const stat of Object.values(again.collections)) assert.equal(stat.inserted, 0);
    assert.equal(again.collections.contacts.existing, 3);
    assert.equal(await repos.contacts.count(), 2);
    assert.equal(await repos.messages.count(), 2);
  });

  it('aceita JSON vazio ou incompleto', async () => {
    const other = await openTestDb();
    try {
      const report = await importJson(other, {});
      assert.ok(Object.values(report.collections).every((s) => s.read === 0));
      assert.equal(report.settings, undefined);
    } finally {
      await other.close();
    }
  });
});
