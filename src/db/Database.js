const fs = require('fs');

// Chave da trava de instância única (advisory lock). É fixa: todas as versões do sistema precisam disputar a mesma.
const INSTANCE_LOCK_KEY = 727301001;
// Limites por conexão no PostgreSQL de produção: um comando preso não prende o servidor para sempre
// e uma transação esquecida aberta não segura linhas e travas
const STATEMENT_TIMEOUT_MS = 30000;
const IDLE_IN_TRANSACTION_TIMEOUT_MS = 60000;

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

  async query(sql, params = []) {
    try {
      return await this.driver.query(sql, params);
    } catch (err) {
      throw markAsDbError(err);
    }
  }

  async many(sql, params) {
    return (await this.query(sql, params)).rows;
  }

  async one(sql, params) {
    return (await this.query(sql, params)).rows[0] || null;
  }

  /** Vários comandos SQL de uma vez, sem parâmetros (migrações). */
  async exec(sql) {
    try {
      return await this.driver.exec(sql);
    } catch (err) {
      throw markAsDbError(err);
    }
  }

  /**
   * Executa fn numa transação: confirma se terminar, desfaz se lançar erro.
   * Dentro de fn use SÓ o banco recebido. Uma consulta feita fora espera a
   * transação terminar, e a transação fica esperando a consulta: trava.
   */
  tx(fn) {
    return this.driver.tx((inner) => fn(new Database(inner)));
  }

  /**
   * Garante uma instância do servidor por banco. Com um PostgreSQL compartilhado, duas instâncias (um deploy
   * sobreposto, um computador de desenvolvimento com a URL de produção) disputariam a fila de disparo: reenvio
   * duplicado e envios "consumidos" pelo simulador. A trava é um advisory lock de sessão, numa conexão própria
   * (fora do pool) que fica aberta enquanto o banco estiver em uso; se ela cair, o PostgreSQL solta a trava.
   * Por isso a conexão precisa ser em modo sessão (um pooler em modo transação, como o do Supabase na porta 6543,
   * não serve). Chame logo depois de abrir o banco, antes de migrar.
   *
   * Se outra instância já tem a trava, tenta de novo a cada retryMs (1 s) até waitMs (30 s, o que cobre o
   * "para e sobe" de um deploy) e então lança um erro. No PGlite não faz nada (a pasta já tem a própria trava).
   * Opções: waitMs, retryMs, logger e createClient (os testes trocam o pg.Client por um falso).
   */
  async lockSingleInstance(options) {
    await this.driver.lockSingleInstance?.(options);
  }

  /** Fecha o banco. Pode ser chamado mais de uma vez (SIGINT e SIGTERM): só a primeira chamada fecha de fato. */
  close() {
    this.closing ??= this.driver.close();
    return this.closing;
  }
}

/**
 * Marca o erro como falha do banco (err.db = true) e devolve o MESMO objeto: code, constraint
 * e o resto continuam nele. Assim a API responde 500 também às falhas de conexão, que não
 * trazem SQLSTATE (ECONNREFUSED, "Connection terminated unexpectedly", pool esgotado).
 */
function markAsDbError(err) {
  if (err && typeof err === 'object') err.db = true;
  return err;
}

