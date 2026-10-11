const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { Database } = require('../../src/db/Database');
const { startPgServer } = require('../helpers/pg-server');

function databaseSuite(name, open) {
  describe(name, () => {
    let db;
    let cleanup;
    before(async () => {
      ({ db, cleanup } = await open());
      await db.exec('CREATE TABLE t (id int PRIMARY KEY, v text, n numeric(12,2), at timestamptz DEFAULT now())');
    });
    after(async () => {
      await db.close();
      await cleanup?.();
    });

    it('query, many e one', async () => {
      await db.query('INSERT INTO t (id, v) VALUES ($1, $2), ($3, $4)', [1, 'a', 2, 'b']);
      assert.deepEqual((await db.many('SELECT v FROM t ORDER BY id')).map((r) => r.v), ['a', 'b']);
      assert.equal((await db.one('SELECT v FROM t WHERE id = $1', [2])).v, 'b');
      assert.equal(await db.one('SELECT v FROM t WHERE id = $1', [99]), null);
    });

    it('transação confirma ao terminar e desfaz em erro', async () => {
      await db.tx(async (t) => { await t.query('INSERT INTO t (id, v) VALUES (3, $1)', ['c']); });
      await assert.rejects(db.tx(async (t) => {
        await t.query('INSERT INTO t (id, v) VALUES (4, $1)', ['d']);
        throw new Error('falhou');
      }), /falhou/);
      assert.deepEqual((await db.many('SELECT id FROM t ORDER BY id')).map((r) => r.id), [1, 2, 3]);
    });

    it('transação aninhada reaproveita a atual', async () => {
      await assert.rejects(db.tx(async (t) => {
        await t.tx(async (inner) => { await inner.query('INSERT INTO t (id, v) VALUES (5, $1)', ['e']); });
        throw new Error('desfaz tudo');
      }), /desfaz tudo/);
      assert.equal(await db.one('SELECT id FROM t WHERE id = 5'), null);
    });

    it('exec roda vários comandos, inclusive numa transação', async () => {
      await db.exec('CREATE TABLE u (x int); INSERT INTO u VALUES (1); INSERT INTO u VALUES (2);');
      await db.tx((t) => t.exec('INSERT INTO u VALUES (3); INSERT INTO u VALUES (4);'));
      assert.equal((await db.one('SELECT count(*)::int AS n FROM u')).n, 4);
    });

    it('erro mantém o código do PostgreSQL', async () => {
      await assert.rejects(db.query('INSERT INTO t (id, v) VALUES (1, $1)', ['x']), (err) => err.code === '23505');
    });

    it('tipos: timestamptz vira Date e numeric vira texto (o mapeamento converte)', async () => {
      const row = await db.one("INSERT INTO t (id, v, n) VALUES (10, 'x', 12.5) RETURNING *");
      assert.ok(row.at instanceof Date);
      assert.equal(Number(row.n), 12.5);
    });
  });
}

databaseSuite('Database com PGlite em memória', async () => ({ db: await Database.open({ pgliteDir: 'memory://' }) }));

databaseSuite('Database com o driver pg', async () => {
  const pg = await startPgServer();
  const db = await Database.open({ databaseUrl: pg.url, databasePoolMax: 1 });
  assert.equal(db.kind, 'pg');
  return { db, cleanup: () => pg.close() };
});

describe('Database.open', () => {
  it('avisa com clareza quando o PostgreSQL não responde, sem mostrar a senha', async () => {
    await assert.rejects(Database.open({ databaseUrl: 'postgres://usuario:segredo@127.0.0.1:1/nada', databasePoolMax: 1 }), (err) => {
      assert.match(err.message, /Não foi possível conectar ao PostgreSQL \(postgres:\/\/usuario:\*\*\*@127\.0\.0\.1:1\/nada\)/);
      assert.ok(!err.message.includes('segredo'));
      return true;
    });
  });

  it('PGlite em pasta: grava em disco e recusa outro processo na mesma pasta', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coral-pglite-'));
    const pgdata = path.join(dir, 'pgdata');
    try {
      let db = await Database.open({ pgliteDir: pgdata });
      assert.equal(db.kind, 'pglite');
      await db.exec("CREATE TABLE k (v text); INSERT INTO k VALUES ('persistiu');");
      await db.close();
      assert.equal(fs.existsSync(`${pgdata}.lock`), false, 'a trava sai ao fechar');

      // trava de um processo vivo: recusa
      const other = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)']);
      try {
        fs.writeFileSync(`${pgdata}.lock`, String(other.pid));
        await assert.rejects(Database.open({ pgliteDir: pgdata }), /já está aberto por outro processo/);
      } finally {
        other.kill();
      }

      // trava de um processo que já morreu: ignora
      fs.writeFileSync(`${pgdata}.lock`, '999999');
      db = await Database.open({ pgliteDir: pgdata });
      assert.deepEqual(await db.many('SELECT v FROM k'), [{ v: 'persistiu' }]);
      await db.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
