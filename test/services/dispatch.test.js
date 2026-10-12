const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { openTestDb } = require('../helpers/db');
const { waitFor } = require('../helpers/app');
const { interleave } = require('../helpers/race');
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

/** Serviço da fila ligado ao banco e a um canal falso. */
function newDispatch(repos, messaging) {
  return new DispatchService({
    repos,
    messaging,
    templates: new TemplateService({ settings: repos.settings }),
    media: { resolve: () => undefined },
    events: { publish() {} },
    config: { publicUrl: 'http://teste.local', simulatorPace: { min: 0, max: 0 } },
    logger: { log() {}, error() {}, warn() {} },
  });
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
    dispatch = newDispatch(repos, messaging);
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

describe('fila de disparo: pedidos que chegam no meio de outro', () => {
  let db;
  let repos;
  let restaurant;
  let worker;
  let created;
  const statusOf = async (id) => (await repos.campaigns.get(id)).status;
  const newCampaign = async (data) => {
    const c = await repos.campaigns.create({ restaurantId: restaurant.id, message: 'Oi', ...data });
    created.push(c.id);
    return c;
  };
  const concluded = (id) => waitFor(async () => (await statusOf(id)) === 'completed', { timeout: 5000, message: 'campanha concluída' });
  const audienceSize = async () => (await repos.contacts.audience(restaurant.id)).length;

  before(async () => {
    db = await openTestDb();
    repos = createRepositories(db);
    await repos.settings.load();
    restaurant = await repos.restaurants.create({ name: 'Concorrência', slug: 'concorrencia', requireApproval: false });
    await repos.contacts.insertMany([1, 2].map((i) => ({ restaurantId: restaurant.id, name: `Cliente ${i}`, phone: `553198000000${i}`, optIn: true })));
  });
  beforeEach(() => {
    created = [];
    worker = newDispatch(repos, new FakeMessaging());
  });
  afterEach(async () => {
    worker.stop();
    await worker.idle();
    // Interceptações que sobraram saem, e as campanhas do teste também (as mensagens vão junto)
    for (const [repo, method] of [[repos.campaigns, 'get'], [repos.campaigns, 'byStatus'], [repos.restaurants, 'get']]) delete repo[method];
    for (const id of created) await repos.campaigns.remove(id);
  });
  after(async () => { await db.close(); });

  it('um disparo pedido com o passo da fila ocupado não se perde', async () => {
    const c = await newCampaign({ name: 'Despertar' });
    let release;
    let parked = false;
    const gate = new Promise((r) => { release = r; });
    // O passo lê a fila (ainda vazia) e fica parado antes de seguir
    interleave(repos.campaigns, 'byStatus', async () => { parked = true; await gate; });
    try {
      worker.kick();
      await waitFor(() => parked, { message: 'passo parado na leitura da fila' });
      await worker.start(c.id); // o pedido chega com o passo ocupado
      release();
      await concluded(c.id);
      assert.equal((await repos.messages.byCampaign(c.id)).length, await audienceSize());
    } finally {
      release();
    }
  });

  it('agendar no meio do disparo recusa o pedido e não duplica a fila', async () => {
    const c = await newCampaign({ name: 'Agenda e dispara' });
    // O schedule já conferiu o status quando outro pedido inicia a campanha
    interleave(repos.restaurants, 'get', () => worker.start(c.id));
    await assert.rejects(worker.schedule(c.id, new Date(Date.now() + 3600e3).toISOString()), { message: 'Esta campanha já foi iniciada.' });
    await concluded(c.id);
    assert.equal((await repos.messages.byCampaign(c.id)).length, await audienceSize());
  });

  it('pausar no instante em que a campanha conclui recusa o pedido e mantém a conclusão', async () => {
    const c = await newCampaign({ name: 'Pausa tardia', status: 'sending', startedAt: new Date().toISOString() });
    // A leitura ainda vê "enviando"; logo depois a fila conclui a campanha
    interleave(repos.campaigns, 'get', () => repos.campaigns.update(c.id, { status: 'completed', completedAt: new Date().toISOString() }));
    await assert.rejects(worker.pause(c.id), { message: 'Só é possível pausar campanhas em andamento.' });
    assert.equal(await statusOf(c.id), 'completed');
  });

  it('retomar uma campanha cancelada no meio do pedido recusa e não a ressuscita', async () => {
    const c = await newCampaign({ name: 'Retoma tardia', status: 'paused', startedAt: new Date().toISOString() });
    interleave(repos.campaigns, 'get', () => repos.campaigns.update(c.id, { status: 'canceled', completedAt: new Date().toISOString() }));
    await assert.rejects(worker.resume(c.id), { message: 'A campanha não está pausada.' });
    assert.equal(await statusOf(c.id), 'canceled');
  });

  it('cancelar no instante em que a campanha conclui recusa o pedido e não mexe na fila', async () => {
    const c = await newCampaign({ name: 'Cancela tardio', status: 'sending', startedAt: new Date().toISOString() });
    const [contact] = await repos.contacts.byRestaurant(restaurant.id);
    const [m] = await repos.messages.insertMany([{ campaignId: c.id, restaurantId: restaurant.id, contactId: contact.id, name: contact.name, phone: contact.phone, code: 'cancelatardio1', status: 'queued' }]);
    interleave(repos.campaigns, 'get', () => repos.campaigns.update(c.id, { status: 'completed', completedAt: new Date().toISOString() }));
    await assert.rejects(worker.cancel(c.id), { message: 'A campanha já foi encerrada.' });
    assert.equal(await statusOf(c.id), 'completed');
    assert.equal((await repos.messages.get(m.id)).status, 'queued');
  });

  it('cancelar um agendamento no meio do início do disparo cancela o envio que começou, sem duplicar a fila', async () => {
    const c = await newCampaign({ name: 'Cancela agenda', status: 'scheduled', scheduledAt: new Date(Date.now() + 3600e3).toISOString() });
    // O cancelamento viu "agendada" e, nesse meio tempo, o disparo começou: ele segue para cancelar o envio
    interleave(repos.campaigns, 'get', async () => { await worker.start(c.id); worker.stop(); });
    await worker.cancel(c.id);
    assert.equal(await statusOf(c.id), 'canceled');
    const messages = await repos.messages.byCampaign(c.id);
    assert.equal(messages.length, await audienceSize());
    assert.ok(messages.every((m) => m.status === 'skipped'), 'o que estava na fila foi descartado');
  });

  it('cancelar é uma operação só: se descartar a fila falhar, o status não muda', async () => {
    const c = await newCampaign({ name: 'Cancela atômico', status: 'sending', startedAt: new Date().toISOString() });
    const [contact] = await repos.contacts.byRestaurant(restaurant.id);
    const [m] = await repos.messages.insertMany([{ campaignId: c.id, restaurantId: restaurant.id, contactId: contact.id, name: contact.name, phone: contact.phone, code: 'atomico1', status: 'queued' }]);
    // O segundo passo do cancelamento (descartar a fila) falha dentro da transação
    const { tx } = repos;
    repos.tx = (fn) => tx.call(repos, (r) => {
      r.messages.skipQueued = async () => { throw new Error('falha ao descartar a fila'); };
      return fn(r);
    });
    try {
      await assert.rejects(worker.cancel(c.id), { message: 'falha ao descartar a fila' });
    } finally {
      repos.tx = tx;
    }
    assert.equal(await statusOf(c.id), 'sending');
    assert.equal((await repos.messages.get(m.id)).status, 'queued');
  });
});
