const path = require('path');
const { Container } = require('./container');
const config = require('./config');
const { JsonStore } = require('./db/JsonStore');
const { createRepositories } = require('./db/repositories');
const { registerMessaging } = require('./messaging');
const { EventBus } = require('./services/EventBus');
const { TemplateService } = require('./services/TemplateService');
const { DispatchService } = require('./services/DispatchService');
const { AnalyticsService } = require('./services/AnalyticsService');
const { AuthService } = require('./services/AuthService');
const { MediaService } = require('./services/MediaService');
const { ReportService } = require('./services/ReportService');
const { PdfService } = require('./services/PdfService');

/**
 * Composição da aplicação (composition root).
 * Aqui — e somente aqui — as implementações concretas são ligadas aos contratos.
 */
function buildContainer(overrides = {}) {
  const c = new Container();

  c.value('config', config);
  c.value('logger', console);
  c.register('store', () => new JsonStore(path.join(config.dataDir, 'db.json')));
  c.register('repos', (x) => createRepositories(x.resolve('store')));
  c.register('events', () => new EventBus());
  c.register('auth', (x) => new AuthService({ config: x.resolve('config'), repos: x.resolve('repos') }));
  c.register('templates', (x) => new TemplateService({ settings: x.resolve('repos').settings }));
  c.register('media', (x) => new MediaService({ config: x.resolve('config') }));
  c.register('analytics', (x) => new AnalyticsService({ repos: x.resolve('repos') }));

  c.register('reports', (x) => new ReportService({ repos: x.resolve('repos'), analytics: x.resolve('analytics') }));
  c.register('pdf', (x) => new PdfService({ config: x.resolve('config'), auth: x.resolve('auth'), logger: x.resolve('logger') }));

  registerMessaging(c);

  c.register('dispatch', (x) => new DispatchService({
    repos: x.resolve('repos'),
    messaging: x.resolve('messaging'), // ← contrato de envio injetado
    templates: x.resolve('templates'),
    media: x.resolve('media'),
    events: x.resolve('events'),
    config: x.resolve('config'),
    logger: x.resolve('logger'),
  }));

  // Permite substituir qualquer peça (ex.: testes com provedor falso)
  for (const [name, factory] of Object.entries(overrides)) c.register(name, factory);
  return c;
}

module.exports = { buildContainer };
