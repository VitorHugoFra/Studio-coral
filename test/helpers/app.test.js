// Testes do próprio auxiliar startApp (test/helpers/app.js): se ele vazar servidor ou pasta, a bateria inteira trava ou suja o disco.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { Client } = require('pg');
const { Database } = require('../../src/db/Database');
const { startApp } = require('./app');

/** Roda fn com TEST_PG=1 (o auxiliar sobe o PostgreSQL de teste e o app pelo driver pg) e devolve o ambiente como estava. */
async function withTestPg(fn) {
  const before = process.env.TEST_PG;
  process.env.TEST_PG = '1';
  try {
    return await fn();
  } finally {
    if (before === undefined) delete process.env.TEST_PG;
    else process.env.TEST_PG = before;
  }
}

/** true se ninguém atende mais nesse endereço. */
async function isDown(databaseUrl) {
  const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 2000 });
  client.on('error', () => {});
  try {
    await client.connect();
    await client.end();
    return false;
  } catch {
    return true;
  }
}

describe('startApp (auxiliar dos testes)', () => {
  it('close() desliga o servidor pg e apaga a pasta de dados mesmo quando o fechamento do app falha', async () => {
    await withTestPg(async () => {
      const ctx = await startApp();
      const db = ctx.container.resolve('db');
      const close = db.close.bind(db);
      db.close = async () => { await close(); throw new Error('falha simulada ao fechar o banco'); };
      assert.ok(ctx.config.databaseUrl, 'com TEST_PG=1 o app sobe pelo servidor pg de teste');
      await assert.rejects(ctx.close(), /falha simulada ao fechar o banco/);
      assert.equal(fs.existsSync(ctx.config.dataDir), false, 'a pasta de dados foi apagada');
      assert.equal(await isDown(ctx.config.databaseUrl), true, 'o servidor pg de teste foi desligado');
    });
  });

  it('com TEST_PG=1, falha (e desliga tudo) se o app não subiu pelo driver pg', async () => {
    const open = Database.open;
    // Configuração errada simulada: o app abre o PGlite em vez do banco que o auxiliar preparou
    Database.open = (options) => open.call(Database, { ...options, databaseUrl: '', pgliteDir: 'memory://' });
    let started = null; // só preenchido se o auxiliar (erradamente) deixar passar: assim o teste sempre desliga o que ligou
    try {
      await withTestPg(async () => {
        await assert.rejects(startApp().then((ctx) => { started = ctx; }), /TEST_PG=1.*pglite/);
      });
    } finally {
      Database.open = open;
      await started?.close();
    }
  });
});
