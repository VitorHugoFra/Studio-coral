const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Database } = require('../../src/db/Database');
const { migrate } = require('../../src/db/migrate');

describe('migrações', () => {
  it('cria o esquema inicial uma vez só', async () => {
    const db = await Database.open({ pgliteDir: 'memory://' });
    try {
      assert.deepEqual(await migrate(db), ['001_esquema_inicial']);
      assert.deepEqual(await migrate(db), []);
      const tables = (await db.many("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name")).map((t) => t.table_name);
      assert.deepEqual(tables, ['campaigns', 'contacts', 'conversions', 'messages', 'restaurants', 'schema_migrations', 'settings', 'users']);
      assert.deepEqual(await db.one('SELECT id, data FROM settings'), { id: 1, data: {} });
    } finally {
      await db.close();
    }
  });

  it('migração com erro não deixa nada pela metade', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coral-mig-'));
    fs.writeFileSync(path.join(dir, '001_ok.sql'), 'CREATE TABLE a (x int);');
    fs.writeFileSync(path.join(dir, '002_ruim.sql'), 'CREATE TABLE b (x int); SELECT * FROM tabela_que_nao_existe;');
    fs.writeFileSync(path.join(dir, 'leia-me.txt'), 'ignorado');
    const db = await Database.open({ pgliteDir: 'memory://' });
    try {
      await assert.rejects(migrate(db, { dir }), /tabela_que_nao_existe/);
      assert.deepEqual((await db.many('SELECT version FROM schema_migrations')).map((r) => r.version), ['001_ok']);
      assert.equal((await db.one("SELECT to_regclass('public.b') AS t")).t, null);
    } finally {
      await db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
