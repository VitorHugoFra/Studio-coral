const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { Database } = require('../../src/db/Database');
const { migrate } = require('../../src/db/migrate');
const { createRepositories } = require('../../src/db/repositories');
const { resetRefusal } = require('../../src/seed');
const { startPgServer } = require('../helpers/pg-server');

const ROOT = path.join(__dirname, '..', '..');

/**
 * Roda `node src/seed.js …` noutro processo. Assíncrono de propósito: o PostgreSQL de teste mora
 * neste processo e precisa continuar respondendo (um spawnSync travaria os dois).
 * O env sempre traz DATABASE_URL e DATA_DIR de teste: nada aqui pode alcançar data/ nem um banco de verdade.
 */
function runSeed(args, env) {
  return new Promise((resolve) => {
    execFile(process.execPath, ['src/seed.js', ...args], { cwd: ROOT, env: { ...process.env, ...env }, timeout: 60000 }, (error, stdout, stderr) => {
      resolve({ code: error ? (error.code ?? 1) : 0, stdout, stderr });
    });
  });
}

describe('npm run seed (src/seed.js --reset) com DATABASE_URL', () => {
  let pg;
  let db;
  let repos;
  let dataDir;

  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coral-seed-cli-'));
    pg = await startPgServer();
    try {
      db = await Database.open({ databaseUrl: pg.url, databasePoolMax: 1 });
      await migrate(db);
      repos = createRepositories(db);
      await repos.restaurants.create({ name: 'Cantina Intocada', slug: 'cantina-intocada' });
    } catch (err) {
      await db?.close();
      await pg.close();
      throw err;
    }
  });
  after(async () => {
    await db?.close();
    await pg?.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('--reset sem --force recusa: sai com código 1, cita o endereço sem a senha e não toca no banco', async () => {
    const run = await runSeed(['--reset'], { DATABASE_URL: pg.url, DATA_DIR: dataDir });
    assert.equal(run.code, 1, `esperava recusar (código 1); saída: ${run.stdout}${run.stderr}`);
    const masked = pg.url.replace(':postgres@', ':***@');
    assert.ok(
      run.stderr.includes(`✖ npm run seed apaga TODOS os dados de ${masked}. Para confirmar, rode: npm run seed -- --force`),
      `mensagem inesperada: ${run.stderr}`,
    );
    assert.ok(!run.stderr.includes(':postgres@'), 'a senha não pode aparecer');
    // O banco continua como estava: nada foi apagado nem recriado, e a pasta de dados ficou vazia
    assert.deepEqual((await repos.restaurants.all()).map((r) => r.name), ['Cantina Intocada']);
    assert.deepEqual(fs.readdirSync(dataDir), []);
  });
});

describe('resetRefusal', () => {
  const databaseUrl = 'postgres://usuario:segredo@banco.exemplo.com:5432/studio';

  it('recusa --reset num banco de verdade sem --force, com o endereço mascarado', () => {
    assert.equal(
      resetRefusal({ databaseUrl, args: ['--reset'] }),
      'npm run seed apaga TODOS os dados de postgres://usuario:***@banco.exemplo.com:5432/studio. Para confirmar, rode: npm run seed -- --force',
    );
  });

  it('com --force, segue', () => {
    assert.equal(resetRefusal({ databaseUrl, args: ['--reset', '--force'] }), null);
  });

  it('sem DATABASE_URL (o PGlite local de desenvolvimento), segue como sempre', () => {
    assert.equal(resetRefusal({ databaseUrl: '', args: ['--reset'] }), null);
  });

  it('sem --reset não há o que confirmar', () => {
    assert.equal(resetRefusal({ databaseUrl, args: [] }), null);
  });
});
