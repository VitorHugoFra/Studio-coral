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

    it('tx devolve o resultado da função', async () => {
      assert.equal(await db.tx(async (t) => (await t.one('SELECT 41 + 1 AS n')).n), 42);
    });

    it('exec roda vários comandos, inclusive numa transação', async () => {
      await db.exec('CREATE TABLE u (x int); INSERT INTO u VALUES (1); INSERT INTO u VALUES (2);');
      await db.tx((t) => t.exec('INSERT INTO u VALUES (3); INSERT INTO u VALUES (4);'));
      assert.equal((await db.one('SELECT count(*)::int AS n FROM u')).n, 4);
    });

    it('erro mantém o código do PostgreSQL', async () => {
      await assert.rejects(db.query('INSERT INTO t (id, v) VALUES (1, $1)', ['x']), (err) => err.code === '23505');
    });

    it('erros do banco saem marcados (err.db) em query, exec e transação, sem perder code e constraint', async () => {
      await db.exec('CREATE TABLE marcados (id int PRIMARY KEY); INSERT INTO marcados VALUES (1);');
      const bad = 'INSERT INTO marcados VALUES (1)'; // chave repetida
      const byQuery = await db.query(bad).catch((err) => err);
      assert.equal(byQuery.db, true);
      assert.equal(byQuery.code, '23505');
      assert.equal(byQuery.constraint, 'marcados_pkey');
      assert.equal((await db.exec('SELECT * FROM tabela_que_nao_existe').catch((err) => err)).db, true);
      assert.equal((await db.many('SELECT * FROM tabela_que_nao_existe').catch((err) => err)).db, true);
      assert.equal((await db.tx((t) => t.query(bad)).catch((err) => err)).db, true);
      // erro do próprio código, lançado dentro da transação, não é falha do banco
      assert.equal((await db.tx(async () => { throw new Error('meu erro'); }).catch((err) => err)).db, undefined);
    });

    it('tipos: timestamptz vira Date e numeric vira texto (o mapeamento converte)', async () => {
      const row = await db.one("INSERT INTO t (id, v, n) VALUES (10, 'x', 12.5) RETURNING *");
      assert.ok(row.at instanceof Date);
      assert.equal(typeof row.n, 'string');
      assert.equal(Number(row.n), 12.5);
    });
  });
}

databaseSuite('Database com PGlite em memória', async () => ({ db: await Database.open({ pgliteDir: 'memory://' }) }));

