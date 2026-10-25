const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { startApp, phone } = require('../helpers/app');
const { SimulatedGateway } = require('../../src/payments/providers/SimulatedGateway');

const MENU = [{ id: 'm1', name: 'Lasanha', price: 62.9 }, { id: 'm2', name: 'Suco', price: 10 }];
const CPF = '529.982.247-25';
const API_KEY = '$aact_hmlg_000TesteChave1234';

describe('pagamento online: configuração, checkout, confirmação, prazo, webhook e estorno', () => {
  let ctx;
  let repos;
  let payments;
  let sim; // restaurante com o simulador
  let asaas; // restaurante com o "Asaas" (gateway falso no lugar do de verdade)
  const fakeAsaas = new SimulatedGateway();
  const order = (restaurant, extra = {}, customer = {}) => ctx.client().post('/api/public/orders', {
    restaurantSlug: restaurant.slug,
    orderKey: crypto.randomBytes(9).toString('base64url'),
    items: [{ id: 'm1', qty: 1 }],
    fulfillment: 'pickup',
    customer: { name: 'Cliente Online', phone: phone(1), cpf: CPF, ...customer },
    ...extra,
  });
  const get = async (id) => repos.orders.get(id);

  before(async () => {
    ctx = await startApp({ overrides: { 'payments.factories': () => ({ asaas: () => fakeAsaas }) } });
    repos = ctx.container.resolve('repos');
    payments = ctx.container.resolve('payments');
    sim = (await ctx.agency.post('/api/restaurants', { name: 'Casa Simulada', menu: MENU, payment: { enabled: true, provider: 'simulated', methods: { pix: true, card: true } } })).data;
    asaas = (await ctx.agency.post('/api/restaurants', { name: 'Casa Asaas', menu: MENU })).data;
  });
  after(async () => { await ctx?.close(); });

  it('configuração: a chave fica cifrada e nunca volta; o painel mostra o webhook e testa a conexão', async () => {
    assert.equal((await ctx.agency.put(`/api/restaurants/${asaas.id}`, { payment: { enabled: true, provider: 'asaas', methods: { pix: true } } })).data.error, 'Cole a chave de API do Asaas do restaurante.');
    assert.equal((await ctx.agency.put(`/api/restaurants/${asaas.id}`, { payment: { enabled: true, provider: 'simulated', methods: { pix: false } } })).data.error, 'Escolha ao menos uma forma de pagamento online.');
    const saved = await ctx.agency.put(`/api/restaurants/${asaas.id}`, { payment: { enabled: true, provider: 'asaas', environment: 'sandbox', apiKey: API_KEY, methods: { pix: true, card: true }, splitPercent: '5', timeoutMinutes: 20 } });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    assert.deepEqual(saved.data.payment, { enabled: true, provider: 'asaas', environment: 'sandbox', methods: { pix: true, card: true }, splitPercent: 5, timeoutMinutes: 20, apiKeyLast4: '1234', hasKey: true });
    assert.ok(!JSON.stringify(saved.data).includes('TesteChave'));
    const stored = (await ctx.container.resolve('db').one('SELECT payment_secret FROM restaurants WHERE id = $1', [asaas.id])).payment_secret;
    assert.ok(stored.apiKeyEnc && !stored.apiKeyEnc.includes('TesteChave'), 'guardada cifrada');

    // Salvar de novo sem colar a chave mantém a que estava
    await ctx.agency.put(`/api/restaurants/${asaas.id}`, { payment: { ...saved.data.payment, apiKey: '' } });
    assert.equal((await ctx.container.resolve('db').one('SELECT payment_secret FROM restaurants WHERE id = $1', [asaas.id])).payment_secret.apiKeyEnc, stored.apiKeyEnc);

    const info = (await ctx.agency.get(`/api/restaurants/${asaas.id}/payment`)).data;
    assert.equal(info.webhookUrl, `${ctx.baseUrl}/webhooks/asaas/${asaas.id}`);
    assert.match(info.webhookToken, /^[\w-]{32}$/);
    assert.deepEqual((await ctx.agency.post(`/api/restaurants/${asaas.id}/payment/test`)).data, { ok: true, balance: 0 });

    await ctx.agency.post(`/api/restaurants/${asaas.id}/users`, { name: 'Dono', email: 'dono@asaas.com.br', password: 'senha-dono-123' });
    const owner = ctx.client();
    await owner.login('dono@asaas.com.br', 'senha-dono-123');
    const mine = (await owner.get('/api/restaurants')).data;
    assert.ok(!JSON.stringify(mine).includes('apiKeyEnc') && !JSON.stringify(mine).includes('TesteChave'));
    assert.equal((await owner.get(`/api/restaurants/${asaas.id}/payment`)).status, 403, 'o token do webhook é só da agência');

    assert.deepEqual((await ctx.client().get(`/api/public/restaurants/${sim.slug}`)).data.payment, { methods: ['pix', 'card'], simulated: true, timeoutMinutes: 30 });
    const off = (await ctx.agency.post('/api/restaurants', { name: 'Casa Sem Online', menu: MENU })).data;
    assert.equal((await ctx.client().get(`/api/public/restaurants/${off.slug}`)).data.payment, null);
    assert.equal((await order(off, { payment: 'pix' })).data.error, 'Esta forma de pagamento não está disponível neste restaurante.');
  });

  it('Pix no simulador: exige CPF, fica fora do quadro até pagar e entra em Novos ao confirmar', async () => {
    assert.equal((await order(sim, { payment: 'pix' }, { cpf: '' })).data.error, 'Informe o CPF para pagar online.');
    const res = await order(sim, { payment: 'pix' });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.equal(res.data.payment.method, 'pix');
    assert.equal(res.data.payment.status, 'pending');
    assert.match(res.data.payment.pix.copyPaste, /SIMULADO/);
    const board = async () => (await ctx.agency.get(`/api/orders?restaurantId=${sim.id}&active=1`)).data.map((o) => o.id);
    assert.ok(!(await board()).includes(res.data.id), 'não pago: fora do quadro');
    assert.deepEqual((await ctx.agency.get(`/api/orders?restaurantId=${sim.id}&awaitingPayment=1`)).data.map((o) => o.id), [res.data.id]);
    assert.equal((await ctx.agency.put(`/api/orders/${res.data.id}/status`, { status: 'preparing' })).data.error, 'Este pedido ainda está esperando o pagamento do cliente.');

    const tracking = (await ctx.client().get(`/api/public/orders/${res.data.trackingCode}`)).data;
    assert.deepEqual([tracking.payment.method, tracking.payment.status, tracking.payment.simulated], ['pix', 'pending', true]);
    assert.ok(tracking.payment.pix.qrCode.startsWith('data:image/svg+xml'));

    assert.equal((await ctx.client().post(`/api/public/orders/${res.data.trackingCode}/simulate-payment`)).status, 200);
    const paid = await get(res.data.id);
    assert.equal(paid.paymentStatus, 'paid');
    assert.ok(paid.paidAt);
    assert.ok((await board()).includes(res.data.id), 'pago: entra em Novos');
    assert.equal((await ctx.client().post(`/api/public/orders/${res.data.trackingCode}/simulate-payment`)).status, 400, 'não paga duas vezes');
    const after = (await ctx.client().get(`/api/public/orders/${res.data.trackingCode}`)).data;
    assert.equal(after.payment.status, 'paid');
    assert.equal(after.payment.pix, null, 'pago: o QR Code some');

    const card = await order(sim, { payment: 'card' }, { phone: phone(2) });
    assert.deepEqual([card.data.payment.method, card.data.payment.status], ['card', 'pending']);
    const cash = await order(sim, {}, { phone: phone(3), cpf: '' });
    assert.deepEqual([cash.data.payment.method, cash.data.payment.status], ['on_delivery', 'none'], 'pagar na entrega continua sem CPF');
  });

  it('prazo vencido: cobrança apagada, pedido cancelado e cupom devolvido', async () => {
    const coupon = await repos.coupons.create({ restaurantId: sim.id, code: 'PRAZO123', discountType: 'fixed', discountValue: 5 });
    const res = await order(sim, { payment: 'pix', couponCode: 'PRAZO123' }, { phone: phone(4) });
    assert.equal(res.data.discount, 5);
    assert.ok((await repos.coupons.get(coupon.id)).usedAt);
    await payments.sweep(Date.now() + 10 * 60e3);
    assert.equal((await get(res.data.id)).paymentStatus, 'pending', 'antes do prazo (30 min) nada muda');
    await payments.sweep(Date.now() + 31 * 60e3);
    const expired = await get(res.data.id);
    assert.deepEqual([expired.status, expired.paymentStatus], ['canceled', 'expired']);
    assert.equal(expired.statusLog.at(-1).by, 'Pagamento');
    assert.equal((await repos.coupons.get(coupon.id)).usedAt, null, 'cupom devolvido');
    assert.equal((await ctx.client().get(`/api/public/orders/${res.data.trackingCode}`)).data.status, 'canceled');
  });

  it('gateway fora do ar: a pessoa recebe a explicação, o pedido fica cancelado e o cupom volta', async () => {
    await repos.coupons.create({ restaurantId: asaas.id, code: 'FALHA123', discountType: 'fixed', discountValue: 5 });
    fakeAsaas.fail = true;
    try {
      const res = await order(asaas, { payment: 'pix', couponCode: 'FALHA123' }, { phone: phone(5) });
      assert.equal(res.status, 502);
      assert.equal(res.data.error, 'Não foi possível gerar o pagamento agora. Tente de novo ou escolha pagar na entrega.');
    } finally {
      fakeAsaas.fail = false;
    }
    const [failed] = (await ctx.agency.get(`/api/orders?restaurantId=${asaas.id}&search=${phone(5).slice(-6)}`)).data;
    assert.deepEqual([failed.status, failed.paymentStatus], ['canceled', 'failed']);
    assert.match(failed.paymentError, /^Pagamento não gerado/);
    assert.equal((await repos.coupons.byCode(asaas.id, 'FALHA123')).usedAt, null);
    assert.equal((await order(asaas, { payment: 'pix', couponCode: 'FALHA123' }, { phone: phone(5) })).status, 201, 'tentar de novo funciona');
  });

  it('webhook do Asaas: token por restaurante, confirmação idempotente e estorno ao cancelar', async () => {
    const res = await order(asaas, { payment: 'pix' }, { phone: phone(6) });
    const saved = await get(res.data.id);
    assert.equal(saved.paymentProvider, 'asaas');
    const hook = (restaurantId, token, body) => fetch(`${ctx.baseUrl}/webhooks/asaas/${restaurantId}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'asaas-access-token': token }, body: JSON.stringify(body) });
    const token = payments.webhookToken(asaas.id);
    const event = (name) => ({ id: `evt_${crypto.randomUUID()}`, event: name, payment: { id: saved.paymentId, status: 'RECEIVED' } });
    assert.equal((await hook(asaas.id, 'errado', event('PAYMENT_RECEIVED'))).status, 401);
    assert.equal((await hook(sim.id, token, event('PAYMENT_RECEIVED'))).status, 401, 'o token de um restaurante não vale para outro');
    assert.equal((await hook(asaas.id, token, event('PAYMENT_CHECKOUT_VIEWED'))).status, 200);
    assert.equal((await get(saved.id)).paymentStatus, 'pending');

    fakeAsaas.pay(saved.paymentId);
    assert.equal((await hook(asaas.id, token, event('PAYMENT_RECEIVED'))).status, 200);
    const paid = await get(saved.id);
    assert.equal(paid.paymentStatus, 'paid');
    assert.equal((await hook(asaas.id, token, event('PAYMENT_CONFIRMED'))).status, 200);
    assert.equal((await get(saved.id)).paidAt, paid.paidAt, 'evento repetido não muda nada');

    const canceled = await ctx.agency.put(`/api/orders/${saved.id}/status`, { status: 'canceled' });
    assert.equal(canceled.status, 200);
    assert.deepEqual([canceled.data.status, canceled.data.paymentStatus], ['canceled', 'refunded']);
  });

  it('consulta de reserva: sem webhook, a página de acompanhamento confirma o pagamento', async () => {
    const res = await order(asaas, { payment: 'pix' }, { phone: phone(7) });
    const saved = await get(res.data.id);
    fakeAsaas.pay(saved.paymentId);
    assert.equal((await ctx.client().get(`/api/public/orders/${res.data.trackingCode}`)).data.payment.status, 'pending', 'consultou há pouco: espera');
    await repos.orders.setPayment(saved.id, { from: ['pending'], patch: { paymentCheckedAt: new Date(Date.now() - 60e3).toISOString() } });
    assert.equal((await ctx.client().get(`/api/public/orders/${res.data.trackingCode}`)).data.payment.status, 'paid');
  });
});
