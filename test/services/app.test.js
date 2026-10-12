const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const baseConfig = require('../../src/config');
const { Database } = require('../../src/db/Database');
const { createApp } = require('../../src/app');
const { startApp, waitFor } = require('../helpers/app');
const { interleave } = require('../helpers/race');

describe('subida do app', () => {
  it('quando a subida falha, a fila para e o banco é fechado', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coral-teste-'));
    const closed = [];
    const close = Database.prototype.close;
    Database.prototype.close = function spy() { closed.push(this); return close.call(this); };
    let stopped = false;
    const failingDispatch = () => ({ async init() { throw new Error('a fila não subiu'); }, stop() { stopped = true; } });
    try {
      await assert.rejects(
        createApp({
          config: { ...baseConfig, dataDir, databaseUrl: '', pgliteDir: 'memory://' },
          seed: false,
          logger: { log() {}, info() {}, warn() {}, error() {} },
          overrides: { dispatch: failingDispatch },
        }),
        { message: 'a fila não subiu' },
      );
    } finally {
      Database.prototype.close = close;
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
    assert.equal(closed.length, 1);
    assert.equal(stopped, true);
  });
});

describe('rotas do painel: concorrência e falhas do banco', () => {
  let ctx;
  let restaurant;
  const newDraft = async (name) => (await ctx.agency.post('/api/campaigns', { restaurantId: restaurant.id, name, message: 'Oi' })).data;

  before(async () => {
    ctx = await startApp();
    restaurant = (await ctx.agency.post('/api/restaurants', { name: 'Cantina das Falhas', requireApproval: false })).data;
    await ctx.agency.post('/api/contacts', { restaurantId: restaurant.id, name: 'Marina', phone: '31999990001' });
  });
  after(async () => { await ctx.close(); });

  it('editar uma campanha que começou a ser disparada no meio do pedido é recusado', async () => {
    const c = await newDraft('Original');
    const repos = ctx.container.resolve('repos');
    // A edição já leu o rascunho quando outro pedido dispara a campanha
    interleave(repos.campaigns, 'get', () => ctx.container.resolve('dispatch').start(c.id));
    const res = await ctx.agency.put(`/api/campaigns/${c.id}`, { name: 'Editada' });
    assert.equal(res.status, 400);
    assert.equal(res.data.error, 'Campanhas já disparadas não podem ser editadas. Duplique-a.');
    await waitFor(async () => (await ctx.agency.get(`/api/campaigns/${c.id}`)).data.status === 'completed', { message: 'campanha concluída' });
    assert.equal((await ctx.agency.get(`/api/campaigns/${c.id}`)).data.name, 'Original');
  });

  it('erro do banco vira 500 com registro no log, sem expor detalhes', async () => {
    const c = await newDraft('Falha');
    const logger = ctx.container.resolve('logger');
    const logged = [];
    const original = logger.error;
    logger.error = (...args) => logged.push(args);
    try {
      // Texto que não é UUID chega ao banco e é recusado por ele (22P02)
      const res = await ctx.agency.put(`/api/campaigns/${c.id}`, { restaurantId: 'não-é-um-uuid' });
      assert.equal(res.status, 500);
      assert.deepEqual(res.data, { error: 'Erro interno. Tente de novo em instantes.' });
      assert.equal(logged.length, 1);
      assert.equal(logged[0][0], '[api]');
      assert.equal(logged[0][1].code, '22P02');
    } finally {
      logger.error = original;
    }
  });
});
