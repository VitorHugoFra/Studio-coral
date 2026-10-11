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
