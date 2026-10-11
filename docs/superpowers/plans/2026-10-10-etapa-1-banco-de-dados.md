# Etapa 1: JSON → PostgreSQL · Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar o `data/db.json` por PostgreSQL sem mudar nenhum comportamento visível do Studio Coral.

**Architecture:**
- Primeiro, uma bateria de testes HTTP congela o comportamento atual, ainda com o JSON.
- Depois, uma camada nova de banco, construída e testada isoladamente: adaptador `Database` (pg ou PGlite), migrações SQL, mapeamento e repositórios assíncronos.
- Por fim, a troca: serviços e rotas passam a usar `await` sobre os repositórios novos, e a mesma bateria tem de continuar passando.
- Os números que hoje são calculados em JavaScript sobre todas as mensagens passam a vir de consultas SQL agregadas.

**Tech Stack:**
- Node 22, Express 4, CommonJS.
- `pg` 8.23 em produção.
- `@electric-sql/pglite` 0.5.8 no desenvolvimento e nos testes.
- `@electric-sql/pglite-socket` 0.2.11 (só testes).
- `node:test` + `node:assert/strict`.

**Spec:** [docs/superpowers/specs/2026-10-10-etapa-1-banco-de-dados-design.md](../specs/2026-10-10-etapa-1-banco-de-dados-design.md)

## Global Constraints

- Node 22 ou superior (`node --test` com glob e `--env-file`). `engines.node` passa a `>=22`.
- Sem ORM. SQL escrito à mão, **só dentro de `src/db/`**: serviços e rotas nunca escrevem SQL.
- Os objetos que saem dos repositórios têm o **mesmo formato de hoje**:
  - campos em camelCase;
  - datas como texto ISO com milissegundos (`2026-10-10T12:57:20.235Z`);
  - `numeric` convertido para `Number`;
  - ids UUID v4 em texto;
  - colunas internas (`phone_key`, `seq`) nunca aparecem.
- Toda contagem em SQL usa `::int`, porque o driver `pg` devolve `bigint` e `count(*)` como texto.
- Campos `jsonb` são gravados com `JSON.stringify`, porque o `pg` transforma arrays JS em arrays do PostgreSQL.
- **Dentro de `db.tx(fn)` / `repos.tx(fn)`, use só o banco ou os repositórios recebidos pelo callback.** Uma consulta feita fora espera a transação terminar, e a transação fica esperando ela: trava. No PGlite isso já foi confirmado na prática.
- Id que não é UUID nunca chega ao SQL:
  - `get`/`update`/`remove` devolvem `null`/`false`;
  - filtros opcionais por restaurante usam `scopeId()`, que troca o valor pelo UUID nulo `00000000-0000-0000-0000-000000000000` (não encontra nada, como o JSON).
- Mensagens de erro, textos e comentários em português, no tom do código atual.
- Commits terminam com a linha `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Testes de caracterização (Tasks 1 e 2) descrevem o comportamento **atual**. Se algum falhar contra o código JSON, corrija o **teste**, a não ser que o comportamento seja um defeito evidente. Nesse caso, anote no commit e pergunte antes de mudar o código.

## Estrutura de arquivos

| Arquivo | Responsabilidade | Task |
|---|---|---|
| `src/app.js` (novo) | `createApp()`: banco, migrações, população inicial, Express e fila; `listen()` e `close()` | 1, 9, 10 |
| `src/server.js` | Só sobe o `createApp()` na porta e trata desligamento | 1 |
| `src/bootstrap.js` | Container de DI. Recebe `config` e, a partir da Task 9, `db` | 1, 9 |
| `src/config.js` | `simulatorPace`, `DATA_DIR`, `DATABASE_URL`, `DATABASE_POOL_MAX`, `pgliteDir` | 1, 3 |
| `src/db/Database.js` (novo) | Adaptador único `query/many/one/exec/tx/close` para `pg` e PGlite, com trava da pasta do PGlite | 3 |
| `src/db/migrate.js` (novo) + `migrations/001_esquema_inicial.sql` (novo) | Aplica as migrações em ordem e registra em `schema_migrations` | 4 |
| `src/db/mapper.js` (novo) | `defineTable`, `isUuid`, `scopeId`, `NIL_UUID` | 5 |
| `src/db/repositories/base.js` (novo) | `Repository`: get/all/count/where/first/create/insertMany/update/remove, unicidade amigável | 5 |
| `src/db/repositories/{restaurants,users,settings,contacts,campaigns,messages,conversions}.js` (novos) | Consultas de cada entidade | 6, 7, 8 |
| `src/db/repositories/index.js` (novo) | `createRepositories(db)` + `repos.tx(fn)` | 6, 7, 8 |
| `src/db/importJson.js` (novo) + `scripts/importar-json.js` (novo) | Copia um `db.json` para o banco | 10 |
| `src/db/JsonStore.js`, `src/db/repositories.js` | **Removidos** na Task 9 | 9 |
| `src/messaging/MessagingProvider.js` | Ganha `static phoneKey()` (saindo do DispatchService) | 7 |
| `src/messaging/providers/SimulatorProvider.js` | Tempos configuráveis (`timing`) | 1 |
| `src/messaging/index.js` | Erro ao salvar o provedor escolhido vai para o log | 9 |
| `src/services/{Auth,Analytics,Report,Dispatch}Service.js` | Assíncronos sobre os repositórios novos | 1 (Dispatch: pace/stop), 9 |
| `src/http/api.js`, `src/http/public.js` | Rotas com `await` | 9 |
| `src/seed.js` | Assíncrono, numa transação; `--reset` com `TRUNCATE` | 9 |
| `test/helpers/app.js` (novo) | `startApp()`: app numa porta livre, pasta temporária, simulador rápido, clientes HTTP | 1, 9, 10, 11 |
| `test/helpers/db.js`, `test/helpers/pg-server.js` (novos) | Banco de teste migrado; PGlite exposto como servidor PostgreSQL | 3, 6 |
| `test/http/*.test.js` (novos) | Caracterização pela API | 1, 2 (+ ajustes 9, 10) |
| `test/db/*.test.js`, `test/services/*.test.js` (novos) | Camada de banco e corridas da fila | 3–10 |
| `test/pg.env` (novo) | `TEST_PG=1` para rodar a bateria HTTP pelo driver `pg` | 11 |
| `README.md`, `.env.example`, `package.json` | Documentação, variáveis e scripts | 1, 3, 10, 11 |

---

### Task 1: App como fábrica, ganchos de teste e caracterização (autenticação, restaurantes, contatos)

**Files:**
- Create: `src/app.js`
- Modify: `src/server.js` (arquivo inteiro), `src/bootstrap.js:20-26`, `src/config.js:19-21`, `src/services/DispatchService.js` (init, kick, tick, step), `src/messaging/providers/SimulatorProvider.js:19-71`, `package.json`
- Test: `test/helpers/app.js`, `test/http/auth.test.js`, `test/http/restaurants.test.js`, `test/http/contacts.test.js`

**Interfaces:**
- Produces:
  - `createApp({ config, overrides, seed }) → Promise<{ app, container, config, listen(port) → Promise<http.Server>, close() → Promise<void> }>`;
  - `buildContainer({ config, overrides })`;
  - `DispatchService#stop()`;
  - `SimulatorProvider({ failRate, deliveryRate, readRate, timing })`;
  - `config.simulatorPace = { min, max }`, em segundos;
  - nos testes: `startApp({ seed, simulator }) → { config, baseUrl, container, agency, client(), close() }`, além de `waitFor`, `sleep`, `phone`, `ADMIN` e `createClient`.

- [ ] **Step 1: Tempos configuráveis no simulador**

Em `src/messaging/providers/SimulatorProvider.js`, troque o construtor, o `start()` e o `send()`. Os valores padrão continuam iguais:

```js
  constructor({ failRate = 0.03, deliveryRate = 0.96, readRate = 0.72, timing = {} } = {}) {
    super();
    this.failRate = failRate;
    this.deliveryRate = deliveryRate;
    this.readRate = readRate;
    // Tempos (ms) da demonstração; os testes usam valores mínimos
    this.timing = { start: 600, send: [120, 400], deliver: [700, 3000], read: [2500, 15000], ...timing };
    this.outbox = [];
    this.timers = new Set();
  }

  async start() {
    if (this.state.state === 'connected') return;
    this.setState('starting');
    await new Promise((r) => setTimeout(r, this.timing.start));
    this.setState('connected', { me: { name: 'Studio Coral · Simulador', number: '55 31 90000-0000' } });
  }
```

E dentro de `send()`, as três esperas:

```js
    await new Promise((r) => setTimeout(r, rand(...this.timing.send)));
```

```js
          }, rand(...this.timing.read));
        }
      }, rand(...this.timing.deliver));
```

- [ ] **Step 2: Ritmo do simulador e parada da fila no DispatchService**

Em `src/config.js`, logo depois de `sessionSecret`:

```js
  sessionSecret: env('SESSION_SECRET', 'studio-coral-dev-secret'),

  // Intervalo entre envios no simulador, em segundos (os testes usam zero)
  simulatorPace: { min: 0.8, max: 2.2 },
```

Em `src/services/DispatchService.js`:

```js
  init() {
    this.messaging.on('ack', (e) => this.handleAck(e));
    this.messaging.on('incoming', (e) => this.handleIncoming(e).catch((err) => this.logger.error(err)));
    this.messaging.on('status', (s) => {
      this.events.publish('messaging:status', s);
      if (s.state === 'connected') this.kick();
    });
    this.messaging.on('outbox', (item) => this.events.publish('outbox', item));

    // Mensagens que estavam "enviando" quando o servidor caiu voltam para a fila
    for (const m of this.repos.messages.filter((x) => x.status === 'sending')) {
      this.repos.messages.update(m, { status: 'queued' });
    }
    this.scheduleTimer = setInterval(() => this.checkSchedules(), 15000).unref();
    this.checkSchedules();
    this.kick();
  }

  /** Para a fila e os agendamentos (desligamento do servidor e testes). */
  stop() {
    this.stopped = true;
    clearInterval(this.scheduleTimer);
    clearTimeout(this.timer);
    this.timer = null;
  }
```

```js
  kick(delay = 50) {
    if (this.busy || this.stopped) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.tick(), delay);
  }
```

No fim de `tick()`:

```js
    if (next !== null && !this.stopped) this.timer = setTimeout(() => this.tick(), next);
```

E no fim de `step()`, o ritmo do simulador vem da configuração:

```js
    if (!sent) return 300; // ignorada/falhou sem tocar no WhatsApp: segue rápido
    const simulator = this.messaging.key === 'simulator';
    const pace = this.config.simulatorPace || { min: 0.8, max: 2.2 };
    const min = simulator ? pace.min : settings.minDelaySeconds;
    const max = simulator ? pace.max : Math.max(settings.maxDelaySeconds, settings.minDelaySeconds);
    return Math.round((min + Math.random() * (max - min)) * 1000);
