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
  after(async () => { await ctx?.close(); });

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
