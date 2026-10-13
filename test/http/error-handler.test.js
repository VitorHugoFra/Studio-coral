const { describe, it, before, beforeEach, afterEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('../helpers/app');
const { finalErrorHandler } = require('../../src/app');

const MESSAGE = 'Erro interno. Tente de novo em instantes.';

describe('tratador final de erros', () => {
  let ctx;
  let repos;
  const logged = [];
  const logger = { log() {}, info() {}, warn() {}, error: (...args) => logged.push(args) };

  before(async () => {
    ctx = await startApp({ logger });
    repos = ctx.container.resolve('repos');
  });
  beforeEach(() => { logged.length = 0; });
  afterEach(() => {
    // Interceptações que sobraram não podem vazar para o teste seguinte
    delete repos.messages.byCode;
    delete repos.users.get;
  });
  after(async () => { await ctx?.close(); });

  it('falha do banco numa rota pública (link /r/:code) vira 500 em texto simples, sem pilha, e fica no log', async () => {
    const failure = Object.assign(new Error('terminating connection due to administrator command'), { code: '57P01' });
    repos.messages.byCode = async () => { throw failure; };
    const res = await fetch(`${ctx.baseUrl}/r/abc12345`, { redirect: 'manual' });
    const body = await res.text();
    assert.equal(res.status, 500);
    assert.match(res.headers.get('content-type'), /^text\/plain/);
    assert.equal(body, MESSAGE, 'nenhuma pilha nem detalhe do erro no corpo');
    assert.deepEqual(logged, [['[http]', failure]]);
  });

  it('falha do banco no middleware de autenticação vira 500 em JSON (rotas /api), sem pilha, e fica no log', async () => {
    const restaurant = (await ctx.agency.post('/api/restaurants', { name: 'Cantina do Erro' })).data;
    await ctx.agency.post(`/api/restaurants/${restaurant.id}/users`, { name: 'Giulia', email: 'giulia@erro.com.br', password: 'senha-da-giulia-1' });
    const giulia = ctx.client();
    assert.equal((await giulia.login('giulia@erro.com.br', 'senha-da-giulia-1')).status, 200);

    // Usuário de restaurante: o middleware confere no banco se o acesso ainda existe, e o banco falha
    const failure = Object.assign(new Error('Connection terminated unexpectedly'), { db: true });
    repos.users.get = async () => { throw failure; };
    logged.length = 0;
    const res = await giulia.get('/api/auth/me');
    assert.equal(res.status, 500);
    assert.deepEqual(res.data, { error: MESSAGE });
    assert.deepEqual(logged, [['[http]', failure]]);
  });

  it('JSON malformado no corpo segue sendo erro do cliente (400), sem pilha e sem ir para o log de erros', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"email": ' });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'Requisição inválida.' });
    assert.deepEqual(logged, []);
  });
});

describe('finalErrorHandler', () => {
  it('com a resposta já iniciada, registra o erro e o entrega ao tratador do Express (que encerra a conexão)', () => {
    const logged = [];
    const handler = finalErrorHandler({ error: (...args) => logged.push(args) });
    const err = new Error('no meio da resposta');
    let delegated;
    const res = { headersSent: true, status() { throw new Error('não pode responder de novo'); } };
    handler(err, { path: '/r/abc12345' }, res, (e) => { delegated = e; });
    assert.equal(delegated, err);
    assert.deepEqual(logged, [['[http]', err]]);
  });
});
