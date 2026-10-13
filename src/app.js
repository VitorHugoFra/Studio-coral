const path = require('path');
const fs = require('fs');
const express = require('express');
const defaultConfig = require('./config');
const { Database } = require('./db/Database');
const { migrate } = require('./db/migrate');
const { importJson, readLegacyJson, formatReport, shortSummary } = require('./db/importJson');
const { buildContainer } = require('./bootstrap');
const { createApi } = require('./http/api');
const { createPublicRoutes } = require('./http/public');
const { seed: seedDemo } = require('./seed');

/**
 * Último tratador de erros do Express. Sem ele, um erro que escapa das rotas públicas (/r/:code, pedidos) ou do
 * middleware de autenticação cai no tratador padrão, que mostra a pilha em HTML fora de NODE_ENV=production,
 * até para o cliente final que abriu um link. Aqui: registra e responde 500 sem detalhe nenhum (JSON em /api,
 * texto simples no resto). Erro do cliente (JSON malformado, corpo grande demais) mantém o status 4xx.
 */
function finalErrorHandler(logger) {
  return (err, req, res, next) => { // os 4 argumentos são o que faz o Express tratar isto como tratador de erros
    const status = err.status >= 400 && err.status < 500 ? err.status : 500;
    if (status === 500) logger.error('[http]', err);
    if (res.headersSent) return next(err); // a resposta já começou: só o tratador do Express consegue encerrar a conexão
    const message = status === 500 ? 'Erro interno. Tente de novo em instantes.' : 'Requisição inválida.';
    if (req.path === '/api' || req.path.startsWith('/api/')) return res.status(status).json({ error: message });
    return res.status(status).type('text/plain').send(message);
  };
}

/**
 * Monta a aplicação: banco, dados, rotas e fila de disparo.
 * O server.js só chama createApp() e sobe a porta; os testes fazem o mesmo
 * numa porta livre, com configuração, provedores e logger próprios.
 */
async function createApp({ config = defaultConfig, overrides = {}, seed = true, logger = console } = {}) {
  const db = await Database.open({ ...config, logger });
  let dispatch = null;
  try {
    // Uma instância por banco, antes de migrar ou mexer em qualquer dado (espera o "para e sobe" de um deploy)
    await db.lockSingleInstance({ logger });
    await migrate(db, { logger });
    const container = buildContainer({ config, db, logger, overrides });
    const repos = container.resolve('repos');
    // Primeira execução (banco vazio): traz o antigo data/db.json, se existir;
    // senão, cria os dados de demonstração
    if (seed && (await repos.restaurants.count()) === 0) {
      const legacy = path.join(config.dataDir, 'db.json');
      if (fs.existsSync(legacy)) {
        const report = await importJson(db, readLegacyJson(legacy));
        logger.log(`📦 data/db.json importado para o banco: ${shortSummary(report)}. O arquivo foi mantido como cópia.`);
        // O resumo só conta o que entrou: se algo ficou de fora ou foi ajustado, o relatório completo
        // (que já traz os avisos) vai para o log; senão, só os avisos
        if (Object.values(report.collections).some((s) => s.existing || s.ignored || s.adjusted)) formatReport(report).forEach((line) => logger.log(line));
        else report.warnings.forEach((w) => logger.log(`   ⚠ ${w}`));
      } else {
        await seedDemo(repos);
        logger.log('🌱 Dados de demonstração criados.');
      }
    }
    await repos.settings.load();

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
    app.use(finalErrorHandler(logger));

    dispatch = container.resolve('dispatch');
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
  } catch (err) {
    // Falha na subida: a fila para e o banco é fechado em vez de ficar aberto até o processo morrer
    dispatch?.stop();
    await db.close().catch(() => {});
    throw err;
  }
}

module.exports = { createApp, finalErrorHandler };
