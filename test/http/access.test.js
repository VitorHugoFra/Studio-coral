const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, fakeMail, ADMIN } = require('../helpers/app');

const MISSING = '00000000-0000-4000-8000-000000000000';
const HOUR = 3600000;
const INVALID_LINK = /^Este link não vale mais/;

/** O token do link (o que vem depois do #). */
const tokenOf = (url) => new URL(url).hash.slice(1);
/** Horas entre agora e a data. */
const hoursUntil = (iso) => (Date.parse(iso) - Date.now()) / HOUR;

/** Eventos em tempo real publicados durante o teste. */
function watchEvents(ctx) {
  const events = ctx.container.resolve('events');
  const seen = [];
  const publish = events.publish.bind(events);
  events.publish = (type, data) => { seen.push({ type, data }); publish(type, data); };
  return seen;
}

describe('acessos pela agência', () => {
  let ctx;
  let alfa;
  let beta;
  before(async () => {
    ctx = await startApp();
    alfa = (await ctx.agency.post('/api/restaurants', { name: 'Cantina Alfa' })).data;
    beta = (await ctx.agency.post('/api/restaurants', { name: 'Bistrô Beta' })).data;
  });
  after(async () => { await ctx.close(); });

  it('convite: o acesso nasce sem senha e a pessoa cria a senha pelo link, uma vez só', async () => {
    const res = await ctx.agency.post('/api/users', { restaurantId: alfa.id, name: 'Ana Souza', email: ' ANA@alfa.com.br ', role: 'manager' });
    assert.equal(res.status, 201);
    const ana = res.data;
    assert.deepEqual([ana.email, ana.name, ana.role, ana.restaurantId, ana.passwordHash], ['ana@alfa.com.br', 'Ana Souza', 'manager', alfa.id, undefined]);
    assert.equal(ana.link.purpose, 'invite');
    assert.equal(ana.link.emailed, false);
    assert.ok(ana.link.url.startsWith(`${ctx.baseUrl}/senha#`));
    assert.ok(Math.abs(hoursUntil(ana.link.expiresAt) - 72) < 0.1, 'convite vale 3 dias');
    const token = tokenOf(ana.link.url);
    assert.ok(token.length >= 40);

    // Ainda sem senha: nenhuma senha entra
    assert.equal((await ctx.client().login('ana@alfa.com.br', '')).status, 401);
    assert.equal((await ctx.client().login('ana@alfa.com.br', 'qualquer-coisa')).status, 401);
    let row = (await ctx.agency.get(`/api/users?restaurantId=${alfa.id}`)).data.find((u) => u.id === ana.id);
    assert.equal(row.status, 'invited');
    assert.deepEqual([row.link.purpose, row.link.expired, row.restaurant], ['invite', false, 'Cantina Alfa']);

    // A página do link mostra de quem é o acesso, sem gastá-lo
    const visitor = ctx.client();
    const info = await visitor.post('/api/auth/link', { token });
    assert.equal(info.status, 200);
    assert.deepEqual([info.data.purpose, info.data.name, info.data.email, info.data.restaurant], ['invite', 'Ana Souza', 'ana@alfa.com.br', 'Cantina Alfa']);

    // Senha recusada não gasta o link
    const short = await visitor.post('/api/auth/link/password', { token, password: 'curta' });
    assert.equal(short.status, 400);
    assert.equal(short.data.error, 'A senha precisa ter pelo menos 8 caracteres.');
    assert.equal((await visitor.post('/api/auth/link', { token })).status, 200);

    const done = await visitor.post('/api/auth/link/password', { token, password: 'senha-da-ana-1' });
    assert.deepEqual(done.data, { ok: true, email: 'ana@alfa.com.br' });
    assert.equal(done.headers.get('set-cookie'), null, 'criar a senha não entra sozinho');
    const again = await visitor.post('/api/auth/link/password', { token, password: 'outra-senha-123' });
    assert.equal(again.status, 400);
    assert.match(again.data.error, INVALID_LINK);
    assert.match((await visitor.post('/api/auth/link', { token })).data.error, INVALID_LINK);

    const login = await ctx.client().login('ana@alfa.com.br', 'senha-da-ana-1');
    assert.equal(login.status, 200);
    assert.equal(login.data.user.teamRole, 'manager');
    row = (await ctx.agency.get('/api/users')).data.find((u) => u.id === ana.id);
    assert.deepEqual([row.status, row.link], ['active', null]);
    assert.ok(row.lastLoginAt);
  });

  it('com a senha definida pela agência, o acesso já entra (como antes)', async () => {
    const res = await ctx.agency.post('/api/users', { restaurantId: beta.id, name: 'Bruno', email: 'bruno@beta.com.br', role: 'manager', password: 'senha-do-bruno-1' });
    assert.equal(res.status, 201);
    assert.equal(res.data.link, undefined);
    assert.equal((await ctx.client().login('bruno@beta.com.br', 'senha-do-bruno-1')).status, 200);
  });

  it('validações da criação', async () => {
    const cases = [
      [{ email: 'x@y.com.br' }, 'Selecione o restaurante.'],
      [{ restaurantId: MISSING, email: 'x@y.com.br' }, 'Restaurante não encontrado.'],
      [{ restaurantId: alfa.id, email: 'sem-arroba' }, 'Informe um e-mail válido.'],
      [{ restaurantId: alfa.id, email: 'ana@alfa.com.br' }, 'Este e-mail já tem acesso.'],
      [{ restaurantId: alfa.id, email: ADMIN.email.toUpperCase() }, 'Este e-mail já tem acesso.'],
      [{ restaurantId: alfa.id, email: 'novo@alfa.com.br', role: 'dono' }, 'Escolha o papel: gerente ou equipe.'],
      [{ restaurantId: alfa.id, email: 'novo@alfa.com.br', password: 'curta' }, 'A senha precisa ter pelo menos 8 caracteres.'],
    ];
    for (const [body, error] of cases) {
      const res = await ctx.agency.post('/api/users', body);
      assert.equal(res.status, 400, error);
      assert.equal(res.data.error, error);
    }
    // Sem papel: equipe, o menor acesso
    assert.equal((await ctx.agency.post('/api/users', { restaurantId: alfa.id, email: 'novo@alfa.com.br' })).data.role, 'staff');
  });

  it('lista todos os restaurantes ou um só, gerentes primeiro, sem hash de senha', async () => {
    const all = (await ctx.agency.get('/api/users')).data;
    assert.deepEqual(all.map((u) => [u.restaurant, u.role, u.email]), [
      ['Bistrô Beta', 'manager', 'bruno@beta.com.br'],
      ['Cantina Alfa', 'manager', 'ana@alfa.com.br'],
      ['Cantina Alfa', 'staff', 'novo@alfa.com.br'],
    ]);
    assert.ok(all.every((u) => !('passwordHash' in u) && !('hasPassword' in u)));
    assert.deepEqual((await ctx.agency.get(`/api/users?restaurantId=${beta.id}`)).data.map((u) => u.email), ['bruno@beta.com.br']);
    assert.deepEqual((await ctx.agency.get('/api/users?restaurantId=nao-existe')).data, []);
    // O endereço antigo continua valendo
    assert.deepEqual((await ctx.agency.get(`/api/restaurants/${beta.id}/users`)).data.map((u) => u.email), ['bruno@beta.com.br']);
  });

  it('o link novo substitui o anterior, e link vencido não vale', async () => {
    const carla = (await ctx.agency.post('/api/users', { restaurantId: alfa.id, name: 'Carla', email: 'carla@alfa.com.br' })).data;
    const first = tokenOf(carla.link.url);
    const second = (await ctx.agency.post(`/api/users/${carla.id}/link`)).data;
    assert.equal(second.purpose, 'invite', 'sem senha ainda: o link continua sendo de convite');
    assert.match((await ctx.client().post('/api/auth/link', { token: first })).data.error, INVALID_LINK);
    assert.equal((await ctx.client().post('/api/auth/link', { token: tokenOf(second.url) })).status, 200);

    await ctx.container.resolve('db').query("UPDATE password_tokens SET expires_at = now() - interval '1 minute' WHERE user_id = $1", [carla.id]);
    assert.match((await ctx.client().post('/api/auth/link', { token: tokenOf(second.url) })).data.error, INVALID_LINK);
    const gone = await ctx.client().post('/api/auth/link/password', { token: tokenOf(second.url), password: 'senha-da-carla-1' });
    assert.match(gone.data.error, INVALID_LINK);
    const row = (await ctx.agency.get('/api/users')).data.find((u) => u.id === carla.id);
    assert.deepEqual([row.status, row.link.expired], ['invited', true]);
  });

  it('definir a senha direto apaga o convite aberto', async () => {
    const davi = (await ctx.agency.post('/api/users', { restaurantId: alfa.id, name: 'Davi', email: 'davi@alfa.com.br' })).data;
    assert.deepEqual((await ctx.agency.put(`/api/users/${davi.id}/password`, { password: 'senha-do-davi-1' })).data, { ok: true });
    assert.match((await ctx.client().post('/api/auth/link', { token: tokenOf(davi.link.url) })).data.error, INVALID_LINK);
    assert.equal((await ctx.client().login('davi@alfa.com.br', 'senha-do-davi-1')).status, 200);
  });

  it('edita nome e papel e remove', async () => {
    const eva = (await ctx.agency.post('/api/users', { restaurantId: alfa.id, name: 'Eva', email: 'eva@alfa.com.br', role: 'staff' })).data;
    const edited = await ctx.agency.put(`/api/users/${eva.id}`, { name: ' Eva Lima ', role: 'manager' });
    assert.deepEqual([edited.data.name, edited.data.role, edited.data.passwordHash], ['Eva Lima', 'manager', undefined]);
    assert.equal((await ctx.agency.put(`/api/users/${eva.id}`, { role: 'dono' })).data.error, 'Escolha o papel: gerente ou equipe.');
    assert.equal((await ctx.agency.put(`/api/users/${eva.id}`, { name: '  ' })).data.error, 'Informe o nome.');
    assert.deepEqual((await ctx.agency.del(`/api/users/${eva.id}`)).data, { ok: true });
    assert.ok(!(await ctx.agency.get('/api/users')).data.some((u) => u.id === eva.id));
    for (const res of [await ctx.agency.del(`/api/users/${eva.id}`), await ctx.agency.put(`/api/users/${eva.id}`, { name: 'X' }), await ctx.agency.post(`/api/users/${eva.id}/link`)]) {
      assert.equal(res.status, 404);
      assert.equal(res.data.error, 'Usuário não encontrado.');
    }
  });

  it('a página do link é servida em /senha, sem login', async () => {
    const res = await ctx.client().get('/senha');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.match(res.data, /<title>Criar senha · Studio Coral<\/title>/);
  });

  it('link inventado ou vazio não vale', async () => {
    const visitor = ctx.client();
    for (const body of [{}, { token: '' }, { token: 'abc' }]) {
      const res = await visitor.post('/api/auth/link', body);
      assert.equal(res.status, 400);
      assert.match(res.data.error, INVALID_LINK);
    }
    assert.match((await visitor.post('/api/auth/link/password', { token: 'abc', password: 'senha-boa-123' })).data.error, INVALID_LINK);
  });
});

