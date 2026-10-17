const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { startApp, waitFor, phone } = require('../helpers/app');

const MENU = [
  { id: 'm1', name: 'Lasanha', price: 62.9 },
  { id: 'm2', name: 'Suco', price: 10 },
  { id: 'm3', name: 'Pizza', price: 45 },
];
const RULE = { enabled: true, discountType: 'fixed', discountValue: 10, minOrder: 40, rewardType: 'percent', rewardValue: 20, rewardMinOrder: 30, rewardValidDays: 15 };

describe('indicação: regra, link do cliente, desconto do indicado e cupom de quem indicou', () => {
  let ctx;
  let repos;
  let r;
  let marina;
  const pub = () => ctx.client();
  const order = (customer, extra = {}) => pub().post('/api/public/orders', {
    restaurantSlug: r.slug,
    orderKey: crypto.randomBytes(9).toString('base64url'),
    items: [{ id: 'm1', qty: 1 }],
    fulfillment: 'pickup',
    customer: { name: 'Cliente', ...customer },
    ...extra,
  });
  const complete = (id) => ctx.agency.put(`/api/orders/${id}/status`, { status: 'completed' });
  const couponsOf = async () => (await ctx.agency.get(`/api/referrals?restaurantId=${r.id}`)).data.coupons;

  before(async () => {
    ctx = await startApp();
    repos = ctx.container.resolve('repos');
    r = (await ctx.agency.post('/api/restaurants', { name: 'Casa Indica', menu: MENU })).data;
    const saved = await ctx.agency.put(`/api/restaurants/${r.id}`, { referral: RULE });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
  });
  after(async () => { await ctx?.close(); });

  it('regra do programa: validada ao salvar e resumida para o site', async () => {
    const bad = await ctx.agency.put(`/api/restaurants/${r.id}`, { referral: { ...RULE, discountType: 'percent', discountValue: 150 } });
    assert.equal(bad.status, 400);
    assert.equal(bad.data.error, 'Desconto do indicado: valor inválido.');
    assert.equal((await ctx.agency.put(`/api/restaurants/${r.id}`, { referral: { enabled: true } })).data.error, 'Informe o desconto do indicado e o cupom de quem indicou.');
    const site = (await pub().get(`/api/public/restaurants/${r.slug}`)).data;
    assert.deepEqual(site.referral, { discount: 'R$ 10,00', discountType: 'fixed', discountValue: 10, minOrder: 40, reward: '20%', rewardMinOrder: 30, rewardValidDays: 15, validUntil: null });
    const off = (await ctx.agency.post('/api/restaurants', { name: 'Casa Sem Programa', menu: MENU })).data;
    assert.equal((await pub().get(`/api/public/restaurants/${off.slug}`)).data.referral, null);
    const denied = await pub().post('/api/public/referrals', { restaurantSlug: off.slug, name: 'Ana', phone: phone(99) });
    assert.equal(denied.status, 400);
    assert.equal(denied.data.error, 'O programa de indicação deste restaurante não está ativo.');
  });

  it('link do cliente: apelido automático ou escolhido, um por telefone, edição só com a chave', async () => {
    const created = await pub().post('/api/public/referrals', { restaurantSlug: r.slug, name: 'Marina Souza', phone: phone(1) });
    assert.equal(created.status, 201);
    marina = created.data;
    assert.equal(marina.slug, 'marina');
    assert.equal(marina.url, `${ctx.baseUrl}/i/${r.slug}/marina`);
    assert.ok(marina.editToken.length > 20);
    assert.match(marina.share, /R\$ 10,00 no primeiro pedido/);
    assert.ok(marina.whatsappUrl.startsWith('https://wa.me/?text=') && marina.whatsappUrl.includes(encodeURIComponent(marina.url)));

    assert.equal((await pub().post('/api/public/referrals', { restaurantSlug: r.slug, name: 'Marina Lima', phone: phone(2) })).data.slug, 'marina-2');
    assert.equal((await pub().post('/api/public/referrals', { restaurantSlug: r.slug, name: 'Bia', phone: phone(3), slug: 'Bia da Pizza!' })).data.slug, 'bia-da-pizza');
    const taken = await pub().post('/api/public/referrals', { restaurantSlug: r.slug, name: 'Outra', phone: phone(4), slug: 'marina' });
    assert.equal(taken.status, 400);
    assert.equal(taken.data.error, 'Este apelido já está em uso. Escolha outro.');
    assert.equal((await pub().post('/api/public/referrals', { restaurantSlug: r.slug, name: 'Curto', phone: phone(5), slug: 'x' })).status, 400);

    const again = await pub().post('/api/public/referrals', { restaurantSlug: r.slug, name: 'Marina S.', phone: '(31) 9900-0001' });
    assert.equal(again.status, 200);
    assert.equal(again.data.existing, true);
    assert.equal(again.data.id, marina.id);
    assert.equal(again.data.editToken, undefined, 'a chave de edição só sai na criação');

    assert.equal((await pub().put(`/api/public/referrals/${marina.id}`, { editToken: 'errada', message: 'x' })).status, 403);
    const edited = await pub().put(`/api/public/referrals/${marina.id}`, { editToken: marina.editToken, message: 'Peça a lasanha! {{link}}' });
    assert.equal(edited.status, 200);
    assert.equal(edited.data.share, `Peça a lasanha! ${marina.url}`);

    const contact = (await ctx.agency.get(`/api/contacts?restaurantId=${r.id}&search=Marina Souza`)).data[0];
    assert.equal(contact.optIn, false, 'criar o link não autoriza marketing');
  });

  it('abrir o link conta o clique e leva ao site com a indicação', async () => {
    const open = (ua) => fetch(`${ctx.baseUrl}/i/${r.slug}/marina`, { redirect: 'manual', headers: { 'User-Agent': ua } });
    const res = await open('Mozilla/5.0');
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), `/demo/${r.slug}?indicacao=marina`);
    await open('WhatsApp/2.24 A');
    assert.equal((await repos.referrals.get(marina.id)).clicks, 1, 'pré-visualização não conta');
    assert.equal((await fetch(`${ctx.baseUrl}/i/${r.slug}/nao-existe`, { redirect: 'manual' })).headers.get('location'), `/demo/${r.slug}`);
    const info = (await pub().get(`/api/public/referrals/${r.slug}/marina`)).data;
    assert.deepEqual([info.firstName, info.active, info.discount], ['Marina', true, 'R$ 10,00']);
    assert.equal((await pub().get(`/api/public/referrals/${r.slug}/nao-existe`)).status, 404);
    assert.equal((await fetch(`${ctx.baseUrl}/indicar/${r.slug}`)).status, 200);
  });

  let referred;
  it('desconto do indicado: só no primeiro pedido, acima do mínimo e nunca para quem indicou', async () => {
    const first = await order({ name: 'Rui Novo', phone: phone(10) }, { referral: 'marina' });
    assert.equal(first.status, 201);
    assert.equal(first.data.discount, 10);
    assert.equal(first.data.total, 52.9);
    assert.equal(first.data.coupon, 'INDICAÇÃO MARINA');
    assert.deepEqual(first.data.referral, { applied: true, by: 'Marina', reason: null });
    referred = (await ctx.agency.get(`/api/orders/${first.data.id}`)).data;
    assert.equal(referred.source, 'referral');
    assert.equal(referred.referralId, marina.id);

    const second = await order({ name: 'Rui Novo', phone: phone(10) }, { referral: 'marina' });
    assert.equal(second.data.discount, 0);
    assert.equal(second.data.referral.reason, 'O desconto de indicação vale só no primeiro pedido.');

    const small = await order({ name: 'Leve', phone: phone(11) }, { referral: 'marina', items: [{ id: 'm2', qty: 2 }] });
    assert.equal(small.data.discount, 0);
    assert.equal(small.data.referral.reason, 'O desconto de indicação vale para pedidos a partir de R$ 40,00.');

    const self = await order({ name: 'Marina Souza', phone: phone(1) }, { referral: 'marina' });
    assert.equal(self.data.referral.reason, 'O desconto de indicação não vale para quem indicou.');

    await ctx.agency.post('/api/orders/import', { restaurantId: r.id, rows: [{ orderId: 'CX-1', date: '01/09/2026', name: 'Antigo', phone: phone(12), total: '30' }] });
    const imported = await order({ name: 'Antigo', phone: phone(12) }, { referral: 'marina' });
    assert.equal(imported.data.referral.reason, 'O desconto de indicação vale só no primeiro pedido.', 'pedido importado conta como pedido anterior');

    const yesterday = new Date(Date.now() - 864e5).toLocaleDateString('sv-SE');
    await ctx.agency.put(`/api/restaurants/${r.id}`, { referral: { ...RULE, validUntil: yesterday } });
    assert.equal((await order({ name: 'Tarde', phone: phone(13) }, { referral: 'marina' })).data.referral.reason, 'O programa de indicação não está ativo.');
    await ctx.agency.put(`/api/restaurants/${r.id}`, { referral: RULE });

    // Os descontos não acumulam: com o cupom da casa (10%) maior que os R$ 10 da indicação, vale o da casa
    await ctx.agency.put(`/api/restaurants/${r.id}`, { coupon: 'CASA10' });
    const big = await order({ name: 'Grande', phone: phone(14) }, { referral: 'marina', items: [{ id: 'm1', qty: 3 }] });
    assert.equal(big.data.discount, 18.87);
    assert.equal(big.data.coupon, 'CASA10');
    assert.equal(big.data.referral.reason, 'Outro desconto maior já foi aplicado (os descontos não acumulam).');
    await ctx.agency.put(`/api/restaurants/${r.id}`, { coupon: '' });
  });

  let reward;
  it('pedido indicado concluído gera um cupom para quem indicou e manda pelo WhatsApp; cancelado não gera', async () => {
    assert.deepEqual(await couponsOf(), [], 'pedido em andamento ainda não gera cupom');
    assert.equal((await complete(referred.id)).status, 200);
    [reward] = await couponsOf();
    assert.match(reward.code, /^[A-HJ-NP-Z2-9]{8}$/);
    assert.deepEqual([reward.discountType, reward.discountValue, reward.minOrder, reward.referralId, reward.originOrderId], ['percent', 20, 30, marina.id, referred.id]);
    const days = (new Date(reward.expiresAt) - Date.now()) / 864e5;
    assert.ok(days > 14 && days < 16, `vale 15 dias (${days})`);
    await waitFor(async () => (await couponsOf())[0].sentAt, { message: 'cupom enviado' });
    const outbox = (await ctx.agency.get('/api/messaging/outbox')).data;
    const sent = outbox.find((m) => m.text?.includes(reward.code));
    assert.ok(sent, 'a mensagem com o cupom saiu pelo simulador');
    assert.match(sent.text, /Rui fez o primeiro pedido no Casa Indica pelo seu convite/);
    assert.match(sent.text, /de 20% em pedidos a partir de R\$ 30,00/);

    const other = await order({ name: 'Cancela', phone: phone(15) }, { referral: 'marina-2' });
    await ctx.agency.put(`/api/orders/${other.data.id}/status`, { status: 'canceled' });
    assert.equal((await couponsOf()).length, 1, 'pedido cancelado não gera cupom');
  });

  it('cupom de uso único: vale uma vez, com mínimo e validade; dois pedidos ao mesmo tempo, um ganha', async () => {
    const used = await order({ name: 'Presente', phone: phone(20) }, { couponCode: ` ${reward.code.toLowerCase()} ` });
    assert.equal(used.status, 201, JSON.stringify(used.data));
    assert.equal(used.data.discount, 12.58);
    assert.equal(used.data.coupon, reward.code);
    const again = await order({ name: 'De novo', phone: phone(21) }, { couponCode: reward.code });
    assert.equal(again.status, 400);
    assert.equal(again.data.error, 'Este cupom já foi usado.');
    assert.equal((await order({ name: 'X', phone: phone(22) }, { couponCode: 'NAOEXISTE' })).data.error, 'Cupom não encontrado.');

    const mk = (extra = {}) => repos.coupons.create({ restaurantId: r.id, code: crypto.randomBytes(4).toString('hex').toUpperCase(), discountType: 'fixed', discountValue: 5, minOrder: 30, ...extra });
    const min = await mk();
    assert.equal((await order({ name: 'Pouco', phone: phone(23) }, { couponCode: min.code, items: [{ id: 'm2', qty: 1 }] })).data.error, 'Este cupom vale para pedidos a partir de R$ 30,00.');
    const old = await mk({ expiresAt: new Date(Date.now() - 1000).toISOString() });
    assert.equal((await order({ name: 'Atrasado', phone: phone(24) }, { couponCode: old.code })).data.error, 'Este cupom venceu.');

    const race = await mk();
    const both = await Promise.all([order({ name: 'A', phone: phone(25) }, { couponCode: race.code }), order({ name: 'B', phone: phone(26) }, { couponCode: race.code })]);
    assert.deepEqual(both.map((x) => x.status).sort(), [201, 400]);
    assert.equal(both.find((x) => x.status === 400).data.error, 'Este cupom já foi usado.');
    assert.equal((await repos.coupons.get(race.id)).usedOrderId, both.find((x) => x.status === 201).data.id);
  });

  it('painel: links com números, cupons, reenviar e o restaurante só vê o próprio', async () => {
    const { links, coupons } = (await ctx.agency.get(`/api/referrals?restaurantId=${r.id}`)).data;
    const m = links.find((l) => l.slug === 'marina');
    assert.deepEqual([m.clicks, m.orders, m.revenue, m.rewards], [1, 1, 52.9, 1]);
    assert.equal(m.url, `${ctx.baseUrl}/i/${r.slug}/marina`);
    assert.equal('editToken' in m, false, 'a chave de edição nunca sai no painel');
    const used = coupons.find((c) => c.code === reward.code);
    assert.ok(used.usedAt && used.usedOrderId);
    assert.equal(used.contactName, 'Marina Souza');
    assert.equal((await ctx.agency.post(`/api/coupons/${used.id}/resend`)).data.error, 'Este cupom já foi usado.');
    const fresh = coupons.find((c) => !c.usedAt && c.code.length === 8 && c.discountValue === 5 && !c.expiresAt);
    assert.ok((await ctx.agency.post(`/api/coupons/${fresh.id}/resend`)).data.sendError, 'cupom sem dono não tem para quem enviar');

    await ctx.agency.post(`/api/restaurants/${r.id}/users`, { name: 'Dona', email: 'dona@indica.com.br', password: 'senha-dona-123' });
    const owner = ctx.client();
    await owner.login('dona@indica.com.br', 'senha-dona-123');
    const mine = (await owner.get('/api/referrals')).data;
    assert.ok(mine.links.length && mine.links.every((l) => l.restaurantId === r.id));
    assert.equal((await owner.post(`/api/coupons/${fresh.id}/resend`)).status, 403);
  });
});
