const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'migrations');
const MIGRATION_FILE = /^\d{3}_.+\.sql$/;

/**
 * Os arquivos .sql da pasta, em ordem. Um .sql que não segue NNN_nome.sql é erro:
 * ignorá-lo em silêncio deixaria o banco sem a mudança que a pessoa achou que tinha feito.
 * Os outros tipos de arquivo (leia-me, notas) são ignorados.
 */
function listMigrations(dir) {
  const files = fs.readdirSync(dir).filter((f) => /\.sql$/i.test(f)).sort();
  const misplaced = files.find((f) => !MIGRATION_FILE.test(f));
  if (misplaced) throw new Error(`Arquivo de migração fora do padrão NNN_nome.sql: ${misplaced}`);
  return files;
}

/**
 * Aplica, em ordem, os arquivos migrations/NNN_nome.sql que ainda não rodaram.
 * Cada arquivo roda numa transação e fica registrado em schema_migrations.
 * Se um falhar, o erro diz qual (a mensagem do banco vai em `cause`) e os anteriores continuam aplicados.
 */
async function migrate(db, { dir = MIGRATIONS_DIR, logger = null } = {}) {
  const files = listMigrations(dir); // antes de tocar no banco: um nome errado não aplica migração nenhuma
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const done = new Set((await db.many('SELECT version FROM schema_migrations')).map((r) => r.version));
  const applied = [];
  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    if (done.has(version)) continue;
    // Editores do Windows gravam um BOM no começo do arquivo; o PostgreSQL o leria como parte do primeiro comando
    const sql = fs.readFileSync(path.join(dir, file), 'utf8').replace(/^﻿/, '');
    try {
      await db.tx(async (t) => {
        await t.exec(sql);
        await t.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
      });
    } catch (err) {
      throw new Error(`Migração ${version} falhou: ${err.message}`, { cause: err });
    }
    applied.push(version);
    logger?.log?.(`  ↳ migração aplicada: ${version}`);
  }
  return applied;
}

module.exports = { migrate, MIGRATIONS_DIR };