describe('esqueci minha senha, sem serviço de e-mail', () => {
  let ctx;
  let restaurant;
  before(async () => {
    ctx = await startApp();
    restaurant = (await ctx.agency.post('/api/restaurants', { name: 'Casa Gama' })).data;
  });
  after(async () => { await ctx.close(); });

  it('a resposta é a mesma com ou sem acesso, e o pedido aparece para a agência', async () => {
    const seen = watchEvents(ctx);
    const gil = (await ctx.agency.post('/api/users', { restaurantId: restaurant.id, name: 'Gil', email: 'gil@gama.com.br', role: 'manager', password: 'senha-do-gil-1' })).data;
    const visitor = ctx.client();
    const unknown = await visitor.post('/api/auth/forgot', { email: 'ninguem@gama.com.br' });
    const known = await visitor.post('/api/auth/forgot', { email: ' GIL@gama.com.br ' });
    assert.deepEqual(unknown.data, { ok: true, delivery: 'manual' });
    assert.deepEqual(known.data, unknown.data);
    assert.equal((await visitor.post('/api/auth/forgot', { email: 'sem-arroba' })).data.error, 'Informe um e-mail válido.');
    assert.deepEqual(seen.map((e) => e.type), ['access:request']);
    assert.deepEqual(seen[0].data, { restaurantId: restaurant.id, userId: gil.id, name: 'Gil' });

    const row = (await ctx.agency.get('/api/users')).data.find((u) => u.id === gil.id);
    assert.equal(row.status, 'reset-requested');
    assert.ok(row.resetRequestedAt);

    // Pedidos seguidos não repetem o aviso nem mudam a hora do pedido
    await visitor.post('/api/auth/forgot', { email: 'gil@gama.com.br' });
    assert.equal(seen.length, 1);
    assert.equal((await ctx.agency.get('/api/users')).data.find((u) => u.id === gil.id).resetRequestedAt, row.resetRequestedAt);
  });

  it('o link de nova senha atende o pedido; usado, encerra as sessões e a senha antiga deixa de valer', async () => {
    const gil = (await ctx.agency.get('/api/users')).data.find((u) => u.email === 'gil@gama.com.br');
    const session = ctx.client();
    assert.equal((await session.login('gil@gama.com.br', 'senha-do-gil-1')).status, 200);

    const link = (await ctx.agency.post(`/api/users/${gil.id}/link`)).data;
    assert.equal(link.purpose, 'reset');
    assert.ok(Math.abs(hoursUntil(link.expiresAt) - 2) < 0.1, 'nova senha vale 2 horas');
    const row = (await ctx.agency.get('/api/users')).data.find((u) => u.id === gil.id);
    assert.deepEqual([row.status, row.resetRequestedAt, row.link.purpose], ['active', null, 'reset']);

    // Até o link ser usado, nada muda
    assert.equal((await session.get('/api/auth/me')).status, 200);
    assert.equal((await ctx.client().login('gil@gama.com.br', 'senha-do-gil-1')).status, 200);

    const info = (await ctx.client().post('/api/auth/link', { token: tokenOf(link.url) })).data;
    assert.deepEqual([info.purpose, info.email, info.restaurant], ['reset', 'gil@gama.com.br', 'Casa Gama']);
    assert.deepEqual((await ctx.client().post('/api/auth/link/password', { token: tokenOf(link.url), password: 'senha-nova-do-gil' })).data, { ok: true, email: 'gil@gama.com.br' });

    const expired = await session.get('/api/auth/me');
    assert.equal(expired.status, 401);
    assert.equal(expired.data.error, 'Sessão expirada. Entre novamente.');
    assert.equal((await ctx.client().login('gil@gama.com.br', 'senha-do-gil-1')).status, 401);
    assert.equal((await ctx.client().login('gil@gama.com.br', 'senha-nova-do-gil')).status, 200);
  });

  it('trocar a própria senha mantém esta sessão e encerra as outras', async () => {
    const here = ctx.client();
    const there = ctx.client();
    await here.login('gil@gama.com.br', 'senha-nova-do-gil');
    await there.login('gil@gama.com.br', 'senha-nova-do-gil');
    const res = await here.put('/api/me/password', { current: 'senha-nova-do-gil', password: 'mais-uma-senha-1' });
    assert.deepEqual(res.data, { ok: true });
    assert.match(res.headers.get('set-cookie'), /^sc_session=.+HttpOnly/);
    assert.equal((await here.get('/api/auth/me')).status, 200);
    assert.equal((await there.get('/api/auth/me')).status, 401);
  });
});

