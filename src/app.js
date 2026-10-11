const path = require('path');
const fs = require('fs');
const express = require('express');
const defaultConfig = require('./config');
const { buildContainer } = require('./bootstrap');
const { createApi } = require('./http/api');
const { createPublicRoutes } = require('./http/public');
const { seed: seedDemo } = require('./seed');

/**
 * Monta a aplicação: dados, rotas e fila de disparo.
 * O server.js só chama createApp() e sobe a porta; os testes fazem o mesmo
 * numa porta livre, com configuração e provedores próprios.
 */
async function createApp({ config = defaultConfig, overrides = {}, seed = true } = {}) {
  const container = buildContainer({ config, overrides });
  const logger = container.resolve('logger');
  const repos = container.resolve('repos');

  // Primeira execução: popula dados de demonstração
  if (seed && !repos.restaurants.all().length) {
    seedDemo(repos);
    logger.log('🌱 Dados de demonstração criados.');
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
  dispatch.init();

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
      dispatch.stop();
      // Espera o envio em andamento (no máximo 3 s) antes de desligar o canal e gravar
      for (const until = Date.now() + 3000; dispatch.busy && Date.now() < until;) {
        await new Promise((r) => { setTimeout(r, 10); });
      }
      // Fecha o navegador do WPPConnect mantendo a sessão salva
      await Promise.race([
        Promise.all([messaging.stop().catch(() => {}), container.resolve('pdf').close()]),
        new Promise((r) => { setTimeout(r, 3000).unref(); }),
      ]);
      if (server) {
        server.closeAllConnections?.();
        await new Promise((r) => { server.close(() => r()); });
      }
      container.resolve('store').flush();
    },
  };
}

module.exports = { createApp };