databaseSuite('Database com o driver pg', async () => {
  const pg = await startPgServer();
  let db;
  try {
    db = await Database.open({ databaseUrl: pg.url, databasePoolMax: 1 });
    assert.equal(db.kind, 'pg');
  } catch (err) {
    // Se a abertura falhar, o servidor de teste não pode ficar de pé segurando o processo
    await db?.close();
    await pg.close();
    throw err;
  }
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

  it('não vaza a senha da DATABASE_URL, nem com @ na senha nem na query string', async () => {
    const casos = [
      ['postgres://usuario:p@ss@127.0.0.1:1/nada', 'postgres://usuario:***@127.0.0.1:1/nada'],
      ['postgres://usuario@127.0.0.1:1/nada?password=segredo', 'postgres://usuario@127.0.0.1:1/nada?password=***'],
      ['postgres://usuario@127.0.0.1:1/nada?sslpassword=segredo&sslmode=disable', 'postgres://usuario@127.0.0.1:1/nada?sslpassword=***&sslmode=disable'],
    ];
    for (const [url, mascarada] of casos) {
      await assert.rejects(Database.open({ databaseUrl: url, databasePoolMax: 1 }), (err) => {
        assert.ok(err.message.includes(`(${mascarada})`), `esperava o endereço mascarado em: ${err.message}`);
        for (const vazamento of ['p@ss', 'ss@', 'segredo']) {
          assert.ok(!err.message.includes(vazamento), `vazou "${vazamento}" em: ${err.message}`);
        }
        return true;
      });
    }
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
        await assert.rejects(Database.open({ pgliteDir: pgdata }), (err) => {
          assert.match(err.message, /já está aberto por outro processo/);
          assert.ok(err.message.includes(`apague ${pgdata}.lock`), `a mensagem deveria nomear o arquivo da trava: ${err.message}`);
          return true;
        });
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

describe('Database.close', () => {
  it('pode ser chamado duas vezes (SIGINT e SIGTERM disparam o mesmo encerramento), em qualquer driver', async () => {
    const emMemoria = await Database.open({ pgliteDir: 'memory://' });
    await emMemoria.close();
    await emMemoria.close();

    const pg = await startPgServer();
    try {
      const db = await Database.open({ databaseUrl: pg.url, databasePoolMax: 1 });
      await db.close();
      await db.close();
    } finally {
      await pg.close();
    }
  });

  it('PGlite que falha ao fechar não deixa a trava da pasta para trás', async () => {
    const db = await Database.open({ pgliteDir: 'memory://' });
    const { lite } = db.driver;
    const fecharDeVerdade = lite.close.bind(lite);
    let soltouATrava = false;
    db.driver.release = () => { soltouATrava = true; };
    lite.close = async () => { throw new Error('falha simulada ao fechar'); };
    try {
      await assert.rejects(db.close(), /falha simulada ao fechar/);
      assert.equal(soltouATrava, true, 'a trava tem de sair mesmo com o erro');
    } finally {
      await fecharDeVerdade();
    }
  });
});

describe('resiliência do driver pg', () => {
  it('conexão ociosa que cai não derruba o servidor: avisa no log e o pool reconecta', async () => {
    const pg = await startPgServer();
    const errors = [];
    let db;
    try {
      db = await Database.open({
        databaseUrl: pg.url,
        databasePoolMax: 1,
        logger: { error: (...args) => errors.push(args.join(' ')) },
      });
      assert.equal((await db.one('SELECT 1 AS n')).n, 1); // deixa um cliente ocioso no pool

      // Derruba o socket do cliente ocioso, como num reinício do banco ou numa queda de rede
      // (pool._clients e connection.stream são internos do pg, que está fixado em versão exata)
      db.driver.pool._clients[0].connection.stream.destroy();
      await new Promise((r) => { setTimeout(r, 100); });

      assert.equal((await db.one('SELECT 2 AS n')).n, 2);
      assert.ok(errors.some((msg) => msg.includes('Conexão ociosa')), `esperava o aviso no log, veio: ${JSON.stringify(errors)}`);
    } finally {
      await db?.close();
      await pg.close();
    }
  });

  it('conexão que cai no meio de uma transação não derruba o servidor: a tx rejeita, avisa no log e o pool reconecta', async () => {
    const pg = await startPgServer();
    const errors = [];
    let db;
    try {
      db = await Database.open({
        databaseUrl: pg.url,
        databasePoolMax: 1,
        logger: { error: (...args) => errors.push(args.join(' ')) },
      });

      // Derruba o socket da conexão emprestada à transação (t.driver é o PgTxDriver; client, o cliente do pg).
      // Se ninguém escutar o 'error' desse cliente, a queda vira exceção não tratada e o runner reprova o teste.
      // A mensagem é conferida para que um erro qualquer dentro da função (um caminho de internos errado) não passe por queda.
      await assert.rejects(db.tx(async (t) => {
        await t.query('SELECT 1');
        t.driver.client.connection.stream.destroy();
        await t.query('SELECT 2');
      }), /Connection terminated|not queryable/);

      assert.ok(errors.some((msg) => msg.includes('durante uma transação')), `esperava o aviso no log, veio: ${JSON.stringify(errors)}`);
      assert.equal((await db.one('SELECT 3 AS n')).n, 3);
    } finally {
      await db?.close();
      await pg.close();
    }
  });
});
