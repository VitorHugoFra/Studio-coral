const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openTestDb } = require('../helpers/db');
const { createRepositories } = require('../../src/db/repositories/index');

describe('campanhas: gravações condicionais', () => {
  let db;
  let repos;
  let restaurant;
  const pause = () => new Promise((r) => { setTimeout(r, 5); });
  const newCampaign = (data = {}) => repos.campaigns.create({ restaurantId: restaurant.id, name: 'Campanha', ...data });
  const entry = (action, extra = {}) => ({ action, by: 'Teste', at: new Date().toISOString(), ...extra });

  before(async () => {
    db = await openTestDb();
    repos = createRepositories(db);
    restaurant = await repos.restaurants.create({ name: 'Casa', slug: 'casa' });
  });
  after(() => db.close());

  it('transition com unchangedSince só grava se a linha não mudou desde a leitura', async () => {
    const c = await newCampaign();
    assert.equal(c.updatedAt, null); // nunca alterada: a "versão" é nula
    const first = await repos.campaigns.transition(c.id, ['draft'], { notes: 'a' }, { unchangedSince: null });
    assert.equal(first.notes, 'a');
    // quem leu a versão nula chegou tarde
    assert.equal(await repos.campaigns.transition(c.id, ['draft'], { notes: 'b' }, { unchangedSince: null }), null);
    await pause(); // as versões são datas em milissegundos: a próxima gravação precisa cair em outro instante
    const second = await repos.campaigns.transition(c.id, ['draft'], { notes: 'c' }, { unchangedSince: first.updatedAt });
    assert.equal(second.notes, 'c');
    assert.equal(await repos.campaigns.transition(c.id, ['draft'], { notes: 'd' }, { unchangedSince: first.updatedAt }), null);
    assert.equal((await repos.campaigns.get(c.id)).notes, 'c');
    // a versão certa com o status errado também não grava
    assert.equal(await repos.campaigns.transition(c.id, ['scheduled'], { notes: 'e' }, { unchangedSince: second.updatedAt }), null);
    // sem a opção, vale só o status, como antes
    assert.equal((await repos.campaigns.transition(c.id, ['draft'], { notes: 'f' })).notes, 'f');
  });

  it('setApproval grava a aprovação e acrescenta a entrada ao histórico no próprio SQL', async () => {
    const c = await newCampaign({ approvalLog: [entry('requested')] });
    const row = await repos.campaigns.setApproval(c, { approval: { status: 'pending' }, entry: entry('requested', { note: 'segunda' }) });
    assert.deepEqual(row.approval, { status: 'pending' });
    assert.deepEqual(row.approvalLog.map((e) => e.action), ['requested', 'requested']);
    assert.deepEqual(c.approvalLog, row.approvalLog); // o objeto recebido fica atualizado
    assert.ok(c.updatedAt);
    // quem leu o histórico antes não apaga o que entrou depois: o banco é quem acrescenta
    const stale = { ...c, approvalLog: [] };
    await repos.campaigns.setApproval(stale, { approval: { status: 'changes' }, entry: entry('changes', { note: 'ajuste' }) });
    const stored = await repos.campaigns.get(c.id);
    assert.deepEqual(stored.approvalLog.map((e) => `${e.action}:${e.note || ''}`), ['requested:', 'requested:segunda', 'changes:ajuste']);
    assert.equal(stored.approval.status, 'changes');
  });

  it('setApproval com pendingOnly só vale sobre uma aprovação pendente', async () => {
    const none = await newCampaign();
    const changes = await newCampaign({ approval: { status: 'changes' } });
    const pending = await newCampaign({ approval: { status: 'pending' } });
    for (const c of [none, changes]) {
      assert.equal(await repos.campaigns.setApproval(c.id, { approval: { status: 'approved' }, entry: entry('approved'), pendingOnly: true }), null);
      assert.deepEqual((await repos.campaigns.get(c.id)).approvalLog, []);
    }
    const done = await repos.campaigns.setApproval(pending.id, { approval: { status: 'approved' }, entry: entry('approved'), pendingOnly: true });
    assert.equal(done.approval.status, 'approved');
    // sem pendingOnly (pedir a aprovação), qualquer situação serve
    assert.equal((await repos.campaigns.setApproval(none.id, { approval: { status: 'pending' }, entry: entry('requested') })).approval.status, 'pending');
  });

  it('setApproval só vale para campanha que ainda não foi enviada e ignora id que não é UUID', async () => {
    for (const status of ['sending', 'paused', 'completed', 'canceled']) {
      const c = await newCampaign({ status, approval: { status: 'pending' } });
      assert.equal(await repos.campaigns.setApproval(c.id, { approval: { status: 'approved' }, entry: entry('approved'), pendingOnly: true }), null);
      assert.equal((await repos.campaigns.get(c.id)).approval.status, 'pending');
    }
    assert.equal(await repos.campaigns.setApproval('xyz', { approval: { status: 'pending' }, entry: entry('requested') }), null);
  });
});