describe('esqueci minha senha, com serviço de e-mail', () => {
  let ctx;
  let restaurant;
  const mail = fakeMail();
  const logged = [];
  const logger = { log() {}, info() {}, warn() {}, error: (...args) => logged.push(args.join(' ')) };
  before(async () => {
    ctx = await startApp({ mail, logger });
    restaurant = (await ctx.agency.post('/api/restaurants', { name: 'Casa Delta' })).data;
  });
  after(async () => { await ctx.close(); });

  it('o link vai para o e-mail da pessoa, uma vez a cada 5 minutos', async () => {
    const seen = watchEvents(ctx);
    const created = await ctx.agency.post('/api/users', { restaurantId: restaurant.id, name: 'Dora Lima', email: 'dora@delta.com.br', role: 'manager' });
    assert.equal(created.data.link.emailed, true, 'o convite também vai por e-mail');
    assert.equal(mail.sent.length, 1);
    assert.deepEqual([mail.sent[0].to, mail.sent[0].subject], ['dora@delta.com.br', 'Seu acesso ao painel da Studio Coral']);
    assert.ok(mail.sent[0].text.includes(created.data.link.url));
    assert.match(mail.sent[0].text, /^Olá, Dora!/);
    await ctx.client().post('/api/auth/link/password', { token: tokenOf(created.data.link.url), password: 'senha-da-dora-1' });

    const visitor = ctx.client();
    assert.deepEqual((await visitor.post('/api/auth/forgot', { email: 'ninguem@delta.com.br' })).data, { ok: true, delivery: 'email' });
    assert.equal(mail.sent.length, 1, 'e-mail sem acesso: nada é enviado');
    assert.deepEqual((await visitor.post('/api/auth/forgot', { email: 'dora@delta.com.br' })).data, { ok: true, delivery: 'email' });
    assert.equal(mail.sent.length, 2);
    const reset = mail.sent[1];
    assert.deepEqual([reset.to, reset.subject], ['dora@delta.com.br', 'Crie uma nova senha · Studio Coral']);
    assert.match(reset.text, /vale por 2 horas/);
    const token = reset.text.match(/\/senha#(\S+)/)[1];
    assert.equal((await visitor.post('/api/auth/link', { token })).data.purpose, 'reset');
    // Foi por e-mail: nada para a agência atender
    assert.equal((await ctx.agency.get('/api/users')).data.find((u) => u.email === 'dora@delta.com.br').status, 'active');
    assert.deepEqual(seen.filter((e) => e.type === 'access:request'), []);

    await visitor.post('/api/auth/forgot', { email: 'dora@delta.com.br' });
    assert.equal(mail.sent.length, 2, 'pedido repetido logo em seguida não manda outro e-mail');
    assert.equal((await visitor.post('/api/auth/link', { token })).status, 200, 'e o link mandado continua valendo');
  });

  it('se o e-mail falhar, o pedido cai para a agência e a falha vai para o log', async () => {
    await ctx.agency.post('/api/users', { restaurantId: restaurant.id, name: 'Edu', email: 'edu@delta.com.br', password: 'senha-do-edu-1' });
    mail.fail = true;
    try {
      assert.deepEqual((await ctx.client().post('/api/auth/forgot', { email: 'edu@delta.com.br' })).data, { ok: true, delivery: 'email' });
    } finally {
      mail.fail = false;
    }
    assert.equal((await ctx.agency.get('/api/users')).data.find((u) => u.email === 'edu@delta.com.br').status, 'reset-requested');
    assert.ok(logged.some((line) => line.includes('edu@delta.com.br') && line.includes('fora do ar')));
  });
});

describe('gerente e equipe do restaurante', () => {
  let ctx;
  let alfa;
  let beta;
  let gerente;
  let equipe;
  let deOutro;
  const ids = {};

  before(async () => {
    ctx = await startApp();
    alfa = (await ctx.agency.post('/api/restaurants', { name: 'Cantina Alfa' })).data;
    beta = (await ctx.agency.post('/api/restaurants', { name: 'Bistrô Beta' })).data;
    const make = async (restaurantId, name, email, role) => {
      const user = (await ctx.agency.post('/api/users', { restaurantId, name, email, role, password: `senha-${name.toLowerCase()}-1` })).data;
      ids[name] = user.id;
      const client = ctx.client();
      assert.equal((await client.login(email, `senha-${name.toLowerCase()}-1`)).status, 200);
      return client;
    };
    gerente = await make(alfa.id, 'Gina', 'gina@alfa.com.br', 'manager');
    equipe = await make(alfa.id, 'Tito', 'tito@alfa.com.br', 'staff');
    deOutro = await make(beta.id, 'Bia', 'bia@beta.com.br', 'manager');
  });
  after(async () => { await ctx.close(); });

  it('o gerente vê só a equipe do próprio restaurante', async () => {
    assert.equal((await gerente.get('/api/auth/me')).data.user.teamRole, 'manager');
    for (const url of ['/api/users', `/api/users?restaurantId=${beta.id}`]) {
      assert.deepEqual((await gerente.get(url)).data.map((u) => u.email), ['gina@alfa.com.br', 'tito@alfa.com.br'], url);
    }
    assert.deepEqual((await deOutro.get('/api/users')).data.map((u) => u.email), ['bia@beta.com.br']);
  });

  it('o gerente convida por link, no próprio restaurante, sem escolher a senha de ninguém', async () => {
    const res = await gerente.post('/api/users', { restaurantId: beta.id, name: 'Lia', email: 'lia@alfa.com.br', role: 'staff' });
    assert.equal(res.status, 201);
    assert.equal(res.data.restaurantId, alfa.id, 'o restaurante é sempre o do gerente');
    assert.equal(res.data.link.purpose, 'invite');
    ids.Lia = res.data.id;
    const withPassword = await gerente.post('/api/users', { name: 'Rui', email: 'rui@alfa.com.br', role: 'staff', password: 'senha-do-rui-1' });
    assert.equal(withPassword.status, 400);
    assert.equal(withPassword.data.error, 'Mande o link de convite: a senha quem cria é a própria pessoa.');
    assert.ok(!(await ctx.agency.get('/api/users')).data.some((u) => u.email === 'rui@alfa.com.br'));
  });

  it('o gerente muda papéis, gera links e remove, mas não mexe no próprio acesso', async () => {
    assert.equal((await gerente.put(`/api/users/${ids.Lia}`, { role: 'manager' })).data.role, 'manager');
    assert.equal((await gerente.post(`/api/users/${ids.Tito}/link`)).data.purpose, 'reset');
    const own = await gerente.put(`/api/users/${ids.Gina}`, { role: 'staff' });
    assert.equal(own.status, 400);
    assert.equal(own.data.error, 'Você não pode mudar o próprio papel.');
    assert.equal((await gerente.put(`/api/users/${ids.Gina}`, { name: 'Gina Alves', role: 'manager' })).data.name, 'Gina Alves', 'o próprio nome pode');
    const self = await gerente.del(`/api/users/${ids.Gina}`);
    assert.equal(self.status, 400);
    assert.equal(self.data.error, 'Você não pode remover o próprio acesso.');
    assert.deepEqual((await gerente.del(`/api/users/${ids.Lia}`)).data, { ok: true });
  });

  it('o gerente não alcança acessos de outro restaurante nem as rotas só da agência', async () => {
    for (const res of [
      await gerente.put(`/api/users/${ids.Bia}`, { role: 'staff' }),
      await gerente.post(`/api/users/${ids.Bia}/link`),
      await gerente.del(`/api/users/${ids.Bia}`),
    ]) {
      assert.equal(res.status, 404);
      assert.equal(res.data.error, 'Usuário não encontrado.');
    }
    for (const res of [
      await gerente.put(`/api/users/${ids.Tito}/password`, { password: 'senha-nova-123' }),
      await gerente.get(`/api/restaurants/${alfa.id}/users`),
      await gerente.post(`/api/restaurants/${alfa.id}/users`, { email: 'x@alfa.com.br' }),
    ]) {
      assert.equal(res.status, 403);
      assert.equal(res.data.error, 'Seu acesso não permite esta ação.');
    }
    assert.equal((await ctx.client().login('bia@beta.com.br', 'senha-bia-1')).status, 200, 'o acesso do outro restaurante continua intacto');
  });

  it('a equipe não cuida de acessos', async () => {
    assert.equal((await equipe.get('/api/auth/me')).data.user.teamRole, 'staff');
    for (const res of [
      await equipe.get('/api/users'),
      await equipe.post('/api/users', { email: 'z@alfa.com.br' }),
      await equipe.put(`/api/users/${ids.Gina}`, { name: 'X' }),
      await equipe.post(`/api/users/${ids.Gina}/link`),
      await equipe.del(`/api/users/${ids.Gina}`),
    ]) {
      assert.equal(res.status, 403);
      assert.equal(res.data.error, 'Só o gerente do restaurante cuida dos acessos da equipe.');
    }
    // O resto do acesso do restaurante continua igual
    assert.equal((await equipe.get('/api/campaigns')).status, 200);
  });

  it('rebaixar o gerente vale na requisição seguinte, sem novo login', async () => {
    assert.equal((await ctx.agency.put(`/api/users/${ids.Bia}`, { role: 'staff' })).data.role, 'staff');
    assert.equal((await deOutro.get('/api/users')).status, 403);
    assert.equal((await deOutro.get('/api/auth/me')).data.user.teamRole, 'staff');
  });
});
