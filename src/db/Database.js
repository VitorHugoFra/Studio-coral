const fs = require('fs');

/**
 * Acesso ao PostgreSQL.
 *
 *  • Produção: um PostgreSQL de verdade (DATABASE_URL), pelo pool do `pg`.
 *  • Desenvolvimento e testes: PGlite, o próprio PostgreSQL compilado para
 *    WebAssembly, rodando dentro do Node (pasta data/pgdata ou memória).
 *
 * Os repositórios só conhecem esta interface: query, many, one, exec, tx, close.
 */
class Database {
  constructor(driver) {
    this.driver = driver;
  }

  /**
   * Abre o banco conforme a configuração: DATABASE_URL ou PGlite.
   * O logger (padrão: console) recebe os avisos do pool do pg.
   */
  static async open({ databaseUrl = '', pgliteDir = 'memory://', databasePoolMax = 10, logger = console } = {}) {
    if (databaseUrl) return new Database(await PgDriver.connect(databaseUrl, databasePoolMax, logger));
    return new Database(await PgliteDriver.open(pgliteDir));
  }

  get kind() {
    return this.driver.kind;
  }

  query(sql, params = []) {
    return this.driver.query(sql, params);
  }

  async many(sql, params) {
    return (await this.query(sql, params)).rows;
  }

  async one(sql, params) {
    return (await this.query(sql, params)).rows[0] || null;
  }

  /** Vários comandos SQL de uma vez, sem parâmetros (migrações). */
  exec(sql) {
    return this.driver.exec(sql);
  }

  /**
   * Executa fn numa transação: confirma se terminar, desfaz se lançar erro.
   * Dentro de fn use SÓ o banco recebido. Uma consulta feita fora espera a
   * transação terminar, e a transação fica esperando a consulta: trava.
   */
  tx(fn) {
    return this.driver.tx((inner) => fn(new Database(inner)));
  }

  /** Fecha o banco. Pode ser chamado mais de uma vez (SIGINT e SIGTERM): só a primeira chamada fecha de fato. */
  close() {
    this.closing ??= this.driver.close();
    return this.closing;
  }
}

/** Endereço do banco sem a senha, para as mensagens de erro. */
function maskUrl(url) {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    for (const key of ['password', 'sslpassword']) if (u.searchParams.has(key)) u.searchParams.set(key, '***');
    return u.toString();
  } catch {
    return '(DATABASE_URL inválida)';
  }
}

class PgDriver {
  static async connect(url, max, logger) {
    // eslint-disable-next-line global-require
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: url, max, connectionTimeoutMillis: 10000 });
    // Conexão ociosa que cai (reinício do banco, rede) não pode derrubar o servidor: o pool reconecta na próxima consulta
    pool.on('error', (err) => logger.error(`[db] Conexão ociosa com o PostgreSQL caiu: ${err.message}`));
    try {
      await pool.query('SELECT 1');
    } catch (err) {
      await pool.end().catch(() => {});
      throw new Error(`Não foi possível conectar ao PostgreSQL (${maskUrl(url)}): ${err.message}`);
    }
    return new PgDriver(pool, logger);
  }

  constructor(pool, logger) {
    this.pool = pool;
    this.logger = logger;
    this.kind = 'pg';
  }

  query(sql, params) {
    return this.pool.query(sql, params);
  }

  exec(sql) {
    return this.pool.query(sql);
  }

  async tx(fn) {
    const client = await this.pool.connect();
    // Enquanto o cliente está emprestado, o pool não vigia o 'error' dele. Sem este listener, uma conexão que cai
    // no meio da transação vira exceção não tratada e derruba o servidor. A consulta em andamento já rejeita, então
    // a transação falha e desfaz; aqui só registramos a queda e marcamos o cliente como quebrado.
    let broken = null;
    const onError = (err) => {
      broken = err;
      this.logger.error(`[db] Conexão com o PostgreSQL caiu durante uma transação: ${err.message}`);
    };
    client.on('error', onError);
    try {
      await client.query('BEGIN');
      const result = await fn(new PgTxDriver(client));
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.removeListener('error', onError);
      // Com o erro, o pool descarta o cliente em vez de devolver uma conexão morta; no próximo uso ele reconecta
      client.release(broken || undefined);
    }
  }

  close() {
    return this.pool.end();
  }
}

/** Cliente já dentro de uma transação; transações aninhadas reaproveitam a atual. */
class PgTxDriver {
  constructor(client) {
    this.client = client;
    this.kind = 'pg';
  }

  query(sql, params) {
    return this.client.query(sql, params);
  }

  exec(sql) {
    return this.client.query(sql);
  }

  tx(fn) {
    return fn(this);
  }

  async close() {}
}

class PgliteDriver {
  static async open(dir) {
    // eslint-disable-next-line global-require
    const { PGlite } = require('@electric-sql/pglite');
    const memory = !dir || dir.startsWith('memory://');
    const release = memory ? () => {} : lockDir(dir);
    try {
      return new PgliteDriver(await PGlite.create(memory ? 'memory://' : dir), release);
    } catch (err) {
      release();
      throw err;
    }
  }

  constructor(lite, release) {
    this.lite = lite;
    this.release = release;
    this.kind = 'pglite';
  }

  query(sql, params) {
    return this.lite.query(sql, params);
  }

  exec(sql) {
    return this.lite.exec(sql);
  }

  tx(fn) {
    return this.lite.transaction((t) => fn(new PgliteTxDriver(t)));
  }

  async close() {
    try {
      await this.lite.close();
    } finally {
      this.release();
    }
  }
}

class PgliteTxDriver {
  constructor(t) {
    this.t = t;
    this.kind = 'pglite';
  }

  query(sql, params) {
    return this.t.query(sql, params);
  }

  exec(sql) {
    return this.t.exec(sql);
  }

  tx(fn) {
    return fn(this);
  }

  async close() {}
}

/**
 * O PGlite não aceita dois processos na mesma pasta (corromperia os dados).
 * A trava fica ao lado da pasta (data/pgdata.lock), com o pid do dono, e
 * impede, por exemplo, rodar `npm run seed` com o servidor ligado.
 */
function lockDir(dir) {
  const file = `${dir}.lock`;
  if (fs.existsSync(file)) {
    const pid = Number(fs.readFileSync(file, 'utf8'));
    if (pid && pid !== process.pid && isAlive(pid)) {
      throw new Error(`O banco local (${dir}) já está aberto por outro processo (pid ${pid}). Pare o servidor antes de rodar este comando. Se ele já estiver parado, apague ${file}.`);
    }
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, String(process.pid));
  return () => fs.rmSync(file, { force: true });
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

module.exports = { Database };
