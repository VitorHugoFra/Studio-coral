const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { startApp, waitFor, phone } = require('../helpers/app');

const MENU = [
  { id: 'm1', category: 'Massas', name: 'Lasanha', price: 62.9 },
  { id: 'm2', category: 'Bebidas', name: 'Suco', price: 10 },
];
const ADDRESS = { cep: '30140-071', street: 'Rua dos Timbiras', number: '1200', complement: 'apto 3', neighborhood: 'Funcionários', city: 'Belo Horizonte', state: 'MG' };
const key = () => crypto.randomBytes(9).toString('base64url');

describe('pedidos: checkout, contato, painel, acompanhamento e importação', () => {
  let ctx;
  let a; // sem cupom
  let b; // com cupom da casa
  let owner; // acesso do restaurante A
  const pub = () => ctx.client();
  const order = (overrides = {}, customer = {}) => pub().post('/api/public/orders', {
    restaurantSlug: a.slug,
    orderKey: key(),
    items: [{ id: 'm1', qty: 2, price: 0.01 }],
    fulfillment: 'delivery',
    address: ADDRESS,
    marketingOptIn: false,
    ...overrides,
    customer: { name: 'Paula Reis', phone: phone(1), ...customer },
  });
  const contactsOf = async (restaurant) => (await ctx.agency.get(`/api/contacts?restaurantId=${restaurant.id}`)).data;
  const ordersOf = async (restaurant, query = '') => (await ctx.agency.get(`/api/orders?restaurantId=${restaurant.id}${query}`)).data;

  before(async () => {
    ctx = await startApp();
    a = (await ctx.agency.post('/api/restaurants', { name: 'Casa A', menu: MENU, requireApproval: false, phone: '(31) 3333-0000' })).data;
    b = (await ctx.agency.post('/api/restaurants', { name: 'Casa B', menu: MENU, coupon: 'CASA10' })).data;
    await ctx.agency.post(`/api/restaurants/${a.id}/users`, { name: 'Dona A', email: 'dona@casaa.com.br', password: 'senha-dona-123' });
    owner = ctx.client();
    await owner.login('dona@casaa.com.br', 'senha-dona-123');
  });
  after(async () => { await ctx?.close(); });

  it('pedido do site: preço do cardápio, número sequencial por restaurante e status novo', async () => {
    const first = await order({ notes: 'Interfone quebrado' }, { cpf: '529.982.247-25' });
    assert.equal(first.status, 201);
    assert.equal(first.data.number, 1);
    assert.equal(first.data.subtotal, 125.8, 'o preço vem do cardápio, não do navegador');
    assert.equal(first.data.discount, 0);
    assert.equal(first.data.total, 125.8);
    assert.match(first.data.trackingCode, /^[\w-]{12}$/);
    assert.equal(first.data.trackingUrl, `${ctx.baseUrl}/pedido/${first.data.trackingCode}`);
    assert.equal((await order({ fulfillment: 'pickup', address: undefined }, { phone: phone(2) })).data.number, 2);
    assert.equal((await order({ restaurantSlug: b.slug }, { phone: phone(3) })).data.number, 1, 'cada restaurante tem a própria numeração');

    const saved = (await ctx.agency.get(`/api/orders/${first.data.id}`)).data;
    assert.equal(saved.status, 'new');
    assert.equal(saved.source, 'site');
    assert.equal(saved.fulfillment, 'delivery');
    assert.equal(saved.phone, phone(1));
    assert.equal(saved.cpf, '52998224725');
    assert.deepEqual(saved.address, { ...ADDRESS, cep: '30140071' });
    assert.equal(saved.neighborhood, 'Funcionários');
    assert.equal(saved.notes, 'Interfone quebrado');
    assert.deepEqual(saved.items, [{ id: 'm1', name: 'Lasanha', qty: 2, price: 62.9, note: '' }]);
    assert.equal(saved.statusLog.length, 1);
    assert.equal(saved.statusLog[0].status, 'new');
    assert.equal(saved.restaurant, 'Casa A');
    assert.equal(saved.campaignId, null);
  });

  it('cupom da casa dá 10% de desconto', async () => {
    const res = await order({ restaurantSlug: b.slug, items: [{ id: 'm1', qty: 1 }] }, { phone: phone(4) });
    assert.equal(res.data.subtotal, 62.9);
    assert.equal(res.data.discount, 6.29);
    assert.equal(res.data.total, 56.61);
    assert.equal((await ctx.agency.get(`/api/orders/${res.data.id}`)).data.coupon, 'CASA10');
  });

  it('erros de validação explicam o que falta', async () => {
    const error = async (overrides, customer, status = 400) => {
      const res = await order(overrides, customer);
      assert.equal(res.status, status);
      return res.data.error;
    };
    assert.equal(await error({}, { name: ' ' }), 'Informe seu nome.');
    assert.equal(await error({}, { phone: '' }), 'Informe o WhatsApp.');
    assert.match(await error({}, { phone: '123' }), /^Telefone inválido/);
    assert.equal(await error({}, { cpf: '111.111.111-11' }), 'CPF inválido.');
    assert.equal(await error({ address: { ...ADDRESS, cep: '' } }), 'Informe o CEP com 8 dígitos.');
    assert.equal(await error({ address: { ...ADDRESS, neighborhood: '' } }), 'Informe o bairro da entrega.');
    assert.equal(await error({ fulfillment: 'drone' }), 'Escolha entrega ou retirada.');
    assert.equal(await error({ items: [] }), 'A sacola está vazia.');
    assert.match(await error({ items: [{ id: 'nao-existe', qty: 1 }] }), /não está mais no cardápio/);
    assert.equal(await error({}, { birthDay: 31, birthMonth: 2 }), 'Data de aniversário inválida.');
    assert.equal(await error({ restaurantSlug: 'nao-existe' }, {}, 404), 'Restaurante não encontrado.');
  });

  it('contato pelo telefone: sem a caixa, entra sem autorização; com a caixa, é autorizado', async () => {
    const c = (await ctx.agency.post('/api/restaurants', { name: 'Casa Contatos', menu: MENU })).data;
    await order({ restaurantSlug: c.slug }, { name: 'Rita Moura', phone: phone(10), birthDay: 14, birthMonth: 5 });
    let [rita] = await contactsOf(c);
    assert.equal(rita.name, 'Rita Moura');
    assert.equal(rita.optIn, false);
    assert.equal(rita.optInSource, null);
    assert.deepEqual([rita.birthDay, rita.birthMonth, rita.birthYear], [14, 5, null]);

    // O mesmo telefone sem o 9º dígito é o mesmo cliente; agora ela marcou a caixa de promoções
    await order({ restaurantSlug: c.slug, marketingOptIn: true }, { name: 'Rita M.', phone: '(31) 9900-0010', birthDay: 15, birthMonth: 5, birthYear: 1990 });
    const list = await contactsOf(c);
    assert.equal(list.length, 1);
    [rita] = list;
    assert.equal(rita.name, 'Rita Moura', 'o nome que já existia fica');
    assert.equal(rita.optIn, true);
    assert.equal(rita.optInSource, 'Pedido no site');
    assert.deepEqual([rita.birthDay, rita.birthMonth, rita.birthYear], [15, 5, 1990]);
    assert.equal(rita.purchase.orders, 2);

    // Caixa desmarcada não tira a autorização
    await order({ restaurantSlug: c.slug, marketingOptIn: false }, { phone: phone(10) });
    assert.equal((await contactsOf(c))[0].optIn, true);
  });

  it('descadastrado continua descadastrado, mesmo marcando a caixa', async () => {
    const c = (await ctx.agency.post('/api/restaurants', { name: 'Casa Descadastro', menu: MENU })).data;
    const saved = (await ctx.agency.post('/api/contacts', { restaurantId: c.id, name: 'Caio Prado', phone: phone(20) })).data;
    await ctx.agency.put(`/api/contacts/${saved.id}`, { optedOut: true });
    assert.equal((await order({ restaurantSlug: c.slug, marketingOptIn: true }, { phone: phone(20) })).status, 201);
    const [caio] = await contactsOf(c);
    assert.equal(caio.optedOut, true);
    assert.equal(caio.name, 'Caio Prado');
  });

  it('pedido pelo link da campanha: atribuído, com o cupom da campanha; link de outro restaurante não vale', async () => {
    const c = (await ctx.agency.post('/api/restaurants', { name: 'Casa Campanha', menu: MENU, requireApproval: false })).data;
    await ctx.agency.post('/api/contacts', { restaurantId: c.id, name: 'Lia Campos', phone: phone(30) });
    const campaign = (await ctx.agency.post('/api/campaigns', { restaurantId: c.id, name: 'Volta', message: 'Oi {{link}}', coupon: 'VOLTA15' })).data;
    await ctx.agency.post(`/api/campaigns/${campaign.id}/start`, {});
    await waitFor(async () => (await ctx.agency.get(`/api/campaigns/${campaign.id}`)).data.status === 'completed', { message: 'campanha concluída' });
    const [m] = (await ctx.agency.get(`/api/campaigns/${campaign.id}/messages`)).data;

    const res = await order({ restaurantSlug: c.slug, ref: m.code, items: [{ id: 'm2', qty: 3 }] }, { name: 'Lia Campos', phone: phone(30) });
    assert.equal(res.status, 201);
    assert.equal(res.data.discount, 3);
    const saved = (await ctx.agency.get(`/api/orders/${res.data.id}`)).data;
    assert.equal(saved.source, 'campaign');
    assert.equal(saved.campaignId, campaign.id);
    assert.equal(saved.messageId, m.id);
    assert.equal(saved.coupon, 'VOLTA15');
    const { stats } = (await ctx.agency.get(`/api/campaigns/${campaign.id}`)).data;
    assert.equal(stats.orders, 1);
    assert.equal(stats.revenue, 27);
    assert.ok((await ctx.agency.get(`/api/campaigns/${campaign.id}/messages`)).data[0].convertedAt);

    // O código do link de outro restaurante não atribui o pedido de A
    const other = await order({ ref: m.code }, { phone: phone(31) });
    const plain = (await ctx.agency.get(`/api/orders/${other.data.id}`)).data;
    assert.equal(plain.source, 'site');
    assert.equal(plain.campaignId, null);
  });

  it('pedido repetido (mesma sacola enviada de novo) devolve o mesmo pedido e não gasta número', async () => {
    const c = (await ctx.agency.post('/api/restaurants', { name: 'Casa Repetida', menu: MENU })).data;
    const orderKey = key();
    const first = await order({ restaurantSlug: c.slug, orderKey }, { phone: phone(40) });
    const again = await order({ restaurantSlug: c.slug, orderKey }, { phone: phone(40) });
    assert.equal(again.status, 200);
    assert.equal(again.data.duplicated, true);
    assert.equal(again.data.id, first.data.id);
    assert.equal(again.data.trackingCode, first.data.trackingCode);
    assert.equal((await ordersOf(c)).length, 1);
    assert.equal((await order({ restaurantSlug: c.slug }, { phone: phone(41) })).data.number, 2);
  });

  it('acompanhamento: andamento, itens e total, sem dados pessoais', async () => {
    const res = await order({ notes: 'Sem cebola' }, { name: 'Bruno Lima Souza', cpf: '529.982.247-25', phone: phone(50) });
    const view = await pub().get(`/api/public/orders/${res.data.trackingCode}`);
    assert.equal(view.status, 200);
    assert.equal(view.headers.get('cache-control'), 'no-store');
    assert.deepEqual(Object.keys(view.data).sort(), ['coupon', 'createdAt', 'discount', 'firstName', 'fulfillment', 'items', 'neighborhood', 'number', 'payment', 'restaurant', 'status', 'statusLog', 'subtotal', 'total'].sort());
    assert.equal(view.data.firstName, 'Bruno');
    assert.equal(view.data.status, 'new');
    assert.equal(view.data.neighborhood, 'Funcionários');
    assert.deepEqual(view.data.restaurant, { name: 'Casa A', slug: a.slug, color: '#73350c', phone: '(31) 3333-0000' });
    const text = JSON.stringify(view.data);
    for (const secret of [phone(50), '52998224725', 'Rua dos Timbiras', 'Sem cebola']) assert.ok(!text.includes(secret), `não expõe ${secret}`);
    assert.equal((await pub().get('/api/public/orders/nao-existe')).status, 404);
    const page = await fetch(`${ctx.baseUrl}/pedido/${res.data.trackingCode}`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<html/i);
  });

  it('painel: quadro do mais antigo para o mais novo, histórico com filtros e busca', async () => {
    const c = (await ctx.agency.post('/api/restaurants', { name: 'Casa Quadro', menu: MENU })).data;
    const one = (await order({ restaurantSlug: c.slug }, { name: 'Ana Prado', phone: phone(60) })).data;
    const two = (await order({ restaurantSlug: c.slug, fulfillment: 'pickup', address: undefined }, { name: 'Davi Reis', phone: phone(61) })).data;
    await ctx.client().post('/api/public/conversions', { restaurantSlug: c.slug, value: 30, orderId: 'EXT-1', customerName: 'Site externo' });
    await ctx.agency.put(`/api/orders/${two.id}/status`, { status: 'completed' });

    assert.deepEqual((await ordersOf(c, '&active=1')).map((o) => o.id), [one.id], 'concluídos e pedidos externos não entram no quadro');
    const history = await ordersOf(c);
    assert.deepEqual(history.map((o) => o.customerName), ['Site externo', 'Davi Reis', 'Ana Prado'], 'do mais novo para o mais antigo');
    assert.equal(history[0].status, 'completed', 'pedido de site externo já chega concluído');
    assert.deepEqual((await ordersOf(c, '&status=completed')).map((o) => o.customerName), ['Site externo', 'Davi Reis']);
    assert.deepEqual((await ordersOf(c, '&search=davi')).map((o) => o.id), [two.id]);
    assert.deepEqual((await ordersOf(c, `&search=${phone(60).slice(-6)}`)).map((o) => o.id), [one.id]);
    assert.deepEqual((await ordersOf(c, '&search=%232')).map((o) => o.id), [two.id], 'busca pelo número (#2)');
    assert.deepEqual((await ordersOf(c, '&search=ext-1')).map((o) => o.customerName), ['Site externo']);
    const today = new Date().toLocaleDateString('sv-SE');
    assert.equal((await ordersOf(c, `&from=${today}&to=${today}`)).length, 3);
    assert.equal((await ordersOf(c, '&to=2020-01-01')).length, 0);
    assert.equal((await ctx.agency.get('/api/orders?from=ontem')).status, 400);
  });

  it('restaurante vê e muda só os próprios pedidos; a cada passo o histórico guarda quem mudou', async () => {
    const mine = (await order({}, { phone: phone(70) })).data;
    const theirs = (await order({ restaurantSlug: b.slug }, { phone: phone(71) })).data;
    const list = (await owner.get('/api/orders')).data;
    assert.ok(list.length > 0 && list.every((o) => o.restaurantId === a.id));
    assert.ok(!(await owner.get(`/api/orders?restaurantId=${b.id}`)).data.some((o) => o.restaurantId === b.id));
    assert.equal((await owner.get(`/api/orders/${theirs.id}`)).status, 404);
    assert.equal((await owner.put(`/api/orders/${theirs.id}/status`, { status: 'preparing' })).status, 404);

    const preparing = await owner.put(`/api/orders/${mine.id}/status`, { status: 'preparing' });
    assert.equal(preparing.status, 200);
    assert.equal(preparing.data.status, 'preparing');
    assert.deepEqual(preparing.data.statusLog.map((e) => [e.status, e.by]), [['new', null], ['preparing', 'Dona A']]);
    await owner.put(`/api/orders/${mine.id}/status`, { status: 'dispatched' });
    const view = (await pub().get(`/api/public/orders/${mine.trackingCode}`)).data;
    assert.equal(view.status, 'dispatched');
    assert.deepEqual(view.statusLog.map((e) => e.status), ['new', 'preparing', 'dispatched']);
    assert.ok(view.statusLog.every((e) => e.at && !e.by), 'a página pública não mostra quem mudou');

    assert.equal((await owner.post('/api/orders/import/preview', { restaurantId: a.id, rows: [] })).status, 403, 'importar é só da agência');
  });

  it('status: só avança ou cancela; concluído e cancelado são finais; quem perde a corrida recebe 409', async () => {
    const id = (await order({}, { phone: phone(80) })).data.id;
    const put = (status) => ctx.agency.put(`/api/orders/${id}/status`, { status });
    assert.equal((await put('voando')).data.error, 'Status inválido.');
    assert.equal((await put('dispatched')).status, 200);
    const back = await put('preparing');
    assert.equal(back.status, 400);
    assert.equal(back.data.error, 'O pedido só avança. Para desfazer, cancele.');
    assert.equal((await put('dispatched')).status, 200, 'o mesmo status de novo não é erro (dois cliques)');
    assert.equal((await put('completed')).status, 200);
    assert.equal((await put('canceled')).data.error, 'Este pedido já foi concluído e não muda mais.');

    const other = (await order({}, { phone: phone(81) })).data.id;
    await ctx.agency.put(`/api/orders/${other}/status`, { status: 'canceled' });
    assert.equal((await ctx.agency.put(`/api/orders/${other}/status`, { status: 'preparing' })).data.error, 'Este pedido foi cancelado e não muda mais.');

    // Duas pessoas olhando o pedido "novo": a primeira inicia o preparo; a segunda, com a tela antiga, cancela
    const service = ctx.container.resolve('orders');
    const repos = ctx.container.resolve('repos');
    const raceId = (await order({}, { phone: phone(82) })).data.id;
    const stale = await repos.orders.get(raceId);
    await service.changeStatus(await repos.orders.get(raceId), 'preparing', { name: 'Cozinha' });
    await assert.rejects(service.changeStatus(stale, 'canceled', { name: 'Caixa' }), (err) => err.status === 409);
    assert.equal((await repos.orders.get(raceId)).status, 'preparing');
  });

  it('pedido de site externo (/api/public/conversions) continua funcionando, já concluído', async () => {
    const res = await pub().post('/api/public/conversions', { restaurantSlug: a.slug, value: 19.9, orderId: 'LOJA-77', items: [{ name: 'Suco', qty: 2, price: 9.95 }] });
    assert.equal(res.status, 201);
    const saved = (await ctx.agency.get(`/api/orders/${res.data.id}`)).data;
    assert.equal(saved.status, 'completed');
    assert.equal(saved.source, 'site');
    assert.equal(saved.number, null);
    assert.equal(saved.trackingUrl, null);
  });

  it('importação: prévia sem gravar, erros por linha, repetidos e contatos sem autorização', async () => {
    const c = (await ctx.agency.post('/api/restaurants', { name: 'Casa Planilha', menu: MENU })).data;
    await ctx.agency.post('/api/contacts', { restaurantId: c.id, name: '', phone: phone(90), optIn: false });
    const rows = [
      { line: 2, orderId: 'IF-1', date: '05/03/2026 19:40', name: 'Marta Dias', phone: phone(90), total: 'R$ 45,90', items: '1x Lasanha' },
      { line: 3, orderId: 'IF-2', date: '06/03/2026', name: 'Joel Sá', phone: '(31) 98888-0091', total: '30', discount: '3', neighborhood: 'Savassi' },
      { line: 4, orderId: 'IF-3', date: '2026-03-07', name: 'Balcão', total: '12,00' },
      { line: 5, orderId: 'IF-2', date: '06/03/2026', total: '30' },
      { line: 6, orderId: 'IF-4', date: '32/03/2026', total: '10' },
      { line: 7, orderId: '', date: '01/03/2026', total: '10' },
    ];
    const preview = (await ctx.agency.post('/api/orders/import/preview', { restaurantId: c.id, rows })).data;
    assert.equal(preview.total, 6);
    assert.equal(preview.toImport, 3);
    assert.equal(preview.duplicated, 1, 'IF-2 repetido na própria planilha');
    assert.equal(preview.newContacts, 1, 'só o Joel é novo; a Marta já é contato e o balcão não tem telefone');
    assert.equal(preview.revenue, 87.9);
    assert.equal(preview.errorCount, 2);
    assert.deepEqual(preview.errors, [
      { line: 6, orderId: 'IF-4', error: 'Data inválida: 32/03/2026' },
      { line: 7, orderId: null, error: 'Sem número do pedido.' },
    ]);
    assert.deepEqual(preview.sample.map((s) => s.orderId), ['IF-1', 'IF-2', 'IF-3']);
    assert.deepEqual(await ordersOf(c), [], 'a prévia não grava nada');

    const done = (await ctx.agency.post('/api/orders/import', { restaurantId: c.id, rows, channel: 'iFood' })).data;
    assert.deepEqual(done, { imported: 3, duplicated: 1, contactsCreated: 1, errorCount: 2, errors: preview.errors });
    const saved = await ordersOf(c);
    const if1 = saved.find((o) => o.orderId === 'IF-1');
    assert.equal(if1.createdAt, new Date(2026, 2, 5, 19, 40).toISOString(), 'a data da compra é a da planilha');
    assert.equal(if1.source, 'import');
    assert.equal(if1.channel, 'iFood');
    assert.equal(if1.status, 'completed');
    assert.equal(if1.value, 45.9);
    assert.deepEqual(if1.items, [{ name: 'Lasanha', qty: 1, price: null }]);
    const if2 = saved.find((o) => o.orderId === 'IF-2');
    assert.deepEqual([if2.subtotal, if2.discount, if2.value, if2.neighborhood], [33, 3, 30, 'Savassi']);
    assert.equal(saved.find((o) => o.orderId === 'IF-3').contactId, null);

    const contacts = await contactsOf(c);
    const marta = contacts.find((x) => x.phone === phone(90));
    assert.equal(marta.name, 'Marta Dias', 'contato sem nome ganha o da planilha');
    assert.equal(marta.optIn, false, 'contato que já existia não muda de autorização');
    const joel = contacts.find((x) => x.name === 'Joel Sá');
    assert.equal(joel.optIn, false, 'sem o consentimento confirmado, entra sem autorização');
    assert.equal(joel.optInSource, null);
    assert.equal(if1.contactId, marta.id);

    // Importar de novo: tudo repetido. Com o consentimento confirmado, o contato novo entra autorizado
    const again = (await ctx.agency.post('/api/orders/import', { restaurantId: c.id, rows: rows.slice(0, 3), channel: 'iFood' })).data;
    assert.equal(again.imported, 0);
    assert.equal(again.duplicated, 3);
    await ctx.agency.post('/api/orders/import', { restaurantId: c.id, rows: [{ orderId: 'CX-1', date: '08/03/2026', name: 'Nina Luz', phone: phone(92), total: '20' }], channel: 'Caixa', consent: true });
    const nina = (await contactsOf(c)).find((x) => x.name === 'Nina Luz');
    assert.equal(nina.optIn, true);
    assert.equal(nina.optInSource, 'Importação de pedidos (Caixa)');

    assert.equal((await ctx.agency.post('/api/orders/import/preview', { restaurantId: c.id, rows: [] })).data.error, 'A planilha não tem pedidos.');
    assert.equal((await ctx.agency.post('/api/orders/import/preview', { restaurantId: 'xyz', rows })).data.error, 'Selecione o restaurante.');
  });

  it('perfil de compra na lista de contatos: pedidos, total, última compra e bairro (cancelados não contam)', async () => {
    const c = (await ctx.agency.post('/api/restaurants', { name: 'Casa Perfil', menu: MENU })).data;
    await order({ restaurantSlug: c.slug, items: [{ id: 'm2', qty: 1 }] }, { name: 'Téo Lins', phone: phone(95) });
    await order({ restaurantSlug: c.slug, items: [{ id: 'm2', qty: 2 }], address: { ...ADDRESS, neighborhood: 'Savassi' } }, { phone: phone(95) });
    const canceled = (await order({ restaurantSlug: c.slug, items: [{ id: 'm1', qty: 5 }], address: { ...ADDRESS, neighborhood: 'Centro' } }, { phone: phone(95) })).data;
    await ctx.agency.put(`/api/orders/${canceled.id}/status`, { status: 'canceled' });
    await ctx.agency.post('/api/contacts', { restaurantId: c.id, name: 'Sem Pedido', phone: phone(96) });

    const list = await contactsOf(c);
    const teo = list.find((x) => x.name === 'Téo Lins');
    assert.equal(teo.purchase.orders, 2);
    assert.equal(teo.purchase.total, 30);
    assert.equal(teo.purchase.lastNeighborhood, 'Savassi');
    assert.ok(teo.purchase.firstAt <= teo.purchase.lastAt);
    assert.equal(teo.neighborhood, null, 'o bairro do contato continua vazio: o do pedido é calculado');
    assert.equal(teo.purchase.topItem, 'Suco');
    assert.deepEqual(list.find((x) => x.name === 'Sem Pedido').purchase, { orders: 0, total: 0, firstAt: null, lastAt: null, lastNeighborhood: null, weekday: null, topItem: null });

    // A ficha do contato guarda aniversário e bairro informados pela agência
    const edited = await ctx.agency.put(`/api/contacts/${teo.id}`, { birthDay: 3, birthMonth: 12, neighborhood: 'Lourdes' });
    assert.equal(edited.status, 200);
    assert.deepEqual([edited.data.birthDay, edited.data.birthMonth, edited.data.neighborhood], [3, 12, 'Lourdes']);
    assert.equal((await ctx.agency.put(`/api/contacts/${teo.id}`, { birthDay: 31, birthMonth: 11 })).data.error, 'Data de aniversário inválida.');
  });
});
