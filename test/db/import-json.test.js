const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openTestDb } = require('../helpers/db');
const { legacyJson, ID } = require('../helpers/legacy-json');
const { importJson, formatReport, shortSummary, readLegacyJson } = require('../../src/db/importJson');
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
    assert.ok(formatReport(first).some((line) => line.includes('Contatos') && line.includes('1 repetidos ou já importados') && line.includes('1 ignorados')));
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

  it('grava a marca legacyImportedAt (data ISO) nas configurações, fora do relatório, e mantém a data da primeira importação', async () => {
    await repos.settings.load();
    const mark = repos.settings.get().legacyImportedAt;
    assert.match(mark, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.ok(Math.abs(Date.now() - Date.parse(mark)) < 5 * 60e3, 'a data é a de agora');
    assert.ok(!first.settings.includes('legacyImportedAt'), 'a marca não é uma configuração vinda do JSON');
    await new Promise((r) => { setTimeout(r, 5); });
    await importJson(db, legacyJson());
    await repos.settings.load();
    assert.equal(repos.settings.get().legacyImportedAt, mark, 'importar de novo não muda a data da primeira importação');
  });

  it('rodar de novo não duplica nada', async () => {
    const again = await importJson(db, legacyJson());
    for (const stat of Object.values(again.collections)) assert.equal(stat.inserted, 0);
    assert.equal(again.collections.contacts.existing, 3);
    assert.equal(await repos.contacts.count(), 2);
    assert.equal(await repos.messages.count(), 2);
  });

  it('rodar de novo não desfaz configurações alteradas no sistema novo', async () => {
    await repos.settings.update({ provider: 'simulator' });
    const again = await importJson(db, legacyJson());
    assert.equal(again.settings, undefined);
    await repos.settings.load();
    assert.equal(repos.settings.get().provider, 'simulator');
    assert.equal(repos.settings.get().footer, 'Rodapé antigo');
  });

  it('só entram as configurações que o banco ainda não tem', async () => {
    const other = await openTestDb();
    try {
      const otherRepos = createRepositories(other);
      await otherRepos.settings.update({ provider: 'simulator' });
      const report = await importJson(other, legacyJson());
      assert.deepEqual(report.settings, ['providerEnvBase', 'footer']);
      await otherRepos.settings.load();
      assert.equal(otherRepos.settings.get().provider, 'simulator');
      assert.equal(otherRepos.settings.get().providerEnvBase, 'simulator');
      assert.equal(otherRepos.settings.get().footer, 'Rodapé antigo');
    } finally {
      await other.close();
    }
  });

  it('um erro numa coleção desfaz tudo e diz qual coleção falhou', async () => {
    const other = await openTestDb();
    try {
      const broken = {
        restaurants: [{ id: ID.restaurant, name: 'Cantina Antiga', slug: 'cantina-antiga' }],
        contacts: [{ id: ID.ana, restaurantId: ID.restaurant, name: 'Ana', phone: '5531999000001', notes: null }],
      };
      await assert.rejects(importJson(other, broken), (err) => {
        assert.match(err.message, /^Falha ao importar contacts: /);
        assert.ok(err.cause instanceof Error, 'o erro original fica em cause');
        return true;
      });
      const check = createRepositories(other);
      assert.equal(await check.restaurants.count(), 0);
      assert.equal(await check.contacts.count(), 0);
      // A marca de "já importado" é da mesma transação: sem importação concluída, a próxima subida tenta de novo
      assert.equal((await other.one('SELECT data FROM settings WHERE id = 1')).data.legacyImportedAt, undefined);
    } finally {
      await other.close();
    }
  });

  it('aceita JSON vazio ou incompleto', async () => {
    const other = await openTestDb();
    try {
      const report = await importJson(other, {});
      assert.ok(Object.values(report.collections).every((s) => s.read === 0));
      assert.equal(report.settings, undefined);
      // Importação concluída (mesmo sem nada para trazer) também deixa a marca
      assert.match((await other.one('SELECT data FROM settings WHERE id = 1')).data.legacyImportedAt, /^\d{4}-\d{2}-\d{2}T/);
    } finally {
      await other.close();
    }
  });
});

describe('leitura do antigo db.json', () => {
  let dir;
  before(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coral-teste-json-')); });
  after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('lê o JSON; arquivo vazio vale como {}', () => {
    const file = path.join(dir, 'db.json');
    fs.writeFileSync(file, JSON.stringify({ restaurants: [{ name: 'Cantina' }] }));
    assert.deepEqual(readLegacyJson(file), { restaurants: [{ name: 'Cantina' }] });
    fs.writeFileSync(file, '');
    assert.deepEqual(readLegacyJson(file), {});
  });

  it('arquivo truncado: o erro traz o caminho e o que fazer', () => {
    const file = path.join(dir, 'truncado.json');
    fs.writeFileSync(file, '{ "restaurants": [ { "id": ');
    assert.throws(() => readLegacyJson(file), (err) => {
      assert.ok(err.message.includes(file), 'o erro cita o arquivo');
      assert.match(err.message, /Corrija o arquivo ou mova-o para outra pasta/);
      return true;
    });
  });
});
