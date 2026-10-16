const { Container } = require('./container');
const defaultConfig = require('./config');
const { createRepositories } = require('./db/repositories');
const { registerMessaging } = require('./messaging');
const { registerMail } = require('./mail');
const { EventBus } = require('./services/EventBus');
const { TemplateService } = require('./services/TemplateService');
const { DispatchService } = require('./services/DispatchService');
const { AnalyticsService } = require('./services/AnalyticsService');
const { AuthService } = require('./services/AuthService');
const { AccessService } = require('./services/AccessService');
const { MediaService } = require('./services/MediaService');
const { ReportService } = require('./services/ReportService');
const { PdfService } = require('./services/PdfService');
const { OrderService } = require('./services/OrderService');
const { ReferralService } = require('./services/ReferralService');

/**
 * Composição da aplicação (composition root).
 * Aqui — e somente aqui — as implementações concretas são ligadas aos contratos.
 * O banco chega já aberto e migrado (abrir é assíncrono; ver src/app.js).
 */
function buildContainer({ config = defaultConfig, db, logger = console, overrides = {} } = {}) {
  if (!db) throw new Error('[container] Informe o banco de dados (db).');
  const c = new Container();

  c.value('config', config);
  c.value('logger', logger);
  c.value('db', db);
  c.register('repos', (x) => createRepositories(x.resolve('db')));
  c.register('events', () => new EventBus());
  c.register('auth', (x) => new AuthService({ config: x.resolve('config'), repos: x.resolve('repos') }));
  registerMail(c);
  c.register('access', (x) => new AccessService({
    repos: x.resolve('repos'),
    mail: x.resolve('mail'), // ← contrato de e-mail injetado
    events: x.resolve('events'),
    config: x.resolve('config'),
    logger: x.resolve('logger'),
  }));
  c.register('templates', (x) => new TemplateService({ settings: x.resolve('repos').settings }));
  c.register('media', (x) => new MediaService({ config: x.resolve('config') }));
  c.register('analytics', (x) => new AnalyticsService({ repos: x.resolve('repos') }));
  c.register('referrals', (x) => new ReferralService({ repos: x.resolve('repos'), messaging: x.resolve('messaging'), templates: x.resolve('templates'), config: x.resolve('config'), logger: x.resolve('logger') }));
  c.register('orders', (x) => new OrderService({ repos: x.resolve('repos'), events: x.resolve('events'), config: x.resolve('config'), referrals: x.resolve('referrals'), logger: x.resolve('logger') }));

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
