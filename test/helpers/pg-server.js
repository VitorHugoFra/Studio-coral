const { PGlite } = require('@electric-sql/pglite');
const { PGLiteSocketServer } = require('@electric-sql/pglite-socket');

/** PostgreSQL de verdade (PGlite) numa porta local, para testar o driver `pg` sem instalar nada. */
async function startPgServer() {
  const lite = await PGlite.create();
  // maxConnections: depois de um erro o pg-pool abre outra conexão; com o padrão (1) ela era recusada
  const server = new PGLiteSocketServer({ db: lite, port: 0, host: '127.0.0.1', maxConnections: 10 });
  await server.start();
  const port = Number(server.getServerConn().split(':').pop());
  return {
    url: `postgres://postgres:postgres@127.0.0.1:${port}/postgres`,
    async close() {
      await server.stop();
      await lite.close();
    },
  };
}

module.exports = { startPgServer };
