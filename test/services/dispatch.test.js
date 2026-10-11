const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { openTestDb } = require('../helpers/db');
const { waitFor } = require('../helpers/app');
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
    dispatch = new DispatchService({
      repos,
      messaging,
      templates: new TemplateService({ settings: repos.settings }),
      media: { resolve: () => undefined },
      events: { publish() {} },
      config: { publicUrl: 'http://teste.local', simulatorPace: { min: 0, max: 0 } },
      logger: { log() {}, error() {}, warn() {} },
    });
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
