/**
 * Copia um data/db.json (formato antigo) para o banco configurado no .env.
 *   npm run db:import-json -- [caminho]     (padrão: data/db.json)
 * Pode rodar de novo sem duplicar. Com o PGlite, pare o servidor antes.
 */
const fs = require('fs');
const path = require('path');
const config = require('../src/config');
const { Database } = require('../src/db/Database');
const { migrate } = require('../src/db/migrate');
const { importJson, formatReport } = require('../src/db/importJson');

(async () => {
  const file = path.resolve(process.argv[2] || path.join(config.dataDir, 'db.json'));
  if (!fs.existsSync(file)) throw new Error(`Arquivo não encontrado: ${file}`);
  const data = JSON.parse(fs.readFileSync(file, 'utf8') || '{}');
  const db = await Database.open(config);
  try {
    await migrate(db, { logger: console });
    const report = await importJson(db, data);
    console.log(`Importado de ${file}:`);
    formatReport(report).forEach((line) => console.log(line));
  } finally {
    await db.close();
  }
})().catch((err) => {
  console.error(`✖ ${err.message}`);
  process.exit(1);
});
