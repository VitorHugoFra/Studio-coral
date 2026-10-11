const path = require('path');
const fs = require('fs');
const express = require('express');
const defaultConfig = require('./config');
const { Database } = require('./db/Database');
const { migrate } = require('./db/migrate');
const { buildContainer } = require('./bootstrap');
const { createApi } = require('./http/api');
const { createPublicRoutes } = require('./http/public');
const { seed: seedDemo } = require('./seed');

/**
 * Monta a aplicação: banco, dados, rotas e fila de disparo.
 * O server.js só chama createApp() e sobe a porta; os testes fazem o mesmo
 * numa porta livre, com configuração, provedores e logger próprios.
 */
async function createApp({ config = defaultConfig, overrides = {}, seed = true, logger = console } = {}) {
  const db = await Database.open({ ...config, logger });
  let container;
  try {
    await migrate(db, { logger });
    container = buildContainer({ config, db, logger, overrides });
    const repos = container.resolve('repos');
    // Primeira execução: popula dados de demonstração
    if (seed && (await repos.restaurants.count()) === 0) {
      await seedDemo(repos);
      logger.log('🌱 Dados de demonstração criados.');
    }
    await repos.settings.load();
  } catch (err) {
    await db.close().catch(() => {});
    throw err;
  }

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use(express.json({
    limit: '8mb',
    verify: (req, _res, buf) => { req.rawBody = buf; },
  }));

  const publicDir = path.join(__dirname, '..', 'public');
  app.use('/vendor/alpine.js', (req, res) => res.sendFile(require.resolve('alpinejs/dist/cdn.min.js')));
  app.use('/uploads', express.static(path.join(config.dataDir, 'uploads'), { maxAge: '7d' }));
  app.use(createPublicRoutes(container));
  app.use('/api', createApi(container));
  app.get(['/app', '/app/*'], (req, res) => res.sendFile(path.join(publicDir, 'app.html')));
  app.use(express.static(publicDir, { extensions: ['html'] }));
  app.use((req, res) => res.status(404).sendFile(path.join(publicDir, 'index.html')));

  const dispatch = container.resolve('dispatch');
  const messaging = container.resolve('messaging');
  await dispatch.init();

  // Reconecta automaticamente o provedor ativo (no WPPConnect usa a sessão salva)
  const { session, tokensDir } = config.messaging.wppconnect;
  if (messaging.key !== 'wppconnect' || fs.existsSync(path.join(tokensDir, session))) messaging.start().catch(() => {});

  let server = null;
  return {
    app,
    container,
    config,
    listen(port = config.port) {
      return new Promise((resolve, reject) => {
        server = app.listen(port, () => resolve(server));
        server.on('error', reject);
      });
    },
    async close() {
      const atMost = (ms, promise) => Promise.race([promise, new Promise((r) => { setTimeout(r, ms).unref(); })]);
      dispatch.stop();
      // Espera o envio em andamento (no máximo 3 s) antes de desligar o canal
      await atMost(3000, dispatch.idle());
      // Fecha o navegador do WPPConnect mantendo a sessão salva
      await atMost(3000, Promise.all([messaging.stop().catch(() => {}), container.resolve('pdf').close()]));
      if (server) {
        server.closeAllConnections?.();
        await new Promise((r) => { server.close(() => r()); });
      }
      await atMost(3000, dispatch.idle()); // nada pode estar usando o banco quando ele fechar
      await db.close();
    },
  };
}

module.exports = { createApp };
