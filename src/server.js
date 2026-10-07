const path = require('path');
const fs = require('fs');
const express = require('express');
const { buildContainer } = require('./bootstrap');
const { createApi } = require('./http/api');
const { createPublicRoutes } = require('./http/public');
const { seed } = require('./seed');

const container = buildContainer();
const config = container.resolve('config');
const repos = container.resolve('repos');

// Primeira execução: popula dados de demonstração
if (!repos.restaurants.all().length) {
  seed(repos);
  console.log('🌱 Dados de demonstração criados.');
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
const hasWppSession = fs.existsSync(path.join(config.messaging.wppconnect.tokensDir, config.messaging.wppconnect.session));
if (messaging.key !== 'wppconnect' || hasWppSession) messaging.start().catch(() => {});

app.listen(config.port, () => {
  console.log(`
  ┌──────────────────────────────────────────────┐
  │  STUDIO CORAL · Plataforma de Disparos       │
  └──────────────────────────────────────────────┘
  Site:      ${config.publicUrl}
  Painel:    ${config.publicUrl}/app
  Login:     ${config.admin.email}
  Provedor:  ${messaging.getStatus().label}
`);
});

const shutdown = async () => {
  container.resolve('store').flush();
  // Fecha o navegador do WPPConnect mantendo a sessão salva
  await Promise.race([Promise.all([messaging.stop().catch(() => {}), container.resolve('pdf').close()]), new Promise((r) => setTimeout(r, 3000))]);
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