```

- [ ] **Step 3: Container recebe a configuração**

Em `src/bootstrap.js`, troque a assinatura e as duas primeiras linhas do corpo, e o registro do `store`:

```js
function buildContainer({ config: cfg = config, overrides = {} } = {}) {
  const c = new Container();

  c.value('config', cfg);
  c.value('logger', console);
  c.register('store', (x) => new JsonStore(path.join(x.resolve('config').dataDir, 'db.json')));
```

O laço final de `overrides` continua igual. O `src/seed.js` chama `buildContainer()` sem argumentos e continua funcionando.

- [ ] **Step 4: `src/app.js`: a montagem sai do server.js**

Crie `src/app.js`:

```js
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
```

- [ ] **Step 5: `src/server.js` só sobe a porta**

Substitua o arquivo inteiro:

```js
const { createApp } = require('./app');

(async () => {
  const instance = await createApp();
  const { config, container } = instance;
  await instance.listen(config.port);
  const messaging = container.resolve('messaging');
  console.log(`
  ┌──────────────────────────────────────────────┐
  │  STUDIO CORAL · Plataforma de Disparos       │
  └──────────────────────────────────────────────┘
  Site:      ${config.publicUrl}
  Painel:    ${config.publicUrl}/app
  Login:     ${config.admin.email}
  Provedor:  ${messaging.getStatus().label}
`);

  const shutdown = async () => {
    await instance.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
})().catch((err) => {
  console.error(`✖ Não foi possível iniciar o Studio Coral: ${err.message}`);
  process.exit(1);
});
```

- [ ] **Step 6: Script de testes no package.json**

Em `package.json`, dentro de `scripts`:

```json
    "seed": "node src/seed.js --reset",
    "test": "node --test --test-concurrency=4 \"test/**/*.test.js\""
```

- [ ] **Step 7: Confira que o app ainda sobe**

Run: `npm start`, abra `http://localhost:3000/app`, entre como agência e pare com Ctrl+C.
Expected: o mesmo painel de antes, e o encerramento sem erro.

- [ ] **Step 8: Auxiliar dos testes HTTP**

Crie `test/helpers/app.js`:

```js
const fs = require('fs');
const os = require('os');
const path = require('path');
const baseConfig = require('../../src/config');
const { createApp } = require('../../src/app');
const { SimulatorProvider } = require('../../src/messaging/providers/SimulatorProvider');

/** Simulador sem falhas aleatórias e com tempos mínimos. */
const FAST_SIMULATOR = {
  failRate: 0,
  deliveryRate: 1,
  readRate: 0,
  timing: { start: 0, send: [1, 3], deliver: [30, 60], read: [30, 60] },
};

const ADMIN = { name: 'Equipe Teste', email: 'admin@teste.com.br', password: 'senha-admin-123' };

/** Cliente HTTP com cookie de sessão, como o navegador. */
function createClient(baseUrl) {
  let cookie = '';
  async function request(method, url, body, headers = {}) {
    const res = await fetch(`${baseUrl}${url}`, {
      method,
      redirect: 'manual',
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) [cookie] = setCookie.split(';');
    const text = await res.text();
    let data = text;
    try { data = text ? JSON.parse(text) : null; } catch { /* resposta não é JSON */ }
    return { status: res.status, data, headers: res.headers };
  }
  return {
    get: (url, headers) => request('GET', url, undefined, headers),
    post: (url, body = {}, headers) => request('POST', url, body, headers),
    put: (url, body = {}) => request('PUT', url, body),
    del: (url) => request('DELETE', url),
    login: (email, password) => request('POST', '/api/auth/login', { email, password }),
  };
}

/** Espera uma condição ficar verdadeira (a fila de disparo é assíncrona). */
async function waitFor(check, { timeout = 10000, interval = 40, message = 'condição' } = {}) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const value = await check();
    if (value) return value;
    await new Promise((r) => { setTimeout(r, interval); });
  }
  throw new Error(`Tempo esgotado esperando: ${message}`);
}

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/** Telefone válido e único por índice: 5531999000001, 5531999000002… */
const phone = (i) => `5531999${String(i).padStart(6, '0')}`;

/**
 * Sobe o app numa porta livre, com pasta de dados temporária e simulador rápido.
 * Devolve o cliente da agência já logado e um close() que desliga e apaga tudo.
 */
async function startApp({ seed = false, simulator = FAST_SIMULATOR } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coral-teste-'));
  const config = {
    ...baseConfig,
    port: 0,
    publicUrl: 'http://127.0.0.1',
    dataDir,
    admin: ADMIN,
    sessionSecret: 'segredo-dos-testes',
    simulatorPace: { min: 0, max: 0.005 },
    messaging: {
      ...baseConfig.messaging,
      provider: 'simulator',
      wppconnect: { ...baseConfig.messaging.wppconnect, tokensDir: path.join(dataDir, 'wpp-tokens') },
    },
  };
  const overrides = {
    'messaging.factories': () => ({ simulator: () => new SimulatorProvider(simulator) }),
  };
  const instance = await createApp({ config, overrides, seed });
  const server = await instance.listen(0);
  // O objeto config é o mesmo que os serviços receberam: os links passam a usar a porta real
  config.publicUrl = `http://127.0.0.1:${server.address().port}`;

  const agency = createClient(config.publicUrl);
  const login = await agency.login(ADMIN.email, ADMIN.password);
  if (login.status !== 200) throw new Error(`Login da agência falhou: ${JSON.stringify(login.data)}`);
  await waitFor(async () => (await agency.get('/api/messaging/status')).data?.state === 'connected', { message: 'simulador conectado' });

  return {
    config,
    baseUrl: config.publicUrl,
    container: instance.container,
    agency,
    client: () => createClient(config.publicUrl),
    async close() {
      await instance.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

module.exports = { startApp, createClient, waitFor, sleep, phone, ADMIN };
```

- [ ] **Step 9: Caracterização: autenticação e perfis**

Crie `test/http/auth.test.js`:

```js
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, ADMIN } = require('../helpers/app');

describe('autenticação e perfis de acesso', () => {
  let ctx;
  before(async () => { ctx = await startApp(); });
  after(async () => { await ctx.close(); });

  async function restaurantWithUser(name, email, password) {
    const restaurant = (await ctx.agency.post('/api/restaurants', { name })).data;
    const user = await ctx.agency.post(`/api/restaurants/${restaurant.id}/users`, { name: `Equipe ${name}`, email, password });
    assert.equal(user.status, 201);
    const client = ctx.client();
    assert.equal((await client.login(email, password)).status, 200);
    return { restaurant, user: user.data, client };
  }

  it('agência entra com o login do .env', async () => {
    const api = ctx.client();
    const res = await api.login(ADMIN.email, ADMIN.password);
    assert.equal(res.status, 200);
    assert.equal(res.data.ok, true);
    assert.equal(res.data.user.role, 'agency');
    assert.equal(res.data.user.email, ADMIN.email);
    assert.equal(res.data.user.name, ADMIN.name);
    assert.match(res.headers.get('set-cookie'), /^sc_session=.+HttpOnly/);
    const me = await api.get('/api/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.data.user.role, 'agency');
  });

  it('senha errada devolve 401', async () => {
    const res = await ctx.client().login(ADMIN.email, 'senha-errada');
    assert.equal(res.status, 401);
    assert.equal(res.data.error, 'E-mail ou senha incorretos.');
  });

  it('sem sessão as rotas do painel devolvem 401', async () => {
    const res = await ctx.client().get('/api/restaurants');
    assert.equal(res.status, 401);
    assert.equal(res.data.error, 'Sessão expirada. Entre novamente.');
  });

  it('sair apaga a sessão', async () => {
    const api = ctx.client();
    await api.login(ADMIN.email, ADMIN.password);
    assert.deepEqual((await api.post('/api/auth/logout')).data, { ok: true });
    assert.equal((await api.get('/api/auth/me')).status, 401);
  });

  it('restaurante vê só o próprio restaurante e só as rotas liberadas', async () => {
    const { restaurant, client } = await restaurantWithUser('Cantina Alfa', 'ana@alfa.com.br', 'senha-ana-123');
    await ctx.agency.post('/api/restaurants', { name: 'Cantina Beta' });

    const me = (await client.get('/api/auth/me')).data.user;
    assert.equal(me.role, 'restaurant');
    assert.equal(me.restaurantId, restaurant.id);
    assert.equal(me.restaurant, 'Cantina Alfa');
    assert.deepEqual((await client.get('/api/restaurants')).data.map((r) => r.name), ['Cantina Alfa']);

    for (const [method, url] of [['get', `/api/contacts?restaurantId=${restaurant.id}`], ['post', '/api/restaurants'], ['get', '/api/messaging/status']]) {
      const res = await client[method](url);
      assert.equal(res.status, 403, `${method} ${url}`);
      assert.equal(res.data.error, 'Seu acesso não permite esta ação.');
    }
    assert.deepEqual(Object.keys((await client.get('/api/settings')).data), ['footer']);
  });

  it('e-mail do restaurante ignora maiúsculas e espaços', async () => {
    await restaurantWithUser('Cantina Gama', 'gil@gama.com.br', 'senha-gil-123');
    const res = await ctx.client().login('  GIL@Gama.com.br ', 'senha-gil-123');
    assert.equal(res.status, 200);
    assert.equal(res.data.user.email, 'gil@gama.com.br');
  });

  it('restaurante troca a própria senha', async () => {
    const { client } = await restaurantWithUser('Cantina Delta', 'davi@delta.com.br', 'senha-davi-123');
    const wrong = await client.put('/api/me/password', { current: 'nao-e-essa', password: 'senha-nova-123' });
    assert.equal(wrong.status, 400);
    assert.equal(wrong.data.error, 'Senha atual incorreta.');
    const short = await client.put('/api/me/password', { current: 'senha-davi-123', password: 'curta' });
    assert.equal(short.data.error, 'A senha precisa ter pelo menos 8 caracteres.');
    assert.deepEqual((await client.put('/api/me/password', { current: 'senha-davi-123', password: 'senha-nova-123' })).data, { ok: true });
    assert.equal((await ctx.client().login('davi@delta.com.br', 'senha-davi-123')).status, 401);
    assert.equal((await ctx.client().login('davi@delta.com.br', 'senha-nova-123')).status, 200);
  });

  it('a senha da agência não muda pelo painel', async () => {
    const res = await ctx.agency.put('/api/me/password', { current: ADMIN.password, password: 'outra-senha-123' });
    assert.equal(res.status, 400);
    assert.equal(res.data.error, 'A senha da agência é definida no arquivo .env.');
  });

  it('acesso removido perde a sessão na hora', async () => {
    const { user, client } = await restaurantWithUser('Cantina Épsilon', 'eva@epsilon.com.br', 'senha-eva-123');
    assert.deepEqual((await ctx.agency.del(`/api/users/${user.id}`)).data, { ok: true });
    assert.equal((await client.get('/api/auth/me')).status, 401);
    assert.equal((await ctx.client().login('eva@epsilon.com.br', 'senha-eva-123')).status, 401);
  });
});
```

- [ ] **Step 10: Caracterização: restaurantes e acessos**

Crie `test/http/restaurants.test.js`:

```js
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, ADMIN } = require('../helpers/app');

const MISSING = '00000000-0000-4000-8000-000000000000';

describe('restaurantes e acessos', () => {
  let ctx;
  before(async () => { ctx = await startApp(); });
  after(async () => { await ctx.close(); });

  it('cria com valores padrão, slug e contagens zeradas', async () => {
    const res = await ctx.agency.post('/api/restaurants', { name: 'Pizzaria do Zé', city: 'Belo Horizonte – MG' });
    assert.equal(res.status, 201);
    const r = res.data;
    assert.match(r.id, /^[0-9a-f-]{36}$/);
    assert.equal(r.slug, 'pizzaria-do-ze');
    assert.equal(r.city, 'Belo Horizonte – MG');
    assert.equal(r.color, '#73350c');
    assert.equal(r.emoji, '🍽️');
    assert.deepEqual(r.menu, []);
    assert.equal(r.contactsCount, 0);
    assert.equal(r.authorizedCount, 0);
    assert.equal(r.campaignsCount, 0);
    assert.equal(r.demoUrl, `${ctx.config.publicUrl}/demo/pizzaria-do-ze`);
    assert.match(r.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('nome repetido ganha sufixo no slug', async () => {
    assert.equal((await ctx.agency.post('/api/restaurants', { name: 'Pizzaria do Zé' })).data.slug, 'pizzaria-do-ze-2');
  });

  it('exige nome', async () => {
    const res = await ctx.agency.post('/api/restaurants', { city: 'BH' });
    assert.equal(res.status, 400);
    assert.equal(res.data.error, 'Informe o nome do restaurante.');
  });

  it('ignora campos que não são do restaurante', async () => {
    const res = await ctx.agency.post('/api/restaurants', { name: 'Bar Só Campos', hacker: true, id: 'x' });
    assert.equal(res.status, 201);
    assert.equal(res.data.hacker, undefined);
    assert.notEqual(res.data.id, 'x');
  });

  it('renomear muda o slug e mantém o resto', async () => {
    const created = (await ctx.agency.post('/api/restaurants', { name: 'Lanchonete Velha', coupon: 'VELHA10' })).data;
    const res = await ctx.agency.put(`/api/restaurants/${created.id}`, { name: 'Lanchonete Nova', menu: [{ id: 'x1', name: 'Coxinha', price: 8.5 }], requireApproval: false });
    assert.equal(res.status, 200);
    assert.equal(res.data.slug, 'lanchonete-nova');
    assert.equal(res.data.coupon, 'VELHA10');
    assert.deepEqual(res.data.menu, [{ id: 'x1', name: 'Coxinha', price: 8.5 }]);
    assert.equal(res.data.requireApproval, false);
    const again = (await ctx.agency.get(`/api/restaurants/${created.id}`)).data;
    assert.equal(again.name, 'Lanchonete Nova');
    assert.ok(again.updatedAt);
  });

  it('restaurante inexistente devolve 404, inclusive com id inválido', async () => {
    for (const id of [MISSING, 'nao-existe']) {
      const get = await ctx.agency.get(`/api/restaurants/${id}`);
      assert.equal(get.status, 404);
      assert.equal(get.data.error, 'Restaurante não encontrado');
      assert.equal((await ctx.agency.put(`/api/restaurants/${id}`, { name: 'X' })).status, 404);
    }
  });

  it('lista em ordem alfabética, respeitando acentos', async () => {
    for (const name of ['Zeta Grill', 'Ébano Bistrô', 'Alfa Burger']) await ctx.agency.post('/api/restaurants', { name });
    const names = (await ctx.agency.get('/api/restaurants')).data.map((r) => r.name);
    assert.deepEqual(names, names.slice().sort((a, b) => a.localeCompare(b)));
    assert.ok(names.indexOf('Alfa Burger') < names.indexOf('Ébano Bistrô'));
    assert.ok(names.indexOf('Ébano Bistrô') < names.indexOf('Zeta Grill'));
  });

  it('acessos do restaurante: criação e validações', async () => {
    const r = (await ctx.agency.post('/api/restaurants', { name: 'Sushi Kai' })).data;
    const url = `/api/restaurants/${r.id}/users`;
    const cases = [
      [{ email: 'sem-arroba', password: 'senha-boa-123' }, 'Informe um e-mail válido.'],
      [{ email: 'kai@sushi.com.br', password: 'curta' }, 'A senha precisa ter pelo menos 8 caracteres.'],
      [{ email: ADMIN.email, password: 'senha-boa-123' }, 'Este e-mail já tem acesso.'],
    ];
    for (const [body, error] of cases) {
      const res = await ctx.agency.post(url, body);
      assert.equal(res.status, 400);
      assert.equal(res.data.error, error);
    }
    const ok = await ctx.agency.post(url, { name: '', email: 'Kai@Sushi.com.br', password: 'senha-boa-123' });
    assert.equal(ok.status, 201);
    assert.equal(ok.data.email, 'kai@sushi.com.br');
    assert.equal(ok.data.name, 'kai@sushi.com.br');
    assert.equal(ok.data.role, 'restaurant');
    assert.equal(ok.data.restaurantId, r.id);
    assert.equal(ok.data.passwordHash, undefined);
    assert.equal((await ctx.agency.post(url, { email: 'kai@sushi.com.br', password: 'senha-boa-123' })).data.error, 'Este e-mail já tem acesso.');
    const list = (await ctx.agency.get(url)).data;
    assert.deepEqual(list.map((u) => u.email), ['kai@sushi.com.br']);
    assert.equal(list[0].passwordHash, undefined);
    const missing = await ctx.agency.post(`/api/restaurants/${MISSING}/users`, { email: 'x@y.com', password: 'senha-boa-123' });
    assert.equal(missing.data.error, 'Restaurante não encontrado.');
  });

  it('agência redefine a senha de um acesso', async () => {
    const r = (await ctx.agency.post('/api/restaurants', { name: 'Taco Loco' })).data;
    const user = (await ctx.agency.post(`/api/restaurants/${r.id}/users`, { email: 'tito@taco.com.br', password: 'senha-velha-123' })).data;
    assert.equal((await ctx.agency.put(`/api/users/${user.id}/password`, { password: '123' })).data.error, 'A senha precisa ter pelo menos 8 caracteres.');
    assert.deepEqual((await ctx.agency.put(`/api/users/${user.id}/password`, { password: 'senha-nova-123' })).data, { ok: true });
    assert.equal((await ctx.client().login('tito@taco.com.br', 'senha-nova-123')).status, 200);
    const missing = await ctx.agency.put(`/api/users/${MISSING}/password`, { password: 'senha-nova-123' });
    assert.equal(missing.status, 404);
    assert.equal(missing.data.error, 'Usuário não encontrado.');
  });
});
```

- [ ] **Step 11: Caracterização: contatos**

Crie `test/http/contacts.test.js`:

```js
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('../helpers/app');

describe('contatos', () => {
  let ctx;
  let r;
  const list = async (query = '') => (await ctx.agency.get(`/api/contacts?restaurantId=${r.id}${query}`)).data;
  const byName = async (name) => (await list()).find((c) => c.name === name);

  before(async () => {
    ctx = await startApp();
    r = (await ctx.agency.post('/api/restaurants', { name: 'Cantina dos Testes' })).data;
  });
  after(async () => { await ctx.close(); });

  it('cria normalizando nome, telefone e tags', async () => {
    const res = await ctx.agency.post('/api/contacts', { restaurantId: r.id, name: '  Marina Souza ', phone: '(31) 99999-0001', tags: 'VIP, Família ,vip' });
    assert.equal(res.status, 201);
    assert.equal(res.data.name, 'Marina Souza');
    assert.equal(res.data.phone, '5531999990001');
    assert.deepEqual(res.data.tags, ['vip', 'família']);
    assert.equal(res.data.optIn, true);
    assert.equal(res.data.optedOut, false);
    assert.equal(res.data.optInSource, 'Cadastro manual');
    assert.equal(res.data.notes, '');
    assert.equal(res.data.restaurantId, r.id);
  });

  it('recusa telefone repetido, inválido e restaurante ausente', async () => {
    const dup = await ctx.agency.post('/api/contacts', { restaurantId: r.id, name: 'Outra', phone: '31999990001' });
    assert.equal(dup.status, 400);
    assert.equal(dup.data.error, 'Este telefone já está na base.');
    assert.equal((await ctx.agency.post('/api/contacts', { restaurantId: r.id, name: 'Curto', phone: '123' })).data.error, 'Telefone inválido: 123');
    assert.equal((await ctx.agency.post('/api/contacts', { restaurantId: r.id, name: 'Vazio' })).data.error, 'Telefone inválido: (vazio)');
    assert.equal((await ctx.agency.post('/api/contacts', { name: 'Sem', phone: '31999990009' })).data.error, 'Selecione o restaurante.');
  });

  it('importa contatos: cria, atualiza e aponta inválidos', async () => {
    const res = await ctx.agency.post('/api/contacts/import', {
      restaurantId: r.id,
      tags: 'Importado',
      contacts: [
        { name: 'Bruno Lima', phone: '31 98888-0002', tags: ['almoco'] },
        { name: 'Marina S.', phone: '5531999990001', tags: ['nova'] },
        { name: 'Bruno de novo', phone: '(31) 98888-0002' },
        { name: 'Sem número', phone: '12' },
      ],
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.created, 1);
    assert.equal(res.data.updated, 2);
    assert.equal(res.data.invalid.length, 1);
    assert.equal(res.data.invalid[0].error, 'Telefone inválido: 12');
    assert.equal(res.data.invalid[0].row.name, 'Sem número');

    assert.deepEqual((await byName('Marina S.')).tags, ['vip', 'família', 'nova', 'importado']);
    const bruno = await byName('Bruno Lima');
    assert.equal(bruno.phone, '5531988880002');
    assert.deepEqual(bruno.tags, ['almoco', 'importado']);
    assert.equal(bruno.optIn, true);
    assert.equal(bruno.optInSource, 'Importação');
    assert.equal((await ctx.agency.post('/api/contacts/import', { contacts: [] })).data.error, 'Selecione o restaurante.');
  });

  it('filtra por tag, situação e busca, em ordem alfabética', async () => {
    const carla = (await ctx.agency.post('/api/contacts', { restaurantId: r.id, name: 'Carla Dias', phone: '31977770003', tags: 'vip' })).data;
    await ctx.agency.put(`/api/contacts/${carla.id}`, { optedOut: true });
    await ctx.agency.post('/api/contacts', { restaurantId: r.id, name: 'Dani Rocha', phone: '31966660004', optIn: false });

    assert.deepEqual((await list()).map((c) => c.name), ['Bruno Lima', 'Carla Dias', 'Dani Rocha', 'Marina S.']);
    assert.deepEqual((await list('&tag=vip')).map((c) => c.name), ['Carla Dias', 'Marina S.']);
    assert.deepEqual((await list('&status=authorized')).map((c) => c.name), ['Bruno Lima', 'Marina S.']);
    assert.deepEqual((await list('&status=optedOut')).map((c) => c.name), ['Carla Dias']);
    assert.deepEqual((await list('&status=pending')).map((c) => c.name), ['Dani Rocha']);
    assert.deepEqual((await list('&search=MARI')).map((c) => c.name), ['Marina S.']);
    assert.deepEqual((await list('&search=8888')).map((c) => c.name), ['Bruno Lima']);
    assert.deepEqual(await list('&search=zzz'), []);
  });

  it('conta as tags da base', async () => {
    const res = (await ctx.agency.get(`/api/contacts/tags?restaurantId=${r.id}`)).data;
    assert.deepEqual(Object.fromEntries(res.map((t) => [t.tag, t.count])), { vip: 2, família: 1, nova: 1, importado: 2, almoco: 1 });
    const counts = res.map((t) => t.count);
    assert.deepEqual(counts, counts.slice().sort((a, b) => b - a));
  });

  it('descadastra e recadastra pela edição', async () => {
    const bruno = await byName('Bruno Lima');
    const out = (await ctx.agency.put(`/api/contacts/${bruno.id}`, { optedOut: true })).data;
    assert.equal(out.optedOut, true);
    assert.match(out.optedOutAt, /^\d{4}-\d{2}-\d{2}T/);
    const back = (await ctx.agency.put(`/api/contacts/${bruno.id}`, { optedOut: false, notes: 'Pediu para voltar' })).data;
    assert.equal(back.optedOut, false);
    assert.equal(back.optedOutAt, null);
    assert.equal(back.notes, 'Pediu para voltar');
    assert.equal(back.phone, '5531988880002');
  });

  it('edição valida o telefone e acusa contato inexistente', async () => {
    const bruno = await byName('Bruno Lima');
    const bad = await ctx.agency.put(`/api/contacts/${bruno.id}`, { phone: '1' });
    assert.equal(bad.status, 400);
    assert.equal(bad.data.error, 'Telefone inválido: 1');
    for (const id of ['00000000-0000-4000-8000-000000000000', 'abc']) {
      const res = await ctx.agency.put(`/api/contacts/${id}`, { name: 'X' });
      assert.equal(res.status, 404);
      assert.equal(res.data.error, 'Contato não encontrado');
    }
  });

  it('conta contatos no restaurante e exclui', async () => {
    const before = (await ctx.agency.get(`/api/restaurants/${r.id}`)).data;
    assert.equal(before.contactsCount, 4);
    assert.equal(before.authorizedCount, 2);
    const dani = await byName('Dani Rocha');
    assert.deepEqual((await ctx.agency.del(`/api/contacts/${dani.id}`)).data, { ok: true });
    assert.deepEqual((await ctx.agency.del(`/api/contacts/${dani.id}`)).data, { ok: false });
    assert.deepEqual((await ctx.agency.del('/api/contacts/abc')).data, { ok: false });
    assert.equal((await ctx.agency.get(`/api/restaurants/${r.id}`)).data.contactsCount, 3);
  });
});
```

- [ ] **Step 12: Rode os testes contra o código atual (JSON)**

Run: `npm test`
Expected: os três arquivos passam (`# fail 0`). Se algum teste falhar, investigue: provavelmente o teste descreveu errado o comportamento atual. Corrija o teste (ver Global Constraints).

- [ ] **Step 13: Commit**

```bash
git add src/app.js src/server.js src/bootstrap.js src/config.js src/services/DispatchService.js src/messaging/providers/SimulatorProvider.js package.json test/
git commit -m "Testes de caracterização: autenticação, restaurantes e contatos

O server.js vira um createApp() reutilizável pelos testes; o simulador
ganha tempos configuráveis e a fila pode ser parada.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Caracterização de campanhas, disparo, relatórios, exclusões e dados de demonstração

**Files:**
- Test: `test/http/campaigns.test.js`, `test/http/dispatch.test.js`, `test/http/reports.test.js`, `test/http/cascade.test.js`, `test/http/seed.test.js`

**Interfaces:**
- Consumes: `startApp`, `waitFor`, `sleep`, `phone` (Task 1).

- [ ] **Step 1: Campanhas e aprovação**

Crie `test/http/campaigns.test.js`:

```js
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, waitFor, sleep, phone } = require('../helpers/app');

describe('campanhas e aprovação', () => {
  let ctx;
  let r;
  let other;
  let rest;

  before(async () => {
    ctx = await startApp();
    r = (await ctx.agency.post('/api/restaurants', { name: 'Bistrô Aprovação' })).data;
    other = (await ctx.agency.post('/api/restaurants', { name: 'Outro Lugar' })).data;
    const add = (name, i, tags, extra = {}) => ctx.agency.post('/api/contacts', { restaurantId: r.id, name, phone: phone(i), tags, ...extra });
    await add('Ana Vip', 1, 'vip');
    await add('Beto Vip Família', 2, 'vip,familia');
    await add('Cris Família', 3, 'familia');
    const out = (await add('Duda Saiu', 4, 'vip')).data;
    await ctx.agency.put(`/api/contacts/${out.id}`, { optedOut: true });
    await add('Edu Sem Opt-in', 5, 'vip', { optIn: false });
    await ctx.agency.post(`/api/restaurants/${r.id}/users`, { name: 'Rita do Bistrô', email: 'rita@bistro.com.br', password: 'senha-rita-123' });
    rest = ctx.client();
    await rest.login('rita@bistro.com.br', 'senha-rita-123');
  });
  after(async () => { await ctx.close(); });

  const create = async (body) => {
    const res = await ctx.agency.post('/api/campaigns', { restaurantId: r.id, ...body });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    return res.data;
  };
  const approve = async (id) => {
    await ctx.agency.post(`/api/campaigns/${id}/request-approval`, {});
    assert.equal((await rest.post(`/api/campaigns/${id}/approve`, {})).data.approval.status, 'approved');
  };

  it('cria rascunho com valores padrão e segmentação normalizada', async () => {
    const blank = await create({});
    assert.equal(blank.name, 'Nova campanha');
    assert.equal(blank.message, '');
    assert.deepEqual(blank.segment, { tags: [], match: 'any' });
    assert.equal(blank.includeFooter, true);
    assert.equal(blank.status, 'draft');
    assert.equal(blank.restaurant, 'Bistrô Aprovação');
    assert.equal(blank.stats.audience, 0);
    assert.equal(blank.stats.orders, 0);
    assert.equal(blank.stats.revenue, 0);

    const c = await create({ name: 'Sextou', message: 'Oi {{primeiro_nome}}', segment: { tags: ['VIP', ' Familia '], match: 'all' }, coupon: 'SEXTOU' });
    assert.deepEqual(c.segment, { tags: ['vip', 'familia'], match: 'all' });
    assert.equal(c.coupon, 'SEXTOU');

    const missing = await ctx.agency.post('/api/campaigns', { name: 'Sem restaurante' });
    assert.equal(missing.status, 400);
    assert.equal(missing.data.error, 'Selecione o restaurante.');
  });

  it('prévia do público considera só contatos autorizados', async () => {
    const preview = async (segment) => (await ctx.agency.post('/api/audience/preview', { restaurantId: r.id, segment })).data;
    const vip = await preview({ tags: ['vip'] });
    assert.equal(vip.count, 2);
    assert.deepEqual(vip.sample.map((s) => s.name).sort(), ['Ana Vip', 'Beto Vip Família']);
    assert.deepEqual(Object.keys(vip.sample[0]).sort(), ['name', 'phone']);
    assert.equal((await preview({ tags: ['vip', 'familia'], match: 'all' })).count, 1);
    assert.equal((await preview({ tags: ['vip', 'familia'], match: 'any' })).count, 3);
    assert.equal((await preview({ tags: [] })).count, 3);
    assert.equal((await preview({ tags: ['VIP'] })).count, 2);
  });

  it('detalhe do rascunho traz o tamanho do público', async () => {
    const c = await create({ name: 'Público VIP', segment: { tags: ['vip'] } });
    const res = (await ctx.agency.get(`/api/campaigns/${c.id}`)).data;
    assert.equal(res.audiencePreview, 2);
    assert.deepEqual(res.segment, { tags: ['vip'], match: 'any' });
  });

  it('lista da mais nova para a mais antiga, por restaurante', async () => {
    const a = await create({ name: 'Ordem A' });
    await sleep(5);
    const b = await create({ name: 'Ordem B' });
    const names = (await ctx.agency.get(`/api/campaigns?restaurantId=${r.id}`)).data.map((c) => c.name);
    assert.ok(names.indexOf(b.name) < names.indexOf(a.name));
    assert.deepEqual((await ctx.agency.get(`/api/campaigns?restaurantId=${other.id}`)).data, []);
  });

  it('fluxo de aprovação: pedido, ajuste, aprovação e reset ao editar', async () => {
    const empty = await create({ name: 'Sem texto' });
    const noText = await ctx.agency.post(`/api/campaigns/${empty.id}/request-approval`, {});
    assert.equal(noText.status, 400);
    assert.equal(noText.data.error, 'Escreva a mensagem antes de pedir aprovação.');

    const c = await create({ name: 'Para aprovar', message: 'Oi {{primeiro_nome}}!' });
    assert.equal((await rest.get('/api/campaigns')).data.some((x) => x.id === c.id), false, 'rascunho interno não aparece para o restaurante');

    const asked = (await ctx.agency.post(`/api/campaigns/${c.id}/request-approval`, { note: 'Confere?' })).data;
    assert.equal(asked.approval.status, 'pending');
    assert.equal(asked.approval.requestedBy, ctx.config.admin.name);
    assert.equal(asked.approvalLog.length, 1);
    assert.equal(asked.approvalLog[0].action, 'requested');
    assert.equal(asked.approvalLog[0].note, 'Confere?');
    assert.equal((await rest.get('/api/campaigns')).data.some((x) => x.id === c.id), true);

    assert.equal((await rest.post(`/api/campaigns/${c.id}/request-changes`, { note: '  ' })).data.error, 'Conte o que precisa mudar.');
    const changes = (await rest.post(`/api/campaigns/${c.id}/request-changes`, { note: 'Trocar o cupom' })).data;
    assert.equal(changes.approval.status, 'changes');
    assert.equal(changes.approval.note, 'Trocar o cupom');
    assert.equal(changes.approval.decidedBy, 'Rita do Bistrô');
    const late = await rest.post(`/api/campaigns/${c.id}/approve`, {});
    assert.equal(late.status, 400);
    assert.equal(late.data.error, 'Esta campanha não está aguardando aprovação.');

    await ctx.agency.post(`/api/campaigns/${c.id}/request-approval`, {});
    const ok = (await rest.post(`/api/campaigns/${c.id}/approve`, { note: 'Pode mandar' })).data;
    assert.equal(ok.approval.status, 'approved');
    assert.equal(ok.approval.note, 'Pode mandar');
    assert.deepEqual(ok.approvalLog.map((l) => l.action), ['requested', 'changes', 'requested', 'approved']);

    assert.equal((await ctx.agency.put(`/api/campaigns/${c.id}`, { name: 'Só o nome mudou', notes: 'interno' })).data.approval.status, 'approved');
    const reset = (await ctx.agency.put(`/api/campaigns/${c.id}`, { message: 'Texto novo' })).data;
    assert.equal(reset.approval, null);
    assert.equal(reset.approvalLog.at(-1).action, 'reset');
    assert.equal(reset.approvalLog.at(-1).note, 'Conteúdo alterado pela agência');
  });

  it('restaurante não vê campanha de outro restaurante', async () => {
    const foreign = (await ctx.agency.post('/api/campaigns', { restaurantId: other.id, name: 'Alheia', message: 'x' })).data;
    await ctx.agency.post(`/api/campaigns/${foreign.id}/request-approval`, {});
    const res = await rest.get(`/api/campaigns/${foreign.id}`);
    assert.equal(res.status, 404);
    assert.equal(res.data.error, 'Campanha não encontrada');
    assert.equal((await rest.post(`/api/campaigns/${foreign.id}/approve`, {})).status, 404);
  });

  it('não dispara nem agenda sem aprovação', async () => {
    const c = await create({ name: 'Sem aprovação', message: 'Oi' });
    for (const action of ['start', 'schedule']) {
      const res = await ctx.agency.post(`/api/campaigns/${c.id}/${action}`, { scheduledAt: new Date(Date.now() + 3600e3).toISOString() });
      assert.equal(res.status, 400);
      assert.equal(res.data.error, 'Esta campanha precisa ser aprovada pelo restaurante antes do envio.');
    }
  });

  it('agenda, desagenda e volta a rascunho quando o conteúdo muda', async () => {
    const c = await create({ name: 'Agendada', message: 'Oi' });
    await approve(c.id);
    assert.equal((await ctx.agency.post(`/api/campaigns/${c.id}/schedule`, { scheduledAt: '2020-01-01T10:00:00.000Z' })).data.error, 'Escolha uma data futura.');
    const when = new Date(Date.now() + 2 * 3600e3).toISOString();
    const scheduled = (await ctx.agency.post(`/api/campaigns/${c.id}/schedule`, { scheduledAt: when })).data;
    assert.equal(scheduled.status, 'scheduled');
    assert.equal(scheduled.scheduledAt, when);
    const canceled = (await ctx.agency.post(`/api/campaigns/${c.id}/cancel`, {})).data;
    assert.equal(canceled.status, 'draft');
    assert.equal(canceled.scheduledAt, null);

    await ctx.agency.post(`/api/campaigns/${c.id}/schedule`, { scheduledAt: when });
    const edited = (await ctx.agency.put(`/api/campaigns/${c.id}`, { coupon: 'NOVO' })).data;
    assert.equal(edited.status, 'draft');
    assert.equal(edited.scheduledAt, null);
    assert.equal(edited.approval, null);
  });

  it('pausa, retoma e cancela uma campanha em andamento', async () => {
    await ctx.agency.post('/api/messaging/stop', {});
    const c = await create({ name: 'Andamento', message: 'Oi {{primeiro_nome}}' });
    await approve(c.id);
    const started = (await ctx.agency.post(`/api/campaigns/${c.id}/start`, {})).data;
    assert.equal(started.status, 'sending');
    assert.equal(started.audienceSize, 3);
    assert.equal(started.provider, 'simulator');
    await waitFor(async () => (await ctx.agency.get(`/api/campaigns/${c.id}`)).data.waitingReason === 'Aguardando conexão com o WhatsApp', { message: 'aviso de espera' });

    assert.equal((await ctx.agency.post(`/api/campaigns/${c.id}/start`, {})).data.error, 'Esta campanha já foi iniciada.');
    assert.equal((await ctx.agency.put(`/api/campaigns/${c.id}`, { name: 'x' })).data.error, 'Campanhas já disparadas não podem ser editadas. Duplique-a.');

    assert.equal((await ctx.agency.post(`/api/campaigns/${c.id}/pause`, {})).data.status, 'paused');
    assert.equal((await ctx.agency.post(`/api/campaigns/${c.id}/pause`, {})).data.error, 'Só é possível pausar campanhas em andamento.');
    assert.equal((await ctx.agency.del(`/api/campaigns/${c.id}`)).data.error, 'Cancele a campanha antes de excluí-la.');
    assert.equal((await ctx.agency.post(`/api/campaigns/${c.id}/resume`, {})).data.status, 'sending');
    assert.equal((await ctx.agency.post(`/api/campaigns/${c.id}/resume`, {})).data.error, 'A campanha não está pausada.');

    const canceled = (await ctx.agency.post(`/api/campaigns/${c.id}/cancel`, {})).data;
    assert.equal(canceled.status, 'canceled');
    assert.ok(canceled.completedAt);
    const messages = (await ctx.agency.get(`/api/campaigns/${c.id}/messages`)).data;
    assert.equal(messages.length, 3);
    assert.ok(messages.every((m) => m.status === 'skipped' && m.error === 'Campanha cancelada'));
    assert.equal((await ctx.agency.post(`/api/campaigns/${c.id}/cancel`, {})).data.error, 'A campanha já foi encerrada.');

    await ctx.agency.post('/api/messaging/start', {});
  });

  it('duplica sem levar a aprovação', async () => {
    const c = await create({ name: 'Original', message: 'Oi', segment: { tags: ['vip'] }, coupon: 'ORIG' });
    await approve(c.id);
    const copy = await ctx.agency.post(`/api/campaigns/${c.id}/duplicate`, {});
    assert.equal(copy.status, 201);
    assert.equal(copy.data.name, 'Original (cópia)');
    assert.equal(copy.data.status, 'draft');
    assert.equal(copy.data.coupon, 'ORIG');
    assert.deepEqual(copy.data.segment, { tags: ['vip'], match: 'any' });
    assert.ok(!copy.data.approval);
  });

  it('campanha inexistente', async () => {
    const id = '00000000-0000-4000-8000-000000000000';
    assert.equal((await ctx.agency.get(`/api/campaigns/${id}`)).status, 404);
    assert.equal((await ctx.agency.get('/api/campaigns/nao-existe')).status, 404);
    const put = await ctx.agency.put(`/api/campaigns/${id}`, { name: 'x' });
    assert.equal(put.status, 404);
    assert.equal(put.data.error, 'Campanha não encontrada');
    const start = await ctx.agency.post(`/api/campaigns/${id}/start`, {});
    assert.equal(start.status, 400);
    assert.equal(start.data.error, 'Campanha não encontrada.');
    assert.equal((await ctx.agency.post(`/api/campaigns/${id}/duplicate`, {})).data.error, 'Campanha não encontrada');
  });
});
```

- [ ] **Step 2: Disparo, link, pedidos e descadastro**

Crie `test/http/dispatch.test.js`:

```js
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, waitFor, phone } = require('../helpers/app');

describe('disparo, link rastreável, pedidos e descadastro', () => {
  let ctx;
  let r;
  let campaign;
  let messages;
  const contacts = [];
  const getCampaign = async () => (await ctx.agency.get(`/api/campaigns/${campaign.id}`)).data;
  const getMessages = async () => (await ctx.agency.get(`/api/campaigns/${campaign.id}/messages`)).data;
  const open = (code, ua) => fetch(`${ctx.baseUrl}/r/${code}`, { redirect: 'manual', headers: { 'User-Agent': ua } });

  before(async () => {
    ctx = await startApp();
    r = (await ctx.agency.post('/api/restaurants', { name: 'Cantina do Disparo', requireApproval: false, coupon: 'CASA5' })).data;
    for (const [i, name] of ['Marina Souza', 'Lucas Lima', 'Ana Costa'].entries()) {
      contacts.push((await ctx.agency.post('/api/contacts', { restaurantId: r.id, name, phone: phone(i + 1) })).data);
    }
    await ctx.agency.post('/api/contacts', { restaurantId: r.id, name: 'Sem Autorização', phone: phone(9), optIn: false });
  });
  after(async () => { await ctx.close(); });

  it('dispara pelo simulador até concluir', async () => {
    campaign = (await ctx.agency.post('/api/campaigns', { restaurantId: r.id, name: 'Promo Sexta', message: '{Oi|Olá}, {{primeiro_nome}}! Cupom {{cupom}}: {{link}}', coupon: 'SEXTA10' })).data;
    const started = await ctx.agency.post(`/api/campaigns/${campaign.id}/start`, {});
    assert.equal(started.status, 200, JSON.stringify(started.data));
    assert.equal(started.data.status, 'sending');
    assert.equal(started.data.audienceSize, 3);
    assert.ok(started.data.startedAt);

    const done = await waitFor(async () => { const c = await getCampaign(); return c.status === 'completed' && c; }, { message: 'campanha concluída' });
    assert.ok(done.completedAt);
    assert.equal(done.waitingReason, null);

    messages = await waitFor(async () => { const list = await getMessages(); return list.every((m) => m.status === 'delivered') && list; }, { message: 'entregas confirmadas' });
    assert.equal(messages.length, 3);
    for (const m of messages) {
      assert.match(m.code, /^[A-Za-z0-9]{6}$/);
      assert.equal(m.provider, 'simulator');
      assert.match(m.providerMessageId, /^sim_/);
      assert.ok(m.sentAt && m.deliveredAt);
      assert.equal(m.text, undefined);
      assert.ok(m.preview.includes(`${ctx.config.publicUrl}/r/${m.code}`), m.preview);
      assert.ok(m.preview.includes('SEXTA10'));
      assert.ok(m.preview.includes(m.name.split(' ')[0]), m.preview);
    }
    const { stats } = await getCampaign();
    assert.equal(stats.audience, 3);
    assert.equal(stats.sent, 3);
    assert.equal(stats.delivered, 3);
    assert.equal(stats.failed, 0);
    assert.equal(stats.queued, 0);
    assert.equal(stats.progress, 100);
    assert.equal(stats.deliveryRate, 100);

    const outbox = (await ctx.agency.get('/api/messaging/outbox')).data;
    assert.equal(outbox.length, 3);
    assert.ok(outbox.every((o) => o.text.endsWith('_Responda SAIR para não receber mais mensagens._')));
  });

  it('link rastreável conta cliques de pessoas e ignora robôs', async () => {
    const m = messages[0];
    const res = await open(m.code, 'Mozilla/5.0 (iPhone)');
    assert.equal(res.status, 302);
    const to = new URL(res.headers.get('location'));
    assert.equal(to.origin, ctx.config.publicUrl);
    assert.equal(to.pathname, `/demo/${r.slug}`);
    assert.equal(to.searchParams.get('sc_ref'), m.code);
    assert.equal(to.searchParams.get('utm_source'), 'whatsapp');
    assert.equal(to.searchParams.get('utm_medium'), 'studio_coral');
    assert.equal(to.searchParams.get('utm_campaign'), 'Promo Sexta');

    const first = (await getMessages()).find((x) => x.id === m.id);
    assert.equal(first.clicks, 1);
    assert.ok(first.clickedAt);
    await open(m.code, 'Mozilla/5.0 (Android)');
    await open(m.code, 'WhatsApp/2.24.1 A');
    await open(m.code, 'facebookexternalhit/1.1');
    const later = (await getMessages()).find((x) => x.id === m.id);
    assert.equal(later.clicks, 2);
    assert.equal(later.clickedAt, first.clickedAt);
    assert.ok(later.lastClickAt >= first.clickedAt);

    const unknown = await open('naoexiste', 'Mozilla/5.0');
    assert.equal(unknown.status, 302);
    assert.equal(unknown.headers.get('location'), '/');

    const { stats } = await getCampaign();
    assert.equal(stats.clicked, 1);
    assert.equal(stats.clicks, 2);
    assert.equal(stats.clickRate, 33.3);
  });

  it('registra pedido atribuído, ignora repetido e aceita venda direta', async () => {
    const pub = ctx.client();
    const m = messages[0];
    const created = await pub.post('/api/public/conversions', { ref: m.code, value: 59.9, orderId: 'PED-1', items: [{ name: 'Lasanha', qty: 1, price: 59.9 }] });
    assert.equal(created.status, 201);
    assert.equal(created.data.ok, true);
    assert.ok(created.data.id);
    const again = await pub.post('/api/public/conversions', { ref: m.code, value: 59.9, orderId: 'PED-1' });
    assert.equal(again.status, 200);
    assert.deepEqual(again.data, { ok: true, duplicated: true });

    assert.ok((await getMessages()).find((x) => x.id === m.id).convertedAt);
    const { stats } = await getCampaign();
    assert.equal(stats.orders, 1);
    assert.equal(stats.revenue, 59.9);
    assert.equal(stats.ticket, 59.9);
    assert.equal(stats.conversionRate, 100);

    assert.equal((await pub.post('/api/public/conversions', { restaurantSlug: r.slug, value: 30, orderId: 'PED-2', customerName: 'Balcão' })).status, 201);
    assert.equal((await getCampaign()).stats.orders, 1, 'venda direta não entra na campanha');
    const missing = await pub.post('/api/public/conversions', { restaurantSlug: 'nao-existe', value: 10 });
    assert.equal(missing.status, 404);
    assert.equal(missing.data.error, 'Referência ou restaurante não encontrado.');
  });

  it('dados públicos do link e do restaurante', async () => {
    const pub = ctx.client();
    const m = messages[0];
    assert.deepEqual((await pub.get(`/api/public/ref/${m.code}`)).data, { firstName: m.name.split(' ')[0], campaign: 'Promo Sexta', coupon: 'SEXTA10' });
    assert.equal((await pub.get('/api/public/ref/naoexiste')).status, 404);
    const site = (await pub.get(`/api/public/restaurants/${r.slug}`)).data;
    assert.equal(site.name, 'Cantina do Disparo');
    assert.equal(site.coupon, 'CASA5');
    assert.deepEqual(site.banners, []);
    assert.equal(site.logoUrl, null);
    assert.equal(site.goals, undefined);
    assert.equal((await pub.get('/api/public/restaurants/nao-existe')).status, 404);
  });

  it('resposta SAIR descadastra, avisa o cliente e marca a mensagem', async () => {
    const target = contacts[1];
    assert.deepEqual((await ctx.agency.post('/api/messaging/simulate-reply', { from: target.phone, body: ' Sair ' })).data, { ok: true });
    await waitFor(async () => (await ctx.agency.get(`/api/contacts?restaurantId=${r.id}&status=optedOut`)).data.some((c) => c.id === target.id), { message: 'descadastro' });
    const msg = await waitFor(async () => (await getMessages()).find((x) => x.contactId === target.id && x.repliedAt), { message: 'resposta registrada' });
    assert.equal(msg.reply, ' Sair ');
    assert.equal(msg.optOut, true);
    const outbox = (await ctx.agency.get('/api/messaging/outbox')).data;
    assert.equal(outbox[0].to, target.phone);
    assert.equal(outbox[0].text, 'Pronto, você não vai mais receber nossas mensagens promocionais.');
    const { stats } = await getCampaign();
    assert.equal(stats.replied, 1);
    assert.equal(stats.optOuts, 1);
  });

  it('envio de teste vai para o número informado', async () => {
    const missing = await ctx.agency.post(`/api/campaigns/${campaign.id}/test`, {});
    assert.equal(missing.status, 400);
    assert.equal(missing.data.error, 'Informe o número para teste.');
    const res = await ctx.agency.post(`/api/campaigns/${campaign.id}/test`, { phone: '(31) 97777-0000' });
    assert.equal(res.status, 200);
    assert.equal(res.data.ok, true);
    assert.equal(res.data.to, '5531977770000');
    const [last] = (await ctx.agency.get('/api/messaging/outbox')).data;
    assert.ok(last.text.startsWith('🧪 *TESTE*'));
    assert.ok(last.text.includes('utm_medium=teste'));
  });
});
```

- [ ] **Step 3: Painel, relatório mensal e configurações**

Crie `test/http/reports.test.js`:

```js
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, waitFor, phone } = require('../helpers/app');

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

describe('painel, relatório mensal e configurações', () => {
  let ctx;
  let a;
  let b;
  let rest;
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  before(async () => {
    ctx = await startApp();
    a = (await ctx.agency.post('/api/restaurants', { name: 'Restaurante A', requireApproval: false })).data;
    b = (await ctx.agency.post('/api/restaurants', { name: 'Restaurante B' })).data;
    await ctx.agency.post('/api/contacts', { restaurantId: a.id, name: 'Paula Reis', phone: phone(1) });
    await ctx.agency.post('/api/contacts', { restaurantId: a.id, name: 'Rui Alves', phone: phone(2) });
    await ctx.agency.post('/api/contacts', { restaurantId: b.id, name: 'Bia Neves', phone: phone(3) });
    const campaign = (await ctx.agency.post('/api/campaigns', { restaurantId: a.id, name: 'Campanha do Mês', message: 'Oi {{primeiro_nome}} {{link}}' })).data;
    await ctx.agency.post(`/api/campaigns/${campaign.id}/start`, {});
    await waitFor(async () => (await ctx.agency.get(`/api/campaigns/${campaign.id}`)).data.status === 'completed', { message: 'campanha concluída' });
    const [m] = (await ctx.agency.get(`/api/campaigns/${campaign.id}/messages`)).data;
    await fetch(`${ctx.baseUrl}/r/${m.code}`, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0' } });
    const pub = ctx.client();
    await pub.post('/api/public/conversions', { ref: m.code, value: 100, orderId: 'A-1', items: [{ name: 'Pizza', qty: 2, price: 40 }, { name: 'Suco', qty: 1, price: 20 }] });
    await pub.post('/api/public/conversions', { restaurantSlug: a.slug, value: 50, orderId: 'A-2' });
    await ctx.agency.post(`/api/restaurants/${a.id}/users`, { name: 'Dono A', email: 'dono@a.com.br', password: 'senha-dono-123' });
    rest = ctx.client();
    await rest.login('dono@a.com.br', 'senha-dono-123');
  });
  after(async () => { await ctx.close(); });

  it('painel do restaurante na visão da agência', async () => {
    const d = (await ctx.agency.get(`/api/dashboard?restaurantId=${a.id}`)).data;
    assert.equal(d.totals.audience, 2);
    assert.equal(d.totals.sent, 2);
    assert.equal(d.totals.clicked, 1);
    assert.equal(d.totals.orders, 1);
    assert.equal(d.totals.revenue, 100);
    assert.equal(d.series.length, 14);
    const today = d.series.at(-1);
    assert.equal(today.day, new Date().toLocaleDateString('sv-SE'));
    assert.equal(today.sent, 2);
    assert.equal(today.clicks, 1);
    assert.equal(today.orders, 1);
    assert.equal(today.revenue, 100);
    assert.deepEqual(d.campaigns.map((c) => c.name), ['Campanha do Mês']);
    assert.equal(d.campaigns[0].restaurant, 'Restaurante A');
    assert.equal(d.campaigns[0].stats.orders, 1);
    assert.equal(d.recentOrders.length, 1);
    assert.equal(d.recentOrders[0].campaign, 'Campanha do Mês');
    assert.equal(d.recentOrders[0].restaurant, 'Restaurante A');
    assert.deepEqual(d.contacts, { total: 2, authorized: 2, optedOut: 0 });
    assert.deepEqual(d.counts, { restaurants: 1, campaigns: 1, active: 0 });
  });

  it('painel geral soma todos os restaurantes', async () => {
    const d = (await ctx.agency.get('/api/dashboard')).data;
    assert.equal(d.counts.restaurants, 2);
    assert.equal(d.contacts.total, 3);
    assert.equal(d.totals.orders, 1);
  });

  it('restaurante só enxerga o próprio painel', async () => {
    const d = (await rest.get(`/api/dashboard?restaurantId=${b.id}`)).data;
    assert.equal(d.contacts.total, 2);
    assert.equal(d.totals.orders, 1);
  });

  it('relatório mensal com totais, dias, campanhas e itens', async () => {
    const rep = (await ctx.agency.get(`/api/reports/monthly?restaurantId=${a.id}&month=${month}`)).data;
    assert.equal(rep.month, month);
    assert.equal(rep.monthLabel, `${MONTHS[now.getMonth()]} de ${now.getFullYear()}`);
    assert.equal(rep.restaurant.name, 'Restaurante A');
    assert.equal(rep.totals.sent, 2);
    assert.equal(rep.totals.orders, 1);
    assert.equal(rep.totals.revenue, 100);
    assert.equal(rep.daily.length, new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate());
    assert.deepEqual(rep.daily[now.getDate() - 1], { day: now.getDate(), sent: 2, clicks: 1, orders: 1, revenue: 100 });
    assert.deepEqual(rep.campaigns.map((c) => c.name), ['Campanha do Mês']);
    assert.deepEqual(rep.best, { name: 'Campanha do Mês', revenue: 100, orders: 1 });
    assert.equal(rep.bestWeekday.name, WEEKDAYS[now.getDay()]);
    assert.equal(rep.bestWeekday.orders, 1);
    assert.deepEqual(rep.topItems, [{ name: 'Pizza', qty: 2, revenue: 80 }, { name: 'Suco', qty: 1, revenue: 20 }]);
    assert.deepEqual(rep.base, { authorized: 2, newThisMonth: 2, optOutsThisMonth: 0 });
    assert.equal(rep.previous.orders, 0);
    assert.equal(rep.change.orders, null);
  });

  it('meses disponíveis e validações do relatório', async () => {
    assert.equal((await ctx.agency.get(`/api/reports/months?restaurantId=${a.id}`)).data[0], month);
    const bad = await ctx.agency.get(`/api/reports/monthly?restaurantId=${a.id}&month=2026-13`);
    assert.equal(bad.status, 400);
    assert.equal(bad.data.error, 'Mês inválido. Use o formato AAAA-MM.');
    assert.equal((await ctx.agency.get('/api/reports/monthly')).data.error, 'Escolha o restaurante.');
    assert.equal((await rest.get(`/api/reports/monthly?month=${month}`)).data.restaurant.name, 'Restaurante A');
  });

  it('mensageria informa o provedor ativo', async () => {
    const s = (await ctx.agency.get('/api/messaging/status')).data;
    assert.equal(s.state, 'connected');
    assert.deepEqual(s.providers.map((p) => [p.key, p.active]), [['simulator', true]]);
  });

  it('configurações: leitura, limites e visão do restaurante', async () => {
    const s = (await ctx.agency.get('/api/settings')).data;
    assert.equal(s.dailyLimit, 800);
    assert.equal(s.footer, 'Responda SAIR para não receber mais mensagens.');
    const upd = (await ctx.agency.put('/api/settings', { minDelaySeconds: 3, maxDelaySeconds: 2, dailyLimit: 0, footer: 'Rodapé novo', optOutKeywords: 'Sair, PARE', businessHours: { start: '10:00' } })).data;
    assert.equal(upd.minDelaySeconds, 3);
    assert.equal(upd.maxDelaySeconds, 3);
    assert.equal(upd.dailyLimit, 1);
    assert.equal(upd.footer, 'Rodapé novo');
    assert.deepEqual(upd.optOutKeywords, ['sair', 'pare']);
    assert.deepEqual(upd.businessHours, { start: '10:00', end: '21:00' });
    assert.equal((await ctx.agency.get('/api/settings')).data.footer, 'Rodapé novo');
    assert.deepEqual((await rest.get('/api/settings')).data, { footer: 'Rodapé novo' });
  });
});
```

- [ ] **Step 4: Exclusões em cascata**

Crie `test/http/cascade.test.js`:

```js
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, waitFor, phone } = require('../helpers/app');

describe('exclusões em cascata', () => {
  let ctx;
  before(async () => { ctx = await startApp(); });
  after(async () => { await ctx.close(); });

  const location = async (code) => (await fetch(`${ctx.baseUrl}/r/${code}`, { redirect: 'manual' })).headers.get('location');

  async function completedCampaign(restaurant, i) {
    await ctx.agency.post('/api/contacts', { restaurantId: restaurant.id, name: `Cliente ${i}`, phone: phone(i) });
    const c = (await ctx.agency.post('/api/campaigns', { restaurantId: restaurant.id, name: `Campanha ${i}`, message: 'Oi {{link}}' })).data;
    await ctx.agency.post(`/api/campaigns/${c.id}/start`, {});
    await waitFor(async () => (await ctx.agency.get(`/api/campaigns/${c.id}`)).data.status === 'completed', { message: 'campanha concluída' });
    const [m] = (await ctx.agency.get(`/api/campaigns/${c.id}/messages`)).data;
    await ctx.client().post('/api/public/conversions', { ref: m.code, value: 42, orderId: `PED-${i}` });
    return { campaign: c, message: m };
  }

  it('excluir campanha apaga as mensagens e os pedidos dela', async () => {
    const r = (await ctx.agency.post('/api/restaurants', { name: 'Casa Um', requireApproval: false })).data;
    const { campaign, message } = await completedCampaign(r, 1);
    assert.equal((await ctx.agency.get(`/api/dashboard?restaurantId=${r.id}`)).data.totals.orders, 1);
    assert.deepEqual((await ctx.agency.del(`/api/campaigns/${campaign.id}`)).data, { ok: true });
    assert.equal((await ctx.agency.get(`/api/campaigns/${campaign.id}`)).status, 404);
    assert.equal(await location(message.code), '/');
    const d = (await ctx.agency.get(`/api/dashboard?restaurantId=${r.id}`)).data;
    assert.equal(d.totals.orders, 0);
    assert.equal(d.totals.audience, 0);
    // o número do pedido volta a ser aceito, porque o pedido anterior foi apagado junto
    assert.equal((await ctx.client().post('/api/public/conversions', { restaurantSlug: r.slug, value: 42, orderId: 'PED-1' })).status, 201);
  });

  it('não exclui restaurante com campanha em andamento', async () => {
    const r = (await ctx.agency.post('/api/restaurants', { name: 'Casa Dois', requireApproval: false })).data;
    await ctx.agency.post('/api/contacts', { restaurantId: r.id, name: 'Cliente 20', phone: phone(20) });
    await ctx.agency.post('/api/messaging/stop', {});
    const c = (await ctx.agency.post('/api/campaigns', { restaurantId: r.id, name: 'Travada', message: 'Oi' })).data;
    await ctx.agency.post(`/api/campaigns/${c.id}/start`, {});
    const blocked = await ctx.agency.del(`/api/restaurants/${r.id}`);
    assert.equal(blocked.status, 400);
    assert.equal(blocked.data.error, 'Há campanhas em andamento para este restaurante.');
    await ctx.agency.post(`/api/campaigns/${c.id}/cancel`, {});
    assert.deepEqual((await ctx.agency.del(`/api/restaurants/${r.id}`)).data, { ok: true });
    await ctx.agency.post('/api/messaging/start', {});
    await waitFor(async () => (await ctx.agency.get('/api/messaging/status')).data.state === 'connected', { message: 'reconectar' });
  });

  it('excluir restaurante apaga contatos, campanhas, pedidos e acessos', async () => {
    const r = (await ctx.agency.post('/api/restaurants', { name: 'Casa Três', requireApproval: false })).data;
    const { message } = await completedCampaign(r, 30);
    await ctx.agency.post(`/api/restaurants/${r.id}/users`, { email: 'dono@casatres.com.br', password: 'senha-dono-123' });
    const owner = ctx.client();
    await owner.login('dono@casatres.com.br', 'senha-dono-123');

    assert.deepEqual((await ctx.agency.del(`/api/restaurants/${r.id}`)).data, { ok: true });
    assert.equal((await ctx.agency.get(`/api/restaurants/${r.id}`)).status, 404);
    assert.deepEqual((await ctx.agency.get(`/api/contacts?restaurantId=${r.id}`)).data, []);
    assert.deepEqual((await ctx.agency.get(`/api/campaigns?restaurantId=${r.id}`)).data, []);
    assert.equal((await ctx.agency.get(`/api/dashboard?restaurantId=${r.id}`)).data.totals.audience, 0);
    assert.equal(await location(message.code), '/');
    assert.equal((await owner.get('/api/auth/me')).status, 401);
    assert.equal((await ctx.client().login('dono@casatres.com.br', 'senha-dono-123')).status, 401);
  });
});
```

- [ ] **Step 5: Dados de demonstração**

Crie `test/http/seed.test.js`:

```js
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('../helpers/app');

describe('dados de demonstração', () => {
  let ctx;
  before(async () => { ctx = await startApp({ seed: true }); });
  after(async () => { await ctx.close(); });

  it('a primeira execução cria os dois restaurantes de exemplo', async () => {
    const list = (await ctx.agency.get('/api/restaurants')).data;
    assert.deepEqual(list.map((r) => r.name), ['Cantina Bella Nonna', 'Sabor de Minas']);
    assert.deepEqual(list.map((r) => r.contactsCount), [48, 34]);
    assert.deepEqual(list.map((r) => r.campaignsCount), [4, 3]);
    assert.ok(list.every((r) => r.demo === true && r.menu.length > 0 && r.banners.length === 2));
  });

  it('os acessos de demonstração funcionam', async () => {
    const giulia = ctx.client();
    const login = await giulia.login('giulia@bellanonna.com.br', 'bellanonna');
    assert.equal(login.status, 200);
    assert.equal(login.data.user.restaurant, 'Cantina Bella Nonna');
    const campaigns = (await giulia.get('/api/campaigns')).data;
    assert.equal(campaigns.find((c) => c.name === 'Clientes VIP · Menu Degustação').approval.status, 'pending');
    assert.equal(campaigns.filter((c) => c.status === 'completed').length, 3);
  });

  it('o histórico de campanhas aparece no painel', async () => {
    const [nonna] = (await ctx.agency.get('/api/restaurants')).data;
    const d = (await ctx.agency.get(`/api/dashboard?restaurantId=${nonna.id}`)).data;
    assert.ok(d.totals.sent > 100);
    assert.ok(d.totals.orders > 0);
    assert.equal(d.campaigns.length, 3);
  });
});
```

- [ ] **Step 6: Rode a bateria inteira contra o JSON**

Run: `npm test`
Expected: 8 arquivos, `# fail 0`. Rode 3 vezes seguidas para garantir que nenhum teste depende de sorte. Se algum oscilar, aumente o `timeout` do `waitFor` naquele ponto e explique no commit.

- [ ] **Step 7: Commit**

```bash
git add test/http
git commit -m "Testes de caracterização: campanhas, disparo, relatórios, exclusões e seed

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Adaptador `Database` (pg e PGlite)

**Files:**
- Create: `src/db/Database.js`, `test/helpers/pg-server.js`
- Modify: `src/config.js`, `package.json`
- Test: `test/db/database.test.js`

**Interfaces:**
- Produces:
  - `Database.open({ databaseUrl, pgliteDir, databasePoolMax }) → Promise<Database>`;
  - instância com `query(sql, params) → { rows, rowCount?, affectedRows? }`, `many()`, `one()` (linha ou `null`), `exec(sql)`, `tx(fn)` (fn recebe um `Database` ligado à transação), `close()` e `kind` (`'pg'` | `'pglite'`);
  - `config.databaseUrl`, `config.databasePoolMax`, `config.pgliteDir`; `config.dataDir` aceita `DATA_DIR`;
  - nos testes: `startPgServer() → { url, close() }`.

- [ ] **Step 1: Dependências**

Run:

```bash
npm install pg@8.23.1 @electric-sql/pglite@0.5.8 --save-exact
npm install @electric-sql/pglite-socket@0.2.11 --save-dev --save-exact
```

Expected: `package.json` com `pg` e `@electric-sql/pglite` em `dependencies`, e `@electric-sql/pglite-socket` em `devDependencies`. O npm também instala as extensões do PGlite que o `pglite-socket` declara como peer. Isso é esperado.

- [ ] **Step 2: Configuração do banco**

Em `src/config.js`, troque a definição de `port` e o começo do objeto exportado:

```js
const port = Number(env('PORT', 3000));
const dataDir = path.resolve(env('DATA_DIR', path.join(__dirname, '..', 'data')));

module.exports = {
  port,
  publicUrl: env('PUBLIC_URL', `http://localhost:${port}`).replace(/\/$/, ''),
  dataDir,

  // Banco de dados: com DATABASE_URL usa o PostgreSQL informado; sem ela, o
  // PGlite (PostgreSQL embutido) guarda tudo em data/pgdata.
  databaseUrl: env('DATABASE_URL', ''),
  databasePoolMax: Number(env('DATABASE_POOL_MAX', 10)),
  pgliteDir: path.join(dataDir, 'pgdata'),
```

E dentro de `messaging.wppconnect`:

```js
      tokensDir: path.join(dataDir, 'wpp-tokens'),
```

- [ ] **Step 3: Servidor PostgreSQL de teste**

Crie `test/helpers/pg-server.js`:

```js
const { PGlite } = require('@electric-sql/pglite');
const { PGLiteSocketServer } = require('@electric-sql/pglite-socket');

/** PostgreSQL de verdade (PGlite) numa porta local, para testar o driver `pg` sem instalar nada. */
async function startPgServer() {
  const lite = await PGlite.create();
  const server = new PGLiteSocketServer({ db: lite, port: 0, host: '127.0.0.1' });
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
```

- [ ] **Step 4: Escreva o teste do adaptador**

Crie `test/db/database.test.js`:

```js
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { Database } = require('../../src/db/Database');
const { startPgServer } = require('../helpers/pg-server');

function databaseSuite(name, open) {
  describe(name, () => {
    let db;
    let cleanup;
    before(async () => {
      ({ db, cleanup } = await open());
      await db.exec('CREATE TABLE t (id int PRIMARY KEY, v text, n numeric(12,2), at timestamptz DEFAULT now())');
    });
    after(async () => {
      await db.close();
      await cleanup?.();
    });

    it('query, many e one', async () => {
      await db.query('INSERT INTO t (id, v) VALUES ($1, $2), ($3, $4)', [1, 'a', 2, 'b']);
      assert.deepEqual((await db.many('SELECT v FROM t ORDER BY id')).map((r) => r.v), ['a', 'b']);
      assert.equal((await db.one('SELECT v FROM t WHERE id = $1', [2])).v, 'b');
      assert.equal(await db.one('SELECT v FROM t WHERE id = $1', [99]), null);
    });

    it('transação confirma ao terminar e desfaz em erro', async () => {
      await db.tx(async (t) => { await t.query('INSERT INTO t (id, v) VALUES (3, $1)', ['c']); });
      await assert.rejects(db.tx(async (t) => {
        await t.query('INSERT INTO t (id, v) VALUES (4, $1)', ['d']);
        throw new Error('falhou');
      }), /falhou/);
      assert.deepEqual((await db.many('SELECT id FROM t ORDER BY id')).map((r) => r.id), [1, 2, 3]);
    });

    it('transação aninhada reaproveita a atual', async () => {
      await assert.rejects(db.tx(async (t) => {
        await t.tx(async (inner) => { await inner.query('INSERT INTO t (id, v) VALUES (5, $1)', ['e']); });
        throw new Error('desfaz tudo');
      }), /desfaz tudo/);
      assert.equal(await db.one('SELECT id FROM t WHERE id = 5'), null);
    });

    it('exec roda vários comandos, inclusive numa transação', async () => {
      await db.exec('CREATE TABLE u (x int); INSERT INTO u VALUES (1); INSERT INTO u VALUES (2);');
      await db.tx((t) => t.exec('INSERT INTO u VALUES (3); INSERT INTO u VALUES (4);'));
      assert.equal((await db.one('SELECT count(*)::int AS n FROM u')).n, 4);
    });

    it('erro mantém o código do PostgreSQL', async () => {
      await assert.rejects(db.query('INSERT INTO t (id, v) VALUES (1, $1)', ['x']), (err) => err.code === '23505');
    });

    it('tipos: timestamptz vira Date e numeric vira texto (o mapeamento converte)', async () => {
      const row = await db.one("INSERT INTO t (id, v, n) VALUES (10, 'x', 12.5) RETURNING *");
      assert.ok(row.at instanceof Date);
      assert.equal(Number(row.n), 12.5);
    });
  });
}

databaseSuite('Database com PGlite em memória', async () => ({ db: await Database.open({ pgliteDir: 'memory://' }) }));

databaseSuite('Database com o driver pg', async () => {
  const pg = await startPgServer();
  const db = await Database.open({ databaseUrl: pg.url, databasePoolMax: 1 });
  assert.equal(db.kind, 'pg');
  return { db, cleanup: () => pg.close() };
});

describe('Database.open', () => {
  it('avisa com clareza quando o PostgreSQL não responde, sem mostrar a senha', async () => {
    await assert.rejects(Database.open({ databaseUrl: 'postgres://usuario:segredo@127.0.0.1:1/nada', databasePoolMax: 1 }), (err) => {
      assert.match(err.message, /Não foi possível conectar ao PostgreSQL \(postgres:\/\/usuario:\*\*\*@127\.0\.0\.1:1\/nada\)/);
      assert.ok(!err.message.includes('segredo'));
      return true;
    });
  });

  it('PGlite em pasta: grava em disco e recusa outro processo na mesma pasta', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coral-pglite-'));
    const pgdata = path.join(dir, 'pgdata');
    try {
      let db = await Database.open({ pgliteDir: pgdata });
      assert.equal(db.kind, 'pglite');
      await db.exec("CREATE TABLE k (v text); INSERT INTO k VALUES ('persistiu');");
      await db.close();
      assert.equal(fs.existsSync(`${pgdata}.lock`), false, 'a trava sai ao fechar');

      // trava de um processo vivo: recusa
      const other = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)']);
      try {
        fs.writeFileSync(`${pgdata}.lock`, String(other.pid));
        await assert.rejects(Database.open({ pgliteDir: pgdata }), /já está aberto por outro processo/);
      } finally {
        other.kill();
      }

      // trava de um processo que já morreu: ignora
      fs.writeFileSync(`${pgdata}.lock`, '999999');
      db = await Database.open({ pgliteDir: pgdata });
      assert.deepEqual(await db.many('SELECT v FROM k'), [{ v: 'persistiu' }]);
      await db.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 5: Rode e veja falhar**

Run: `node --test test/db/database.test.js`
Expected: FAIL com `Cannot find module '../../src/db/Database'`.

- [ ] **Step 6: Implemente o adaptador**

Crie `src/db/Database.js`:

```js
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

  /** Abre o banco conforme a configuração: DATABASE_URL ou PGlite. */
  static async open({ databaseUrl = '', pgliteDir = 'memory://', databasePoolMax = 10 } = {}) {
    if (databaseUrl) return new Database(await PgDriver.connect(databaseUrl, databasePoolMax));
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

  close() {
    return this.driver.close();
  }
}

const maskUrl = (url) => url.replace(/\/\/([^:/@]+):([^@]*)@/, '//$1:***@');

class PgDriver {
  static async connect(url, max) {
    // eslint-disable-next-line global-require
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: url, max });
    try {
      await pool.query('SELECT 1');
    } catch (err) {
      await pool.end().catch(() => {});
      throw new Error(`Não foi possível conectar ao PostgreSQL (${maskUrl(url)}): ${err.message}`);
    }
    return new PgDriver(pool);
  }

  constructor(pool) {
    this.pool = pool;
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
    try {
      await client.query('BEGIN');
      const result = await fn(new PgTxDriver(client));
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
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
    await this.lite.close();
    this.release();
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
      throw new Error(`O banco local (${dir}) já está aberto por outro processo (pid ${pid}). Pare o servidor antes de rodar este comando.`);
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
```

- [ ] **Step 7: Rode e veja passar**

Run: `node --test test/db/database.test.js`
Expected: PASS (13 testes). O teste com pasta em disco leva alguns segundos, por causa da criação inicial do banco.

- [ ] **Step 8: A bateria HTTP continua verde**

Run: `npm test`
Expected: `# fail 0`. O app ainda usa o JSON; a camada nova só foi acrescentada.

- [ ] **Step 9: Commit**

```bash
git add src/db/Database.js src/config.js package.json package-lock.json test/helpers/pg-server.js test/db/database.test.js
git commit -m "Adaptador de banco: PostgreSQL (pg) em produção, PGlite no desenvolvimento

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Migrações e esquema inicial

**Files:**
- Create: `src/db/migrate.js`, `migrations/001_esquema_inicial.sql`
- Test: `test/db/migrate.test.js`

**Interfaces:**
- Consumes: `Database` (Task 3).
- Produces:
  - `migrate(db, { dir, logger }) → Promise<string[]>`, as versões aplicadas nesta chamada;
  - as tabelas `restaurants`, `users`, `contacts`, `campaigns`, `messages`, `conversions`, `settings` e `schema_migrations`;
  - os nomes de restrição usados adiante: `restaurants_slug_key`, `users_email_key`, `contacts_restaurant_phone`, `messages_code_key` e o índice parcial `conversions_restaurant_order`.

- [ ] **Step 1: Escreva o teste**

Crie `test/db/migrate.test.js`:

```js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Database } = require('../../src/db/Database');
const { migrate } = require('../../src/db/migrate');

describe('migrações', () => {
  it('cria o esquema inicial uma vez só', async () => {
    const db = await Database.open({ pgliteDir: 'memory://' });
    try {
      assert.deepEqual(await migrate(db), ['001_esquema_inicial']);
      assert.deepEqual(await migrate(db), []);
      const tables = (await db.many("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name")).map((t) => t.table_name);
      assert.deepEqual(tables, ['campaigns', 'contacts', 'conversions', 'messages', 'restaurants', 'schema_migrations', 'settings', 'users']);
      assert.deepEqual(await db.one('SELECT id, data FROM settings'), { id: 1, data: {} });
    } finally {
      await db.close();
    }
  });

  it('migração com erro não deixa nada pela metade', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coral-mig-'));
    fs.writeFileSync(path.join(dir, '001_ok.sql'), 'CREATE TABLE a (x int);');
    fs.writeFileSync(path.join(dir, '002_ruim.sql'), 'CREATE TABLE b (x int); SELECT * FROM tabela_que_nao_existe;');
    fs.writeFileSync(path.join(dir, 'leia-me.txt'), 'ignorado');
    const db = await Database.open({ pgliteDir: 'memory://' });
    try {
      await assert.rejects(migrate(db, { dir }), /tabela_que_nao_existe/);
      assert.deepEqual((await db.many('SELECT version FROM schema_migrations')).map((r) => r.version), ['001_ok']);
      assert.equal((await db.one("SELECT to_regclass('public.b') AS t")).t, null);
    } finally {
      await db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Rode e veja falhar**

Run: `node --test test/db/migrate.test.js`
Expected: FAIL com `Cannot find module '../../src/db/migrate'`.

- [ ] **Step 3: Implemente o executor de migrações**

Crie `src/db/migrate.js`:

```js
const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'migrations');

/**
 * Aplica, em ordem, os arquivos migrations/NNN_nome.sql que ainda não rodaram.
 * Cada arquivo roda numa transação e fica registrado em schema_migrations.
 */
async function migrate(db, { dir = MIGRATIONS_DIR, logger = null } = {}) {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const done = new Set((await db.many('SELECT version FROM schema_migrations')).map((r) => r.version));
  const files = fs.readdirSync(dir).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
  const applied = [];
  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    if (done.has(version)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    await db.tx(async (t) => {
      await t.exec(sql);
      await t.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
    });
    applied.push(version);
    logger?.log?.(`  ↳ migração aplicada: ${version}`);
  }
  return applied;
}

module.exports = { migrate, MIGRATIONS_DIR };
```

- [ ] **Step 4: Escreva o esquema**

Crie `migrations/001_esquema_inicial.sql`:

```sql
-- Etapa 1: o mesmo modelo do antigo data/db.json, agora em tabelas.
-- Os ids são os UUIDs que a aplicação já usa; datas em timestamptz.

CREATE TABLE restaurants (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  name text NOT NULL,
  slug text NOT NULL,
  segment text,
  city text,
  site_url text,
  phone text,
  audience text,
  products text,
  goals text,
  tone text,
  color text,
  coupon text,
  tagline text,
  instagram text,
  emoji text,
  address text,
  hours text,
  logo_url text,
  menu jsonb NOT NULL DEFAULT '[]',
  banners jsonb NOT NULL DEFAULT '[]',
  require_approval boolean NOT NULL DEFAULT true,
  demo boolean NOT NULL DEFAULT false,
  CONSTRAINT restaurants_slug_key UNIQUE (slug)
);

CREATE TABLE users (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  restaurant_id uuid NOT NULL REFERENCES restaurants (id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'restaurant',
  name text NOT NULL,
  email text NOT NULL,
  password_hash text NOT NULL,
  last_login_at timestamptz,
  CONSTRAINT users_email_key UNIQUE (email)
);
CREATE INDEX users_restaurant ON users (restaurant_id);

CREATE TABLE contacts (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  restaurant_id uuid NOT NULL REFERENCES restaurants (id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  phone text NOT NULL,
  phone_key text NOT NULL,
  tags text[] NOT NULL DEFAULT '{}',
  opt_in boolean NOT NULL DEFAULT false,
  opt_in_source text,
  opted_out boolean NOT NULL DEFAULT false,
  opted_out_at timestamptz,
  notes text NOT NULL DEFAULT '',
  demo boolean NOT NULL DEFAULT false,
  CONSTRAINT contacts_restaurant_phone UNIQUE (restaurant_id, phone)
);
CREATE INDEX contacts_tags ON contacts USING gin (tags);
CREATE INDEX contacts_phone_key ON contacts (phone_key);

CREATE TABLE campaigns (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  restaurant_id uuid NOT NULL REFERENCES restaurants (id) ON DELETE CASCADE,
  name text NOT NULL,
  objective text,
  occasion text,
  message text NOT NULL DEFAULT '',
  media_url text,
  destination_url text,
  coupon text,
  notes text,
  segment jsonb NOT NULL DEFAULT '{"tags": [], "match": "any"}',
  include_footer boolean NOT NULL DEFAULT true,
  cloud_template jsonb,
  status text NOT NULL DEFAULT 'draft',
  approval jsonb,
  approval_log jsonb NOT NULL DEFAULT '[]',
  provider text,
  audience_size integer,
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  waiting_reason text,
  last_error text,
  demo boolean NOT NULL DEFAULT false
);
CREATE INDEX campaigns_restaurant ON campaigns (restaurant_id, created_at);
CREATE INDEX campaigns_status ON campaigns (status);

CREATE TABLE messages (
  id uuid PRIMARY KEY,
  seq bigint GENERATED ALWAYS AS IDENTITY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  campaign_id uuid NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL REFERENCES restaurants (id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts (id) ON DELETE SET NULL,
  name text,
  phone text NOT NULL,
  phone_key text NOT NULL,
  demo boolean NOT NULL DEFAULT false,
  code text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  text text,
  error text,
  provider text,
  provider_message_id text,
  queued_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  clicked_at timestamptz,
  last_click_at timestamptz,
  replied_at timestamptz,
  converted_at timestamptz,
  clicks integer NOT NULL DEFAULT 0,
  reply text,
  opt_out boolean NOT NULL DEFAULT false,
  CONSTRAINT messages_code_key UNIQUE (code)
);
CREATE INDEX messages_queue ON messages (campaign_id, status, seq);
CREATE INDEX messages_provider_id ON messages (provider_message_id);
CREATE INDEX messages_sent_at ON messages (sent_at);
CREATE INDEX messages_phone_key ON messages (phone_key, sent_at);
CREATE INDEX messages_restaurant_sent ON messages (restaurant_id, sent_at);

CREATE TABLE conversions (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  restaurant_id uuid NOT NULL REFERENCES restaurants (id) ON DELETE CASCADE,
  -- Igual a hoje: excluir a campanha exclui os pedidos dela (muda na etapa 2)
  campaign_id uuid REFERENCES campaigns (id) ON DELETE CASCADE,
  message_id uuid REFERENCES messages (id) ON DELETE SET NULL,
  contact_id uuid REFERENCES contacts (id) ON DELETE SET NULL,
  code text,
  customer_name text,
  order_id text,
  value numeric(12, 2) NOT NULL DEFAULT 0,
  items jsonb NOT NULL DEFAULT '[]'
);
CREATE UNIQUE INDEX conversions_restaurant_order ON conversions (restaurant_id, order_id) WHERE order_id IS NOT NULL;
CREATE INDEX conversions_restaurant_created ON conversions (restaurant_id, created_at);
CREATE INDEX conversions_campaign ON conversions (campaign_id);

CREATE TABLE settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  data jsonb NOT NULL DEFAULT '{}'
);
INSERT INTO settings (id, data) VALUES (1, '{}');
```

- [ ] **Step 5: Rode e veja passar**

Run: `node --test test/db/migrate.test.js`
Expected: PASS (2 testes).

- [ ] **Step 6: Commit**

```bash
git add src/db/migrate.js migrations/001_esquema_inicial.sql test/db/migrate.test.js
git commit -m "Migrações versionadas e esquema inicial do PostgreSQL

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Mapeamento e repositório base

**Files:**
- Create: `src/db/mapper.js`, `src/db/repositories/base.js`
- Test: `test/db/repository.test.js`

**Interfaces:**
- Consumes: `Database` (Task 3).
- Produces:
  - `defineTable({ name, columns, json, numeric, hidden, unique }) → { name, unique, columns, fromRow(row), toColumns(data) → Map<coluna, valor> }`;
  - `isUuid(v)`, `scopeId(v)` e `NIL_UUID`;
  - `class Repository(db, table)` com:
    - `get(id)`, `all(order)`, `count()`;
    - `where(condition, params, order)`, `first(condition, params, order)`;
    - `create(data, { onConflict })`, `insertMany(list, { onConflict })`;
    - `update(target, patch)`, que copia o resultado em `target` quando recebe o objeto;
    - `remove(id) → boolean`, `write(fn)`;
    - os ganchos `beforeWrite(data)`, `map(row)` e `mapAll(rows)`.

- [ ] **Step 1: Escreva o teste**

Crie `test/db/repository.test.js`:

```js
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Database } = require('../../src/db/Database');
const { defineTable, isUuid, scopeId, NIL_UUID } = require('../../src/db/mapper');
const { Repository } = require('../../src/db/repositories/base');

const things = defineTable({
  name: 'things',
  columns: ['name', 'price', 'data', 'tags', 'active', 'label'],
  json: ['data'],
  numeric: ['price'],
  hidden: ['secret'],
  unique: { things_name: 'Esse nome já existe.' },
});

class ThingsRepo extends Repository {
  constructor(db) {
    super(db, things);
  }

  beforeWrite(data) {
    return data.name !== undefined ? { ...data, secret: data.name.toUpperCase() } : data;
  }
}

describe('mapeamento e repositório base', () => {
  let db;
  let repo;
  before(async () => {
    db = await Database.open({ pgliteDir: 'memory://' });
    await db.exec(`CREATE TABLE things (
      id uuid PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz,
      name text NOT NULL, price numeric(12,2), data jsonb, tags text[] NOT NULL DEFAULT '{}',
      active boolean NOT NULL DEFAULT true, label text NOT NULL DEFAULT 'padrão', secret text,
      CONSTRAINT things_name UNIQUE (name))`);
    repo = new ThingsRepo(db);
  });
  after(() => db.close());

  it('isUuid e scopeId', () => {
    assert.equal(isUuid('8e5ff564-1299-4909-9c35-f414fed26f24'), true);
    assert.equal(isUuid('nao-e-uuid'), false);
    assert.equal(isUuid(null), false);
    assert.equal(scopeId(''), null);
    assert.equal(scopeId(undefined), null);
    assert.equal(scopeId('xyz'), NIL_UUID);
    assert.equal(scopeId('8e5ff564-1299-4909-9c35-f414fed26f24'), '8e5ff564-1299-4909-9c35-f414fed26f24');
  });

  it('create devolve camelCase, datas ISO, números, JSON e padrões; esconde colunas internas', async () => {
    const t = await repo.create({ name: 'Pizza', price: 39.9, data: [{ a: 1 }], tags: ['x', 'y'] });
    assert.ok(isUuid(t.id));
    assert.match(t.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.equal(t.updatedAt, null);
    assert.equal(t.price, 39.9);
    assert.deepEqual(t.data, [{ a: 1 }]);
    assert.deepEqual(t.tags, ['x', 'y']);
    assert.equal(t.active, true);
    assert.equal(t.label, 'padrão');
    assert.equal(t.secret, undefined);
    assert.equal((await db.one('SELECT secret FROM things WHERE id = $1', [t.id])).secret, 'PIZZA');
  });

  it('mantém id e createdAt informados', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const t = await repo.create({ id, name: 'Antiga', createdAt: '2026-01-02T03:04:05.000Z' });
    assert.equal(t.id, id);
    assert.equal(t.createdAt, '2026-01-02T03:04:05.000Z');
  });

  it('recusa campo desconhecido', async () => {
    await assert.rejects(repo.create({ name: 'X', inventado: 1 }), /Campo desconhecido em things: inventado/);
  });

  it('insertMany usa DEFAULT nos campos ausentes e grava em lotes', async () => {
    const rows = await repo.insertMany([{ name: 'A1', label: 'com rótulo' }, { name: 'A2' }]);
    assert.deepEqual(rows.map((r) => r.label), ['com rótulo', 'padrão']);
    const many = Array.from({ length: 1201 }, (_, i) => ({ name: `lote-${i}`, price: i }));
    assert.equal((await repo.insertMany(many)).length, 1201);
    assert.equal((await db.one("SELECT count(*)::int AS n FROM things WHERE name LIKE 'lote-%'")).n, 1201);
  });

  it('insertMany com onConflict ignora os repetidos', async () => {
    const rows = await repo.insertMany([{ name: 'A1' }, { name: 'Nova' }], { onConflict: 'ON CONFLICT (name) DO NOTHING' });
    assert.deepEqual(rows.map((r) => r.name), ['Nova']);
    assert.equal(await repo.create({ name: 'Nova' }, { onConflict: 'ON CONFLICT (name) DO NOTHING' }), null);
  });

  it('update grava, marca updatedAt e copia no objeto recebido', async () => {
    const t = await repo.create({ name: 'Original', price: 10 });
    const updated = await repo.update(t, { name: 'Renomeado', data: { ok: true } });
    assert.equal(updated.name, 'Renomeado');
    assert.ok(updated.updatedAt);
    assert.equal(t.name, 'Renomeado');
    assert.deepEqual(t.data, { ok: true });
    assert.equal((await db.one('SELECT secret FROM things WHERE id = $1', [t.id])).secret, 'RENOMEADO');
    assert.equal((await repo.update(t.id, { price: 12.5 })).price, 12.5);
  });

  it('get, update e remove com id inexistente ou inválido', async () => {
    const missing = '22222222-2222-4222-8222-222222222222';
    assert.equal(await repo.get('nao-e-uuid'), null);
    assert.equal(await repo.get(missing), null);
    assert.equal(await repo.update('nao-e-uuid', { name: 'x' }), null);
    assert.equal(await repo.update(missing, { name: 'x' }), null);
    assert.equal(await repo.remove('nao-e-uuid'), false);
    const t = await repo.create({ name: 'Apagar' });
    assert.equal(await repo.remove(t.id), true);
    assert.equal(await repo.remove(t.id), false);
  });

  it('unicidade vira mensagem amigável com status 400', async () => {
    await assert.rejects(repo.create({ name: 'Pizza' }), (err) => err.message === 'Esse nome já existe.' && err.status === 400);
  });

  it('where, first, all e count', async () => {
    assert.deepEqual((await repo.where('name = ANY($1)', [['A1', 'A2']], 'name')).map((r) => r.name), ['A1', 'A2']);
    assert.equal((await repo.first('name LIKE $1', ['lote-%'], 'price DESC')).name, 'lote-1200');
    assert.equal(await repo.first('name = $1', ['nenhum']), null);
    assert.equal((await repo.all()).length, await repo.count());
  });
});
```

- [ ] **Step 2: Rode e veja falhar**

Run: `node --test test/db/repository.test.js`
Expected: FAIL com `Cannot find module '../../src/db/mapper'`.

- [ ] **Step 3: Implemente o mapeamento**

Crie `src/db/mapper.js`:

```js
const toSnake = (key) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const toCamel = (col) => col.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

const isUuid = (value) => typeof value === 'string' && UUID.test(value);

/**
 * Filtro opcional por id: vazio = sem filtro; texto que não é UUID vira o
 * UUID nulo, que não encontra nada (como o filtro do antigo JSON).
 */
const scopeId = (value) => (value ? (isUuid(value) ? value : NIL_UUID) : null);

/**
 * Descrição de uma tabela para os repositórios.
 *  • columns: campos expostos (camelCase), além de id, createdAt e updatedAt
 *  • json: campos jsonb (serializados na escrita; o `pg` transformaria arrays em arrays SQL)
 *  • numeric: campos numeric, que os drivers devolvem como texto
 *  • hidden: colunas internas, gravadas pelo repositório e nunca devolvidas
 *  • unique: nome da restrição de unicidade → mensagem amigável
 */
function defineTable({ name, columns, json = [], numeric = [], hidden = [], unique = {} }) {
  const exposed = ['id', 'createdAt', 'updatedAt', ...columns];
  const writable = new Set([...exposed, ...hidden]);
  const jsonSet = new Set(json);
  const numericSet = new Set(numeric);
  const hiddenSet = new Set(hidden);

  return {
    name,
    unique,
    columns: exposed,
    /** Linha do banco → objeto da aplicação. */
    fromRow(row) {
      if (!row) return null;
      const out = {};
      for (const [col, value] of Object.entries(row)) {
        const key = toCamel(col);
        if (hiddenSet.has(key)) continue;
        if (value instanceof Date) out[key] = value.toISOString();
        else if (numericSet.has(key) && value !== null) out[key] = Number(value);
        else out[key] = value;
      }
      return out;
    },
    /** Objeto da aplicação → colunas para gravar (campo desconhecido é erro de programação). */
    toColumns(data) {
      const map = new Map();
      for (const [key, value] of Object.entries(data)) {
        if (value === undefined) continue;
        if (!writable.has(key)) throw new Error(`Campo desconhecido em ${name}: ${key}`);
        map.set(toSnake(key), jsonSet.has(key) && value !== null ? JSON.stringify(value) : value);
      }
      return map;
    },
  };
}

module.exports = { defineTable, isUuid, scopeId, NIL_UUID, toSnake, toCamel };
```

- [ ] **Step 4: Implemente o repositório base**

Crie `src/db/repositories/base.js`:

```js
const crypto = require('crypto');
const { isUuid } = require('../mapper');

const CHUNK = 500; // linhas por INSERT (o PostgreSQL aceita até 65.535 parâmetros)

/**
 * Operações comuns a todos os repositórios; cada repositório acrescenta as
 * consultas próprias. Condições e ordenações recebidas como texto são de uso
 * interno (nunca vêm do usuário).
 */
class Repository {
  constructor(db, table) {
    this.db = db;
    this.table = table;
  }

  get name() {
    return this.table.name;
  }

  /** Gancho para calcular colunas derivadas antes de gravar (ex.: phone_key). */
  beforeWrite(data) {
    return data;
  }

  map(row) {
    return this.table.fromRow(row);
  }

  mapAll(rows) {
    return rows.map((row) => this.table.fromRow(row));
  }

  /** Executa uma escrita traduzindo violações de unicidade em mensagens amigáveis. */
  async write(fn) {
    try {
      return await fn();
    } catch (err) {
      const friendly = err.code === '23505' && this.table.unique[err.constraint];
      if (friendly) throw Object.assign(new Error(friendly), { status: 400, cause: err });
      throw err;
    }
  }

  async get(id) {
    if (!isUuid(id)) return null;
    return this.map(await this.db.one(`SELECT * FROM ${this.name} WHERE id = $1`, [id]));
  }

  async all(order = 'created_at, id') {
    return this.mapAll(await this.db.many(`SELECT * FROM ${this.name} ORDER BY ${order}`));
  }

  async count() {
    return (await this.db.one(`SELECT count(*)::int AS n FROM ${this.name}`)).n;
  }

  async where(condition, params = [], order = 'created_at, id') {
    return this.mapAll(await this.db.many(`SELECT * FROM ${this.name} WHERE ${condition} ORDER BY ${order}`, params));
  }

  async first(condition, params = [], order = 'created_at, id') {
    return this.map(await this.db.one(`SELECT * FROM ${this.name} WHERE ${condition} ORDER BY ${order} LIMIT 1`, params));
  }

  async create(data, options) {
    const [row] = await this.insertMany([data], options);
    return row || null;
  }

  /**
   * Insere várias linhas, em lotes. Campos ausentes recebem o DEFAULT da coluna.
   * options.onConflict: trecho "ON CONFLICT … DO NOTHING"; linhas ignoradas não voltam.
   */
  async insertMany(list, { onConflict = '' } = {}) {
    if (!list.length) return [];
    const now = new Date().toISOString();
    const maps = list.map((d) => this.table.toColumns(this.beforeWrite({ id: crypto.randomUUID(), createdAt: now, ...d })));
    const out = [];
    for (let i = 0; i < maps.length; i += CHUNK) {
      const chunk = maps.slice(i, i + CHUNK);
      const cols = [...new Set(chunk.flatMap((m) => [...m.keys()]))];
      const params = [];
      const tuples = chunk.map((m) => `(${cols.map((c) => (m.has(c) ? `$${params.push(m.get(c))}` : 'DEFAULT')).join(', ')})`);
      const sql = `INSERT INTO ${this.name} (${cols.join(', ')}) VALUES ${tuples.join(', ')} ${onConflict} RETURNING *`;
      out.push(...this.mapAll(await this.write(() => this.db.many(sql, params))));
    }
    return out;
  }

  /**
   * Atualiza e devolve a linha. Recebendo o objeto (e não só o id), copia nele
   * o resultado: quem guardou a referência continua vendo o estado atual.
   */
  async update(target, patch) {
    const id = target && typeof target === 'object' ? target.id : target;
    if (!isUuid(id)) return null;
    const map = this.table.toColumns(this.beforeWrite({ ...patch, updatedAt: new Date().toISOString() }));
    map.delete('id');
    const params = [id];
    const sets = [...map].map(([col, value]) => `${col} = $${params.push(value)}`);
    const row = this.map(await this.write(() => this.db.one(`UPDATE ${this.name} SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, params)));
    if (row && target && typeof target === 'object') Object.assign(target, row);
    return row;
  }

  async remove(id) {
    if (!isUuid(id)) return false;
    const res = await this.db.query(`DELETE FROM ${this.name} WHERE id = $1`, [id]);
    return (res.rowCount ?? res.affectedRows ?? 0) > 0;
  }
}

module.exports = { Repository };
```

- [ ] **Step 5: Rode e veja passar**

Run: `node --test test/db/repository.test.js`
Expected: PASS (10 testes).

- [ ] **Step 6: Commit**

```bash
git add src/db/mapper.js src/db/repositories/base.js test/db/repository.test.js
git commit -m "Mapeamento camelCase/ISO e repositório base com lotes e unicidade amigável

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Repositórios de restaurantes, acessos e configurações

**Files:**
- Create: `src/db/repositories/restaurants.js`, `src/db/repositories/users.js`, `src/db/repositories/settings.js`, `src/db/repositories/index.js`, `test/helpers/db.js`
- Test: `test/db/repositories.test.js`

**Interfaces:**
- Consumes: `defineTable`, `isUuid`, `Repository` (Task 5); `migrate` (Task 4).
- Produces:
  - `RestaurantsRepo#bySlug(slug)`, `#slugTaken(slug, ignoreId) → boolean`, `#counts(ids) → Map<id, { contactsCount, authorizedCount, campaignsCount }>`;
  - `UsersRepo#byEmail(email)`, `#listByRestaurant(restaurantId)`;
  - `SettingsRepo#load()`, `#get()` (síncrono, a partir da cópia em memória), `#update(patch)` e `DEFAULT_SETTINGS`;
  - `createRepositories(db, { settings }) → { db, settings, restaurants, users, …, tx(fn) }`;
  - nos testes: `openTestDb()`.

- [ ] **Step 1: Banco de teste migrado**

Crie `test/helpers/db.js`:

```js
const { Database } = require('../../src/db/Database');
const { migrate } = require('../../src/db/migrate');

/** PostgreSQL (PGlite) em memória, já com o esquema aplicado. */
async function openTestDb() {
  const db = await Database.open({ pgliteDir: 'memory://' });
  await migrate(db);
  return db;
}

module.exports = { openTestDb };
```

- [ ] **Step 2: Escreva o teste**

Crie `test/db/repositories.test.js`:

```js
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openTestDb } = require('../helpers/db');
// O caminho termina em /index enquanto o antigo src/db/repositories.js existir:
// o Node acha o arquivo antes da pasta. O arquivo antigo sai na Task 9.
const { createRepositories } = require('../../src/db/repositories/index');

describe('repositórios: restaurantes, acessos e configurações', () => {
  let db;
  let repos;
  before(async () => {
    db = await openTestDb();
    repos = createRepositories(db);
    await repos.settings.load();
  });
  after(() => db.close());

  it('restaurante: padrões, JSON e busca por slug', async () => {
    const r = await repos.restaurants.create({ name: 'Cantina', slug: 'cantina', menu: [{ id: 'm1', name: 'Lasanha', price: 62.9 }] });
    assert.equal(r.requireApproval, true);
    assert.equal(r.demo, false);
    assert.deepEqual(r.banners, []);
    assert.deepEqual(r.menu, [{ id: 'm1', name: 'Lasanha', price: 62.9 }]);
    assert.equal((await repos.restaurants.bySlug('cantina')).id, r.id);
    assert.equal(await repos.restaurants.bySlug('outra'), null);
  });

  it('restaurante: slug ocupado, ignorando o próprio', async () => {
    const r = await repos.restaurants.bySlug('cantina');
    assert.equal(await repos.restaurants.slugTaken('cantina'), true);
    assert.equal(await repos.restaurants.slugTaken('cantina', r.id), false);
    assert.equal(await repos.restaurants.slugTaken('livre'), false);
    await assert.rejects(repos.restaurants.create({ name: 'Outra', slug: 'cantina' }), /Já existe um restaurante com este endereço/);
  });

  it('restaurante: contagens de contatos, autorizados e campanhas', async () => {
    const r = await repos.restaurants.bySlug('cantina');
    const empty = await repos.restaurants.create({ name: 'Vazio', slug: 'vazio' });
    await db.query(`INSERT INTO contacts (id, restaurant_id, phone, phone_key, opt_in, opted_out) VALUES
      (gen_random_uuid(), $1, '5531999000001', '3199000001', true, false),
      (gen_random_uuid(), $1, '5531999000002', '3199000002', true, true),
      (gen_random_uuid(), $1, '5531999000003', '3199000003', false, false)`, [r.id]);
    await db.query("INSERT INTO campaigns (id, restaurant_id, name) VALUES (gen_random_uuid(), $1, 'C1')", [r.id]);
    const counts = await repos.restaurants.counts([r.id, empty.id]);
    assert.deepEqual(counts.get(r.id), { contactsCount: 3, authorizedCount: 1, campaignsCount: 1 });
    assert.deepEqual(counts.get(empty.id), { contactsCount: 0, authorizedCount: 0, campaignsCount: 0 });
    assert.equal((await repos.restaurants.counts([])).size, 0);
  });

  it('acessos: e-mail único, lista por restaurante e exclusão em cascata', async () => {
    const r = await repos.restaurants.create({ name: 'Bistrô', slug: 'bistro' });
    const u = await repos.users.create({ restaurantId: r.id, role: 'restaurant', name: 'Bia', email: 'bia@bistro.com.br', passwordHash: 'scrypt:x:y' });
    assert.equal((await repos.users.byEmail('bia@bistro.com.br')).id, u.id);
    assert.deepEqual((await repos.users.listByRestaurant(r.id)).map((x) => x.email), ['bia@bistro.com.br']);
    assert.deepEqual(await repos.users.listByRestaurant('nao-e-uuid'), []);
    await assert.rejects(repos.users.create({ restaurantId: r.id, name: 'Outra', email: 'bia@bistro.com.br', passwordHash: 'x' }), /Este e-mail já tem acesso/);
    assert.equal(await repos.restaurants.remove(r.id), true);
    assert.equal(await repos.users.get(u.id), null);
  });

  it('configurações: padrões, mescla e persistência', async () => {
    assert.equal(repos.settings.get().dailyLimit, 800);
    const updated = await repos.settings.update({ dailyLimit: 50, footer: 'Novo rodapé' });
    assert.equal(updated.dailyLimit, 50);
    assert.equal(updated.minDelaySeconds, 6);
    await repos.settings.update({ provider: 'simulator' });
    const fresh = createRepositories(db);
    await fresh.settings.load();
    assert.equal(fresh.settings.get().dailyLimit, 50);
    assert.equal(fresh.settings.get().footer, 'Novo rodapé');
    assert.equal(fresh.settings.get().provider, 'simulator');
  });
});
```

- [ ] **Step 3: Rode e veja falhar**

Run: `node --test test/db/repositories.test.js`
Expected: FAIL com `Cannot find module '../../src/db/repositories/index'`.

- [ ] **Step 4: Implemente os três repositórios**

Crie `src/db/repositories/restaurants.js`:

```js
const { defineTable, isUuid } = require('../mapper');
const { Repository } = require('./base');

const table = defineTable({
  name: 'restaurants',
  columns: ['name', 'slug', 'segment', 'city', 'siteUrl', 'phone', 'audience', 'products', 'goals', 'tone', 'color', 'coupon', 'tagline', 'instagram', 'emoji', 'address', 'hours', 'logoUrl', 'menu', 'banners', 'requireApproval', 'demo'],
  json: ['menu', 'banners'],
  unique: { restaurants_slug_key: 'Já existe um restaurante com este endereço.' },
});

class RestaurantsRepo extends Repository {
  constructor(db) {
    super(db, table);
  }

  bySlug(slug) {
    return this.first('slug = $1', [String(slug)]);
  }

  async slugTaken(slug, ignoreId = null) {
    const row = await this.db.one('SELECT 1 FROM restaurants WHERE slug = $1 AND ($2::uuid IS NULL OR id <> $2::uuid)', [slug, isUuid(ignoreId) ? ignoreId : null]);
    return !!row;
  }

  /** Contagens da lista de restaurantes: contatos, autorizados e campanhas. */
  async counts(ids) {
    if (!ids.length) return new Map();
    const rows = await this.db.many(`
      SELECT r.id,
        (SELECT count(*)::int FROM contacts c WHERE c.restaurant_id = r.id) AS contacts_count,
        (SELECT count(*)::int FROM contacts c WHERE c.restaurant_id = r.id AND c.opt_in AND NOT c.opted_out) AS authorized_count,
        (SELECT count(*)::int FROM campaigns k WHERE k.restaurant_id = r.id) AS campaigns_count
      FROM restaurants r WHERE r.id = ANY($1::uuid[])`, [ids.filter(isUuid)]);
    return new Map(rows.map((r) => [r.id, { contactsCount: r.contacts_count, authorizedCount: r.authorized_count, campaignsCount: r.campaigns_count }]));
  }
}

module.exports = { RestaurantsRepo, table };
```

Crie `src/db/repositories/users.js`:

```js
const { defineTable, isUuid } = require('../mapper');
const { Repository } = require('./base');

const table = defineTable({
  name: 'users',
  columns: ['restaurantId', 'role', 'name', 'email', 'passwordHash', 'lastLoginAt'],
  unique: { users_email_key: 'Este e-mail já tem acesso.' },
});

class UsersRepo extends Repository {
  constructor(db) {
    super(db, table);
  }

  byEmail(email) {
    return this.first('email = $1', [String(email)]);
  }

  async listByRestaurant(restaurantId) {
    return isUuid(restaurantId) ? this.where('restaurant_id = $1', [restaurantId]) : [];
  }
}

module.exports = { UsersRepo, table };
```

Crie `src/db/repositories/settings.js`:

```js
const DEFAULT_SETTINGS = {
  provider: null,
  minDelaySeconds: 6,
  maxDelaySeconds: 14,
  dailyLimit: 800,
  businessHoursOnly: false,
  businessHours: { start: '09:00', end: '21:00' },
  optOutKeywords: ['sair', 'parar', 'pare', 'cancelar', 'descadastrar', 'stop'],
  optOutReply: 'Pronto, você não vai mais receber nossas mensagens promocionais.',
  footer: 'Responda SAIR para não receber mais mensagens.',
};

/**
 * Configurações gerais (uma linha só). Ficam em memória depois do load() para
 * que get() siga síncrono (o TemplateService monta textos sem await); update()
 * grava no banco e atualiza a cópia. Pressupõe uma instância do servidor.
 */
class SettingsRepo {
  constructor(db) {
    this.db = db;
    this.cache = {};
  }

  async load() {
    const row = await this.db.one('SELECT data FROM settings WHERE id = 1');
    this.cache = row?.data || {};
    return this.get();
  }

  get() {
    return { ...DEFAULT_SETTINGS, ...this.cache };
  }

  async update(patch) {
    const row = await this.db.one(
      `INSERT INTO settings (id, data) VALUES (1, $1)
       ON CONFLICT (id) DO UPDATE SET data = settings.data || EXCLUDED.data
       RETURNING data`,
      [JSON.stringify(patch)],
    );
    this.cache = row.data;
    return this.get();
  }
}

module.exports = { SettingsRepo, DEFAULT_SETTINGS };
```

Crie `src/db/repositories/index.js`:

```js
const { RestaurantsRepo } = require('./restaurants');
const { UsersRepo } = require('./users');
const { SettingsRepo, DEFAULT_SETTINGS } = require('./settings');

/**
 * Configurações vistas de dentro de uma transação: leitura da cópia em memória.
 * Gravar ali usaria o banco de fora da transação (e travaria no PGlite), então falha na hora.
 */
const readOnlySettings = (settings) => ({
  get: () => settings.get(),
  load: async () => { throw new Error('As configurações não podem ser recarregadas dentro de uma transação.'); },
  update: async () => { throw new Error('As configurações não podem ser alteradas dentro de uma transação.'); },
});

/**
 * Repositórios ligados a um banco (ou a uma transação).
 * repos.tx(async (r) => …) entrega os mesmos repositórios dentro de uma
 * transação. Dentro do callback use SÓ o `r` recebido (ver Database#tx).
 * Dentro da transação as configurações são só leitura (r.settings.get()).
 */
function createRepositories(db, { settings = new SettingsRepo(db) } = {}) {
  return {
    db,
    settings,
    restaurants: new RestaurantsRepo(db),
    users: new UsersRepo(db),
    tx(fn) {
      return db.tx((t) => fn(createRepositories(t, { settings: readOnlySettings(settings) })));
    },
  };
}

module.exports = { createRepositories, DEFAULT_SETTINGS };
```

- [ ] **Step 5: Rode e veja passar**

Run: `node --test test/db/repositories.test.js`
Expected: PASS (5 testes).

- [ ] **Step 6: Commit**

```bash
git add src/db/repositories test/helpers/db.js test/db/repositories.test.js
git commit -m "Repositórios de restaurantes, acessos e configurações no PostgreSQL

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Repositório de contatos

**Files:**
- Create: `src/db/repositories/contacts.js`
- Modify: `src/db/repositories/index.js`, `src/messaging/MessagingProvider.js` (novo `static phoneKey`), `src/services/DispatchService.js:9-13`
- Test: `test/db/contacts.test.js`

**Interfaces:**
- Consumes: `Repository`, `defineTable`, `isUuid`, `scopeId` (Task 5); `createRepositories` (Task 6).
- Produces:
  - `MessagingProvider.phoneKey(phone) → string` (DDD + últimos 8 dígitos);
  - `ContactsRepo#listByRestaurant({ restaurantId, tag, status })`, `#byRestaurant(id)`, `#findByPhone(restaurantId, phone)`, `#byPhoneKey(key)`;
  - `ContactsRepo#audience(restaurantId, segment)`, `#tagCounts(restaurantId) → [{ tag, count }]`, `#markOptedOut(ids, at)`;
  - `ContactsRepo#stats({ restaurantId, from, to }) → { total, authorized, optedOut, createdInRange, optedOutInRange }`.

- [ ] **Step 1: `phoneKey` passa para o contrato de mensageria**

Em `src/messaging/MessagingProvider.js`, logo depois de `normalizePhone`:

```js
  /** Chave de comparação de telefone: DDD + últimos 8 dígitos (ignora o 9º dígito). */
  static phoneKey(phone) {
    const n = MessagingProvider.normalizePhone(phone).replace(/^55/, '');
    return n.length >= 10 ? `${n.slice(0, 2)}${n.slice(-8)}` : n;
  }
```

Em `src/services/DispatchService.js`, troque a função local `phoneKey` (linhas 9-13) por:

```js
/** Chave de comparação de telefone: DDD + últimos 8 dígitos (ignora o 9º dígito). */
const phoneKey = (phone) => MessagingProvider.phoneKey(phone);
```

- [ ] **Step 2: Escreva o teste**

Crie `test/db/contacts.test.js`:

```js
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openTestDb } = require('../helpers/db');
const { createRepositories } = require('../../src/db/repositories/index');
const { MessagingProvider } = require('../../src/messaging/MessagingProvider');

describe('repositório de contatos', () => {
  let db;
  let repos;
  let r1;
  let r2;
  const names = (list) => list.map((c) => c.name).sort();

  before(async () => {
    db = await openTestDb();
    repos = createRepositories(db);
    r1 = await repos.restaurants.create({ name: 'Um', slug: 'um' });
    r2 = await repos.restaurants.create({ name: 'Dois', slug: 'dois' });
    await repos.contacts.insertMany([
      { restaurantId: r1.id, name: 'Ana', phone: '5531999000001', tags: ['vip'], optIn: true },
      { restaurantId: r1.id, name: 'Beto', phone: '5531999000002', tags: ['vip', 'familia'], optIn: true },
      { restaurantId: r1.id, name: 'Cris', phone: '5531999000003', tags: ['familia'], optIn: true },
      { restaurantId: r1.id, name: 'Duda', phone: '5531999000004', tags: ['vip'], optIn: true, optedOut: true },
      { restaurantId: r1.id, name: 'Edu', phone: '5531999000005', tags: ['vip'], optIn: false },
      { restaurantId: r2.id, name: 'Ana em outro restaurante', phone: '5531999000001', tags: [], optIn: true },
    ]);
  });
  after(() => db.close());

  it('phoneKey ignora o 55 e o nono dígito', () => {
    assert.equal(MessagingProvider.phoneKey('5531999000001'), '3199000001');
    assert.equal(MessagingProvider.phoneKey('(31) 9900-0001'), '3199000001');
  });

  it('grava a chave do telefone sem expor a coluna', async () => {
    const ana = await repos.contacts.findByPhone(r1.id, '5531999000001');
    assert.equal(ana.phoneKey, undefined);
    assert.equal((await db.one('SELECT phone_key FROM contacts WHERE id = $1', [ana.id])).phone_key, '3199000001');
  });

  it('lista com filtros de tag e situação', async () => {
    const list = async (f) => names(await repos.contacts.listByRestaurant({ restaurantId: r1.id, ...f }));
    assert.deepEqual(await list({}), ['Ana', 'Beto', 'Cris', 'Duda', 'Edu']);
    assert.deepEqual(await list({ tag: 'vip' }), ['Ana', 'Beto', 'Duda', 'Edu']);
    assert.deepEqual(await list({ status: 'authorized' }), ['Ana', 'Beto', 'Cris']);
    assert.deepEqual(await list({ status: 'optedOut' }), ['Duda']);
    assert.deepEqual(await list({ status: 'pending' }), ['Edu']);
    assert.deepEqual(await repos.contacts.listByRestaurant({ restaurantId: 'xyz' }), []);
    assert.equal((await repos.contacts.listByRestaurant({})).length, 6);
    assert.equal((await repos.contacts.byRestaurant(r2.id)).length, 1);
  });

  it('público da campanha: só autorizados, com "qualquer" e "todas"', async () => {
    const audience = async (segment) => names(await repos.contacts.audience(r1.id, segment));
    assert.deepEqual(await audience({}), ['Ana', 'Beto', 'Cris']);
    assert.deepEqual(await audience({ tags: ['vip'] }), ['Ana', 'Beto']);
    assert.deepEqual(await audience({ tags: ['vip', 'familia'], match: 'any' }), ['Ana', 'Beto', 'Cris']);
    assert.deepEqual(await audience({ tags: ['vip', 'familia'], match: 'all' }), ['Beto']);
    assert.deepEqual(await repos.contacts.audience('xyz', {}), []);
  });

  it('busca por telefone no restaurante e pela chave em todos', async () => {
    assert.equal((await repos.contacts.findByPhone(r1.id, '5531999000002')).name, 'Beto');
    assert.equal(await repos.contacts.findByPhone(r1.id, '5531999009999'), null);
    assert.equal(await repos.contacts.findByPhone('xyz', '5531999000002'), null);
    assert.deepEqual(names(await repos.contacts.byPhoneKey('3199000001')), ['Ana', 'Ana em outro restaurante']);
  });

  it('telefone repetido no mesmo restaurante vira mensagem amigável', async () => {
    await assert.rejects(repos.contacts.create({ restaurantId: r1.id, name: 'X', phone: '5531999000001' }), /Este telefone já está na base/);
    const beto = await repos.contacts.findByPhone(r1.id, '5531999000002');
    await assert.rejects(repos.contacts.update(beto, { phone: '5531999000001' }), /Este telefone já está na base/);
  });

  it('atualizar o telefone recalcula a chave', async () => {
    const cris = await repos.contacts.findByPhone(r1.id, '5531999000003');
    await repos.contacts.update(cris, { phone: '5531988887777' });
    assert.equal((await db.one('SELECT phone_key FROM contacts WHERE id = $1', [cris.id])).phone_key, '3188887777');
  });

  it('contagem de tags ordenada por uso e por nome', async () => {
    assert.deepEqual(await repos.contacts.tagCounts(r1.id), [{ tag: 'vip', count: 4 }, { tag: 'familia', count: 2 }]);
    assert.deepEqual(await repos.contacts.tagCounts('xyz'), []);
    assert.equal((await repos.contacts.tagCounts(null))[0].tag, 'vip');
  });

  it('descadastro em lote e números da base', async () => {
    const from = new Date(Date.now() - 60000).toISOString();
    const to = new Date(Date.now() + 60000).toISOString();
    const ana = await repos.contacts.findByPhone(r1.id, '5531999000001');
    const [changed] = await repos.contacts.markOptedOut([ana.id], new Date().toISOString());
    assert.equal(changed.optedOut, true);
    assert.deepEqual(await repos.contacts.markOptedOut([], new Date().toISOString()), []);
    assert.deepEqual(await repos.contacts.stats({ restaurantId: r1.id, from, to }), { total: 5, authorized: 2, optedOut: 2, createdInRange: 5, optedOutInRange: 1 });
    assert.equal((await repos.contacts.stats()).total, 6);
    assert.deepEqual(await repos.contacts.stats({ restaurantId: 'xyz' }), { total: 0, authorized: 0, optedOut: 0, createdInRange: 0, optedOutInRange: 0 });
  });

  it('excluir o restaurante apaga os contatos dele', async () => {
    await repos.restaurants.remove(r2.id);
    assert.deepEqual(names(await repos.contacts.byPhoneKey('3199000001')), ['Ana']);
  });
});
```

- [ ] **Step 3: Rode e veja falhar**

Run: `node --test test/db/contacts.test.js`
Expected: FAIL com `TypeError: Cannot read properties of undefined (reading 'insertMany')`, porque ainda não existe `repos.contacts`.

- [ ] **Step 4: Implemente o repositório**

Crie `src/db/repositories/contacts.js`:

```js
const { defineTable, isUuid, scopeId } = require('../mapper');
const { Repository } = require('./base');
const { MessagingProvider } = require('../../messaging/MessagingProvider');

const table = defineTable({
  name: 'contacts',
  columns: ['restaurantId', 'name', 'phone', 'tags', 'optIn', 'optInSource', 'optedOut', 'optedOutAt', 'notes', 'demo'],
  hidden: ['phoneKey'],
  unique: { contacts_restaurant_phone: 'Este telefone já está na base.' },
});

class ContactsRepo extends Repository {
  constructor(db) {
    super(db, table);
  }

  beforeWrite(data) {
    return data.phone !== undefined ? { ...data, phoneKey: MessagingProvider.phoneKey(data.phone) } : data;
  }

  /** Contatos com filtros de restaurante, tag e situação (a busca por texto fica na rota). */
  async listByRestaurant({ restaurantId, tag, status } = {}) {
    const where = [];
    const params = [];
    if (restaurantId) {
      if (!isUuid(restaurantId)) return [];
      where.push(`restaurant_id = $${params.push(restaurantId)}`);
    }
    if (tag) where.push(`$${params.push(String(tag))} = ANY(tags)`);
    if (status === 'authorized') where.push('opt_in AND NOT opted_out');
    if (status === 'optedOut') where.push('opted_out');
    if (status === 'pending') where.push('NOT opt_in');
    return this.where(where.join(' AND ') || 'TRUE', params);
  }

  async byRestaurant(restaurantId) {
    return isUuid(restaurantId) ? this.where('restaurant_id = $1', [restaurantId]) : [];
  }

  async findByPhone(restaurantId, phone) {
    if (!isUuid(restaurantId)) return null;
    return this.first('restaurant_id = $1 AND phone = $2', [restaurantId, phone]);
  }

  /** O mesmo cliente em qualquer restaurante (respostas como "SAIR"). */
  byPhoneKey(key) {
    return this.where('phone_key = $1', [key]);
  }

  /** Público de uma campanha: autorizados do restaurante, filtrados pelas tags. */
  async audience(restaurantId, segment = {}) {
    if (!isUuid(restaurantId)) return [];
    const tags = (segment.tags || []).filter(Boolean);
    const params = [restaurantId];
    let condition = 'restaurant_id = $1 AND opt_in AND NOT opted_out';
    if (tags.length) condition += ` AND tags ${segment.match === 'all' ? '@>' : '&&'} $${params.push(tags)}::text[]`;
    return this.where(condition, params);
  }

  async tagCounts(restaurantId) {
    return this.db.many(`
      SELECT tag, count(*)::int AS count
      FROM contacts, unnest(tags) AS tag
      WHERE ($1::uuid IS NULL OR restaurant_id = $1::uuid)
      GROUP BY tag ORDER BY count DESC, tag`, [scopeId(restaurantId)]);
  }

  async markOptedOut(ids, at) {
    if (!ids.length) return [];
    return this.mapAll(await this.db.many('UPDATE contacts SET opted_out = true, opted_out_at = $2, updated_at = now() WHERE id = ANY($1::uuid[]) RETURNING *', [ids, at]));
  }

  /** Números da base para o painel e o relatório (período opcional para novos e descadastros). */
  async stats({ restaurantId = null, from = null, to = null } = {}) {
    const row = await this.db.one(`
      SELECT count(*)::int AS total,
        count(*) FILTER (WHERE opt_in AND NOT opted_out)::int AS authorized,
        count(*) FILTER (WHERE opted_out)::int AS opted_out,
        count(*) FILTER (WHERE created_at >= $2 AND created_at < $3)::int AS created_in_range,
        count(*) FILTER (WHERE opted_out_at >= $2 AND opted_out_at < $3)::int AS opted_out_in_range
      FROM contacts WHERE ($1::uuid IS NULL OR restaurant_id = $1::uuid)`, [scopeId(restaurantId), from, to]);
    return { total: row.total, authorized: row.authorized, optedOut: row.opted_out, createdInRange: row.created_in_range, optedOutInRange: row.opted_out_in_range };
  }
}

module.exports = { ContactsRepo, table };
```

Em `src/db/repositories/index.js`, acrescente:

```js
const { ContactsRepo } = require('./contacts');
```

e, dentro do objeto devolvido:

```js
    users: new UsersRepo(db),
    contacts: new ContactsRepo(db),
```

- [ ] **Step 5: Rode e veja passar**

Run: `node --test test/db/contacts.test.js test/db/repositories.test.js`
Expected: PASS.

- [ ] **Step 6: A bateria HTTP continua verde**

Run: `npm test`
Expected: `# fail 0`. A troca do `phoneKey` não muda o comportamento.

- [ ] **Step 7: Commit**

```bash
git add src/db/repositories src/messaging/MessagingProvider.js src/services/DispatchService.js test/db/contacts.test.js
git commit -m "Repositório de contatos: filtros, público por tags e chave de telefone

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Repositórios de campanhas, mensagens e pedidos

**Files:**
- Create: `src/db/repositories/campaigns.js`, `src/db/repositories/messages.js`, `src/db/repositories/conversions.js`
- Modify: `src/db/repositories/index.js` (versão final)
- Test: `test/db/campaigns-messages.test.js`

**Interfaces:**
- Consumes: `Repository`, `defineTable`, `isUuid`, `scopeId` (Task 5); `ContactsRepo` (Task 7).
- Produces:
  - **CampaignsRepo:**
    - `list({ restaurantId })`, `byStatus(status)`, `dueScheduled(nowIso)`;
    - `transition(target, fromStatuses, patch) → linha | null`;
    - `hasActive(restaurantId)`, `anySending()`, `mediaInUse(url)`;
    - `startedBetween(restaurantId, from, to)`, `launched(restaurantId)`, `counts(restaurantId) → { campaigns, active }`.
  - **MessagesRepo:**
    - `byCampaign(id)`, `byCode(code)`, `byProviderId(id)`;
    - `requeueSending() → número`, `claimNext(campaignId)`, `hasQueued(campaignId)`, `skipQueued(campaignId, error)`, `countSentSince(iso)`;
    - `markSent(id, { provider, providerMessageId, sentAt })`, `applyAck(providerMessageId, status, at)`, `markFailedByProvider(providerMessageId, error, at)`;
    - `registerClick(id, at)`, `lastSentToPhoneKey(key)`, `registerReply(id, { reply, optOut, at })`, `markConverted(id, at)`;
    - `summary({ restaurantId, campaignId, sentFrom, sentTo })` e `summaryByCampaign(ids) → Map`;
    - `timelineSince({ restaurantId, since }) → [{ sentAt, readAt, clickedAt }]`, `sentBetween(restaurantId, from, to) → [{ sentAt, clickedAt }]`, `sentMonths(restaurantId) → ['AAAA-MM']`.
  - **ConversionsRepo:**
    - `createUnique(data) → linha | null` (repetido);
    - `summary({ restaurantId, campaignId, attributedOnly, from, to }) → { orders, revenue }` e `summaryByCampaign(ids) → Map`;
    - `attributedSince({ restaurantId, since })`, `recentAttributed({ restaurantId, limit })`, `attributedBetween(restaurantId, from, to)`.
  - Contagens brutas de `summary` (chaves exatas): `{ audience, queued, sent, delivered, read, failed, skipped, clicked, clicks, replied, optOuts }`.
  - `repos.reset()`: apaga todos os dados e volta as configurações ao padrão (usado pelo `npm run seed`).

- [ ] **Step 1: Escreva o teste**

Crie `test/db/campaigns-messages.test.js`:

```js
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { openTestDb } = require('../helpers/db');
const { createRepositories } = require('../../src/db/repositories/index');
const { MessagingProvider } = require('../../src/messaging/MessagingProvider');

describe('repositórios de campanhas, mensagens e pedidos', () => {
  let db;
  let repos;
  let phoneSeq = 100;
  const at = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();
  const pause = () => new Promise((r) => { setTimeout(r, 5); });

  before(async () => {
    db = await openTestDb();
    repos = createRepositories(db);
  });
  after(() => db.close());

  /** Restaurante novo com 3 contatos de telefones únicos (testes independentes entre si). */
  async function fresh() {
    const restaurant = await repos.restaurants.create({ name: 'Casa', slug: `casa-${crypto.randomBytes(3).toString('hex')}` });
    const contacts = await repos.contacts.insertMany([1, 2, 3].map((i) => ({ restaurantId: restaurant.id, name: `Cliente ${i}`, phone: `5531988${String(phoneSeq++).padStart(6, '0')}`, optIn: true })));
    contacts.sort((a, b) => a.name.localeCompare(b.name));
    return { restaurant, contacts };
  }

  const queue = (campaign, list) => repos.messages.insertMany(list.map((c) => ({
    campaignId: campaign.id, restaurantId: campaign.restaurantId, contactId: c.id, name: c.name, phone: c.phone,
    code: crypto.randomBytes(6).toString('base64url'), status: 'queued', queuedAt: at(),
  })));

  it('campanha: JSON, padrões e transição condicional de status', async () => {
    const { restaurant } = await fresh();
    const c = await repos.campaigns.create({ restaurantId: restaurant.id, name: 'Campanha', segment: { tags: ['vip'], match: 'all' }, approval: { status: 'pending' } });
    assert.equal(c.status, 'draft');
    assert.equal(c.includeFooter, true);
    assert.equal(c.message, '');
    assert.deepEqual(c.segment, { tags: ['vip'], match: 'all' });
    assert.deepEqual(c.approval, { status: 'pending' });
    assert.deepEqual(c.approvalLog, []);
    const moved = await repos.campaigns.transition(c, ['draft', 'scheduled'], { status: 'sending', startedAt: at() });
    assert.equal(moved.status, 'sending');
    assert.equal(c.status, 'sending');
    assert.equal(await repos.campaigns.transition(c.id, ['draft'], { status: 'sending' }), null);
    assert.equal(await repos.campaigns.transition('xyz', ['draft'], { status: 'sending' }), null);
  });

  it('campanha: consultas do disparo, das exclusões e do painel', async () => {
    const { restaurant } = await fresh();
    const add = (data) => repos.campaigns.create({ restaurantId: restaurant.id, name: 'C', ...data });
    await add({});
    const due = await add({ status: 'scheduled', scheduledAt: at(-1000) });
    await add({ status: 'scheduled', scheduledAt: at(3600e3) });
    const sending = await add({ status: 'sending', startedAt: at() });
    await add({ status: 'paused', mediaUrl: '/uploads/foto.jpg' });

    assert.ok((await repos.campaigns.dueScheduled(at())).some((c) => c.id === due.id));
    assert.ok((await repos.campaigns.byStatus('sending')).some((c) => c.id === sending.id));
    assert.equal(await repos.campaigns.hasActive(restaurant.id), true);
    assert.equal(await repos.campaigns.hasActive('xyz'), false);
    assert.equal(await repos.campaigns.anySending(), true);
    assert.equal(await repos.campaigns.mediaInUse('/uploads/foto.jpg'), true);
    assert.equal(await repos.campaigns.mediaInUse('/uploads/outra.jpg'), false);
    assert.deepEqual(await repos.campaigns.counts(restaurant.id), { campaigns: 5, active: 4 });
    assert.equal((await repos.campaigns.launched(restaurant.id)).length, 4);
    assert.equal((await repos.campaigns.list({ restaurantId: restaurant.id })).length, 5);
    assert.deepEqual(await repos.campaigns.list({ restaurantId: 'xyz' }), []);
    assert.deepEqual((await repos.campaigns.startedBetween(restaurant.id, at(-60000), at(60000))).map((c) => c.id), [sending.id]);
  });

  it('fila: ordem de inserção, reserva atômica e cancelamento', async () => {
    const { restaurant, contacts } = await fresh();
    const c = await repos.campaigns.create({ restaurantId: restaurant.id, name: 'Fila', status: 'sending' });
    await queue(c, contacts);
    const [a, b] = await Promise.all([repos.messages.claimNext(c.id), repos.messages.claimNext(c.id)]);
    assert.notEqual(a.id, b.id);
    assert.equal(a.status, 'sending');
    assert.deepEqual([a.name, b.name].sort(), ['Cliente 1', 'Cliente 2']);
    assert.equal(a.phoneKey, undefined);
    assert.equal(a.seq, undefined);
    assert.equal(await repos.messages.hasQueued(c.id), true);
    assert.deepEqual((await repos.messages.skipQueued(c.id, 'Campanha cancelada')).map((m) => m.name), ['Cliente 3']);
    assert.equal(await repos.messages.hasQueued(c.id), false);
    assert.equal(await repos.messages.claimNext(c.id), null);
    assert.ok((await repos.messages.requeueSending()) >= 2);
    assert.equal((await repos.messages.claimNext(c.id)).name, 'Cliente 1');
    await repos.messages.requeueSending();
    assert.deepEqual((await repos.messages.byCampaign(c.id)).map((m) => m.name), ['Cliente 1', 'Cliente 2', 'Cliente 3']);
  });

  it('envio e confirmações nunca fazem o status voltar', async () => {
    const { restaurant, contacts } = await fresh();
    const c = await repos.campaigns.create({ restaurantId: restaurant.id, name: 'Acks', status: 'sending' });
    const [m1, m2, m3] = await queue(c, contacts);
    const p = (n) => `${c.id}-p${n}`;

    const sent = await repos.messages.markSent(m1.id, { provider: 'simulator', providerMessageId: p(1), sentAt: at() });
    assert.equal(sent.status, 'sent');
    assert.equal(sent.error, null);
    const read = await repos.messages.applyAck(p(1), 'read', at());
    assert.equal(read.status, 'read');
    assert.ok(read.deliveredAt && read.readAt);
    assert.equal(await repos.messages.applyAck(p(1), 'delivered', at()), null, 'entregue depois de lida não volta');
    assert.equal((await repos.messages.byProviderId(p(1))).status, 'read');
    assert.equal(await repos.messages.applyAck(p(1), 'played', at()), null, 'status desconhecido é ignorado');
    assert.equal(await repos.messages.byProviderId(null), null);

    // confirmação que chegou antes do markSent não é desfeita por ele
    await repos.messages.update(m2, { providerMessageId: p(2), status: 'sending' });
    await repos.messages.applyAck(p(2), 'delivered', at());
    assert.equal((await repos.messages.markSent(m2.id, { provider: 'simulator', providerMessageId: p(2), sentAt: at() })).status, 'delivered');

    // falha reportada depois do envio; uma entrega posterior ainda vale (como antes)
    await repos.messages.markSent(m3.id, { provider: 'simulator', providerMessageId: p(3), sentAt: at() });
    const failed = await repos.messages.markFailedByProvider(p(3), 'Número bloqueado', at());
    assert.equal(failed.status, 'failed');
    assert.ok(failed.failedAt);
    assert.equal((await repos.messages.applyAck(p(3), 'delivered', at())).status, 'delivered');
  });

  it('clique, resposta e conversão', async () => {
    const { restaurant, contacts } = await fresh();
    const c = await repos.campaigns.create({ restaurantId: restaurant.id, name: 'Funil', status: 'completed' });
    const [m] = await queue(c, contacts.slice(0, 1));
    await repos.messages.markSent(m.id, { provider: 'simulator', providerMessageId: `${c.id}-f`, sentAt: at(-5000) });
    const first = await repos.messages.registerClick(m.id, at(-4000));
    const second = await repos.messages.registerClick(m.id, at(-3000));
    assert.equal(second.clicks, 2);
    assert.equal(second.clickedAt, first.clickedAt);
    assert.ok(second.lastClickAt > first.lastClickAt);
    assert.equal((await repos.messages.byCode(m.code)).id, m.id);
    assert.equal((await repos.messages.lastSentToPhoneKey(MessagingProvider.phoneKey(m.phone))).id, m.id);

    const replied = await repos.messages.registerReply(m.id, { reply: 'SAIR', optOut: true, at: at() });
    assert.equal(replied.reply, 'SAIR');
    assert.equal(replied.optOut, true);
    assert.equal(await repos.messages.registerReply(m.id, { reply: 'de novo', optOut: false, at: at() }), null);
    assert.ok((await repos.messages.markConverted(m.id, at())).convertedAt);
    assert.equal(await repos.messages.markConverted(m.id, at()), null);
  });

  it('contagens seguem as regras do painel', async () => {
    const { restaurant, contacts } = await fresh();
    const c = await repos.campaigns.create({ restaurantId: restaurant.id, name: 'Números', status: 'completed' });
    const [m1, m2] = await queue(c, contacts);
    await repos.messages.markSent(m1.id, { provider: 's', providerMessageId: `${c.id}-n1`, sentAt: at() });
    await repos.messages.applyAck(`${c.id}-n1`, 'read', at());
    await repos.messages.registerClick(m1.id, at());
    await repos.messages.registerClick(m1.id, at());
    await repos.messages.registerReply(m1.id, { reply: 'SAIR', optOut: true, at: at() });
    await repos.messages.update(m2, { status: 'failed', error: 'x' });
    // a terceira mensagem continua na fila
    const s = await repos.messages.summary({ campaignId: c.id });
    assert.deepEqual(s, { audience: 3, queued: 1, sent: 1, delivered: 1, read: 1, failed: 1, skipped: 0, clicked: 1, clicks: 2, replied: 1, optOuts: 1 });
    const byCampaign = await repos.messages.summaryByCampaign([c.id, 'xyz']);
    assert.equal(byCampaign.size, 1);
    assert.deepEqual(byCampaign.get(c.id), s);
    assert.equal((await repos.messages.summary({ restaurantId: restaurant.id })).audience, 3);
    assert.equal((await repos.messages.summary({ restaurantId: 'xyz' })).audience, 0);
    assert.equal((await repos.messages.summary({ restaurantId: restaurant.id, sentFrom: at(60000) })).sent, 0);
    assert.ok((await repos.messages.countSentSince(at(-60000))) >= 1);
  });

  it('linhas do tempo e meses com envio', async () => {
    const { restaurant, contacts } = await fresh();
    const c = await repos.campaigns.create({ restaurantId: restaurant.id, name: 'Tempo', status: 'completed' });
    const [m] = await queue(c, contacts.slice(0, 1));
    await repos.messages.markSent(m.id, { provider: 's', providerMessageId: `${c.id}-t`, sentAt: '2026-03-31T23:30:00.000Z' });
    await repos.messages.registerClick(m.id, '2026-04-01T10:00:00.000Z');
    assert.deepEqual(await repos.messages.sentMonths(restaurant.id), ['2026-03']);
    assert.deepEqual(await repos.messages.sentBetween(restaurant.id, '2026-03-01T00:00:00.000Z', '2026-04-01T00:00:00.000Z'), [{ sentAt: '2026-03-31T23:30:00.000Z', clickedAt: '2026-04-01T10:00:00.000Z' }]);
    assert.deepEqual(await repos.messages.timelineSince({ restaurantId: restaurant.id, since: '2026-04-01T00:00:00.000Z' }), [{ sentAt: '2026-03-31T23:30:00.000Z', readAt: null, clickedAt: '2026-04-01T10:00:00.000Z' }]);
  });

  it('pedidos: repetido no restaurante é ignorado; totais e listas', async () => {
    const { restaurant } = await fresh();
    const c = await repos.campaigns.create({ restaurantId: restaurant.id, name: 'Vendas', status: 'completed' });
    const first = await repos.conversions.createUnique({ restaurantId: restaurant.id, campaignId: c.id, orderId: 'P-1', value: 10.1, items: [{ name: 'A', qty: 1, price: 10.1 }] });
    assert.equal(first.value, 10.1);
    assert.deepEqual(first.items, [{ name: 'A', qty: 1, price: 10.1 }]);
    assert.equal(await repos.conversions.createUnique({ restaurantId: restaurant.id, orderId: 'P-1', value: 99 }), null);
    await pause();
    await repos.conversions.createUnique({ restaurantId: restaurant.id, campaignId: c.id, orderId: 'P-2', value: 20.2 });
    await repos.conversions.createUnique({ restaurantId: restaurant.id, value: 5 });
    await repos.conversions.createUnique({ restaurantId: restaurant.id, value: 5 }); // sem número: nunca é repetido

    assert.deepEqual(await repos.conversions.summary({ restaurantId: restaurant.id }), { orders: 4, revenue: 40.3 });
    assert.deepEqual(await repos.conversions.summary({ restaurantId: restaurant.id, attributedOnly: true }), { orders: 2, revenue: 30.3 });
    assert.deepEqual(await repos.conversions.summary({ campaignId: c.id }), { orders: 2, revenue: 30.3 });
    assert.deepEqual(await repos.conversions.summary({ restaurantId: 'xyz' }), { orders: 0, revenue: 0 });
    assert.deepEqual((await repos.conversions.summaryByCampaign([c.id])).get(c.id), { orders: 2, revenue: 30.3 });
    assert.deepEqual((await repos.conversions.recentAttributed({ restaurantId: restaurant.id, limit: 1 })).map((x) => x.orderId), ['P-2']);
    assert.equal((await repos.conversions.attributedSince({ restaurantId: restaurant.id, since: at(-60000) })).length, 2);
    assert.equal((await repos.conversions.attributedBetween(restaurant.id, at(-60000), at(60000))).length, 2);
  });

  it('excluir campanha apaga mensagens e pedidos; excluir contato mantém a mensagem', async () => {
    const { restaurant, contacts } = await fresh();
    const c = await repos.campaigns.create({ restaurantId: restaurant.id, name: 'Apagar', status: 'completed' });
    const [m1, m2] = await queue(c, contacts.slice(0, 2));
    await repos.conversions.createUnique({ restaurantId: restaurant.id, campaignId: c.id, messageId: m1.id, contactId: contacts[0].id, orderId: 'X-1', value: 1 });
    await repos.contacts.remove(contacts[1].id);
    assert.equal((await repos.messages.get(m2.id)).contactId, null);
    await repos.campaigns.remove(c.id);
    assert.equal(await repos.messages.get(m1.id), null);
    assert.deepEqual(await repos.conversions.summary({ restaurantId: restaurant.id }), { orders: 0, revenue: 0 });
  });

  it('transação desfaz tudo quando algo falha', async () => {
    const { restaurant } = await fresh();
    await assert.rejects(repos.tx(async (t) => {
      await t.campaigns.create({ restaurantId: restaurant.id, name: 'Dentro da transação' });
      throw new Error('falhou');
    }), /falhou/);
    assert.deepEqual(await repos.campaigns.list({ restaurantId: restaurant.id }), []);
  });
});
```

- [ ] **Step 2: Rode e veja falhar**

Run: `node --test test/db/campaigns-messages.test.js`
Expected: FAIL com `TypeError: Cannot read properties of undefined (reading 'create')`, porque ainda não existe `repos.campaigns`.

- [ ] **Step 3: Repositório de campanhas**

Crie `src/db/repositories/campaigns.js`:

```js
const { defineTable, isUuid, scopeId } = require('../mapper');
const { Repository } = require('./base');

const table = defineTable({
  name: 'campaigns',
  columns: ['restaurantId', 'name', 'objective', 'occasion', 'message', 'mediaUrl', 'destinationUrl', 'coupon', 'notes', 'segment', 'includeFooter', 'cloudTemplate', 'status', 'approval', 'approvalLog', 'provider', 'audienceSize', 'scheduledAt', 'startedAt', 'completedAt', 'waitingReason', 'lastError', 'demo'],
  json: ['segment', 'cloudTemplate', 'approval', 'approvalLog'],
});

class CampaignsRepo extends Repository {
  constructor(db) {
    super(db, table);
  }

  async list({ restaurantId } = {}) {
    if (!restaurantId) return this.all();
    return isUuid(restaurantId) ? this.where('restaurant_id = $1', [restaurantId]) : [];
  }

  byStatus(status) {
    return this.where('status = $1', [status], 'started_at, created_at, id');
  }

  dueScheduled(now) {
    return this.where("status = 'scheduled' AND scheduled_at <= $1", [now], 'scheduled_at, id');
  }

  /**
   * Muda a campanha só se ela ainda estiver num dos status esperados.
   * Evita corridas (dois disparos ao mesmo tempo, conclusão sobre uma pausa).
   */
  async transition(target, from, patch) {
    const id = target && typeof target === 'object' ? target.id : target;
    if (!isUuid(id)) return null;
    const map = this.table.toColumns({ ...patch, updatedAt: new Date().toISOString() });
    const params = [id, from];
    const sets = [...map].map(([col, value]) => `${col} = $${params.push(value)}`);
    const row = this.map(await this.db.one(`UPDATE campaigns SET ${sets.join(', ')} WHERE id = $1 AND status = ANY($2::text[]) RETURNING *`, params));
    if (row && target && typeof target === 'object') Object.assign(target, row);
    return row;
  }

  async hasActive(restaurantId) {
    if (!isUuid(restaurantId)) return false;
    return !!(await this.db.one("SELECT 1 FROM campaigns WHERE restaurant_id = $1 AND status IN ('sending', 'scheduled') LIMIT 1", [restaurantId]));
  }

  async anySending() {
    return !!(await this.db.one("SELECT 1 FROM campaigns WHERE status = 'sending' LIMIT 1"));
  }

  async mediaInUse(url) {
    return !!(await this.db.one("SELECT 1 FROM campaigns WHERE media_url = $1 AND status IN ('sending', 'paused', 'scheduled') LIMIT 1", [url]));
  }

  /** Campanhas iniciadas no período (relatório mensal), da mais antiga para a mais nova. */
  startedBetween(restaurantId, from, to) {
    return this.where('restaurant_id = $1 AND started_at >= $2 AND started_at < $3', [scopeId(restaurantId), from, to], 'started_at, id');
  }

  /** Campanhas que já saíram do rascunho (ranking do painel). */
  launched(restaurantId = null) {
    return this.where("status <> 'draft' AND ($1::uuid IS NULL OR restaurant_id = $1::uuid)", [scopeId(restaurantId)]);
  }

  async counts(restaurantId = null) {
    return this.db.one(`
      SELECT count(*)::int AS campaigns,
        count(*) FILTER (WHERE status IN ('sending', 'scheduled', 'paused'))::int AS active
      FROM campaigns WHERE ($1::uuid IS NULL OR restaurant_id = $1::uuid)`, [scopeId(restaurantId)]);
  }
}

module.exports = { CampaignsRepo, table };
```

- [ ] **Step 4: Repositório de mensagens**

Crie `src/db/repositories/messages.js`:

```js
const { defineTable, isUuid, scopeId } = require('../mapper');
const { Repository } = require('./base');
const { MessagingProvider } = require('../../messaging/MessagingProvider');

/** Ordem dos status de envio: uma confirmação nunca faz o status voltar. */
const STATUS_ORDER = ['queued', 'sending', 'sent', 'delivered', 'read'];

const table = defineTable({
  name: 'messages',
  columns: ['campaignId', 'restaurantId', 'contactId', 'name', 'phone', 'demo', 'code', 'status', 'text', 'error', 'provider', 'providerMessageId', 'queuedAt', 'sentAt', 'deliveredAt', 'readAt', 'failedAt', 'clickedAt', 'lastClickAt', 'repliedAt', 'convertedAt', 'clicks', 'reply', 'optOut'],
  hidden: ['phoneKey', 'seq'],
});

/** Regras de contagem do painel (eram o summarize() em JavaScript). */
const SUMMARY_COLUMNS = `
  count(*)::int AS audience,
  count(*) FILTER (WHERE status IN ('queued', 'sending'))::int AS queued,
  count(*) FILTER (WHERE sent_at IS NOT NULL)::int AS sent,
  count(*) FILTER (WHERE delivered_at IS NOT NULL OR status IN ('delivered', 'read'))::int AS delivered,
  count(*) FILTER (WHERE read_at IS NOT NULL OR status = 'read')::int AS read,
  count(*) FILTER (WHERE status = 'failed')::int AS failed,
  count(*) FILTER (WHERE status = 'skipped')::int AS skipped,
  count(*) FILTER (WHERE clicked_at IS NOT NULL)::int AS clicked,
  COALESCE(sum(clicks), 0)::int AS clicks,
  count(*) FILTER (WHERE replied_at IS NOT NULL)::int AS replied,
  count(*) FILTER (WHERE opt_out)::int AS opt_outs`;

const fromSummary = (r) => ({
  audience: r.audience, queued: r.queued, sent: r.sent, delivered: r.delivered, read: r.read, failed: r.failed,
  skipped: r.skipped, clicked: r.clicked, clicks: r.clicks, replied: r.replied, optOuts: r.opt_outs,
});

const iso = (value) => (value ? new Date(value).toISOString() : null);

class MessagesRepo extends Repository {
  constructor(db) {
    super(db, table);
  }

  beforeWrite(data) {
    return data.phone !== undefined ? { ...data, phoneKey: MessagingProvider.phoneKey(data.phone) } : data;
  }

  async byCampaign(campaignId) {
    return isUuid(campaignId) ? this.where('campaign_id = $1', [campaignId], 'seq') : [];
  }

  byCode(code) {
    return this.first('code = $1', [String(code)]);
  }

  async byProviderId(providerMessageId) {
    return providerMessageId ? this.first('provider_message_id = $1', [String(providerMessageId)]) : null;
  }

  /** Ao subir o servidor: o que ficou "enviando" volta para a fila. */
  async requeueSending() {
    const res = await this.db.query("UPDATE messages SET status = 'queued', updated_at = now() WHERE status = 'sending'");
    return res.rowCount ?? res.affectedRows ?? 0;
  }

  /** Reserva a próxima mensagem da fila (atômico: a mesma nunca é entregue duas vezes). */
  async claimNext(campaignId) {
    return this.map(await this.db.one(`
      UPDATE messages SET status = 'sending', updated_at = now()
      WHERE id = (
        SELECT id FROM messages WHERE campaign_id = $1 AND status = 'queued'
        ORDER BY seq LIMIT 1 FOR UPDATE SKIP LOCKED
      )
      RETURNING *`, [campaignId]));
  }

  async hasQueued(campaignId) {
    return !!(await this.db.one("SELECT 1 FROM messages WHERE campaign_id = $1 AND status = 'queued' LIMIT 1", [campaignId]));
  }

  async skipQueued(campaignId, error) {
    return this.mapAll(await this.db.many("UPDATE messages SET status = 'skipped', error = $2, updated_at = now() WHERE campaign_id = $1 AND status = 'queued' RETURNING *", [campaignId, error]));
  }

  async countSentSince(since) {
    return (await this.db.one('SELECT count(*)::int AS n FROM messages WHERE sent_at >= $1', [since])).n;
  }

  /** Envio aceito pelo provedor; uma confirmação que já chegou (entregue/lida) é mantida. */
  async markSent(id, { provider, providerMessageId, sentAt }) {
    return this.map(await this.db.one(`
      UPDATE messages SET
        status = CASE WHEN status IN ('delivered', 'read') THEN status ELSE 'sent' END,
        provider = $2, provider_message_id = $3, sent_at = $4, error = NULL, updated_at = now()
      WHERE id = $1 RETURNING *`, [id, provider, providerMessageId, sentAt]));
  }

  /** Confirmação de entrega ou leitura. Fora de ordem, nunca faz o status voltar. */
  async applyAck(providerMessageId, status, at) {
    return this.map(await this.db.one(`
      UPDATE messages SET
        status = $2,
        delivered_at = CASE WHEN $2 IN ('delivered', 'read') THEN COALESCE(delivered_at, $3) ELSE delivered_at END,
        read_at = CASE WHEN $2 = 'read' THEN $3 ELSE read_at END,
        updated_at = now()
      WHERE provider_message_id = $1
        AND COALESCE(array_position($4::text[], status), 0) < array_position($4::text[], $2)
      RETURNING *`, [providerMessageId, status, at, STATUS_ORDER]));
  }

  async markFailedByProvider(providerMessageId, error, at) {
    return this.map(await this.db.one("UPDATE messages SET status = 'failed', error = $2, failed_at = $3, updated_at = now() WHERE provider_message_id = $1 RETURNING *", [providerMessageId, error, at]));
  }

  async registerClick(id, at) {
    return this.map(await this.db.one('UPDATE messages SET clicks = clicks + 1, clicked_at = COALESCE(clicked_at, $2), last_click_at = $2, updated_at = now() WHERE id = $1 RETURNING *', [id, at]));
  }

  lastSentToPhoneKey(key) {
    return this.first('phone_key = $1 AND sent_at IS NOT NULL', [key], 'sent_at DESC');
  }

  async registerReply(id, { reply, optOut, at }) {
    return this.map(await this.db.one('UPDATE messages SET replied_at = $2, reply = $3, opt_out = $4, updated_at = now() WHERE id = $1 AND replied_at IS NULL RETURNING *', [id, at, reply, optOut]));
  }

  async markConverted(id, at) {
    return this.map(await this.db.one('UPDATE messages SET converted_at = $2, updated_at = now() WHERE id = $1 AND converted_at IS NULL RETURNING *', [id, at]));
  }

  /** Contagens brutas para um filtro (restaurante, campanha e/ou período de envio). */
  async summary({ restaurantId, campaignId, sentFrom, sentTo } = {}) {
    const where = ['TRUE'];
    const params = [];
    if (restaurantId) where.push(`restaurant_id = $${params.push(scopeId(restaurantId))}`);
    if (campaignId) where.push(`campaign_id = $${params.push(scopeId(campaignId))}`);
    if (sentFrom) where.push(`sent_at >= $${params.push(sentFrom)}`);
    if (sentTo) where.push(`sent_at < $${params.push(sentTo)}`);
    return fromSummary(await this.db.one(`SELECT ${SUMMARY_COLUMNS} FROM messages WHERE ${where.join(' AND ')}`, params));
  }

  /** Contagens por campanha, numa consulta só. */
  async summaryByCampaign(campaignIds) {
    const ids = campaignIds.filter(isUuid);
    if (!ids.length) return new Map();
    const rows = await this.db.many(`SELECT campaign_id, ${SUMMARY_COLUMNS} FROM messages WHERE campaign_id = ANY($1::uuid[]) GROUP BY campaign_id`, [ids]);
    return new Map(rows.map((r) => [r.campaign_id, fromSummary(r)]));
  }

  /** Envios, leituras e cliques a partir de um instante (série diária do painel). */
  async timelineSince({ restaurantId, since }) {
    const rows = await this.db.many(`
      SELECT sent_at, read_at, clicked_at FROM messages
      WHERE ($1::uuid IS NULL OR restaurant_id = $1::uuid)
        AND (sent_at >= $2 OR read_at >= $2 OR clicked_at >= $2)`, [scopeId(restaurantId), since]);
    return rows.map((r) => ({ sentAt: iso(r.sent_at), readAt: iso(r.read_at), clickedAt: iso(r.clicked_at) }));
  }

  /** Envios do período (relatório mensal): data de envio e de clique. */
  async sentBetween(restaurantId, from, to) {
    const rows = await this.db.many('SELECT sent_at, clicked_at FROM messages WHERE restaurant_id = $1 AND sent_at >= $2 AND sent_at < $3', [scopeId(restaurantId), from, to]);
    return rows.map((r) => ({ sentAt: iso(r.sent_at), clickedAt: iso(r.clicked_at) }));
  }

  /** Meses (AAAA-MM, em UTC, como o antigo sentAt.slice(0, 7)) com algum envio. */
  async sentMonths(restaurantId) {
    const rows = await this.db.many("SELECT DISTINCT to_char(sent_at AT TIME ZONE 'UTC', 'YYYY-MM') AS month FROM messages WHERE restaurant_id = $1 AND sent_at IS NOT NULL", [scopeId(restaurantId)]);
    return rows.map((r) => r.month);
  }
}

module.exports = { MessagesRepo, table, STATUS_ORDER };
```

- [ ] **Step 5: Repositório de pedidos**

Crie `src/db/repositories/conversions.js`:

```js
const { defineTable, isUuid, scopeId } = require('../mapper');
const { Repository } = require('./base');

const table = defineTable({
  name: 'conversions',
  columns: ['restaurantId', 'campaignId', 'messageId', 'contactId', 'code', 'customerName', 'orderId', 'value', 'items'],
  json: ['items'],
  numeric: ['value'],
});

const fromTotals = (row) => ({ orders: row.orders, revenue: Number(row.revenue) });

class ConversionsRepo extends Repository {
  constructor(db) {
    super(db, table);
  }

  /** Registra o pedido; número de pedido repetido no restaurante devolve null. */
  createUnique(data) {
    return this.create(data, { onConflict: 'ON CONFLICT (restaurant_id, order_id) WHERE order_id IS NOT NULL DO NOTHING' });
  }

  async summary({ restaurantId, campaignId, attributedOnly = false, from, to } = {}) {
    const where = ['TRUE'];
    const params = [];
    if (restaurantId) where.push(`restaurant_id = $${params.push(scopeId(restaurantId))}`);
    if (campaignId) where.push(`campaign_id = $${params.push(scopeId(campaignId))}`);
    if (attributedOnly) where.push('campaign_id IS NOT NULL');
    if (from) where.push(`created_at >= $${params.push(from)}`);
    if (to) where.push(`created_at < $${params.push(to)}`);
    return fromTotals(await this.db.one(`SELECT count(*)::int AS orders, COALESCE(sum(value), 0) AS revenue FROM conversions WHERE ${where.join(' AND ')}`, params));
  }

  async summaryByCampaign(campaignIds) {
    const ids = campaignIds.filter(isUuid);
    if (!ids.length) return new Map();
    const rows = await this.db.many('SELECT campaign_id, count(*)::int AS orders, COALESCE(sum(value), 0) AS revenue FROM conversions WHERE campaign_id = ANY($1::uuid[]) GROUP BY campaign_id', [ids]);
    return new Map(rows.map((r) => [r.campaign_id, fromTotals(r)]));
  }

  /** Pedidos atribuídos a campanhas a partir de um instante (série do painel). */
  attributedSince({ restaurantId, since }) {
    return this.where('campaign_id IS NOT NULL AND ($1::uuid IS NULL OR restaurant_id = $1::uuid) AND created_at >= $2', [scopeId(restaurantId), since]);
  }

  /** Últimos pedidos atribuídos a campanhas. */
  async recentAttributed({ restaurantId, limit = 6 }) {
    return this.mapAll(await this.db.many('SELECT * FROM conversions WHERE campaign_id IS NOT NULL AND ($1::uuid IS NULL OR restaurant_id = $1::uuid) ORDER BY created_at DESC LIMIT $2', [scopeId(restaurantId), limit]));
  }

  /** Pedidos atribuídos no período (relatório mensal). */
  attributedBetween(restaurantId, from, to) {
    return this.where('restaurant_id = $1 AND campaign_id IS NOT NULL AND created_at >= $2 AND created_at < $3', [scopeId(restaurantId), from, to]);
  }
}

module.exports = { ConversionsRepo, table };
```

- [ ] **Step 6: `index.js` final**

Substitua `src/db/repositories/index.js` inteiro:

```js
const { RestaurantsRepo } = require('./restaurants');
const { UsersRepo } = require('./users');
const { SettingsRepo, DEFAULT_SETTINGS } = require('./settings');
const { ContactsRepo } = require('./contacts');
const { CampaignsRepo } = require('./campaigns');
const { MessagesRepo } = require('./messages');
const { ConversionsRepo } = require('./conversions');

/**
 * Configurações vistas de dentro de uma transação: leitura da cópia em memória.
 * Gravar ali usaria o banco de fora da transação (e travaria no PGlite), então falha na hora.
 */
const readOnlySettings = (settings) => ({
  get: () => settings.get(),
  load: async () => { throw new Error('As configurações não podem ser recarregadas dentro de uma transação.'); },
  update: async () => { throw new Error('As configurações não podem ser alteradas dentro de uma transação.'); },
});

/**
 * Repositórios ligados a um banco (ou a uma transação).
 * repos.tx(async (r) => …) entrega os mesmos repositórios dentro de uma
 * transação. Dentro do callback use SÓ o `r` recebido (ver Database#tx).
 * Dentro da transação as configurações são só leitura (r.settings.get()).
 */
function createRepositories(db, { settings = new SettingsRepo(db) } = {}) {
  return {
    db,
    settings,
    restaurants: new RestaurantsRepo(db),
    users: new UsersRepo(db),
    contacts: new ContactsRepo(db),
    campaigns: new CampaignsRepo(db),
    messages: new MessagesRepo(db),
    conversions: new ConversionsRepo(db),
    tx(fn) {
      return db.tx((t) => fn(createRepositories(t, { settings: readOnlySettings(settings) })));
    },
    /** Apaga todos os dados (as tabelas filhas vão junto) e volta as configurações ao padrão (npm run seed). */
    async reset() {
      await db.exec("TRUNCATE restaurants, users, contacts, campaigns, messages, conversions CASCADE; UPDATE settings SET data = '{}' WHERE id = 1;");
      await settings.load();
    },
  };
}

module.exports = { createRepositories, DEFAULT_SETTINGS };
```

E acrescente, como **último** teste de `test/db/campaigns-messages.test.js` (ele apaga o banco do arquivo):

```js
  it('reset apaga todos os dados e volta as configurações ao padrão', async () => {
    await repos.settings.load();
    await repos.settings.update({ footer: 'Outro rodapé' });
    await repos.reset();
    assert.equal(await repos.restaurants.count(), 0);
    assert.equal(await repos.messages.count(), 0);
    assert.equal(repos.settings.get().footer, 'Responda SAIR para não receber mais mensagens.');
  });
```

- [ ] **Step 7: Rode e veja passar**

Run: `node --test test/db/`
Expected: todos os arquivos de `test/db` passam.

- [ ] **Step 8: Commit**

```bash
git add src/db/repositories test/db/campaigns-messages.test.js
git commit -m "Repositórios de campanhas, mensagens e pedidos: fila atômica e contagens em SQL

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: A troca: serviços, rotas e seed sobre o PostgreSQL

Esta tarefa é inevitavelmente grande. O acesso a dados passa de síncrono para assíncrono, e todos os pontos que o usam mudam juntos. O portão de qualidade é a bateria de caracterização das Tasks 1 e 2, que precisa continuar 100% verde, mais os testes novos de corrida da fila.

**Files:**
- Modify: `src/bootstrap.js` e `src/app.js` (arquivos inteiros), `src/services/AuthService.js` (`login`, `middleware`), `src/services/AnalyticsService.js`, `src/services/ReportService.js` e `src/services/DispatchService.js` (arquivos inteiros), `src/http/api.js` e `src/http/public.js` (arquivos inteiros), `src/seed.js` (função `seed` e bloco final), `src/messaging/index.js:33`, `test/helpers/app.js`, `test/http/contacts.test.js`
- Delete: `src/db/JsonStore.js`, `src/db/repositories.js`
- Test: `test/services/dispatch.test.js`

**Interfaces:**
- Consumes: tudo da Task 8; `createRepositories`, `Database`, `migrate`.
- Produces:
  - `createApp({ config, overrides, seed, logger })` sobre o PostgreSQL;
  - `buildContainer({ config, db, logger, overrides })`;
  - `AnalyticsService.withRates(counts, sales)` (estático), `#campaignStats(id)`, `#statsForCampaigns(ids) → Map`, `#overview()` (todos assíncronos);
  - `ReportService#availableMonths()`, `#totals()`, `#monthly()` (assíncronos);
  - `DispatchService`: `init()` assíncrono, `stop()`, `idle()`, `track(promise)`, `publishProgress(campaign)` e `publishProgressById(id)`; `start()`, `schedule()`, `pause()`, `resume()`, `cancel()`, `checkSchedules()`, `sendTest()`, `handleAck()` e `handleIncoming()` assíncronos;
  - `seed(repos, { reset })` assíncrono.

- [ ] **Step 1: Escreva os testes novos (corridas da fila e telefone repetido na edição)**

Crie `test/services/dispatch.test.js`:

```js
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { openTestDb } = require('../helpers/db');
const { waitFor } = require('../helpers/app');
const { createRepositories } = require('../../src/db/repositories/index');
const { DispatchService } = require('../../src/services/DispatchService');
const { TemplateService } = require('../../src/services/TemplateService');

/** Canal falso: aceita tudo e guarda o que foi enviado. */
class FakeMessaging extends EventEmitter {
  constructor() {
    super();
    this.key = 'simulator';
    this.sent = [];
    this.next = 1;
  }

  isConnected() { return true; }

  getStatus() { return { state: 'connected' }; }

  async send({ to, text }) {
    const providerMessageId = `fake-${this.next++}`;
    this.sent.push({ to, text, providerMessageId });
    return { providerMessageId, to };
  }
}

describe('fila de disparo sobre o banco', () => {
  let db;
  let repos;
  let messaging;
  let dispatch;
  let restaurant;
  const statusOf = async (id) => (await repos.campaigns.get(id)).status;

  before(async () => {
    db = await openTestDb();
    repos = createRepositories(db);
    await repos.settings.load();
    messaging = new FakeMessaging();
    dispatch = new DispatchService({
      repos,
      messaging,
      templates: new TemplateService({ settings: repos.settings }),
      media: { resolve: () => undefined },
      events: { publish() {} },
      config: { publicUrl: 'http://teste.local', simulatorPace: { min: 0, max: 0 } },
      logger: { log() {}, error() {}, warn() {} },
    });
    restaurant = await repos.restaurants.create({ name: 'Fila', slug: 'fila', requireApproval: false });
    await repos.contacts.insertMany([1, 2, 3].map((i) => ({ restaurantId: restaurant.id, name: `Pessoa ${i}`, phone: `553197000000${i}`, optIn: true })));
  });
  after(async () => {
    dispatch.stop();
    await dispatch.idle();
    await db.close();
  });

  it('dois disparos ao mesmo tempo criam a fila uma vez só', async () => {
    const c = await repos.campaigns.create({ restaurantId: restaurant.id, name: 'Corrida', message: 'Oi {{primeiro_nome}}' });
    const results = await Promise.allSettled([dispatch.start(c.id), dispatch.start(c.id)]);
    assert.deepEqual(results.map((x) => x.status).sort(), ['fulfilled', 'rejected']);
    assert.equal(results.find((x) => x.status === 'rejected').reason.message, 'Esta campanha já foi iniciada.');
    await waitFor(async () => (await statusOf(c.id)) === 'completed', { message: 'campanha concluída' });
    assert.equal((await repos.messages.byCampaign(c.id)).length, 3);
    assert.equal(messaging.sent.length, 3);
    assert.equal(new Set(messaging.sent.map((s) => s.to)).size, 3);
  });

  it('confirmação que chega antes de o envio ser gravado é aplicada logo depois', async () => {
    const c = await repos.campaigns.create({ restaurantId: restaurant.id, name: 'Ack cedo', message: 'Oi', status: 'completed' });
    const [contact] = await repos.contacts.byRestaurant(restaurant.id);
    const [m] = await repos.messages.insertMany([{ campaignId: c.id, restaurantId: restaurant.id, contactId: contact.id, name: contact.name, phone: contact.phone, code: 'ackcedo1', status: 'sending' }]);
    const pending = dispatch.handleAck({ providerMessageId: 'chega-cedo', status: 'delivered' });
    await new Promise((r) => { setTimeout(r, 100); });
    await repos.messages.markSent(m.id, { provider: 'simulator', providerMessageId: 'chega-cedo', sentAt: new Date().toISOString() });
    await pending;
    const updated = await repos.messages.get(m.id);
    assert.equal(updated.status, 'delivered');
    assert.ok(updated.deliveredAt);
  });

  it('agendamento vencido dispara; sem aprovação volta para rascunho com o motivo', async () => {
    const strict = await repos.restaurants.create({ name: 'Exige aprovação', slug: 'exige' });
    await repos.contacts.create({ restaurantId: strict.id, name: 'Alguém', phone: '5531970009999', optIn: true });
    const past = new Date(Date.now() - 1000).toISOString();
    const ok = await repos.campaigns.create({ restaurantId: restaurant.id, name: 'Agendada', message: 'Oi', status: 'scheduled', scheduledAt: past });
    const blocked = await repos.campaigns.create({ restaurantId: strict.id, name: 'Sem aprovação', message: 'Oi', status: 'scheduled', scheduledAt: past });
    await dispatch.checkSchedules();
    assert.ok(['sending', 'completed'].includes(await statusOf(ok.id)));
    const after = await repos.campaigns.get(blocked.id);
    assert.equal(after.status, 'draft');
    assert.equal(after.lastError, 'Esta campanha precisa ser aprovada pelo restaurante antes do envio.');
  });

  it('uma pausa no meio do envio não é desfeita pela conclusão', async () => {
    const c = await repos.campaigns.create({ restaurantId: restaurant.id, name: 'Pausa', message: 'Oi', status: 'sending', startedAt: new Date().toISOString() });
    const stale = { ...c };
    await repos.campaigns.update(c.id, { status: 'paused' });
    await dispatch.complete(stale);
    assert.equal(await statusOf(c.id), 'paused');
  });
});
```

Em `test/http/contacts.test.js`, acrescente este teste logo depois de `'edição valida o telefone e acusa contato inexistente'`. Ele registra o comportamento novo: o JSON aceitava telefone duplicado na edição.

```js
  it('editar o telefone para um que já existe é recusado', async () => {
    const marina = await byName('Marina S.');
    const bruno = await byName('Bruno Lima');
    const res = await ctx.agency.put(`/api/contacts/${bruno.id}`, { phone: marina.phone });
    assert.equal(res.status, 400);
    assert.equal(res.data.error, 'Este telefone já está na base.');
  });
```

- [ ] **Step 2: Rode e veja falhar**

Run: `node --test test/services/dispatch.test.js test/http/contacts.test.js`
Expected: FAIL. O DispatchService ainda usa os repositórios síncronos (`this.repos.contacts.filter is not a function`), e o teste de telefone repetido devolve 200.

- [ ] **Step 3: Composição: `src/bootstrap.js`**

Substitua o arquivo inteiro:

```js
const { Container } = require('./container');
const defaultConfig = require('./config');
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
```

- [ ] **Step 4: `src/app.js` sobre o banco**

Substitua o arquivo inteiro:

```js
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
  const db = await Database.open(config);
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
```

- [ ] **Step 5: `AuthService` assíncrono**

Em `src/services/AuthService.js`, troque `login` e `middleware`:

```js
  async login(email, password) {
    const mail = String(email).trim().toLowerCase();
    if (this.safeEqual(mail, this.admin.email.toLowerCase()) && this.safeEqual(password, this.admin.password)) {
      return this.tokenFor({ role: 'agency', email: this.admin.email, name: this.admin.name });
    }
    const user = await this.repos.users.byEmail(mail);
    if (!user || !AuthService.checkPassword(password, user.passwordHash)) return null;
    const restaurant = await this.repos.restaurants.get(user.restaurantId);
    if (!restaurant) return null;
    await this.repos.users.update(user, { lastLoginAt: new Date().toISOString() });
    return this.tokenFor({ role: 'restaurant', userId: user.id, restaurantId: user.restaurantId, email: user.email, name: user.name, restaurant: restaurant.name });
  }
```

```js
  middleware() {
    return (req, res, next) => {
      const user = this.verify(this.readCookie(req));
      const expired = () => res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });
      if (!user) return expired();
      if (user.role !== 'restaurant') {
        req.user = user;
        return next();
      }
      // Usuário de restaurante removido perde o acesso na hora
      return this.repos.users.get(user.userId).then((found) => {
        if (!found) return expired();
        req.user = user;
        return next();
      }, next);
    };
  }
```

- [ ] **Step 6: `AnalyticsService`: contagens no SQL, taxas aqui**

Substitua `src/services/AnalyticsService.js` inteiro:

```js
const DAY = 24 * 60 * 60 * 1000;
const dayKey = (iso) => (iso ? new Date(iso).toLocaleDateString('sv-SE') : null);
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const round2 = (v) => Math.round(v * 100) / 100;

const EMPTY_COUNTS = { audience: 0, queued: 0, sent: 0, delivered: 0, read: 0, failed: 0, skipped: 0, clicked: 0, clicks: 0, replied: 0, optOuts: 0 };
const NO_SALES = { orders: 0, revenue: 0 };

/** Meia-noite (fuso do servidor) do primeiro dia de uma série de `days` dias. */
const seriesStart = (days) => {
  const d = new Date(Date.now() - (days - 1) * DAY);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};

/**
 * Etapa 8 do fluxo — Análise. Indicadores de desempenho das campanhas.
 * As regras de contagem ficam no SQL (messages.summary e conversions.summary);
 * aqui se calculam as taxas e se montam as séries diárias.
 */
class AnalyticsService {
  constructor({ repos }) {
    this.repos = repos;
  }

  /** Taxas a partir das contagens brutas (mesmo formato do antigo summarize()). */
  static withRates(counts = EMPTY_COUNTS, sales = NO_SALES) {
    const s = { ...EMPTY_COUNTS, ...counts };
    s.orders = sales.orders;
    s.revenue = round2(sales.revenue);
    s.processed = s.audience - s.queued;
    s.progress = pct(s.processed, s.audience);
    s.deliveryRate = pct(s.delivered, s.sent);
    s.readRate = pct(s.read, s.delivered);
    s.clickRate = pct(s.clicked, s.delivered);
    s.conversionRate = pct(s.orders, s.clicked);
    s.ticket = s.orders ? round2(s.revenue / s.orders) : 0;
    return s;
  }

  async campaignStats(campaignId) {
    return (await this.statsForCampaigns([campaignId])).get(campaignId);
  }

  /** Estatísticas de várias campanhas com duas consultas agrupadas. */
  async statsForCampaigns(ids) {
    const [counts, sales] = await Promise.all([
      this.repos.messages.summaryByCampaign(ids),
      this.repos.conversions.summaryByCampaign(ids),
    ]);
    return new Map(ids.map((id) => [id, AnalyticsService.withRates(counts.get(id), sales.get(id))]));
  }

  async overview({ restaurantId, days = 14 } = {}) {
    const scope = restaurantId || null;
    const since = seriesStart(days);
    // Só entram pedidos atribuídos a campanhas (vindos de um link rastreável)
    const [counts, sales, timeline, orders, launched, recent, base, campaignCounts, restaurants] = await Promise.all([
      this.repos.messages.summary({ restaurantId: scope }),
      this.repos.conversions.summary({ restaurantId: scope, attributedOnly: true }),
      this.repos.messages.timelineSince({ restaurantId: scope, since }),
      this.repos.conversions.attributedSince({ restaurantId: scope, since }),
      this.repos.campaigns.launched(scope),
      this.repos.conversions.recentAttributed({ restaurantId: scope, limit: 6 }),
      this.repos.contacts.stats({ restaurantId: scope }),
      this.repos.campaigns.counts(scope),
      this.repos.restaurants.all(),
    ]);

    // Série diária
    const series = [];
    const index = {};
    for (let i = days - 1; i >= 0; i -= 1) {
      const key = dayKey(new Date(Date.now() - i * DAY).toISOString());
      const row = { day: key, sent: 0, read: 0, clicks: 0, orders: 0, revenue: 0 };
      index[key] = row;
      series.push(row);
    }
    for (const m of timeline) {
      if (index[dayKey(m.sentAt)]) index[dayKey(m.sentAt)].sent += 1;
      if (index[dayKey(m.readAt)]) index[dayKey(m.readAt)].read += 1;
      if (index[dayKey(m.clickedAt)]) index[dayKey(m.clickedAt)].clicks += 1;
    }
    for (const c of orders) {
      const row = index[dayKey(c.createdAt)];
      if (row) { row.orders += 1; row.revenue += Number(c.value) || 0; }
    }

    const names = new Map(restaurants.map((r) => [r.id, r.name]));
    const stats = await this.statsForCampaigns(launched.map((c) => c.id));
    const ranking = launched
      .map((c) => ({
        id: c.id,
        name: c.name,
        status: c.status,
        restaurant: names.get(c.restaurantId) || '—',
        startedAt: c.startedAt,
        stats: stats.get(c.id),
      }))
      .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));

    const campaignNames = new Map(launched.map((c) => [c.id, c.name]));
    const recentOrders = recent.map((c) => ({
      ...c,
      campaign: campaignNames.get(c.campaignId) || 'Pedido direto',
      restaurant: names.get(c.restaurantId) || '',
    }));

    return {
      totals: AnalyticsService.withRates(counts, sales),
      series,
      campaigns: ranking,
      recentOrders,
      contacts: { total: base.total, authorized: base.authorized, optedOut: base.optedOut },
      counts: {
        restaurants: restaurantId ? 1 : restaurants.length,
        campaigns: campaignCounts.campaigns,
        active: campaignCounts.active,
      },
    };
  }
}

module.exports = { AnalyticsService };
```

- [ ] **Step 7: `ReportService` assíncrono**

Substitua `src/services/ReportService.js` inteiro:

```js
const { AnalyticsService } = require('./AnalyticsService');

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

const monthRange = (month) => {
  const [y, m] = String(month).split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) throw new Error('Mês inválido. Use o formato AAAA-MM.');
  return { start: new Date(y, m - 1, 1), end: new Date(y, m, 1), y, m };
};
const shift = (month, delta) => {
  const { y, m } = monthRange(month);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const variation = (now, before) => (before ? Math.round(((now - before) / before) * 1000) / 10 : null);

/**
 * Relatório mensal do restaurante (enviado em PDF pela agência).
 */
class ReportService {
  constructor({ repos, analytics }) {
    this.repos = repos;
    this.analytics = analytics;
  }

  static currentMonth() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  /** Meses que têm algum envio para o restaurante (para o seletor). */
  async availableMonths(restaurantId) {
    const set = new Set([ReportService.currentMonth()]);
    for (const m of await this.repos.messages.sentMonths(restaurantId)) set.add(m);
    return [...set].sort().reverse();
  }

  async totals(restaurantId, month) {
    const { start, end } = monthRange(month);
    const from = start.toISOString();
    const to = end.toISOString();
    const [counts, sales] = await Promise.all([
      this.repos.messages.summary({ restaurantId, sentFrom: from, sentTo: to }),
      this.repos.conversions.summary({ restaurantId, attributedOnly: true, from, to }),
    ]);
    return { summary: AnalyticsService.withRates(counts, sales), start, end, from, to };
  }

  async monthly({ restaurantId, month = ReportService.currentMonth() }) {
    const restaurant = await this.repos.restaurants.get(restaurantId);
    if (!restaurant) throw Object.assign(new Error('Restaurante não encontrado.'), { status: 404 });

    const cur = await this.totals(restaurantId, month);
    const prev = (await this.totals(restaurantId, shift(month, -1))).summary;
    const { y, m } = monthRange(month);
    const s = cur.summary;
    const inMonth = (iso) => iso && new Date(iso) >= cur.start && new Date(iso) < cur.end;

    const [sent, orders, started, base] = await Promise.all([
      this.repos.messages.sentBetween(restaurantId, cur.from, cur.to),
      this.repos.conversions.attributedBetween(restaurantId, cur.from, cur.to),
      this.repos.campaigns.startedBetween(restaurantId, cur.from, cur.to),
      this.repos.contacts.stats({ restaurantId, from: cur.from, to: cur.to }),
    ]);

    // Dia a dia
    const days = new Date(y, m, 0).getDate();
    const daily = Array.from({ length: days }, (_, i) => ({ day: i + 1, sent: 0, clicks: 0, orders: 0, revenue: 0 }));
    for (const msg of sent) {
      daily[new Date(msg.sentAt).getDate() - 1].sent += 1;
      if (inMonth(msg.clickedAt)) daily[new Date(msg.clickedAt).getDate() - 1].clicks += 1;
    }
    const weekdays = WEEKDAYS.map((name) => ({ name, orders: 0, revenue: 0 }));
    const items = {};
    for (const c of orders) {
      const d = new Date(c.createdAt);
      daily[d.getDate() - 1].orders += 1;
      daily[d.getDate() - 1].revenue += Number(c.value) || 0;
      weekdays[d.getDay()].orders += 1;
      weekdays[d.getDay()].revenue += Number(c.value) || 0;
      for (const it of c.items || []) {
        const k = it.name || 'Item';
        items[k] = items[k] || { name: k, qty: 0, revenue: 0 };
        items[k].qty += Number(it.qty) || 1;
        items[k].revenue += (Number(it.price) || 0) * (Number(it.qty) || 1);
      }
    }

    const stats = await this.analytics.statsForCampaigns(started.map((c) => c.id));
    const campaigns = started.map((c) => ({ id: c.id, name: c.name, objective: c.objective, startedAt: c.startedAt, mediaUrl: c.mediaUrl || null, stats: stats.get(c.id) }));
    const best = campaigns.slice().sort((a, b) => b.stats.revenue - a.stats.revenue)[0] || null;
    const bestDay = weekdays.slice().sort((a, b) => b.orders - a.orders)[0];

    return {
      generatedAt: new Date().toISOString(),
      month,
      monthLabel: `${MONTHS[m - 1]} de ${y}`,
      restaurant: { id: restaurant.id, name: restaurant.name, segment: restaurant.segment, city: restaurant.city, color: restaurant.color, coupon: restaurant.coupon },
      totals: s,
      previous: { month: shift(month, -1), sent: prev.sent, clicked: prev.clicked, orders: prev.orders, revenue: prev.revenue },
      change: {
        sent: variation(s.sent, prev.sent),
        clicked: variation(s.clicked, prev.clicked),
        orders: variation(s.orders, prev.orders),
        revenue: variation(s.revenue, prev.revenue),
      },
      daily,
      campaigns,
      best: best && best.stats.revenue > 0 ? { name: best.name, revenue: best.stats.revenue, orders: best.stats.orders } : null,
      bestWeekday: bestDay && bestDay.orders ? bestDay : null,
      topItems: Object.values(items).sort((a, b) => b.qty - a.qty).slice(0, 6),
      base: { authorized: base.authorized, newThisMonth: base.createdInRange, optOutsThisMonth: base.optedOutInRange },
    };
  }
}

module.exports = { ReportService };
```

- [ ] **Step 8: `DispatchService`: fila assíncrona e atômica**

Substitua `src/services/DispatchService.js` inteiro:

```js
const crypto = require('crypto');
const { MessagingProvider } = require('../messaging/MessagingProvider');

const ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const normalizeText = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
/** Meia-noite (UTC) de hoje: o limite diário conta os envios desde então. */
const startOfTodayUtc = () => `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;

/** Chave de comparação de telefone: DDD + últimos 8 dígitos (ignora o 9º dígito). */
const phoneKey = (phone) => MessagingProvider.phoneKey(phone);

/**
 * Fila de disparo das campanhas.
 *
 * Depende apenas do contrato de mensageria (injeção de dependência): não sabe
 * se o envio vai pelo WPPConnect, pela API Oficial ou pelo simulador.
 * Um envio por vez, com intervalo aleatório entre mensagens, limite diário e
 * janela de horário — boas práticas para proteger o número do restaurante.
 * As mudanças de estado são atômicas no banco (reserva da mensagem, status
 * que nunca volta, conclusão que respeita uma pausa).
 */
class DispatchService {
  constructor({ repos, messaging, templates, media, events, config, logger = console }) {
    this.repos = repos;
    this.messaging = messaging;
    this.templates = templates;
    this.media = media;
    this.events = events;
    this.config = config;
    this.logger = logger;
    this.timer = null;
    this.busy = false;
    this.stopped = false;
    this.checking = false;
    this.pending = new Set();
  }

  async init() {
    this.messaging.on('ack', (e) => this.track(this.handleAck(e)));
    this.messaging.on('incoming', (e) => this.track(this.handleIncoming(e)));
    this.messaging.on('status', (s) => {
      this.events.publish('messaging:status', s);
      if (s.state === 'connected') this.kick();
    });
    this.messaging.on('outbox', (item) => this.events.publish('outbox', item));

    // Mensagens que estavam "enviando" quando o servidor caiu voltam para a fila
    await this.repos.messages.requeueSending();
    this.scheduleTimer = setInterval(() => this.track(this.checkSchedules()), 15000).unref();
    await this.checkSchedules();
    this.kick();
  }

  /** Acompanha tarefas em segundo plano (confirmações, respostas) e registra os erros. */
  track(promise) {
    const task = Promise.resolve(promise).catch((err) => this.logger.error('[dispatch]', err));
    this.pending.add(task);
    task.finally(() => this.pending.delete(task));
    return task;
  }

  /** Para a fila e os agendamentos (desligamento do servidor e testes). */
  stop() {
    this.stopped = true;
    clearInterval(this.scheduleTimer);
    clearTimeout(this.timer);
    this.timer = null;
  }

  /** Espera o passo atual e as tarefas em andamento (antes de fechar o banco). */
  async idle() {
    while (this.busy || this.pending.size) {
      await Promise.all([...this.pending]);
      if (this.busy) await new Promise((r) => { setTimeout(r, 10); });
    }
  }

  // ── Público-alvo ───────────────────────────────────────────

  audience(restaurantId, segment = {}) {
    return this.repos.contacts.audience(restaurantId, segment);
  }

  // ── Ciclo de vida da campanha ──────────────────────────────

  newCode() {
    const bytes = crypto.randomBytes(6);
    return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
  }

  trackingLink(code) {
    return `${this.config.publicUrl}/r/${code}`;
  }

  async start(campaignId) {
    const campaign = await this.mustGet(campaignId);
    if (!['draft', 'scheduled'].includes(campaign.status)) throw new Error('Esta campanha já foi iniciada.');
    if (!campaign.message?.trim()) throw new Error('Escreva a mensagem antes de disparar.');
    const restaurant = await this.repos.restaurants.get(campaign.restaurantId);
    if (!restaurant) throw new Error('Restaurante não encontrado.');
    this.assertApproved(campaign, restaurant);

    const contacts = await this.audience(campaign.restaurantId, campaign.segment);
    if (!contacts.length) throw new Error('Nenhum contato autorizado corresponde a esta segmentação.');

    const at = new Date().toISOString();
    const queue = contacts.map((c) => ({
      campaignId: campaign.id,
      restaurantId: campaign.restaurantId,
      contactId: c.id,
      name: c.name,
      phone: c.phone,
      demo: !!c.demo,
      status: 'queued',
      queuedAt: at,
      clicks: 0,
    }));
    // A fila e o novo status entram juntos. Se um código de link colidir
    // (índice único), a transação é desfeita e refeita com códigos novos.
    for (let attempt = 1; ; attempt += 1) {
      try {
        await this.repos.tx(async (r) => {
          const moved = await r.campaigns.transition(campaign, ['draft', 'scheduled'], {
            status: 'sending',
            startedAt: at,
            audienceSize: contacts.length,
            provider: this.messaging.key,
            waitingReason: null,
          });
          if (!moved) throw new Error('Esta campanha já foi iniciada.');
          await r.messages.insertMany(queue.map((m) => ({ ...m, code: this.newCode() })));
        });
        break;
      } catch (err) {
        if (err.constraint !== 'messages_code_key' || attempt >= 3) throw err;
      }
    }
    this.publishProgress(campaign);
    this.kick();
    return campaign;
  }

  async schedule(campaignId, when) {
    const campaign = await this.mustGet(campaignId);
    if (!['draft', 'scheduled'].includes(campaign.status)) throw new Error('Esta campanha já foi iniciada.');
    this.assertApproved(campaign, await this.repos.restaurants.get(campaign.restaurantId));
    const date = new Date(when);
    if (Number.isNaN(date.getTime()) || date.getTime() < Date.now() - 60000) throw new Error('Escolha uma data futura.');
    await this.repos.campaigns.update(campaign, { status: 'scheduled', scheduledAt: date.toISOString() });
    this.publishProgress(campaign);
    return campaign;
  }

  async pause(campaignId) {
    const c = await this.mustGet(campaignId);
    if (c.status !== 'sending') throw new Error('Só é possível pausar campanhas em andamento.');
    await this.repos.campaigns.update(c, { status: 'paused' });
    this.publishProgress(c);
    return c;
  }

  async resume(campaignId) {
    const c = await this.mustGet(campaignId);
    if (c.status !== 'paused') throw new Error('A campanha não está pausada.');
    await this.repos.campaigns.update(c, { status: 'sending' });
    this.publishProgress(c);
    this.kick();
    return c;
  }

  async cancel(campaignId) {
    const c = await this.mustGet(campaignId);
    if (['completed', 'canceled'].includes(c.status)) throw new Error('A campanha já foi encerrada.');
    if (c.status === 'scheduled' || c.status === 'draft') {
      await this.repos.campaigns.update(c, { status: 'draft', scheduledAt: null });
    } else {
      await this.repos.messages.skipQueued(c.id, 'Campanha cancelada');
      await this.repos.campaigns.update(c, { status: 'canceled', completedAt: new Date().toISOString() });
    }
    this.publishProgress(c);
    return c;
  }

  async checkSchedules() {
    if (this.checking) return;
    this.checking = true;
    try {
      const due = await this.repos.campaigns.dueScheduled(new Date().toISOString());
      for (const c of due) {
        try {
          await this.start(c.id);
        } catch (err) {
          // Só volta para rascunho se ainda estiver agendada (não desfaz um envio que começou)
          if (await this.repos.campaigns.transition(c, ['scheduled'], { status: 'draft', lastError: err.message })) this.publishProgress(c);
        }
      }
    } finally {
      this.checking = false;
    }
  }

  /** Restaurantes com aprovação ligada só recebem campanhas aprovadas por eles. */
  assertApproved(campaign, restaurant) {
    if (restaurant?.requireApproval !== false && campaign.approval?.status !== 'approved') {
      throw new Error('Esta campanha precisa ser aprovada pelo restaurante antes do envio.');
    }
  }

  // ── Worker ─────────────────────────────────────────────────

  kick(delay = 50) {
    if (this.busy || this.stopped) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.tick(), delay);
  }

  async tick() {
    this.timer = null;
    if (this.stopped) return;
    this.busy = true;
    let next = null;
    try {
      next = await this.step();
    } catch (err) {
      this.logger.error('[dispatch]', err);
      next = 5000;
    } finally {
      this.busy = false;
    }
    if (next !== null && !this.stopped) this.timer = setTimeout(() => this.tick(), next);
  }

  async setWaiting(campaigns, reason) {
    for (const c of campaigns) {
      if (c.waitingReason !== reason) {
        await this.repos.campaigns.update(c, { waitingReason: reason });
        this.publishProgress(c);
      }
    }
  }

  withinBusinessHours(settings) {
    if (!settings.businessHoursOnly) return true;
    const hhmm = new Date().toTimeString().slice(0, 5);
    return hhmm >= settings.businessHours.start && hhmm <= settings.businessHours.end;
  }

  /** Processa uma mensagem. Retorna em quantos ms rodar novamente (ou null se a fila acabou). */
  async step() {
    const active = await this.repos.campaigns.byStatus('sending');
    if (!active.length) return null;

    const settings = this.repos.settings.get();
    if (!this.messaging.isConnected()) {
      await this.setWaiting(active, 'Aguardando conexão com o WhatsApp');
      return 5000;
    }
    if (!this.withinBusinessHours(settings)) {
      await this.setWaiting(active, `Fora do horário de envio (${settings.businessHours.start}–${settings.businessHours.end})`);
      return 60000;
    }
    if ((await this.repos.messages.countSentSince(startOfTodayUtc())) >= settings.dailyLimit) {
      await this.setWaiting(active, `Limite diário de ${settings.dailyLimit} envios atingido`);
      return 60000;
    }

    let message = null;
    let campaign = null;
    for (const c of active) {
      message = await this.repos.messages.claimNext(c.id);
      if (message) { campaign = c; break; }
      await this.complete(c);
    }
    if (!message) return null;
    if (campaign.waitingReason) await this.repos.campaigns.update(campaign, { waitingReason: null });

    const sent = await this.deliver(campaign, message);
    if (!(await this.repos.messages.hasQueued(campaign.id))) await this.complete(campaign);

    if (!sent) return 300; // ignorada/falhou sem tocar no WhatsApp: segue rápido
    const simulator = this.messaging.key === 'simulator';
    const pace = this.config.simulatorPace || { min: 0.8, max: 2.2 };
    const min = simulator ? pace.min : settings.minDelaySeconds;
    const max = simulator ? pace.max : Math.max(settings.maxDelaySeconds, settings.minDelaySeconds);
    return Math.round((min + Math.random() * (max - min)) * 1000);
  }

  async complete(campaign) {
    if (campaign.status !== 'sending') return;
    // Só conclui se ainda estiver enviando: uma pausa no meio do caminho vale
    const done = await this.repos.campaigns.transition(campaign, ['sending'], { status: 'completed', completedAt: new Date().toISOString(), waitingReason: null });
    if (done) this.publishProgress(campaign);
  }

  async deliver(campaign, message) {
    const [contact, restaurant] = await Promise.all([
      this.repos.contacts.get(message.contactId),
      this.repos.restaurants.get(campaign.restaurantId),
    ]);

    if (!contact || contact.optedOut || !contact.optIn) {
      await this.updateMessage(campaign, message, { status: 'skipped', error: 'Contato descadastrado' });
      return false;
    }
    if (contact.demo && this.messaging.key !== 'simulator') {
      await this.updateMessage(campaign, message, { status: 'skipped', error: 'Contato fictício (só é enviado no simulador)' });
      return false;
    }

    const link = this.trackingLink(message.code);
    const text = this.templates.compose({ campaign, contact, restaurant, link });
    const vars = this.templates.buildVars({ contact, restaurant, campaign, link });
    const template = campaign.cloudTemplate?.name
      ? { ...campaign.cloudTemplate, params: this.templates.templateParams(campaign, vars) }
      : undefined;

    await this.updateMessage(campaign, message, { status: 'sending', text });
    try {
      const media = this.media.resolve(campaign.mediaUrl);
      const res = await this.messaging.send({ to: contact.phone, text, media, template });
      const sent = await this.repos.messages.markSent(message.id, {
        provider: this.messaging.key,
        providerMessageId: res.providerMessageId,
        sentAt: new Date().toISOString(),
      });
      this.publishMessage(campaign, sent || message);
    } catch (err) {
      await this.updateMessage(campaign, message, { status: 'failed', error: err.message, failedAt: new Date().toISOString() });
    }
    return true;
  }

  async updateMessage(campaign, message, patch) {
    const updated = await this.repos.messages.update(message, patch);
    this.publishMessage(campaign, updated || message);
  }

  publishMessage(campaign, message) {
    this.events.publish('message:update', this.publicMessage(message));
    this.publishProgress(campaign);
  }

  publicMessage(m) {
    const { text, ...rest } = m;
    return { ...rest, preview: text ? text.slice(0, 160) : null };
  }

  // ── Confirmações e respostas ───────────────────────────────

  async handleAck({ providerMessageId, status, error }, attempt = 1) {
    const at = new Date().toISOString();
    const message = status === 'failed'
      ? await this.repos.messages.markFailedByProvider(providerMessageId, error || 'Falha reportada pelo WhatsApp', at)
      : await this.repos.messages.applyAck(providerMessageId, status, at);
    if (message) {
      this.events.publish('message:update', this.publicMessage(message));
      await this.publishProgressById(message.campaignId);
      return;
    }
    // A confirmação pode chegar antes de o envio ser gravado: tenta de novo em instantes
    if (attempt < 4 && !this.stopped && !(await this.repos.messages.byProviderId(providerMessageId))) {
      await new Promise((r) => { setTimeout(r, 250 * attempt); });
      await this.handleAck({ providerMessageId, status, error }, attempt + 1);
    }
  }

  async handleIncoming({ from, body }) {
    const key = phoneKey(from);
    const contacts = await this.repos.contacts.byPhoneKey(key);
    const settings = this.repos.settings.get();
    const text = normalizeText(body);
    const isOptOut = settings.optOutKeywords.map(normalizeText).includes(text);
    const at = new Date().toISOString();

    if (isOptOut) {
      await this.repos.contacts.markOptedOut(contacts.map((c) => c.id), at);
      if (settings.optOutReply) {
        await this.messaging.send({ to: from, text: settings.optOutReply }).catch(() => {});
      }
    }

    const last = await this.repos.messages.lastSentToPhoneKey(key);
    if (last && !last.repliedAt) {
      const updated = await this.repos.messages.registerReply(last.id, { reply: String(body).slice(0, 280), optOut: isOptOut, at });
      if (updated) {
        this.events.publish('message:update', this.publicMessage(updated));
        await this.publishProgressById(updated.campaignId);
      }
    }

    this.events.publish('incoming', { from, body, optOut: isOptOut, contacts: contacts.map((c) => c.name) });
  }

  // ── Teste ──────────────────────────────────────────────────

  async sendTest({ campaign, phone }) {
    const restaurant = await this.repos.restaurants.get(campaign.restaurantId);
    const destination = this.destinationFor(campaign, restaurant);
    const link = `${destination}${destination.includes('?') ? '&' : '?'}utm_source=whatsapp&utm_medium=teste`;
    const contact = { name: 'Cliente Teste', phone };
    const text = `🧪 *TESTE*\n\n${this.templates.compose({ campaign, contact, restaurant, link })}`;
    const vars = this.templates.buildVars({ contact, restaurant, campaign, link });
    const template = campaign.cloudTemplate?.name
      ? { ...campaign.cloudTemplate, params: this.templates.templateParams(campaign, vars) }
      : undefined;
    return this.messaging.send({ to: phone, text, media: this.media.resolve(campaign.mediaUrl), template });
  }

  destinationFor(campaign, restaurant) {
    const url = campaign?.destinationUrl || restaurant?.siteUrl;
    if (url) return url;
    return `${this.config.publicUrl}/demo/${restaurant?.slug || ''}`;
  }

  // ── Utilidades ─────────────────────────────────────────────

  async mustGet(id) {
    const c = await this.repos.campaigns.get(id);
    if (!c) throw new Error('Campanha não encontrada.');
    return c;
  }

  publishProgress(campaign) {
    this.events.publish('campaign:progress', { id: campaign.id, restaurantId: campaign.restaurantId, status: campaign.status, waitingReason: campaign.waitingReason || null });
  }

  async publishProgressById(campaignId) {
    const campaign = await this.repos.campaigns.get(campaignId);
    if (campaign) this.publishProgress(campaign);
  }
}

module.exports = { DispatchService, phoneKey };
```

- [ ] **Step 9: Rotas do painel: `src/http/api.js`**

Substitua o arquivo inteiro:

```js
const express = require('express');
const { TemplateService } = require('../services/TemplateService');
const { MessagingProvider } = require('../messaging/MessagingProvider');
const { CAMPAIGN_IDEAS } = require('../ideas');
const { AuthService } = require('../services/AuthService');
const { ReportService } = require('../services/ReportService');

const slugify = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'restaurante';

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));
const cleanTags = (tags) => [...new Set((Array.isArray(tags) ? tags : String(tags || '').split(','))
  .map((t) => String(t).trim().toLowerCase()).filter(Boolean))];
const notFound = (message) => Object.assign(new Error(message), { status: 404 });

/** JSON com chaves em ordem, para comparar conteúdo (o jsonb do PostgreSQL reordena as chaves). */
const stable = (value) => JSON.stringify(value, (_key, v) => (v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
  : v));

const RESTAURANT_FIELDS = ['name', 'segment', 'city', 'siteUrl', 'phone', 'audience', 'products', 'goals', 'tone', 'color', 'coupon', 'menu', 'tagline', 'instagram', 'emoji', 'address', 'hours', 'requireApproval', 'banners', 'logoUrl'];
const CAMPAIGN_FIELDS = ['name', 'restaurantId', 'objective', 'occasion', 'message', 'mediaUrl', 'destinationUrl', 'coupon', 'segment', 'includeFooter', 'cloudTemplate', 'notes'];

/** Rotas autenticadas do painel (/api/*). */
function createApi(container) {
  const repos = container.resolve('repos');
  const auth = container.resolve('auth');
  const messaging = container.resolve('messaging');
  const dispatch = container.resolve('dispatch');
  const analytics = container.resolve('analytics');
  const templates = container.resolve('templates');
  const events = container.resolve('events');
  const config = container.resolve('config');
  const media = container.resolve('media');
  const reports = container.resolve('reports');
  const pdf = container.resolve('pdf');

  const router = express.Router();
  const wrap = (fn) => (req, res) => Promise.resolve().then(() => fn(req, res)).catch((err) => res.status(err.status || 400).json({ error: err.message }));

  // ── Autenticação ───────────────────────────────────────────
  router.post('/auth/login', wrap(async (req, res) => {
    const token = await auth.login(req.body?.email || '', req.body?.password || '');
    if (!token) return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
    auth.setCookie(res, token);
    return res.json({ ok: true, user: auth.verify(token) });
  }));
  router.post('/auth/logout', (req, res) => { auth.clearCookie(res); res.json({ ok: true }); });

  router.use(auth.middleware());

  /*
   * Usuários de restaurante só alcançam estas rotas; dentro delas os dados
   * ficam sempre presos ao restaurante do usuário (ver scopeOf e ownCampaign).
   */
  const RESTAURANT_ROUTES = [
    ['GET', /^\/(auth\/me|events|dashboard|meta|settings|restaurants|campaigns|reports\/months|reports\/monthly|reports\/monthly\.pdf)$/],
    ['GET', /^\/campaigns\/[^/]+(\/messages)?$/],
    ['POST', /^\/campaigns\/[^/]+\/(approve|request-changes)$/],
    ['PUT', /^\/me\/password$/],
  ];
  router.use((req, res, next) => {
    if (req.user.role !== 'restaurant') return next();
    const ok = RESTAURANT_ROUTES.some(([m, re]) => m === req.method && re.test(req.path));
    return ok ? next() : res.status(403).json({ error: 'Seu acesso não permite esta ação.' });
  });
  const isRestaurant = (req) => req.user.role === 'restaurant';
  const scopeOf = (req, fallback) => (isRestaurant(req) ? req.user.restaurantId : (fallback || null));
  const ownCampaign = async (req) => {
    const c = await repos.campaigns.get(req.params.id);
    if (!c || (isRestaurant(req) && c.restaurantId !== req.user.restaurantId)) throw notFound('Campanha não encontrada');
    return c;
  };

  router.get('/auth/me', (req, res) => res.json({ user: req.user }));

  router.put('/me/password', wrap(async (req, res) => {
    if (!isRestaurant(req)) throw new Error('A senha da agência é definida no arquivo .env.');
    const user = await repos.users.get(req.user.userId);
    if (!AuthService.checkPassword(req.body?.current || '', user.passwordHash)) throw new Error('Senha atual incorreta.');
    AuthService.validatePassword(req.body?.password);
    await repos.users.update(user, { passwordHash: AuthService.hashPassword(req.body.password) });
    res.json({ ok: true });
  }));

  // ── Tempo real ─────────────────────────────────────────────
  router.get('/events', (req, res) => {
    events.attach(req, res, { restaurantId: scopeOf(req) });
    if (!isRestaurant(req)) res.write(`event: messaging:status\ndata: ${JSON.stringify(messaging.getStatus())}\n\n`);
  });

  // ── Painel ─────────────────────────────────────────────────
  router.get('/dashboard', wrap(async (req, res) => {
    res.json(await analytics.overview({ restaurantId: scopeOf(req, req.query.restaurantId), days: Number(req.query.days) || 14 }));
  }));

  router.get('/meta', (req, res) => {
    res.json({ variables: TemplateService.VARIABLES, ideas: CAMPAIGN_IDEAS, publicUrl: config.publicUrl });
  });

  // ── Restaurantes (Diagnóstico) ─────────────────────────────
  const ZERO_COUNTS = { contactsCount: 0, authorizedCount: 0, campaignsCount: 0 };
  const withCounts = async (list) => {
    const counts = await repos.restaurants.counts(list.map((r) => r.id));
    return list.map((r) => ({ ...r, ...(counts.get(r.id) || ZERO_COUNTS), demoUrl: `${config.publicUrl}/demo/${r.slug}` }));
  };
  const withCountsOne = async (r) => (await withCounts([r]))[0];

  router.get('/restaurants', wrap(async (req, res) => {
    const list = (await repos.restaurants.all()).filter((r) => !isRestaurant(req) || r.id === req.user.restaurantId);
    res.json(await withCounts(list.sort((a, b) => a.name.localeCompare(b.name))));
  }));

  // ── Acessos dos restaurantes (gerenciados pela agência) ────
  const publicUser = ({ passwordHash, ...u }) => u;

  router.get('/restaurants/:id/users', wrap(async (req, res) => {
    res.json((await repos.users.listByRestaurant(req.params.id)).map(publicUser));
  }));

  router.post('/restaurants/:id/users', wrap(async (req, res) => {
    if (!(await repos.restaurants.get(req.params.id))) throw new Error('Restaurante não encontrado.');
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Informe um e-mail válido.');
    if (email === config.admin.email.toLowerCase() || (await repos.users.byEmail(email))) throw new Error('Este e-mail já tem acesso.');
    AuthService.validatePassword(req.body?.password);
    const user = await repos.users.create({
      restaurantId: req.params.id,
      name: String(req.body?.name || '').trim() || email,
      email,
      role: 'restaurant',
      passwordHash: AuthService.hashPassword(req.body.password),
    });
    res.status(201).json(publicUser(user));
  }));

  router.put('/users/:id/password', wrap(async (req, res) => {
    const user = await repos.users.get(req.params.id);
    if (!user) throw notFound('Usuário não encontrado.');
    AuthService.validatePassword(req.body?.password);
    await repos.users.update(user, { passwordHash: AuthService.hashPassword(req.body.password) });
    res.json({ ok: true });
  }));

  router.delete('/users/:id', wrap(async (req, res) => res.json({ ok: await repos.users.remove(req.params.id) })));

  router.get('/restaurants/:id', wrap(async (req, res) => {
    const r = await repos.restaurants.get(req.params.id);
    if (!r) throw notFound('Restaurante não encontrado');
    res.json(await withCountsOne(r));
  }));

  const uniqueSlug = async (name, ignoreId) => {
    const base = slugify(name);
    let slug = base;
    let i = 2;
    while (await repos.restaurants.slugTaken(slug, ignoreId)) slug = `${base}-${i++}`;
    return slug;
  };

  router.post('/restaurants', wrap(async (req, res) => {
    const data = pick(req.body || {}, RESTAURANT_FIELDS);
    if (!data.name?.trim()) throw new Error('Informe o nome do restaurante.');
    const r = await repos.restaurants.create({ color: '#73350c', emoji: '🍽️', menu: [], ...data, slug: await uniqueSlug(data.name) });
    res.status(201).json(await withCountsOne(r));
  }));

  router.put('/restaurants/:id', wrap(async (req, res) => {
    const r = await repos.restaurants.get(req.params.id);
    if (!r) throw notFound('Restaurante não encontrado');
    const data = pick(req.body || {}, RESTAURANT_FIELDS);
    if (data.name && data.name !== r.name) data.slug = await uniqueSlug(data.name, r.id);
    res.json(await withCountsOne(await repos.restaurants.update(r, data)));
  }));

  router.delete('/restaurants/:id', wrap(async (req, res) => {
    if (await repos.campaigns.hasActive(req.params.id)) throw new Error('Há campanhas em andamento para este restaurante.');
    // Contatos, campanhas, mensagens, pedidos e acessos saem junto (ON DELETE CASCADE)
    await repos.restaurants.remove(req.params.id);
    res.json({ ok: true });
  }));

  // ── Contatos (base autorizada) ─────────────────────────────
  router.get('/contacts', wrap(async (req, res) => {
    const { restaurantId, search = '', tag, status } = req.query;
    const q = String(search).toLowerCase();
    const digits = q.replace(/\D/g, '');
    const list = (await repos.contacts.listByRestaurant({ restaurantId, tag, status }))
      .filter((c) => !q || (c.name || '').toLowerCase().includes(q) || (digits && c.phone.includes(digits)));
    list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    res.json(list);
  }));

  router.get('/contacts/tags', wrap(async (req, res) => {
    res.json(await repos.contacts.tagCounts(req.query.restaurantId));
  }));

  const contactPayload = (body) => {
    const phone = MessagingProvider.normalizePhone(body.phone);
    if (phone.length < 12 || phone.length > 13) throw new Error(`Telefone inválido: ${body.phone || '(vazio)'}`);
    return {
      name: String(body.name || '').trim(),
      phone,
      tags: cleanTags(body.tags),
      optIn: body.optIn !== false,
      optInSource: body.optInSource || 'Cadastro manual',
      notes: body.notes || '',
    };
  };

  router.post('/contacts', wrap(async (req, res) => {
    const { restaurantId } = req.body || {};
    if (!(await repos.restaurants.get(restaurantId))) throw new Error('Selecione o restaurante.');
    const data = contactPayload(req.body);
    if (await repos.contacts.findByPhone(restaurantId, data.phone)) throw new Error('Este telefone já está na base.');
    res.status(201).json(await repos.contacts.create({ restaurantId, ...data, optedOut: false }));
  }));

  router.post('/contacts/import', wrap(async (req, res) => {
    const { restaurantId, contacts = [], tags = [], optIn = true, optInSource = 'Importação' } = req.body || {};
    if (!(await repos.restaurants.get(restaurantId))) throw new Error('Selecione o restaurante.');
    const extra = cleanTags(tags);
    const existing = new Map((await repos.contacts.byRestaurant(restaurantId)).map((c) => [c.phone, c]));
    const result = { created: 0, updated: 0, invalid: [] };
    const toCreate = [];
    const toUpdate = new Map();
    for (const row of contacts) {
      try {
        const data = contactPayload({ ...row, optIn, optInSource });
        data.tags = cleanTags([...data.tags, ...extra]);
        const found = existing.get(data.phone) || toCreate.find((c) => c.phone === data.phone);
        if (found) {
          if (found.id) {
            // Mescla em memória (uma linha repetida mais adiante vê o resultado) e grava no fim
            Object.assign(found, { name: data.name || found.name, tags: cleanTags([...(found.tags || []), ...data.tags]) });
            toUpdate.set(found.id, found);
          }
          result.updated += 1;
        } else {
          toCreate.push({ restaurantId, ...data, optedOut: false });
        }
      } catch (err) {
        result.invalid.push({ row, error: err.message });
      }
    }
    await repos.tx(async (r) => {
      for (const c of toUpdate.values()) await r.contacts.update(c.id, { name: c.name, tags: c.tags });
      await r.contacts.insertMany(toCreate);
    });
    result.created = toCreate.length;
    res.json(result);
  }));

  router.put('/contacts/:id', wrap(async (req, res) => {
    const c = await repos.contacts.get(req.params.id);
    if (!c) throw notFound('Contato não encontrado');
    const data = contactPayload({ ...c, ...req.body });
    const patch = { ...data };
    if (req.body.optedOut !== undefined) {
      patch.optedOut = !!req.body.optedOut;
      patch.optedOutAt = req.body.optedOut ? new Date().toISOString() : null;
    }
    res.json(await repos.contacts.update(c, patch));
  }));

  router.delete('/contacts/:id', wrap(async (req, res) => res.json({ ok: await repos.contacts.remove(req.params.id) })));

  // ── Campanhas ──────────────────────────────────────────────
  const campaignViews = async (list) => {
    const [stats, restaurants] = await Promise.all([analytics.statsForCampaigns(list.map((c) => c.id)), repos.restaurants.all()]);
    const names = new Map(restaurants.map((r) => [r.id, r.name]));
    return list.map((c) => ({ ...c, restaurant: names.get(c.restaurantId) || '—', stats: stats.get(c.id) }));
  };
  const campaignView = async (c) => (await campaignViews([c]))[0];

  router.get('/campaigns', wrap(async (req, res) => {
    const list = (await repos.campaigns.list({ restaurantId: scopeOf(req, req.query.restaurantId) }))
      // o restaurante não vê rascunhos internos da agência, só o que foi para aprovação ou enviado
      .filter((c) => !isRestaurant(req) || c.approval || !['draft'].includes(c.status))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    res.json(await campaignViews(list));
  }));

  router.get('/campaigns/:id', wrap(async (req, res) => {
    const c = await ownCampaign(req);
    const audiencePreview = ['draft', 'scheduled'].includes(c.status) ? (await dispatch.audience(c.restaurantId, c.segment)).length : c.audienceSize;
    res.json({ ...(await campaignView(c)), audiencePreview });
  }));

  router.get('/campaigns/:id/messages', wrap(async (req, res) => {
    const c = await ownCampaign(req);
    res.json((await repos.messages.byCampaign(c.id)).map((m) => dispatch.publicMessage(m)));
  }));

  const normalizeCampaign = (body) => {
    const data = pick(body || {}, CAMPAIGN_FIELDS);
    if (data.segment) data.segment = { tags: cleanTags(data.segment.tags), match: data.segment.match === 'all' ? 'all' : 'any' };
    if (data.cloudTemplate) {
      data.cloudTemplate = data.cloudTemplate.name
        ? { name: String(data.cloudTemplate.name).trim(), language: data.cloudTemplate.language || 'pt_BR', params: (data.cloudTemplate.params || []).filter((p) => p !== '') }
        : null;
    }
    return data;
  };

  router.post('/campaigns', wrap(async (req, res) => {
    const data = normalizeCampaign(req.body);
    if (!(await repos.restaurants.get(data.restaurantId))) throw new Error('Selecione o restaurante.');
    const c = await repos.campaigns.create({
      name: 'Nova campanha',
      message: '',
      segment: { tags: [], match: 'any' },
      includeFooter: true,
      ...data,
      status: 'draft',
    });
    res.status(201).json(await campaignView(c));
  }));

  router.put('/campaigns/:id', wrap(async (req, res) => {
    const c = await repos.campaigns.get(req.params.id);
    if (!c) throw notFound('Campanha não encontrada');
    if (!['draft', 'scheduled'].includes(c.status)) throw new Error('Campanhas já disparadas não podem ser editadas. Duplique-a.');
    const data = normalizeCampaign(req.body);
    // Mudou o que o cliente final recebe? Então a aprovação do restaurante deixa de valer.
    const CONTENT = ['message', 'mediaUrl', 'coupon', 'destinationUrl', 'segment', 'includeFooter', 'restaurantId'];
    const changed = CONTENT.some((k) => data[k] !== undefined && stable(data[k]) !== stable(c[k]));
    if (changed && c.approval) {
      data.approval = null;
      data.approvalLog = [...(c.approvalLog || []), { action: 'reset', by: req.user.name, at: new Date().toISOString(), note: 'Conteúdo alterado pela agência' }];
      if (c.status === 'scheduled') { data.status = 'draft'; data.scheduledAt = null; }
    }
    res.json(await campaignView(await repos.campaigns.update(c, data)));
  }));

  router.delete('/campaigns/:id', wrap(async (req, res) => {
    const c = await repos.campaigns.get(req.params.id);
    if (c && ['sending', 'paused'].includes(c.status)) throw new Error('Cancele a campanha antes de excluí-la.');
    // Mensagens e pedidos da campanha saem junto (ON DELETE CASCADE)
    await repos.campaigns.remove(req.params.id);
    res.json({ ok: true });
  }));

  router.post('/campaigns/:id/duplicate', wrap(async (req, res) => {
    const c = await repos.campaigns.get(req.params.id);
    if (!c) throw new Error('Campanha não encontrada');
    const copy = await repos.campaigns.create({
      ...pick(c, CAMPAIGN_FIELDS),
      name: `${c.name} (cópia)`,
      status: 'draft',
    });
    res.status(201).json(await campaignView(copy));
  }));

  router.post('/audience/preview', wrap(async (req, res) => {
    const { restaurantId, segment } = req.body || {};
    const list = await dispatch.audience(restaurantId, { tags: cleanTags(segment?.tags), match: segment?.match });
    res.json({ count: list.length, sample: list.slice(0, 5).map((c) => ({ name: c.name, phone: c.phone })) });
  }));

  // ── Aprovação pelo restaurante ─────────────────────────────
  const logApproval = (c, entry) => [...(c.approvalLog || []), { ...entry, at: new Date().toISOString() }];
  const publishApproval = (c) => events.publish('approval', { id: c.id, restaurantId: c.restaurantId, name: c.name, approval: c.approval });

  router.post('/campaigns/:id/request-approval', wrap(async (req, res) => {
    const c = await ownCampaign(req);
    if (!['draft', 'scheduled'].includes(c.status)) throw new Error('Só campanhas não enviadas vão para aprovação.');
    if (!c.message?.trim()) throw new Error('Escreva a mensagem antes de pedir aprovação.');
    await repos.campaigns.update(c, {
      approval: { status: 'pending', requestedAt: new Date().toISOString(), requestedBy: req.user.name },
      approvalLog: logApproval(c, { action: 'requested', by: req.user.name, note: req.body?.note || '' }),
    });
    publishApproval(c);
    res.json(await campaignView(c));
  }));

  router.post('/campaigns/:id/approve', wrap(async (req, res) => {
    const c = await ownCampaign(req);
    if (c.approval?.status !== 'pending') throw new Error('Esta campanha não está aguardando aprovação.');
    await repos.campaigns.update(c, {
      approval: { ...c.approval, status: 'approved', decidedAt: new Date().toISOString(), decidedBy: req.user.name, note: req.body?.note || '' },
      approvalLog: logApproval(c, { action: 'approved', by: req.user.name, note: req.body?.note || '' }),
    });
    publishApproval(c);
    res.json(await campaignView(c));
  }));

  router.post('/campaigns/:id/request-changes', wrap(async (req, res) => {
    const c = await ownCampaign(req);
    if (c.approval?.status !== 'pending') throw new Error('Esta campanha não está aguardando aprovação.');
    const note = String(req.body?.note || '').trim();
    if (!note) throw new Error('Conte o que precisa mudar.');
    await repos.campaigns.update(c, {
      approval: { ...c.approval, status: 'changes', decidedAt: new Date().toISOString(), decidedBy: req.user.name, note },
      approvalLog: logApproval(c, { action: 'changes', by: req.user.name, note }),
    });
    publishApproval(c);
    res.json(await campaignView(c));
  }));

  router.post('/campaigns/:id/start', wrap(async (req, res) => res.json(await campaignView(await dispatch.start(req.params.id)))));
  router.post('/campaigns/:id/schedule', wrap(async (req, res) => res.json(await campaignView(await dispatch.schedule(req.params.id, req.body?.scheduledAt)))));
  router.post('/campaigns/:id/pause', wrap(async (req, res) => res.json(await campaignView(await dispatch.pause(req.params.id)))));
  router.post('/campaigns/:id/resume', wrap(async (req, res) => res.json(await campaignView(await dispatch.resume(req.params.id)))));
  router.post('/campaigns/:id/cancel', wrap(async (req, res) => res.json(await campaignView(await dispatch.cancel(req.params.id)))));

  router.post('/campaigns/:id/test', wrap(async (req, res) => {
    const c = await repos.campaigns.get(req.params.id);
    if (!c) throw new Error('Campanha não encontrada');
    if (!req.body?.phone) throw new Error('Informe o número para teste.');
    const result = await dispatch.sendTest({ campaign: c, phone: req.body.phone });
    res.json({ ok: true, ...result });
  }));

  router.post('/preview', wrap(async (req, res) => {
    const { restaurantId, message, coupon, includeFooter } = req.body || {};
    const restaurant = await repos.restaurants.get(restaurantId);
    const contact = { name: req.body?.sampleName || 'Marina Souza' };
    const text = templates.compose({
      campaign: { message: message || '', coupon, includeFooter },
      contact,
      restaurant,
      link: `${config.publicUrl}/r/exemplo`,
    });
    res.json({ text });
  }));

  // ── Mensageria (provedor injetado) ─────────────────────────
  router.get('/messaging/status', (req, res) => res.json({ ...messaging.getStatus(), providers: messaging.listProviders() }));
  router.post('/messaging/start', wrap(async (req, res) => { messaging.start().catch(() => {}); res.json(messaging.getStatus()); }));
  router.post('/messaging/stop', wrap(async (req, res) => { await messaging.stop(); res.json(messaging.getStatus()); }));
  router.post('/messaging/logout', wrap(async (req, res) => { await messaging.logout(); res.json(messaging.getStatus()); }));
  router.post('/messaging/provider', wrap(async (req, res) => {
    if (await repos.campaigns.anySending()) throw new Error('Pause as campanhas em andamento antes de trocar o canal.');
    await messaging.use(req.body?.provider);
    res.json({ ...messaging.getStatus(), providers: messaging.listProviders() });
  }));
  router.post('/messaging/test', wrap(async (req, res) => {
    const { phone, text, mediaUrl } = req.body || {};
    if (!phone) throw new Error('Informe o número.');
    res.json(await messaging.send({ to: phone, text: text || 'Olá! Esta é uma mensagem de teste da Studio Coral.', media: media.resolve(mediaUrl) }));
  }));

  // ── Imagens ────────────────────────────────────────────────
  router.get('/uploads', (req, res) => res.json(media.list().map(({ path: _p, ...m }) => m)));
  router.post('/uploads', wrap((req, res) => {
    const { path: _p, ...info } = media.save(req.body || {});
    res.status(201).json(info);
  }));
  router.delete('/uploads/:file', wrap(async (req, res) => {
    if (await repos.campaigns.mediaInUse(`/uploads/${req.params.file}`)) throw new Error('Esta imagem está em uma campanha em andamento.');
    media.remove(req.params.file);
    res.json({ ok: true });
  }));
  router.get('/messaging/outbox', (req, res) => {
    const sim = messaging.provider('simulator');
    res.json(sim ? sim.getOutbox() : []);
  });
  router.post('/messaging/simulate-reply', wrap((req, res) => {
    const sim = messaging.provider('simulator');
    if (!sim) throw new Error('Simulador indisponível.');
    sim.simulateIncoming(req.body?.from, req.body?.body || 'SAIR');
    res.json({ ok: true });
  }));

  // ── Configurações ──────────────────────────────────────────
  router.get('/settings', (req, res) => {
    const s = repos.settings.get();
    res.json(isRestaurant(req) ? { footer: s.footer } : s);
  });

  // ── Relatório mensal ───────────────────────────────────────
  const reportScope = (req) => {
    const restaurantId = scopeOf(req, req.query.restaurantId);
    if (!restaurantId) throw new Error('Escolha o restaurante.');
    return restaurantId;
  };
  router.get('/reports/months', wrap(async (req, res) => res.json(await reports.availableMonths(reportScope(req)))));
  router.get('/reports/monthly', wrap(async (req, res) => {
    res.json(await reports.monthly({ restaurantId: reportScope(req), month: req.query.month || ReportService.currentMonth() }));
  }));
  router.get('/reports/monthly.pdf', wrap(async (req, res) => {
    const restaurantId = reportScope(req);
    const month = req.query.month || ReportService.currentMonth();
    const report = await reports.monthly({ restaurantId, month }); // valida antes de abrir o navegador
    const file = await pdf.render(`/relatorio?restaurantId=${restaurantId}&month=${month}&print=1`, req.user);
    const { slug } = await repos.restaurants.get(restaurantId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="relatorio-${slug}-${month}.pdf"`);
    res.end(file);
    return report;
  }));
  router.put('/settings', wrap(async (req, res) => {
    const b = req.body || {};
    const patch = {};
    if (b.minDelaySeconds !== undefined) patch.minDelaySeconds = Math.max(1, Number(b.minDelaySeconds) || 1);
    if (b.maxDelaySeconds !== undefined) patch.maxDelaySeconds = Math.max(patch.minDelaySeconds || 1, Number(b.maxDelaySeconds) || 1);
    if (b.dailyLimit !== undefined) patch.dailyLimit = Math.max(1, Number(b.dailyLimit) || 1);
    if (b.businessHoursOnly !== undefined) patch.businessHoursOnly = !!b.businessHoursOnly;
    if (b.businessHours) patch.businessHours = { start: b.businessHours.start || '09:00', end: b.businessHours.end || '21:00' };
    if (b.optOutKeywords) patch.optOutKeywords = cleanTags(b.optOutKeywords);
    if (b.optOutReply !== undefined) patch.optOutReply = String(b.optOutReply);
    if (b.footer !== undefined) patch.footer = String(b.footer);
    res.json(await repos.settings.update(patch));
  }));

  return router;
}

module.exports = { createApi, slugify };
```

- [ ] **Step 10: Rotas públicas: `src/http/public.js`**

Substitua o arquivo inteiro:

```js
const express = require('express');
const path = require('path');

const BOT_UA = /whatsapp|facebookexternalhit|facebot|bot|crawler|spider|preview|slurp|telegram/i;

/**
 * Rotas públicas:
 *  • /r/:code                 → link rastreável (etapa 6 — Conversão)
 *  • /api/public/conversions  → registro de pedido (etapa 7 — Compra)
 *  • /t.js                    → script de conversão para o site do restaurante
 *  • /demo/:slug              → site próprio de demonstração do restaurante
 *  • /webhooks/whatsapp       → webhook da API Oficial (status e respostas)
 */
function createPublicRoutes(container) {
  const repos = container.resolve('repos');
  const dispatch = container.resolve('dispatch');
  const events = container.resolve('events');
  const messaging = container.resolve('messaging');
  const config = container.resolve('config');

  const router = express.Router();
  const publicDir = path.join(__dirname, '..', '..', 'public');
  const wrap = (fn) => (req, res, next) => Promise.resolve().then(() => fn(req, res)).catch(next);

  const cors = (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    return next();
  };

  // ── Link rastreável ────────────────────────────────────────
  router.get('/r/:code', wrap(async (req, res) => {
    const message = await repos.messages.byCode(req.params.code);
    if (!message) return res.redirect(302, '/');

    const [campaign, restaurant] = await Promise.all([repos.campaigns.get(message.campaignId), repos.restaurants.get(message.restaurantId)]);
    const destination = new URL(dispatch.destinationFor(campaign, restaurant), config.publicUrl);
    destination.searchParams.set('sc_ref', message.code);
    destination.searchParams.set('utm_source', 'whatsapp');
    destination.searchParams.set('utm_medium', 'studio_coral');
    if (campaign) destination.searchParams.set('utm_campaign', campaign.name);

    // Pré-visualização de link do WhatsApp/redes não conta como clique
    if (!BOT_UA.test(req.headers['user-agent'] || '')) {
      const clicked = await repos.messages.registerClick(message.id, new Date().toISOString());
      events.publish('click', { campaignId: message.campaignId, restaurantId: message.restaurantId, messageId: message.id, name: message.name });
      events.publish('message:update', dispatch.publicMessage(clicked || message));
    }
    return res.redirect(302, destination.toString());
  }));

  // ── Conversões ─────────────────────────────────────────────
  router.options('/api/public/conversions', cors);
  router.post('/api/public/conversions', cors, wrap(async (req, res) => {
    const { ref, value, orderId, items, restaurantSlug, customerName } = req.body || {};
    const message = ref ? await repos.messages.byCode(String(ref)) : null;
    const restaurant = message
      ? await repos.restaurants.get(message.restaurantId)
      : await repos.restaurants.bySlug(String(restaurantSlug || ''));
    if (!restaurant) return res.status(404).json({ error: 'Referência ou restaurante não encontrado.' });

    // Número de pedido repetido no restaurante é ignorado (índice único, sem corrida)
    const conversion = await repos.conversions.createUnique({
      restaurantId: restaurant.id,
      campaignId: message?.campaignId || null,
      messageId: message?.id || null,
      contactId: message?.contactId || null,
      code: message?.code || null,
      customerName: customerName || message?.name || null,
      orderId: orderId ? String(orderId) : null,
      value: Math.max(0, Number(value) || 0),
      items: Array.isArray(items) ? items.slice(0, 50) : [],
    });
    if (!conversion) return res.json({ ok: true, duplicated: true });
    if (message && !message.convertedAt) await repos.messages.markConverted(message.id, conversion.createdAt);
    events.publish('conversion', { ...conversion, restaurant: restaurant.name });
    return res.status(201).json({ ok: true, id: conversion.id });
  }));

  router.get('/api/public/restaurants/:slug', cors, wrap(async (req, res) => {
    const r = await repos.restaurants.bySlug(req.params.slug);
    if (!r) return res.status(404).json({ error: 'Restaurante não encontrado' });
    const { id, name, slug, tagline, segment, city, color, coupon, menu, address, hours, phone, instagram, banners, logoUrl } = r;
    return res.json({ id, name, slug, tagline, segment, city, color, coupon, menu, address, hours, phone, instagram, banners: banners || [], logoUrl: logoUrl || null });
  }));

  router.get('/api/public/ref/:code', cors, wrap(async (req, res) => {
    const m = await repos.messages.byCode(req.params.code);
    if (!m) return res.status(404).json({});
    const campaign = await repos.campaigns.get(m.campaignId);
    return res.json({ firstName: (m.name || '').split(/\s+/)[0], campaign: campaign?.name || null, coupon: campaign?.coupon || null });
  }));

  // Script para sites de restaurantes: guarda o sc_ref e expõe StudioCoral.conversion(valor, pedido)
  router.get('/t.js', (req, res) => {
    res.type('application/javascript').send(`(function(){
  var K='sc_ref',API='${config.publicUrl}/api/public/conversions';
  try{var p=new URLSearchParams(location.search).get(K);if(p)localStorage.setItem(K,JSON.stringify({ref:p,at:Date.now()}));}catch(e){}
  function ref(){try{var v=JSON.parse(localStorage.getItem(K)||'null');if(v&&Date.now()-v.at<7*864e5)return v.ref;}catch(e){}return null;}
  window.StudioCoral={ref:ref,conversion:function(value,orderId,items){var r=ref();if(!r)return Promise.resolve(null);
    return fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ref:r,value:value,orderId:orderId,items:items||[]})}).then(function(x){return x.json();});}};
})();`);
  });

  // ── Site de demonstração do restaurante ────────────────────
  router.get('/demo/:slug', wrap(async (req, res) => {
    if (!(await repos.restaurants.bySlug(req.params.slug))) return res.status(404).sendFile(path.join(publicDir, 'index.html'));
    return res.sendFile(path.join(publicDir, 'demo.html'));
  }));

  // ── Webhook da API Oficial (Meta) ──────────────────────────
  router.get('/webhooks/whatsapp', (req, res) => {
    const provider = messaging.provider('whatsapp-cloud') || messaging.instance('whatsapp-cloud');
    const challenge = provider.verifyWebhook(req.query);
    return challenge ? res.status(200).send(challenge) : res.sendStatus(403);
  });

  router.post('/webhooks/whatsapp', (req, res) => {
    const provider = messaging.instance('whatsapp-cloud');
    if (!provider.isValidSignature(req.rawBody, req.headers['x-hub-signature-256'])) return res.sendStatus(401);
    provider.handleWebhook(req.body);
    return res.sendStatus(200);
  });

  return router;
}

module.exports = { createPublicRoutes };
```

- [ ] **Step 11: `src/seed.js` assíncrono**

Mantenha as linhas 1–89 (cabeçalho, `rng`, `RESTAURANTS`, `IMAGES`, `BANNERS`, `RESTAURANT_USERS` e `TAG_POOL`) **sem mudança**. Substitua dali até o fim do arquivo por:

```js
async function seed(repos, { reset = false } = {}) {
  if (reset) await repos.reset();
  const rand = rng(42);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const now = Date.now();
  const iso = (t) => new Date(t).toISOString();

  // Numa transação: ou a demonstração entra inteira, ou nada entra
  await repos.tx(async (r) => {
    for (const [ri, data] of RESTAURANTS.entries()) {
      const restaurant = await r.restaurants.create({
        ...data,
        demo: true,
        requireApproval: true,
        menu: data.menu.map((it) => ({ ...it, image: IMAGES[it.id] ? `/demo-assets/${IMAGES[it.id]}.svg` : '' })),
        banners: (BANNERS[data.slug] || []).map((b) => `/demo-assets/${b}.svg`),
      });
      const login = RESTAURANT_USERS[data.slug];
      if (login) {
        await r.users.create({ restaurantId: restaurant.id, role: 'restaurant', name: login.name, email: login.email, passwordHash: AuthService.hashPassword(login.password) });
      }

      // Contatos fictícios
      const contacts = [];
      const total = ri === 0 ? 48 : 34;
      for (let i = 0; i < total; i += 1) {
        const tags = [...new Set([...pick(TAG_POOL), ...(rand() < 0.3 ? pick(TAG_POOL) : [])])];
        contacts.push({
          restaurantId: restaurant.id,
          name: `${pick(FIRST)} ${pick(LAST)}`,
          phone: `55009${String(80000000 + ri * 1000 + i * 37).padStart(8, '0')}`,
          tags,
          optIn: i % 17 !== 5,
          optInSource: pick(['Pedido no site', 'Cadastro no balcão', 'QR Code na mesa', 'Programa de fidelidade']),
          optedOut: i % 23 === 7,
          demo: true,
          createdAt: iso(now - (30 + i) * DAY),
        });
      }
      const saved = await r.contacts.insertMany(contacts);
      const eligible = saved.filter((c) => c.optIn && !c.optedOut);

      // Campanhas históricas concluídas
      const history = ri === 0
        ? [
          { name: 'Sextou com Massa Fresca', daysAgo: 12, objective: 'Aumentar pedidos no fim de semana', occasion: 'Sexta-feira', coupon: 'NONNA10', perf: [0.97, 0.78, 0.34, 0.42] },
          { name: 'Saudade da Nonna', daysAgo: 6, objective: 'Reativar clientes inativos', occasion: 'Recorrente', coupon: 'VOLTA15', perf: [0.95, 0.81, 0.41, 0.38] },
          { name: 'Lançamento: Nhoque de Baroa', daysAgo: 2, objective: 'Divulgar lançamento de produto', occasion: 'Lançamento', coupon: 'NONNA10', perf: [0.98, 0.74, 0.29, 0.33] },
        ]
        : [
          { name: 'Marmita da Semana', daysAgo: 9, objective: 'Aumentar pedidos no almoço', occasion: 'Recorrente', coupon: 'UAI15', perf: [0.96, 0.83, 0.38, 0.47] },
          { name: 'Dia de Chuva, Dia de Tropeiro', daysAgo: 4, objective: 'Oportunidade do clima', occasion: 'Clima', coupon: 'UAI15', perf: [0.94, 0.77, 0.31, 0.4] },
        ];

      for (const h of history) {
        const start = now - h.daysAgo * DAY + 18 * 3600e3 - (new Date().getHours() * 3600e3);
        const campaign = await r.campaigns.create({
          restaurantId: restaurant.id,
          name: h.name,
          objective: h.objective,
          occasion: h.occasion,
          coupon: h.coupon,
          message: '{Oi|Olá}, {{primeiro_nome}}! Aqui é do {{restaurante}}. Esta semana o cupom *{{cupom}}* vale nos pedidos pelo site:\n\n{{link}}',
          segment: { tags: [], match: 'any' },
          includeFooter: true,
          status: 'completed',
          approval: { status: 'approved', decidedBy: RESTAURANT_USERS[data.slug].name, decidedAt: iso(start - DAY / 2) },
          provider: 'simulator',
          audienceSize: eligible.length,
          startedAt: iso(start),
          completedAt: iso(start + 40 * 60e3),
          createdAt: iso(start - DAY),
          demo: true,
        });
        const [deliv, read, click, conv] = h.perf;
        for (const [i, c] of eligible.entries()) {
          const sentAt = start + i * 50e3;
          const ok = rand() < deliv;
          const wasRead = ok && rand() < read;
          const clicked = wasRead && rand() < click / read * 0.9 + 0.05;
          const converted = clicked && rand() < conv;
          const m = await r.messages.create({
            campaignId: campaign.id,
            restaurantId: restaurant.id,
            contactId: c.id,
            name: c.name,
            phone: c.phone,
            demo: true,
            code: crypto.randomBytes(5).toString('base64url'),
            status: ok ? (wasRead ? 'read' : 'delivered') : 'failed',
            error: ok ? null : 'Número não possui WhatsApp',
            provider: 'simulator',
            queuedAt: iso(start),
            sentAt: iso(sentAt),
            deliveredAt: ok ? iso(sentAt + 60e3) : null,
            readAt: wasRead ? iso(sentAt + (5 + rand() * 120) * 60e3) : null,
            clickedAt: clicked ? iso(sentAt + (10 + rand() * 600) * 60e3) : null,
            clicks: clicked ? 1 + Math.floor(rand() * 2) : 0,
            createdAt: iso(start),
          });
          if (converted) {
            const items = [pick(data.menu), pick(data.menu)];
            const value = Math.round(items.reduce((s, it) => s + it.price, 0) * 0.9 * 100) / 100;
            const at = iso(new Date(m.clickedAt).getTime() + 8 * 60e3);
            await r.conversions.create({
              restaurantId: restaurant.id,
              campaignId: campaign.id,
              messageId: m.id,
              contactId: c.id,
              code: m.code,
              customerName: c.name,
              orderId: `DEMO-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
              value,
              items: items.map((it) => ({ name: it.name, qty: 1, price: it.price })),
              createdAt: at,
            });
            await r.messages.update(m, { convertedAt: at });
          }
        }
      }

      // Rascunho pronto para demonstrar o disparo ao vivo
      await r.campaigns.create({
        restaurantId: restaurant.id,
        name: ri === 0 ? 'Clientes VIP · Menu Degustação' : 'Sábado em Família',
        objective: ri === 0 ? 'Recompensar melhores clientes' : 'Aumentar pedidos no fim de semana',
        occasion: ri === 0 ? 'Recorrente' : 'Sábado',
        coupon: ri === 0 ? 'VIPNONNA' : 'UAI15',
        message: ri === 0
          ? '{{primeiro_nome}}, esta semana a {{restaurante}} vai servir um menu degustação de 5 tempos, só para quem já é cliente da casa.\n\nAs reservas e pedidos são pelo site, com o cupom *{{cupom}}*:\n{{link}}'
          : '{Bom dia|Opa}, {{primeiro_nome}}! Sábado o {{restaurante}} abre às 11h com feijão tropeiro e frango com quiabo no fogão a lenha.\n\nSe pedir pelo site, use o cupom *{{cupom}}*:\n{{link}}',
        segment: { tags: ri === 0 ? ['vip'] : ['familia', 'fim-de-semana'], match: 'any' },
        includeFooter: true,
        status: 'draft',
        // A da Cantina já foi enviada para o restaurante aprovar
        ...(ri === 0 ? {
          approval: { status: 'pending', requestedAt: iso(now - 3 * 3600e3), requestedBy: 'Equipe Studio Coral' },
          approvalLog: [{ action: 'requested', by: 'Equipe Studio Coral', at: iso(now - 3 * 3600e3), note: 'Menu degustação de outubro. Confere se o cupom está certo?' }],
        } : {}),
      });
    }
  });
}

module.exports = { seed };

if (require.main === module) {
  (async () => {
    /* eslint-disable global-require */
    const config = require('./config');
    const { Database } = require('./db/Database');
    const { migrate } = require('./db/migrate');
    const { createRepositories } = require('./db/repositories');
    /* eslint-enable global-require */
    const db = await Database.open(config);
    try {
      await migrate(db);
      const repos = createRepositories(db);
      await repos.settings.load();
      await seed(repos, { reset: process.argv.includes('--reset') });
      console.log('🌱 Base de demonstração recriada.');
    } finally {
      await db.close();
    }
  })().catch((err) => {
    console.error(`✖ ${err.message}`);
    process.exit(1);
  });
}
```

- [ ] **Step 12: Mensageria salva a escolha de provedor sem engolir erro**

Em `src/messaging/index.js`, troque o `onChange`:

```js
      onChange: (key) => settings.update({ provider: key, providerEnvBase: envProvider })
        .catch((err) => c.resolve('logger').error('[settings] Não foi possível salvar o provedor escolhido:', err.message)),
```

- [ ] **Step 13: Remova a camada antiga**

```bash
git rm src/db/JsonStore.js src/db/repositories.js
```

- [ ] **Step 14: Auxiliar dos testes usa PostgreSQL em memória e logger silencioso**

Em `test/helpers/app.js`, acrescente perto do topo:

```js
/** Logger dos testes: só mostra erros. */
const QUIET = { log() {}, info() {}, warn: console.warn, error: console.error };
```

No objeto `config` de `startApp`, logo depois de `dataDir`:

```js
    dataDir,
    databaseUrl: '',
    pgliteDir: 'memory://',
```

E passe o logger ao `createApp`:

```js
  const instance = await createApp({ config, overrides, seed, logger: QUIET });
```

- [ ] **Step 15: Rode a bateria inteira**

Run: `npm test`
Expected: todos os arquivos passam (`test/http`, `test/db` e `test/services`). Rode 3 vezes seguidas.

Se algum teste HTTP falhar, a referência é o comportamento antigo: corrija o código, nunca o teste de caracterização. A única exceção prevista é o teste de telefone repetido na edição, que é comportamento novo. Pontos prováveis de diferença e onde olhar:
- **ordem de listas:** os `sort` em JavaScript foram mantidos nas rotas;
- **`null` × campo ausente:** os testes usam `assert.ok(!x)` onde isso varia;
- **tipos numéricos:** veja os `::int` e o `numeric` no mapeamento.

- [ ] **Step 16: Conferência rápida no navegador, com uma pasta de dados separada**

Run (Git Bash): `DATA_DIR=./data/smoke npm start`
Expected:
- o console mostra "migração aplicada: 001_esquema_inicial" e "Dados de demonstração criados";
- em `http://localhost:3000/app` o painel abre com os dois restaurantes de demonstração.

Pare com Ctrl+C, depois rode `rm -rf data/smoke`. A pasta separada preserva o `data/` real para a importação automática da Task 10.

- [ ] **Step 17: Commit**

```bash
git add -A src test
git commit -m "Serviços, rotas e seed sobre o PostgreSQL; fim do data/db.json

As contagens do painel e do relatório viram consultas SQL, a fila reserva
mensagens de forma atômica e as confirmações nunca fazem o status voltar.
A bateria de caracterização continua igual e verde.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Importação do `data/db.json`, manual e automática na primeira subida

**Files:**
- Create: `src/db/importJson.js`, `scripts/importar-json.js`, `test/helpers/legacy-json.js`
- Modify: `src/app.js` (população inicial), `test/helpers/app.js` (opção `legacyJson`), `package.json` (script)
- Test: `test/db/import-json.test.js`, `test/http/import.test.js`

**Interfaces:**
- Consumes: `createRepositories` e as `table` exportadas por cada repositório (Tasks 6–8).
- Produces:
  - `importJson(db, data) → { collections: { [nome]: { read, inserted, existing, ignored, adjusted } }, warnings: string[], settings?: string[] }`;
  - `formatReport(report) → string[]` e `shortSummary(report) → string`;
  - `startApp({ …, legacyJson })` grava o objeto como `db.json` na pasta de dados antes de subir.

Regra da subida (complementa o spec): com o banco vazio, se existir `data/db.json`, ele é importado **em vez de** criar a demonstração. O arquivo não é apagado.

- [ ] **Step 1: Dados antigos de exemplo**

Crie `test/helpers/legacy-json.js`:

```js
const { AuthService } = require('../../src/services/AuthService');

const ID = {
  restaurant: '8e5ff564-1299-4909-9c35-f414fed26f24',
  user: 'c939db2c-d1d4-48bc-bbf3-16c9f157d048',
  ana: '11111111-1111-4111-8111-111111111111',
  beto: '22222222-2222-4222-8222-222222222222',
  anaRepetida: '33333333-3333-4333-8333-333333333333',
  orfao: '44444444-4444-4444-8444-444444444444',
  campaign: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  m1: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
  m2: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
  m3: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3',
  v1: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
  v2: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
  gone: '99999999-9999-4999-8999-999999999999',
  goneRestaurant: '98989898-9898-4898-8898-989898989898',
};

/**
 * Um db.json no formato antigo, com os defeitos que o JSON permitia:
 * telefone repetido, contato de restaurante apagado, mensagem de contato
 * apagado, mensagem e pedido de campanha apagada, campo que não existe mais.
 */
function legacyJson() {
  return {
    restaurants: [{ id: ID.restaurant, createdAt: '2026-09-01T12:00:00.000Z', name: 'Cantina Antiga', slug: 'cantina-antiga', color: '#73350c', menu: [{ id: 'm1', name: 'Lasanha', price: 62.9 }], requireApproval: true, demo: false }],
    users: [{ id: ID.user, createdAt: '2026-09-01T12:00:00.000Z', restaurantId: ID.restaurant, role: 'restaurant', name: 'Giulia', email: 'giulia@antiga.com.br', passwordHash: AuthService.hashPassword('senha-giulia-123'), lastLoginAt: '2026-09-10T08:00:00.000Z', updatedAt: '2026-09-10T08:00:00.000Z' }],
    contacts: [
      { id: ID.ana, createdAt: '2026-09-02T12:00:00.000Z', restaurantId: ID.restaurant, name: 'Ana', phone: '5531999000001', tags: ['vip'], optIn: true, optInSource: 'Pedido no site', optedOut: false, campoAntigo: 'x' },
      { id: ID.beto, createdAt: '2026-09-02T12:00:00.000Z', restaurantId: ID.restaurant, name: 'Beto', phone: '5531999000002', tags: [], optIn: true, optedOut: true, optedOutAt: '2026-09-20T10:00:00.000Z' },
      { id: ID.anaRepetida, createdAt: '2026-09-03T12:00:00.000Z', restaurantId: ID.restaurant, name: 'Ana repetida', phone: '5531999000001', tags: [], optIn: true, optedOut: false },
      { id: ID.orfao, createdAt: '2026-09-03T12:00:00.000Z', restaurantId: ID.goneRestaurant, name: 'De restaurante apagado', phone: '5531999000009', tags: [], optIn: true, optedOut: false },
    ],
    campaigns: [{ id: ID.campaign, createdAt: '2026-09-05T12:00:00.000Z', restaurantId: ID.restaurant, name: 'Sextou', message: 'Oi {{link}}', segment: { tags: [], match: 'any' }, includeFooter: true, status: 'completed', approval: { status: 'approved' }, approvalLog: [], provider: 'simulator', audienceSize: 2, startedAt: '2026-09-05T18:00:00.000Z', completedAt: '2026-09-05T18:40:00.000Z' }],
    messages: [
      { id: ID.m1, createdAt: '2026-09-05T18:00:00.000Z', campaignId: ID.campaign, restaurantId: ID.restaurant, contactId: ID.ana, name: 'Ana', phone: '5531999000001', demo: false, code: 'abc1234', status: 'read', error: null, provider: 'simulator', queuedAt: '2026-09-05T18:00:00.000Z', sentAt: '2026-09-05T18:00:00.000Z', deliveredAt: '2026-09-05T18:01:00.000Z', readAt: '2026-09-05T18:30:00.000Z', clickedAt: '2026-09-05T19:00:00.000Z', clicks: 1, convertedAt: '2026-09-05T19:10:00.000Z' },
      { id: ID.m2, createdAt: '2026-09-05T18:00:00.000Z', campaignId: ID.campaign, restaurantId: ID.restaurant, contactId: ID.gone, name: 'Contato apagado', phone: '5531999000005', code: 'abc1235', status: 'delivered', sentAt: '2026-09-05T18:01:00.000Z', clicks: 0 },
      { id: ID.m3, createdAt: '2026-09-05T18:00:00.000Z', campaignId: ID.gone, restaurantId: ID.restaurant, contactId: ID.beto, name: 'Beto', phone: '5531999000002', code: 'abc1236', status: 'sent', sentAt: '2026-09-05T18:02:00.000Z', clicks: 0 },
    ],
    conversions: [
      { id: ID.v1, createdAt: '2026-09-05T19:10:00.000Z', restaurantId: ID.restaurant, campaignId: ID.campaign, messageId: ID.m1, contactId: ID.ana, code: 'abc1234', customerName: 'Ana', orderId: 'PED-1', value: 77.4, items: [{ name: 'Lasanha', qty: 1, price: 62.9 }] },
      { id: ID.v2, createdAt: '2026-09-06T12:00:00.000Z', restaurantId: ID.restaurant, campaignId: ID.gone, messageId: ID.m3, contactId: ID.gone, customerName: 'Beto', orderId: 'PED-2', value: 30, items: [] },
    ],
    settings: { provider: 'whatsapp-cloud', providerEnvBase: 'simulator', footer: 'Rodapé antigo' },
  };
}

module.exports = { legacyJson, ID };
```

- [ ] **Step 2: Escreva os testes**

Crie `test/db/import-json.test.js`:

```js
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openTestDb } = require('../helpers/db');
const { legacyJson, ID } = require('../helpers/legacy-json');
const { importJson, formatReport, shortSummary } = require('../../src/db/importJson');
const { createRepositories } = require('../../src/db/repositories');
const { AuthService } = require('../../src/services/AuthService');

describe('importação do antigo db.json', () => {
  let db;
  let repos;
  let first;
  before(async () => {
    db = await openTestDb();
    repos = createRepositories(db);
    first = await importJson(db, legacyJson());
  });
  after(() => db.close());

  it('relata o que entrou, o que já existia, o que foi ignorado e o que foi ajustado', () => {
    assert.deepEqual(first.collections, {
      restaurants: { read: 1, inserted: 1, existing: 0, ignored: 0, adjusted: 0 },
      users: { read: 1, inserted: 1, existing: 0, ignored: 0, adjusted: 0 },
      contacts: { read: 4, inserted: 2, existing: 1, ignored: 1, adjusted: 0 },
      campaigns: { read: 1, inserted: 1, existing: 0, ignored: 0, adjusted: 0 },
      messages: { read: 3, inserted: 2, existing: 0, ignored: 1, adjusted: 1 },
      conversions: { read: 2, inserted: 2, existing: 0, ignored: 0, adjusted: 1 },
    });
    assert.deepEqual(first.warnings, ['contacts: campos desconhecidos ignorados (campoAntigo)']);
    assert.deepEqual(first.settings, ['provider', 'providerEnvBase', 'footer']);
    assert.equal(shortSummary(first), '1 restaurantes, 1 acessos, 2 contatos, 1 campanhas, 2 mensagens, 2 pedidos');
    assert.ok(formatReport(first).some((line) => line.includes('Contatos') && line.includes('1 já existiam') && line.includes('1 ignorados')));
  });

  it('referências quebradas: mensagem perde o contato, pedido perde campanha, mensagem e contato', async () => {
    assert.equal((await repos.messages.get(ID.m2)).contactId, null);
    assert.equal(await repos.messages.get(ID.m3), null);
    const v2 = await repos.conversions.get(ID.v2);
    assert.equal(v2.campaignId, null);
    assert.equal(v2.messageId, null);
    assert.equal(v2.contactId, null);
    assert.equal(v2.value, 30);
  });

  it('mantém ids, datas, JSON, senha e configurações', async () => {
    const r = await repos.restaurants.get(ID.restaurant);
    assert.equal(r.createdAt, '2026-09-01T12:00:00.000Z');
    assert.deepEqual(r.menu, [{ id: 'm1', name: 'Lasanha', price: 62.9 }]);
    const u = await repos.users.get(ID.user);
    assert.ok(AuthService.checkPassword('senha-giulia-123', u.passwordHash));
    assert.equal((await repos.conversions.get(ID.v1)).value, 77.4);
    assert.equal((await db.one('SELECT phone_key FROM contacts WHERE id = $1', [ID.ana])).phone_key, '3199000001');
    await repos.settings.load();
    assert.equal(repos.settings.get().footer, 'Rodapé antigo');
    assert.equal(repos.settings.get().dailyLimit, 800);
  });

  it('rodar de novo não duplica nada', async () => {
    const again = await importJson(db, legacyJson());
    for (const stat of Object.values(again.collections)) assert.equal(stat.inserted, 0);
    assert.equal(again.collections.contacts.existing, 3);
    assert.equal(await repos.contacts.count(), 2);
    assert.equal(await repos.messages.count(), 2);
  });

  it('aceita JSON vazio ou incompleto', async () => {
    const other = await openTestDb();
    try {
      const report = await importJson(other, {});
      assert.ok(Object.values(report.collections).every((s) => s.read === 0));
      assert.equal(report.settings, undefined);
    } finally {
      await other.close();
    }
  });
});
```

Crie `test/http/import.test.js`:

```js
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('../helpers/app');
const { legacyJson } = require('../helpers/legacy-json');

describe('primeira subida com um data/db.json antigo', () => {
  let ctx;
  before(async () => { ctx = await startApp({ seed: true, legacyJson: legacyJson() }); });
  after(async () => { await ctx.close(); });

  it('importa o JSON em vez de criar a demonstração', async () => {
    const list = (await ctx.agency.get('/api/restaurants')).data;
    assert.deepEqual(list.map((r) => r.name), ['Cantina Antiga']);
    assert.equal(list[0].contactsCount, 2);
    assert.equal(list[0].campaignsCount, 1);
  });

  it('acessos, configurações e números vêm junto', async () => {
    assert.equal((await ctx.client().login('giulia@antiga.com.br', 'senha-giulia-123')).status, 200);
    assert.equal((await ctx.agency.get('/api/settings')).data.footer, 'Rodapé antigo');
    const [r] = (await ctx.agency.get('/api/restaurants')).data;
    const d = (await ctx.agency.get(`/api/dashboard?restaurantId=${r.id}`)).data;
    assert.equal(d.totals.audience, 2);
    assert.equal(d.totals.orders, 1);
    assert.equal(d.totals.revenue, 77.4);
  });

  it('um provedor salvo que não existe neste ambiente cai no simulador', async () => {
    assert.equal((await ctx.agency.get('/api/messaging/status')).data.state, 'connected');
  });
});
```

- [ ] **Step 3: Rode e veja falhar**

Run: `node --test test/db/import-json.test.js test/http/import.test.js`
Expected: FAIL com `Cannot find module '../../src/db/importJson'`. O teste HTTP falha porque a demonstração é criada no lugar da importação.

- [ ] **Step 4: Implemente a importação**

Crie `src/db/importJson.js`:

```js
const { createRepositories } = require('./repositories');
const { table: restaurants } = require('./repositories/restaurants');
const { table: users } = require('./repositories/users');
const { table: contacts } = require('./repositories/contacts');
const { table: campaigns } = require('./repositories/campaigns');
const { table: messages } = require('./repositories/messages');
const { table: conversions } = require('./repositories/conversions');

const TABLES = { restaurants, users, contacts, campaigns, messages, conversions };
const LABELS = { restaurants: 'Restaurantes', users: 'Acessos', contacts: 'Contatos', campaigns: 'Campanhas', messages: 'Mensagens', conversions: 'Pedidos' };
const SHORT = { restaurants: 'restaurantes', users: 'acessos', contacts: 'contatos', campaigns: 'campanhas', messages: 'mensagens', conversions: 'pedidos' };
// Qualquer repetido (id, slug, e-mail, telefone ou número de pedido) é ignorado
const SKIP_EXISTING = 'ON CONFLICT DO NOTHING';

/**
 * Copia o conteúdo de um antigo data/db.json para o banco, numa transação.
 *  • Pode rodar de novo: o que já existe é ignorado.
 *  • O JSON não tinha integridade. Pedidos e mensagens com vínculo quebrado
 *    perdem o vínculo; o que não pode existir sem o pai é ignorado; tudo vai
 *    para o relatório.
 */
async function importJson(db, data) {
  const report = { collections: {}, warnings: [] };
  await db.tx(async (t) => {
    const repos = createRepositories(t);
    const idsOf = async (table) => new Set((await t.many(`SELECT id FROM ${table}`)).map((r) => r.id));

    const prepare = (name) => {
      const allowed = new Set(TABLES[name].columns);
      const unknown = new Set();
      const rows = (Array.isArray(data?.[name]) ? data[name] : []).map((row) => Object.fromEntries(
        Object.entries(row).filter(([key]) => allowed.has(key) || (unknown.add(key), false)),
      ));
      if (unknown.size) report.warnings.push(`${name}: campos desconhecidos ignorados (${[...unknown].join(', ')})`);
      const stat = { read: rows.length, inserted: 0, existing: 0, ignored: 0, adjusted: 0 };
      report.collections[name] = stat;
      return { rows, stat };
    };

    const insert = async (name, rows, stat) => {
      const inserted = await repos[name].insertMany(rows, { onConflict: SKIP_EXISTING });
      stat.inserted = inserted.length;
      stat.existing = rows.length - inserted.length;
    };

    // Restaurantes primeiro; o resto só entra se o restaurante existir
    const restaurantsPart = prepare('restaurants');
    await insert('restaurants', restaurantsPart.rows, restaurantsPart.stat);
    const restaurantIds = await idsOf('restaurants');
    const ofKnownRestaurant = ({ rows, stat }) => rows.filter((row) => restaurantIds.has(row.restaurantId) || (stat.ignored += 1, false));

    for (const name of ['users', 'contacts', 'campaigns']) {
      const part = prepare(name);
      await insert(name, ofKnownRestaurant(part), part.stat);
    }
    const contactIds = await idsOf('contacts');
    const campaignIds = await idsOf('campaigns');

    // Mensagens: sem campanha não existem; contato apagado vira null
    const messagesPart = prepare('messages');
    const messageRows = ofKnownRestaurant(messagesPart)
      .filter((row) => campaignIds.has(row.campaignId) || (messagesPart.stat.ignored += 1, false))
      .map((row) => {
        if (!row.contactId || contactIds.has(row.contactId)) return row;
        messagesPart.stat.adjusted += 1;
        return { ...row, contactId: null };
      });
    await insert('messages', messageRows, messagesPart.stat);
    const messageIds = await idsOf('messages');

    // Pedidos são dado de venda: perdem o vínculo quebrado, mas ficam
    const conversionsPart = prepare('conversions');
    const conversionRows = ofKnownRestaurant(conversionsPart).map((row) => {
      const fixed = { ...row };
      if (fixed.campaignId && !campaignIds.has(fixed.campaignId)) fixed.campaignId = null;
      if (fixed.messageId && !messageIds.has(fixed.messageId)) fixed.messageId = null;
      if (fixed.contactId && !contactIds.has(fixed.contactId)) fixed.contactId = null;
      if (['campaignId', 'messageId', 'contactId'].some((k) => fixed[k] !== row[k])) conversionsPart.stat.adjusted += 1;
      return fixed;
    });
    await insert('conversions', conversionRows, conversionsPart.stat);

    // Configurações salvas no JSON valem por cima dos padrões
    if (data?.settings && typeof data.settings === 'object' && Object.keys(data.settings).length) {
      await repos.settings.update(data.settings);
      report.settings = Object.keys(data.settings);
    }
  });
  return report;
}

/** Linhas legíveis do relatório (script de importação). */
function formatReport(report) {
  const lines = Object.entries(report.collections).map(([name, s]) => {
    const extras = [
      s.existing && `${s.existing} já existiam`,
      s.ignored && `${s.ignored} ignorados (referência quebrada)`,
      s.adjusted && `${s.adjusted} com vínculo ajustado`,
    ].filter(Boolean).join(', ');
    return `  ${LABELS[name].padEnd(13)} ${String(s.inserted).padStart(5)} de ${s.read}${extras ? ` · ${extras}` : ''}`;
  });
  if (report.settings) lines.push(`  Configurações: ${report.settings.join(', ')}`);
  return [...lines, ...report.warnings.map((w) => `  ⚠ ${w}`)];
}

/** Resumo de uma linha (log da primeira subida). */
function shortSummary(report) {
  return Object.entries(report.collections).map(([name, s]) => `${s.inserted} ${SHORT[name]}`).join(', ');
}

module.exports = { importJson, formatReport, shortSummary };
```

Crie `scripts/importar-json.js`:

```js
/**
 * Copia um data/db.json (formato antigo) para o banco configurado no .env.
 *   npm run db:import-json -- [caminho]     (padrão: data/db.json)
 * Pode rodar de novo sem duplicar. Com o PGlite, pare o servidor antes.
 */
const fs = require('fs');
const path = require('path');
const config = require('../src/config');
const { Database } = require('../src/db/Database');
const { migrate } = require('../src/db/migrate');
const { importJson, formatReport } = require('../src/db/importJson');

(async () => {
  const file = path.resolve(process.argv[2] || path.join(config.dataDir, 'db.json'));
  if (!fs.existsSync(file)) throw new Error(`Arquivo não encontrado: ${file}`);
  const data = JSON.parse(fs.readFileSync(file, 'utf8') || '{}');
  const db = await Database.open(config);
  try {
    await migrate(db, { logger: console });
    const report = await importJson(db, data);
    console.log(`Importado de ${file}:`);
    formatReport(report).forEach((line) => console.log(line));
  } finally {
    await db.close();
  }
})().catch((err) => {
  console.error(`✖ ${err.message}`);
  process.exit(1);
});
```

Em `package.json`, dentro de `scripts`:

```json
    "db:import-json": "node scripts/importar-json.js",
```

- [ ] **Step 5: Importação automática na primeira subida**

Em `src/app.js`, acrescente o require:

```js
const { importJson, shortSummary } = require('./db/importJson');
```

E troque o bloco da população inicial por:

```js
    // Primeira execução (banco vazio): traz o antigo data/db.json, se existir;
    // senão, cria os dados de demonstração
    if (seed && (await repos.restaurants.count()) === 0) {
      const legacy = path.join(config.dataDir, 'db.json');
      if (fs.existsSync(legacy)) {
        const report = await importJson(db, JSON.parse(fs.readFileSync(legacy, 'utf8') || '{}'));
        logger.log(`📦 data/db.json importado para o banco: ${shortSummary(report)}. O arquivo foi mantido como cópia.`);
        report.warnings.forEach((w) => logger.log(`   ⚠ ${w}`));
      } else {
        await seedDemo(repos);
        logger.log('🌱 Dados de demonstração criados.');
      }
    }
```

- [ ] **Step 6: Auxiliar dos testes aceita um db.json antigo**

Em `test/helpers/app.js`, mude a assinatura e grave o arquivo logo depois de criar a pasta:

```js
async function startApp({ seed = false, simulator = FAST_SIMULATOR, legacyJson = null } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coral-teste-'));
  if (legacyJson) fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify(legacyJson));
```

- [ ] **Step 7: Rode e veja passar**

Run: `npm test`
Expected: tudo verde, inclusive `test/db/import-json.test.js` e `test/http/import.test.js`.

- [ ] **Step 8: Importe o `data/db.json` real numa pasta separada e confira as contagens**

Run (Git Bash, na raiz do projeto):

```bash
node -e "const d=require('./data/db.json');for(const k of ['restaurants','users','contacts','campaigns','messages','conversions'])console.log(k,(d[k]||[]).length)"
DATA_DIR=./data/import-check node scripts/importar-json.js data/db.json
```

Expected: a coluna "inserted" (o primeiro número de cada linha) bate com as contagens do primeiro comando, sem `ignorados`. Depois apague a pasta: `rm -rf data/import-check data/import-check.lock`.

- [ ] **Step 9: Commit**

```bash
git add src/db/importJson.js scripts/importar-json.js src/app.js package.json test/helpers test/db/import-json.test.js test/http/import.test.js
git commit -m "Importação do antigo data/db.json: comando próprio e automática na primeira subida

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Driver de produção na bateria HTTP, documentação e conferência final

**Files:**
- Create: `test/pg.env`
- Modify: `test/helpers/app.js`, `package.json` (scripts e `engines`), `.env.example`, `README.md`

**Interfaces:**
- Consumes: `startPgServer()` (Task 3), `startApp()` (Tasks 1, 9, 10).
- Produces: `npm test` roda tudo com o PGlite e depois a bateria HTTP pelo driver `pg` (`TEST_PG=1`).

- [ ] **Step 1: Modo `TEST_PG` no auxiliar**

Em `test/helpers/app.js`, acrescente o require:

```js
const { startPgServer } = require('./pg-server');
```

Em `startApp`, logo depois de montar o objeto `config` e antes de `createApp`:

```js
  // TEST_PG=1: o mesmo teste, mas pelo driver `pg` (como em produção)
  const pg = process.env.TEST_PG === '1' ? await startPgServer() : null;
  if (pg) {
    config.databaseUrl = pg.url;
    config.databasePoolMax = 1;
  }
```

E no `close()` devolvido:

```js
    async close() {
      await instance.close();
      await pg?.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
```

Crie `test/pg.env`:

```
TEST_PG=1
```

- [ ] **Step 2: Scripts e versão do Node**

Em `package.json`:

```json
  "scripts": {
    "start": "node src/server.js",
    "dev": "node --watch src/server.js",
    "seed": "node src/seed.js --reset",
    "db:import-json": "node scripts/importar-json.js",
    "test": "node --test --test-concurrency=4 \"test/**/*.test.js\" && npm run test:pg",
    "test:pg": "node --env-file=test/pg.env --test --test-concurrency=4 \"test/http/**/*.test.js\""
  },
  "engines": {
    "node": ">=22"
  },
```

- [ ] **Step 3: Rode a bateria completa**

Run: `npm test`
Expected: as duas rodadas verdes. Na segunda, os testes HTTP passam pelo driver `pg` (cada arquivo sobe o próprio servidor PostgreSQL local). Rode 3 vezes seguidas.

- [ ] **Step 4: `.env.example`**

Depois do bloco de `PUBLIC_URL`, acrescente:

```
# ── Banco de dados ───────────────────────────────────────────
# Vazio: usa o PGlite (PostgreSQL embutido) em data/pgdata — bom para desenvolver.
# Produção: endereço do PostgreSQL, ex.: postgres://usuario:senha@host:5432/studio_coral
DATABASE_URL=
# Conexões simultâneas com o PostgreSQL
DATABASE_POOL_MAX=10
```

- [ ] **Step 5: README**

Grave o texto novo da seção "Como rodar" em `data/readme-como-rodar.md`:

````markdown
## Como rodar

```bash
npm install
cp .env.example .env
npm start
```

> **Node 22 ou superior.** O WPPConnect e o relatório em PDF usam o Chrome do Puppeteer, instalado junto com as dependências opcionais (`npm install`).

> **Rede corporativa:** o WPPConnect abre o `web.whatsapp.com` num Chrome interno. Se a rede bloquear esse site (como o Sophos Web Protection da rede atual), a conexão falha e o painel avisa. Use uma rede sem esse bloqueio (casa, 4G) ou peça a liberação do domínio à TI.

### Banco de dados

Os dados ficam no PostgreSQL.

- **Sem configurar nada (desenvolvimento):** o sistema usa o **PGlite**, um PostgreSQL embutido, e grava em `data/pgdata`. Não é preciso instalar PostgreSQL.
- **Produção:** defina `DATABASE_URL=postgres://usuario:senha@host:5432/banco` no `.env`. As tabelas são criadas e atualizadas sozinhas ao subir o servidor (pasta `migrations/`).
- **Vindo da versão com `data/db.json`:** na primeira subida com o banco vazio, o conteúdo do JSON é importado automaticamente, e o arquivo é mantido como cópia. Para importar à mão: `npm run db:import-json -- caminho/do/db.json`.
- `npm run seed` apaga o banco e recria os dados de demonstração.
- Com o PGlite, só um processo usa a pasta por vez: pare o servidor antes de rodar `npm run seed` ou `npm run db:import-json`.

### Testes

```bash
npm test
```

Roda a bateria completa duas vezes: com o PostgreSQL embutido e pelo driver `pg`, como em produção. Não precisa de nada instalado além das dependências do projeto.
````

E troque, no `README.md`, o trecho que vai da linha `## Como rodar` até a linha que começa com `` `npm run seed` apaga a base `` (inclusive). Use um script: as linhas 39–40 do README têm caracteres de controle de um caminho do Windows colado errado, e uma substituição por texto não acharia o trecho:

```bash
node -e "
const fs = require('fs');
const text = fs.readFileSync('README.md', 'utf8');
const eol = text.includes('\r\n') ? '\r\n' : '\n';
const lines = text.split(/\r?\n/);
const start = lines.findIndex((l) => l.startsWith('## Como rodar'));
const end = lines.findIndex((l) => l.startsWith('\`npm run seed\` apaga a base'));
if (start < 0 || end < start) throw new Error('Trecho não encontrado no README');
const novo = fs.readFileSync('data/readme-como-rodar.md', 'utf8').trimEnd().split(/\r?\n/);
lines.splice(start, end - start + 1, ...novo);
fs.writeFileSync('README.md', lines.join(eol));
"
rm data/readme-como-rodar.md
```

Por fim, na seção "Observações" do README, troque a linha do banco:

```markdown
- **Banco**: PostgreSQL acessado por repositórios (`src/db/repositories`); o SQL fica só dentro de `src/db`. Rode uma instância do servidor por vez: a fila de disparo e os eventos em tempo real ficam na memória do processo.
```

Confira o resultado abrindo o README: a seção "Como rodar" deve estar inteira e sem caracteres estranhos.

- [ ] **Step 6: Conferência no navegador, com uma pasta de dados separada**

Crie `data/verificacao.env`:

```
DATA_DIR=./data/verificacao
PORT=3100
PUBLIC_URL=http://localhost:3100
MESSAGING_PROVIDER=simulator
```

Run: `node --env-file=data/verificacao.env src/server.js`

Confira em `http://localhost:3100/app`:
1. Login da agência (e-mail e senha do `.env`). O painel abre com os dois restaurantes de demonstração.
2. Nova campanha para a Cantina Bella Nonna, segmento `vip`, mensagem com `{{primeiro_nome}}` e `{{link}}`. Peça aprovação.
3. Em outra aba anônima, entre como `giulia@bellanonna.com.br` / `bellanonna` e aprove.
4. De volta à agência: Conexão → simulador conectado. Dispare. O progresso anda em tempo real até "Concluída".
5. Abra um link `/r/…` da tela de resultado. O site de demonstração abre com a saudação. Faça um pedido. O painel mostra o pedido.
6. Relatórios → Cantina → mês atual: os números aparecem.
7. Pare o servidor (Ctrl+C) e suba de novo: tudo continua lá (PGlite em disco).

Pare o servidor e apague: `rm -rf data/verificacao data/verificacao.lock data/verificacao.env`.

- [ ] **Step 7: Primeira subida com os dados reais**

Run: `npm start`
Expected:
- o console mostra `📦 data/db.json importado para o banco: …` e as contagens conferidas na Task 10;
- o painel mostra os dados que existiam no JSON.

Pare com Ctrl+C.

- [ ] **Step 8: Bateria final e commit**

Run: `npm test` (duas rodadas verdes) e `git status`. Deve haver só README, `.env.example`, `package.json`, `test/pg.env` e `test/helpers/app.js` alterados, sem nada dentro de `data/`.

```bash
git add README.md .env.example package.json test/pg.env test/helpers/app.js
git commit -m "Bateria HTTP também pelo driver pg; README e .env.example com o banco

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Cobertura do spec (auto-revisão)

| Requisito do spec | Task |
|---|---|
| PostgreSQL com `pg` em produção, PGlite em desenvolvimento e testes | 3 |
| Migrações versionadas, aplicadas ao subir | 4, 9 |
| Repositórios no formato de hoje (camelCase, ISO, Number), `update` copiando no objeto, `tx` | 5–8 |
| Configurações com `get()` síncrono e cópia em memória | 6 |
| Contagens em SQL com as regras do `summarize`; estatísticas de várias campanhas numa consulta | 8, 9 |
| Séries diárias em JavaScript sobre linhas do período | 9 |
| Reserva atômica, ack sem regressão, `markSent` com `CASE`, clique atômico, início em transação com códigos únicos, limite diário em UTC, retorno de `sending` à fila | 8, 9 |
| Esquema com colunas, JSONB, índices e cascatas | 4 |
| Rotas e serviços assíncronos; ordenações com acento em JavaScript | 9 |
| Importação do JSON com regras para referências quebradas | 10 |
| Erros: conexão (sem senha), unicidade amigável, pedido repetido sem corrida, transação desfeita | 3, 5, 8, 9 |
| Testes: caracterização antes (JSON) e depois (PostgreSQL), repositórios, caminho de produção (`pg`) | 1, 2, 3, 9, 11 |
| Critérios de aceite: `npm test`, contagens da importação, navegador, sem `JsonStore`, README | 9, 10, 11 |
| Limites conhecidos documentados (uma instância; PGlite só para desenvolvimento) | 11 |
