const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const baseConfig = require('../../src/config');
const { Database } = require('../../src/db/Database');
const { createApp } = require('../../src/app');
const { startApp } = require('../helpers/app');
const { legacyJson, ID } = require('../helpers/legacy-json');

/** Logger que guarda o que a subida registra (avisos e erros continuam aparecendo no terminal). */
const recordingLogger = (lines) => ({ log: (...args) => lines.push(args.join(' ')), info() {}, warn: console.warn, error: console.error });

describe('primeira subida com um data/db.json antigo', () => {
  let ctx;
  const logged = [];
  before(async () => { ctx = await startApp({ seed: true, legacyJson: legacyJson(), logger: recordingLogger(logged) }); });
  after(async () => { await ctx.close(); });

  it('importa o JSON em vez de criar a demonstração', async () => {
    const list = (await ctx.agency.get('/api/restaurants')).data;
    assert.deepEqual(list.map((r) => r.name), ['Cantina Antiga']);
    assert.equal(list[0].contactsCount, 2);
    assert.equal(list[0].campaignsCount, 1);
  });

  it('o db.json antigo fica onde estava, como cópia', () => {
    assert.ok(fs.existsSync(path.join(ctx.config.dataDir, 'db.json')));
  });

  it('o log diz o que entrou e também o que ficou de fora ou foi ajustado, sem repetir os avisos', () => {
    assert.ok(logged.some((l) => l.includes('data/db.json importado para o banco: 1 restaurantes, 1 acessos, 2 contatos, 1 campanhas, 2 mensagens, 2 pedidos')));
    assert.ok(logged.some((l) => l.includes('Contatos') && l.includes('1 repetidos ou já importados') && l.includes('1 ignorados')));
    assert.ok(logged.some((l) => l.includes('Mensagens') && l.includes('1 ignorados') && l.includes('1 com vínculo ajustado')));
    assert.ok(logged.some((l) => l.includes('Pedidos') && l.includes('1 com vínculo ajustado')));
    assert.equal(logged.filter((l) => l.includes('campoAntigo')).length, 1);
    assert.ok(!logged.some((l) => l.includes('demonstração')));
  });

  it('acessos, configurações e números vêm junto', async () => {
    assert.equal((await ctx.client().login('giulia@antiga.com.br', 'senha-giulia-123')).status, 200);
    assert.equal((await ctx.agency.get('/api/settings')).data.footer, 'Rodapé antigo');
    const [r] = (await ctx.agency.get('/api/restaurants')).data;
    const d = (await ctx.agency.get(`/api/dashboard?restaurantId=${r.id}`)).data;
    assert.equal(d.totals.audience, 2);
    assert.equal(d.totals.orders, 1);
    assert.equal(d.totals.revenue, 77.4);
  });

  it('um provedor salvo que não existe neste ambiente cai no simulador', async () => {
    // A escolha do JSON foi importada, mas este ambiente só tem o simulador
    assert.equal((await ctx.agency.get('/api/settings')).data.provider, 'whatsapp-cloud');
    assert.equal((await ctx.agency.get('/api/messaging/status')).data.state, 'connected');
  });
});

describe('primeira subida com um data/db.json sem perdas', () => {
  let ctx;
  const logged = [];
  const clean = {
    restaurants: [{ id: ID.restaurant, name: 'Cantina Limpa', slug: 'cantina-limpa' }],
    contacts: [{ id: ID.ana, restaurantId: ID.restaurant, name: 'Ana', phone: '5531999000001', campoAntigo: 'x' }],
  };
  before(async () => { ctx = await startApp({ seed: true, legacyJson: clean, logger: recordingLogger(logged) }); });
  after(async () => { await ctx.close(); });

  it('o log traz só o resumo e o aviso do campo desconhecido, uma vez', () => {
    assert.ok(logged.some((l) => l.includes('data/db.json importado para o banco: 1 restaurantes, 0 acessos, 1 contatos')));
    assert.ok(!logged.some((l) => l.includes('Contatos')), 'sem o relatório completo quando nada ficou de fora');
    assert.equal(logged.filter((l) => l.includes('campoAntigo')).length, 1);
  });
});

describe('primeira subida com um data/db.json corrompido', () => {
  it('falha dizendo qual arquivo e o que fazer; o banco fica fechado e vazio', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coral-teste-'));
    const file = path.join(dataDir, 'db.json');
    fs.writeFileSync(file, '{ "restaurants": [ { "id": ');
    // Banco em pasta (e não em memória) para poder reabri-lo depois da falha
    const config = { ...baseConfig, dataDir, databaseUrl: '', pgliteDir: path.join(dataDir, 'pgdata') };
    try {
      await assert.rejects(createApp({ config, seed: true, logger: { log() {}, info() {}, warn() {}, error() {} } }), (err) => {
        assert.ok(err.message.includes(file), 'o erro cita o arquivo');
        assert.match(err.message, /Corrija o arquivo/);
        return true;
      });
      assert.equal(fs.existsSync(`${config.pgliteDir}.lock`), false, 'a trava do banco foi liberada');
      const db = await Database.open({ pgliteDir: config.pgliteDir });
      try {
        assert.equal((await db.one('SELECT count(*)::int AS n FROM restaurants')).n, 0);
      } finally {
        await db.close();
      }
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
