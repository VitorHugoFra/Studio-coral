const { describe, it, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const baseConfig = require('../../src/config');
const { Database } = require('../../src/db/Database');
const { createApp } = require('../../src/app');
const { startApp, waitFor, sleep } = require('../helpers/app');
const { interleave } = require('../helpers/race');
const { legacyJson } = require('../helpers/legacy-json');

describe('subida do app', () => {
  it('quando a subida falha, a fila para e o banco é fechado', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coral-teste-'));
    const closed = [];
    const close = Database.prototype.close;
    Database.prototype.close = function spy() { closed.push(this); return close.call(this); };
    let stopped = false;
    const failingDispatch = () => ({ async init() { throw new Error('a fila não subiu'); }, stop() { stopped = true; } });
    try {
      await assert.rejects(
        createApp({
          config: { ...baseConfig, dataDir, databaseUrl: '', pgliteDir: 'memory://' },
          seed: false,
          logger: { log() {}, info() {}, warn() {}, error() {} },
          overrides: { dispatch: failingDispatch },
        }),
        { message: 'a fila não subiu' },
      );
    } finally {
      Database.prototype.close = close;
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
    assert.equal(closed.length, 1);
    assert.equal(stopped, true);
  });

  it('trava a instância única logo depois de abrir o banco, antes de migrar', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coral-teste-'));
    const logger = { log() {}, info() {}, warn() {}, error() {} };
    const original = Database.prototype.lockSingleInstance;
    const calls = [];
    Database.prototype.lockSingleInstance = async function spy(options) {
      // Ainda não migrou: a tabela de controle das migrações não existe
      const migrated = (await this.one("SELECT to_regclass('public.schema_migrations') AS t")).t !== null;
      calls.push({ options, migrated });
      return original?.call(this, options);
    };
    let instance;
    try {
      instance = await createApp({ config: { ...baseConfig, dataDir, databaseUrl: '', pgliteDir: 'memory://' }, seed: false, logger });
    } finally {
      Database.prototype.lockSingleInstance = original;
      await instance?.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
    assert.equal(calls.length, 1);
    assert.equal(calls[0].migrated, false, 'a trava vem antes das migrações');
    assert.equal(calls[0].options.logger, logger, 'os avisos da espera vão para o logger da aplicação');
  });

  it('o db.json antigo entra uma vez só: com todos os restaurantes excluídos, a próxima subida cria a demonstração em vez de reimportar', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coral-teste-'));
    const { restaurants, users } = legacyJson();
    fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ restaurants, users }));
    // Banco em pasta (e não em memória) para reabri-lo na segunda subida
    const config = {
      ...baseConfig,
      dataDir,
      databaseUrl: '',
      pgliteDir: path.join(dataDir, 'pgdata'),
      messaging: { ...baseConfig.messaging, provider: 'simulator', wppconnect: { ...baseConfig.messaging.wppconnect, tokensDir: path.join(dataDir, 'wpp-tokens') } },
    };
    const lines = [];
    const logger = { log: (...args) => lines.push(args.join(' ')), info() {}, warn() {}, error: console.error };
    const names = async (instance) => (await instance.container.resolve('repos').restaurants.all()).map((r) => r.name);
    try {
      // 1ª subida, banco vazio e db.json presente: importa
      let marker;
      let instance = await createApp({ config, seed: true, logger });
      try {
        assert.deepEqual(await names(instance), ['Cantina Antiga']);
        assert.ok(lines.some((l) => l.includes('data/db.json importado')));
        const repos = instance.container.resolve('repos');
        marker = repos.settings.get().legacyImportedAt;
        // Todos os restaurantes são excluídos (os acessos vão junto)
        for (const r of await repos.restaurants.all()) await repos.restaurants.remove(r.id);
        assert.equal(await repos.restaurants.count(), 0);
      } finally {
        await instance.close();
      }

      // 2ª subida, banco vazio de novo: o db.json (com os acessos e senhas antigos) NÃO volta
      lines.length = 0;
      instance = await createApp({ config, seed: true, logger });
      try {
        assert.deepEqual(await names(instance), ['Cantina Bella Nonna', 'Sabor de Minas']);
        assert.ok(lines.some((l) => l.includes('Dados de demonstração criados')));
        assert.ok(!lines.some((l) => l.includes('importado')));
        assert.equal(await instance.container.resolve('repos').users.byEmail('giulia@antiga.com.br'), null, 'o acesso antigo não voltou');
        // A marca deixada pela importação (data ISO, nas configurações) é o que impede a reimportação
        assert.match(marker, /^\d{4}-\d{2}-\d{2}T/);
        assert.equal(instance.container.resolve('repos').settings.get().legacyImportedAt, marker);
      } finally {
        await instance.close();
      }
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('se outra instância já usa o banco, a subida falha com a mensagem da trava e o banco é fechado', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coral-teste-'));
    const busy = 'Outra instância do Studio Coral já está usando este banco (postgres://x:***@h/d). Rode uma instância por vez.';
    const original = Database.prototype.lockSingleInstance;
    const close = Database.prototype.close;
    const closed = [];
    Database.prototype.lockSingleInstance = async () => { throw new Error(busy); };
    Database.prototype.close = function spy() { closed.push(this); return close.call(this); };
    let started = null; // só preenchido se a subida (erradamente) der certo: assim o teste sempre desliga o que ligou
    try {
      await assert.rejects(
        createApp({ config: { ...baseConfig, dataDir, databaseUrl: '', pgliteDir: 'memory://' }, seed: false, logger: { log() {}, info() {}, warn() {}, error() {} } })
          .then((instance) => { started = instance; }),
        { message: busy },
      );
    } finally {
      Database.prototype.lockSingleInstance = original;
      Database.prototype.close = close;
      await started?.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
    assert.equal(closed.length, 1, 'o banco não fica aberto depois da falha');
  });
});