/** Para usar em .catch(): marca o erro como falha do banco e o lança de novo. */
function rethrowAsDbError(err) {
  throw markAsDbError(err);
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
    const pool = new Pool({
      connectionString: url,
      max,
      connectionTimeoutMillis: 10000,
      // Os limites de tempo valem por conexão: o pool roda isto em cada conexão nova e só a entrega depois (com o evento
      // 'connect' a primeira consulta de quem a pediu chegaria com o SET ainda em andamento, o que o pg 8 já marca como
      // obsoleto). Se o SET falhar, só registramos: a conexão serve do mesmo jeito.
      // Uma migração demorada de verdade pode começar com SET LOCAL statement_timeout = 0.
      onConnect: (client) => client
        .query(`SET statement_timeout = ${STATEMENT_TIMEOUT_MS}; SET idle_in_transaction_session_timeout = ${IDLE_IN_TRANSACTION_TIMEOUT_MS}`)
        .catch((err) => logger.error(`[db] Não foi possível aplicar os limites de tempo à conexão com o PostgreSQL: ${err.message}`)),
    });
    // Conexão ociosa que cai (reinício do banco, rede) não pode derrubar o servidor: o pool reconecta na próxima consulta
    pool.on('error', (err) => logger.error(`[db] Conexão ociosa com o PostgreSQL caiu: ${err.message}`));
    try {
      await pool.query('SELECT 1');
    } catch (err) {
      await pool.end().catch(() => {});
      throw new Error(`Não foi possível conectar ao PostgreSQL (${maskUrl(url)}): ${err.message}`);
    }
    return new PgDriver(pool, logger, url);
  }

  constructor(pool, logger, url) {
    this.pool = pool;
    this.logger = logger;
    this.url = url;
    this.instanceLock = null;
    this.kind = 'pg';
  }

  query(sql, params) {
    return this.pool.query(sql, params);
  }

  exec(sql) {
    return this.pool.query(sql);
  }

  async tx(fn) {
    // Falhas de conexão, do BEGIN e do COMMIT são falhas do banco mesmo sem SQLSTATE (pool esgotado, conexão que caiu).
    // As consultas de dentro de fn já saem marcadas pelo Database; o erro lançado pela própria fn, não
    const client = await this.pool.connect().catch(rethrowAsDbError);
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
      await client.query('BEGIN').catch(rethrowAsDbError);
      const result = await fn(new PgTxDriver(client));
      await client.query('COMMIT').catch(rethrowAsDbError);
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

  /** Ver Database#lockSingleInstance. Chamar de novo não abre outra conexão. */
  async lockSingleInstance({ waitMs = 30000, retryMs = 1000, logger = this.logger, createClient = openLockClient } = {}) {
    if (this.instanceLock) return;
    this.instanceLock = await acquireInstanceLock(this.url, { waitMs, retryMs, logger, createClient });
  }

  async close() {
    try {
      // A trava é solta antes de fechar o pool; se a conexão dela já morreu, o erro é engolido e o pool fecha do mesmo jeito
      await this.instanceLock?.release();
    } finally {
      await this.pool.end();
    }
  }
}

/** A conexão própria da trava: fora do pool, com keepalive para notar uma conexão que morreu em silêncio. */
function openLockClient(url) {
  // eslint-disable-next-line global-require
  const { Client } = require('pg');
  return new Client({ connectionString: url, connectionTimeoutMillis: 10000, keepAlive: true });
}

/**
 * Abre a conexão da trava e tenta o pg_try_advisory_lock até conseguir ou acabar o prazo (waitMs); a espera
 * entre as tentativas nunca passa do prazo. Devolve { release() }, que solta a trava e fecha a conexão sem lançar erro.
 */
async function acquireInstanceLock(url, { waitMs, retryMs, logger, createClient }) {
  const client = createClient(url);
  // A trava vale enquanto esta conexão viver. Se ela cair (rede, reinício do banco), o PostgreSQL a solta e outra instância
  // pode assumir: aqui só dá para avisar. Sem este listener, o erro de uma conexão ociosa derrubaria o servidor
  client.on('error', (err) => logger.error(`[db] A conexão que guarda a trava de instância única caiu: ${err.message}. Outra instância pode assumir este banco.`));
  const closeQuietly = () => client.end().catch(() => {});

  try {
    await client.connect();
  } catch (err) {
    await closeQuietly();
    throw new Error(`Não foi possível abrir a conexão da trava de instância única (${maskUrl(url)}): ${err.message}`, { cause: err });
  }

  try {
    const deadline = Date.now() + waitMs;
    let waiting = false;
    for (;;) {
      const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [INSTANCE_LOCK_KEY]);
      if (rows[0].ok) break;
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`Outra instância do Studio Coral já está usando este banco (${maskUrl(url)}). Rode uma instância por vez.`);
      if (!waiting) {
        waiting = true;
        logger.log?.(`⏳ Outra instância está usando o banco; esperando até ${Math.ceil(waitMs / 1000)} s para ela terminar...`);
      }
      await new Promise((resolve) => { setTimeout(resolve, Math.min(retryMs, left)); });
    }
  } catch (err) {
    await closeQuietly();
    throw err;
  }

  return {
    async release() {
      // Solta de forma explícita antes de fechar: num PostgreSQL de verdade fechar a conexão já bastaria, mas o que fica
      // entre nós e o banco (um proxy, o servidor de teste) pode manter a sessão viva, e a trava com ela
      await client.query('SELECT pg_advisory_unlock($1)', [INSTANCE_LOCK_KEY]).catch(() => {});
      await closeQuietly();
    },
  };
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

  /** A pasta do PGlite já tem a própria trava (lockDir): não há o que travar no banco. */
  async lockSingleInstance() {}

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

module.exports = { Database, maskUrl };
