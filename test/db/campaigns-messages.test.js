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
    assert.equal((await repos.messages.summary({ campaignId: c.id, sentTo: at(-60000) })).sent, 0, 'envio depois do fim do período não conta');
    assert.equal((await repos.messages.summary({ campaignId: c.id, sentTo: at(60000) })).sent, 1);
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
    // o período é [de, até): o envio exatamente no início conta; exatamente no fim, não
    assert.equal((await repos.messages.sentBetween(restaurant.id, '2026-03-31T23:30:00.000Z', '2026-04-01T00:00:00.000Z')).length, 1);
    assert.equal((await repos.messages.sentBetween(restaurant.id, '2026-03-01T00:00:00.000Z', '2026-03-31T23:30:00.000Z')).length, 0);
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

  it('pedidos: o período é [de, até), incluindo o início e excluindo o fim', async () => {
    const { restaurant } = await fresh();
    const c = await repos.campaigns.create({ restaurantId: restaurant.id, name: 'Período', status: 'completed' });
    const from = '2026-05-01T00:00:00.000Z';
    const to = '2026-06-01T00:00:00.000Z';
    const order = (orderId, createdAt, value) => repos.conversions.createUnique({ restaurantId: restaurant.id, campaignId: c.id, orderId, value, createdAt });
    await order('B-1', '2026-04-30T23:59:59.999Z', 99); // um instante antes do período
    await order('B-2', from, 10.1); // exatamente no início: conta
    await order('B-3', '2026-05-15T12:00:00.000Z', 20.2);
    await order('B-4', to, 5); // exatamente no fim: não conta
    assert.deepEqual(await repos.conversions.summary({ restaurantId: restaurant.id, from, to }), { orders: 2, revenue: 30.3 });
    assert.deepEqual((await repos.conversions.attributedBetween(restaurant.id, from, to)).map((x) => x.orderId), ['B-2', 'B-3']);
    assert.deepEqual(await repos.conversions.summary({ restaurantId: restaurant.id }), { orders: 4, revenue: 134.3 });
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

  it('mensagens: id que não é UUID devolve vazio em vez de erro do banco', async () => {
    assert.equal(await repos.messages.claimNext('xyz'), null);
    assert.equal(await repos.messages.hasQueued('xyz'), false);
    assert.deepEqual(await repos.messages.skipQueued('xyz', 'Campanha cancelada'), []);
    assert.equal(await repos.messages.markSent('xyz', { provider: 'simulator', providerMessageId: 'p', sentAt: at() }), null);
    assert.equal(await repos.messages.registerClick('xyz', at()), null);
    assert.equal(await repos.messages.registerReply('xyz', { reply: 'SAIR', optOut: true, at: at() }), null);
    assert.equal(await repos.messages.markConverted('xyz', at()), null);
  });

  it('empates na data saem sempre na mesma ordem', async () => {
    const { restaurant, contacts } = await fresh();
    const c = await repos.campaigns.create({ restaurantId: restaurant.id, name: 'Empates', status: 'completed' });
    // duas mensagens para o mesmo telefone, enviadas no mesmo instante
    const [first, second] = await queue(c, [contacts[0], contacts[0]]);
    const sentAt = at(-1000);
    await repos.messages.markSent(first.id, { provider: 's', providerMessageId: `${c.id}-e1`, sentAt });
    await repos.messages.markSent(second.id, { provider: 's', providerMessageId: `${c.id}-e2`, sentAt });
    assert.equal((await repos.messages.lastSentToPhoneKey(MessagingProvider.phoneKey(contacts[0].phone))).id, first.id, 'vale a primeira inserida, como no JSON antigo');

    // dois pedidos no mesmo instante, inseridos na ordem contrária à dos ids
    const ids = ['10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001'];
    const createdAt = at(-2000);
    for (const [i, id] of ids.entries()) await repos.conversions.createUnique({ id, restaurantId: restaurant.id, campaignId: c.id, orderId: `E-${i}`, value: 1, createdAt });
    assert.deepEqual((await repos.conversions.recentAttributed({ restaurantId: restaurant.id, limit: 2 })).map((x) => x.id), [ids[1], ids[0]]);
  });

  // apaga o banco deste arquivo: precisa ser o último teste
  it('reset apaga todos os dados e volta as configurações ao padrão', async () => {
    await repos.settings.load();
    await repos.settings.update({ footer: 'Outro rodapé' });
    await repos.reset();
    assert.equal(await repos.restaurants.count(), 0);
    assert.equal(await repos.messages.count(), 0);
    assert.equal(repos.settings.get().footer, 'Responda SAIR para não receber mais mensagens.');
  });
});
