const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Database } = require('../../src/db/Database');
const { migrate } = require('../../src/db/migrate');

describe('migrações', () => {
  it('aplica as migrações em ordem, uma vez só, e cria os índices das chaves estrangeiras', async () => {
    const db = await Database.open({ pgliteDir: 'memory://' });
    try {
      // As duas primeiras, nessa ordem (as próximas migrações não quebram este teste)
      assert.deepEqual((await migrate(db)).slice(0, 2), ['001_esquema_inicial', '002_indices_chaves_estrangeiras']);
      assert.deepEqual(await migrate(db), []);
      const tables = (await db.many("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name")).map((t) => t.table_name);
      // A etapa 2 (003_pedidos) renomeou conversions para orders; a criação de contas (004_acessos) acrescentou
      // os links de convite e de nova senha; a etapa 4 (005_indicacoes), os cupons e os links de indicação
      assert.deepEqual(tables, ['campaigns', 'contacts', 'coupons', 'messages', 'orders', 'password_tokens', 'referral_links', 'restaurants', 'schema_migrations', 'settings', 'users']);
      assert.deepEqual(await db.one('SELECT id, data FROM settings'), { id: 1, data: {} });
      // Sem estes índices, excluir um contato ou uma mensagem varre a tabela filha inteira
      const indexes = (await db.many("SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('messages_contact', 'orders_message', 'orders_contact') ORDER BY indexname")).map((i) => i.indexname);
      assert.deepEqual(indexes, ['messages_contact', 'orders_contact', 'orders_message']);
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

  it('falha numa migração diz qual foi e guarda o erro original em cause', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coral-mig-'));
    fs.writeFileSync(path.join(dir, '001_ok.sql'), 'CREATE TABLE a (x int);');
    fs.writeFileSync(path.join(dir, '002_ruim.sql'), 'SELECT * FROM tabela_que_nao_existe;');
    const db = await Database.open({ pgliteDir: 'memory://' });
    try {
      await assert.rejects(migrate(db, { dir }), (err) => {
        assert.match(err.message, /^Migração 002_ruim falhou: .*tabela_que_nao_existe/);
        assert.ok(err.cause instanceof Error, 'o erro original fica em cause');
        assert.equal(err.cause.code, '42P01', 'e traz o SQLSTATE do PostgreSQL');
        return true;
      });
    } finally {
      await db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('arquivo .sql fora do padrão NNN_nome.sql é erro claro e nada é aplicado; os que não são .sql seguem ignorados', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coral-mig-'));
    fs.writeFileSync(path.join(dir, '001_ok.sql'), 'CREATE TABLE a (x int);');
    fs.writeFileSync(path.join(dir, 'v2_indices.sql'), 'CREATE TABLE b (x int);');
    fs.writeFileSync(path.join(dir, 'leia-me.txt'), 'ignorado');
    fs.writeFileSync(path.join(dir, 'notas.md'), 'ignorado');
    const db = await Database.open({ pgliteDir: 'memory://' });
    try {
      await assert.rejects(migrate(db, { dir }), { message: 'Arquivo de migração fora do padrão NNN_nome.sql: v2_indices.sql' });
      // O erro vem antes de qualquer migração: nem a 001 foi aplicada
      assert.equal((await db.one("SELECT to_regclass('public.a') AS t")).t, null);
      // Sem o arquivo fora do padrão, a pasta (com o .txt e o .md) migra normalmente
      fs.rmSync(path.join(dir, 'v2_indices.sql'));
      assert.deepEqual(await migrate(db, { dir }), ['001_ok']);
    } finally {
      await db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('migração salva com BOM UTF-8 (como os editores do Windows fazem) é aplicada normalmente', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coral-mig-'));
    fs.writeFileSync(path.join(dir, '001_com_bom.sql'), '﻿CREATE TABLE com_bom (x int);');
    const db = await Database.open({ pgliteDir: 'memory://' });
    try {
      assert.deepEqual(await migrate(db, { dir }), ['001_com_bom']);
      assert.notEqual((await db.one("SELECT to_regclass('public.com_bom') AS t")).t, null);
    } finally {
      await db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