describe('rotas do painel: concorrência e falhas do banco', () => {
  let ctx;
  let repos;
  let restaurant; // dispara sem aprovação
  let strict; // exige a aprovação do restaurante
  let giulia; // cliente do restaurante que exige aprovação
  const newDraft = async (name, owner = restaurant) => (await ctx.agency.post('/api/campaigns', { restaurantId: owner.id, name, message: 'Oi' })).data;
  const view = async (id) => (await ctx.agency.get(`/api/campaigns/${id}`)).data;
  const requestApproval = (id, note) => ctx.agency.post(`/api/campaigns/${id}/request-approval`, { note });

  before(async () => {
    ctx = await startApp();
    repos = ctx.container.resolve('repos');
    restaurant = (await ctx.agency.post('/api/restaurants', { name: 'Cantina das Falhas', requireApproval: false })).data;
    await ctx.agency.post('/api/contacts', { restaurantId: restaurant.id, name: 'Marina', phone: '31999990001' });
    strict = (await ctx.agency.post('/api/restaurants', { name: 'Cantina Exigente' })).data;
    await ctx.agency.post('/api/contacts', { restaurantId: strict.id, name: 'Paulo', phone: '31999990002' });
    await ctx.agency.post(`/api/restaurants/${strict.id}/users`, { name: 'Giulia', email: 'giulia@exigente.com.br', password: 'senha-da-giulia-1' });
    giulia = ctx.client();
    await giulia.login('giulia@exigente.com.br', 'senha-da-giulia-1');
  });
  afterEach(() => {
    // Interceptação que sobrou não pode vazar para o teste seguinte
    delete repos.campaigns.get;
    delete repos.contacts.audience;
  });
  after(async () => { await ctx.close(); });

  /** A próxima leitura de campanha falha com `failure`; devolve a resposta da edição e o que foi para o log. */
  async function editWhileDatabaseFails(failure) {
    const c = await newDraft('Falha');
    const logger = ctx.container.resolve('logger');
    const logged = [];
    const original = logger.error;
    logger.error = (...args) => logged.push(args);
    interleave(repos.campaigns, 'get', () => { throw failure; });
    try {
      return { res: await ctx.agency.put(`/api/campaigns/${c.id}`, { name: 'Nova' }), logged };
    } finally {
      logger.error = original;
    }
  }

  it('editar uma campanha que começou a ser disparada no meio do pedido é recusado', async () => {
    const c = await newDraft('Original');
    // A edição já leu o rascunho quando outro pedido dispara a campanha
    interleave(repos.campaigns, 'get', () => ctx.container.resolve('dispatch').start(c.id));
    const res = await ctx.agency.put(`/api/campaigns/${c.id}`, { name: 'Editada' });
    assert.equal(res.status, 400);
    assert.equal(res.data.error, 'Campanhas já disparadas não podem ser editadas. Duplique-a.');
    await waitFor(async () => (await view(c.id)).status === 'completed', { message: 'campanha concluída' });
    assert.equal((await view(c.id)).name, 'Original');
  });

  it('disparar no meio de uma edição de conteúdo recusa o disparo: texto sem aprovação não sai', async () => {
    const c = await newDraft('Aprovada', strict);
    await requestApproval(c.id, 'Confere o texto');
    assert.equal((await giulia.post(`/api/campaigns/${c.id}/approve`, {})).status, 200);
    await sleep(5); // a "versão" da campanha é a data da última alteração, em milissegundos
    // O disparo já conferiu a aprovação quando a edição chega e a cancela (o conteúdo mudou)
    interleave(repos.contacts, 'audience', () => ctx.agency.put(`/api/campaigns/${c.id}`, { message: 'TEXTO NUNCA APROVADO' }));
    const res = await ctx.agency.post(`/api/campaigns/${c.id}/start`);
    assert.equal(res.status, 400);
    assert.equal(res.data.error, 'A campanha foi alterada enquanto era disparada. Confira e dispare de novo.');
    const after = await view(c.id);
    assert.equal(after.status, 'draft');
    assert.equal(after.approval, null);
    assert.equal(after.message, 'TEXTO NUNCA APROVADO');
    assert.deepEqual((await ctx.agency.get(`/api/campaigns/${c.id}/messages`)).data, []);
  });

  it('aprovar no meio de uma edição de conteúdo recusa a aprovação e mantém o cancelamento dela', async () => {
    const c = await newDraft('Aprovação e edição', strict);
    await requestApproval(c.id);
    // A aprovação já leu o pedido pendente quando a edição chega e o cancela (o conteúdo mudou)
    interleave(repos.campaigns, 'get', () => ctx.agency.put(`/api/campaigns/${c.id}`, { message: 'Texto novo' }));
    const res = await giulia.post(`/api/campaigns/${c.id}/approve`, {});
    assert.equal(res.status, 400);
    assert.equal(res.data.error, 'Esta campanha não está aguardando aprovação.');
    const after = await view(c.id);
    assert.equal(after.approval, null);
    assert.deepEqual(after.approvalLog.map((e) => e.action), ['requested', 'reset']);
    assert.equal(after.message, 'Texto novo');
  });

  it('dois registros no histórico de aprovação ao mesmo tempo ficam os dois', async () => {
    const c = await newDraft('Duas entradas', strict);
    await requestApproval(c.id, 'primeira');
    // O restaurante pede ajustes sobre o pedido que leu; no meio do caminho a agência pede a aprovação de novo
    interleave(repos.campaigns, 'get', () => requestApproval(c.id, 'segunda'));
    const res = await giulia.post(`/api/campaigns/${c.id}/request-changes`, { note: 'ajuste' });
    assert.equal(res.status, 200);
    const after = await view(c.id);
    assert.deepEqual(after.approvalLog.map((e) => `${e.action}:${e.note}`), ['requested:primeira', 'requested:segunda', 'changes:ajuste']);
    assert.equal(after.approval.status, 'changes');
  });

  it('editar no meio de uma aprovação é recusado com 409 e preserva a aprovação', async () => {
    const c = await newDraft('Edição e aprovação', strict);
    await requestApproval(c.id, 'primeira');
    await sleep(5);
    // A edição já leu o pedido pendente quando o restaurante aprova
    interleave(repos.campaigns, 'get', () => giulia.post(`/api/campaigns/${c.id}/approve`, {}));
    const res = await ctx.agency.put(`/api/campaigns/${c.id}`, { message: 'Texto novo' });
    assert.equal(res.status, 409);
    assert.equal(res.data.error, 'A campanha foi alterada por outra pessoa. Recarregue e tente de novo.');
    const after = await view(c.id);
    assert.equal(after.approval.status, 'approved');
    assert.equal(after.message, 'Oi');
    assert.deepEqual(after.approvalLog.map((e) => e.action), ['requested', 'approved']);
  });

  it('trocar a campanha para um restaurante que não existe é recusado com 400', async () => {
    const c = await newDraft('Troca de restaurante');
    for (const restaurantId of ['não-é-um-uuid', '00000000-0000-4000-8000-000000000000', null]) {
      const res = await ctx.agency.put(`/api/campaigns/${c.id}`, { restaurantId });
      assert.equal(res.status, 400);
      assert.equal(res.data.error, 'Selecione o restaurante.');
    }
    assert.equal((await view(c.id)).restaurantId, restaurant.id);
    // Para um restaurante que existe, a troca segue valendo
    assert.equal((await ctx.agency.put(`/api/campaigns/${c.id}`, { restaurantId: strict.id })).status, 200);
    assert.equal((await view(c.id)).restaurantId, strict.id);
  });

  it('erro do banco com SQLSTATE vira 500 com registro no log, sem expor detalhes', async () => {
    const failure = Object.assign(new Error('terminating connection due to administrator command'), { code: '57P01' });
    const { res, logged } = await editWhileDatabaseFails(failure);
    assert.equal(res.status, 500);
    assert.deepEqual(res.data, { error: 'Erro interno. Tente de novo em instantes.' });
    assert.deepEqual(logged, [['[api]', failure]]);
  });

  it('erro de conexão marcado como do banco (sem SQLSTATE) também vira 500 com registro no log', async () => {
    const failure = Object.assign(new Error('Connection terminated unexpectedly'), { db: true });
    const { res, logged } = await editWhileDatabaseFails(failure);
    assert.equal(res.status, 500);
    assert.deepEqual(res.data, { error: 'Erro interno. Tente de novo em instantes.' });
    assert.deepEqual(logged, [['[api]', failure]]);
  });
});
