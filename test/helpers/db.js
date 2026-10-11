const { Database } = require('../../src/db/Database');
const { migrate } = require('../../src/db/migrate');

/** PostgreSQL (PGlite) em memória, já com o esquema aplicado. */
async function openTestDb() {
  const db = await Database.open({ pgliteDir: 'memory://' });
  await migrate(db);
  return db;
}

module.exports = { openTestDb };
