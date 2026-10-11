const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'migrations');

/**
 * Aplica, em ordem, os arquivos migrations/NNN_nome.sql que ainda não rodaram.
 * Cada arquivo roda numa transação e fica registrado em schema_migrations.
 */
async function migrate(db, { dir = MIGRATIONS_DIR, logger = null } = {}) {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const done = new Set((await db.many('SELECT version FROM schema_migrations')).map((r) => r.version));
  const files = fs.readdirSync(dir).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
  const applied = [];
  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    if (done.has(version)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    await db.tx(async (t) => {
      await t.exec(sql);
      await t.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
    });
    applied.push(version);
    logger?.log?.(`  ↳ migração aplicada: ${version}`);
  }
  return applied;
}

module.exports = { migrate, MIGRATIONS_DIR };
