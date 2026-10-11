const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, waitFor, sleep, phone } = require('../helpers/app');

describe('campanhas e aprovação', () => {
  let ctx;
  let r;
  let other;
  let rest;

  before(async () => {
    ctx = await startApp();
    r = (await ctx.agency.post('/api/restaurants', { name: 'Bistrô Aprovação' })).data;
    other = (await ctx.agency.post('/api/restaurants', { name: 'Outro Lugar' })).data;
    const add = (name, i, tags, extra = {}) => ctx.agency.post('/api/contacts', { restaurantId: r.id, name, phone: phone(i), tags, ...extra });
    await add('Ana Vip', 1, 'vip');
    await add('Beto Vip Família', 2, 'vip,familia');
    await add('Cris Família', 3, 'familia');
    const out = (await add('Duda Saiu', 4, 'vip')).data;
    await ctx.agency.put(`/api/contacts/${out.id}`, { optedOut: true });
    await add('Edu Sem Opt-in', 5, 'vip', { optIn: false });
    await ctx.agency.post(`/api/restaurants/${r.id}/users`, { name: 'Rita do Bistrô', email: 'rita@bistro.com.br', password: 'senha-rita-123' });
    rest = ctx.client();
    await rest.login('rita@bistro.com.br', 'senha-rita-123');
  });
  after(async () => { await ctx?.close(); });

  const create = async (body) => {
    const res = await ctx.agency.post('/api/campaigns', { restaurantId: r.id, ...body });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    return res.data;
  };
  const approve = async (id) => {
    await ctx.agency.post(`/api/campaigns/${id}/request-approval`, {});
    assert.equal((await rest.post(`/api/campaigns/${id}/approve`, {})).data.approval.status, 'approved');
  };

  it('cria rascunho com valores padrão e segmentação normalizada', async () => {
    const blank = await create({});
    assert.equal(blank.name, 'Nova campanha');
    assert.equal(blank.message, '');
    assert.deepEqual(blank.segment, { tags: [], match: 'any' });
    assert.equal(blank.includeFooter, true);
    assert.equal(blank.status, 'draft');
    assert.equal(blank.restaurant, 'Bistrô Aprovação');
    assert.equal(blank.stats.audience, 0);
    assert.equal(blank.stats.orders, 0);
    assert.equal(blank.stats.revenue, 0);

    const c = await create({ name: 'Sextou', message: 'Oi {{primeiro_nome}}', segment: { tags: ['VIP', ' Familia '], match: 'all' }, coupon: 'SEXTOU' });
    assert.deepEqual(c.segment, { tags: ['vip', 'familia'], match: 'all' });
    assert.equal(c.coupon, 'SEXTOU');

    const missing = await ctx.agency.post('/api/campaigns', { name: 'Sem restaurante' });
    assert.equal(missing.status, 400);
    assert.equal(missing.data.error, 'Selecione o restaurante.');
  });

  it('prévia do público considera só contatos autorizados', async () => {
    const preview = async (segment) => (await ctx.agency.post('/api/audience/preview', { restaurantId: r.id, segment })).data;
    const vip = await preview({ tags: ['vip'] });
    assert.equal(vip.count, 2);
    assert.deepEqual(vip.sample.map((s) => s.name).sort(), ['Ana Vip', 'Beto Vip Família']);
    assert.deepEqual(Object.keys(vip.sample[0]).sort(), ['name', 'phone']);
    assert.equal((await preview({ tags: ['vip', 'familia'], match: 'all' })).count, 1);
    assert.equal((await preview({ tags: ['vip', 'familia'], match: 'any' })).count, 3);
    assert.equal((await preview({ tags: [] })).count, 3);
    assert.equal((await preview({ tags: ['VIP'] })).count, 2);
  });

  it('detalhe do rascunho traz o tamanho do público', async () => {
    const c = await create({ name: 'Público VIP', segment: { tags: ['vip'] } });
    const res = (await ctx.agency.get(`/api/campaigns/${c.id}`)).data;
    assert.equal(res.audiencePreview, 2);
    assert.deepEqual(res.segment, { tags: ['vip'], match: 'any' });
  });

  it('lista da mais nova para a mais antiga, por restaurante', async () => {
    const a = await create({ name: 'Ordem A' });
    await sleep(5);
    const b = await create({ name: 'Ordem B' });
    const names = (await ctx.agency.get(`/api/campaigns?restaurantId=${r.id}`)).data.map((c) => c.name);
    assert.ok(names.includes(a.name) && names.includes(b.name));
    assert.ok(names.indexOf(b.name) < names.indexOf(a.name));
    assert.deepEqual((await ctx.agency.get(`/api/campaigns?restaurantId=${other.id}`)).data, []);
  });

  it('fluxo de aprovação: pedido, ajuste, aprovação e reset ao editar', async () => {
    const empty = await create({ name: 'Sem texto' });
    const noText = await ctx.agency.post(`/api/campaigns/${empty.id}/request-approval`, {});
    assert.equal(noText.status, 400);
    assert.equal(noText.data.error, 'Escreva a mensagem antes de pedir aprovação.');

    const c = await create({ name: 'Para aprovar', message: 'Oi {{primeiro_nome}}!' });
    assert.equal((await rest.get('/api/campaigns')).data.some((x) => x.id === c.id), false, 'rascunho interno não aparece para o restaurante');

    const asked = (await ctx.agency.post(`/api/campaigns/${c.id}/request-approval`, { note: 'Confere?' })).data;
    assert.equal(asked.approval.status, 'pending');
    assert.equal(asked.approval.requestedBy, ctx.config.admin.name);
    assert.equal(asked.approvalLog.length, 1);
    assert.equal(asked.approvalLog[0].action, 'requested');
    assert.equal(asked.approvalLog[0].note, 'Confere?');
    assert.equal((await rest.get('/api/campaigns')).data.some((x) => x.id === c.id), true);

    assert.equal((await rest.post(`/api/campaigns/${c.id}/request-changes`, { note: '  ' })).data.error, 'Conte o que precisa mudar.');
    const changes = (await rest.post(`/api/campaigns/${c.id}/request-changes`, { note: 'Trocar o cupom' })).data;
    assert.equal(changes.approval.status, 'changes');
    assert.equal(changes.approval.note, 'Trocar o cupom');
    assert.equal(changes.approval.decidedBy, 'Rita do Bistrô');
    const late = await rest.post(`/api/campaigns/${c.id}/approve`, {});
    assert.equal(late.status, 400);
    assert.equal(late.data.error, 'Esta campanha não está aguardando aprovação.');

    await ctx.agency.post(`/api/campaigns/${c.id}/request-approval`, {});
    const ok = (await rest.post(`/api/campaigns/${c.id}/approve`, { note: 'Pode mandar' })).data;
    assert.equal(ok.approval.status, 'approved');
    assert.equal(ok.approval.note, 'Pode mandar');
    assert.deepEqual(ok.approvalLog.map((l) => l.action), ['requested', 'changes', 'requested', 'approved']);

    assert.equal((await ctx.agency.put(`/api/campaigns/${c.id}`, { name: 'Só o nome mudou', notes: 'interno' })).data.approval.status, 'approved');
    const reset = (await ctx.agency.put(`/api/campaigns/${c.id}`, { message: 'Texto novo' })).data;
    assert.equal(reset.approval, null);
    assert.equal(reset.approvalLog.at(-1).action, 'reset');
    assert.equal(reset.approvalLog.at(-1).note, 'Conteúdo alterado pela agência');
  });

  it('restaurante não vê campanha de outro restaurante', async () => {
    const foreign = (await ctx.agency.post('/api/campaigns', { restaurantId: other.id, name: 'Alheia', message: 'x' })).data;
    await ctx.agency.post(`/api/campaigns/${foreign.id}/request-approval`, {});
    const res = await rest.get(`/api/campaigns/${foreign.id}`);
    assert.equal(res.status, 404);
    assert.equal(res.data.error, 'Campanha não encontrada');
    assert.equal((await rest.post(`/api/campaigns/${foreign.id}/approve`, {})).status, 404);
  });

  it('não dispara nem agenda sem aprovação', async () => {
    const c = await create({ name: 'Sem aprovação', message: 'Oi' });
    for (const action of ['start', 'schedule']) {
      const res = await ctx.agency.post(`/api/campaigns/${c.id}/${action}`, { scheduledAt: new Date(Date.now() + 3600e3).toISOString() });
      assert.equal(res.status, 400);
      assert.equal(res.data.error, 'Esta campanha precisa ser aprovada pelo restaurante antes do envio.');
    }
  });

  it('agenda, desagenda e volta a rascunho quando o conteúdo muda', async () => {
    const c = await create({ name: 'Agendada', message: 'Oi' });
    await approve(c.id);
    assert.equal((await ctx.agency.post(`/api/campaigns/${c.id}/schedule`, { scheduledAt: '2020-01-01T10:00:00.000Z' })).data.error, 'Escolha uma data futura.');
    const when = new Date(Date.now() + 2 * 3600e3).toISOString();
    const scheduled = (await ctx.agency.post(`/api/campaigns/${c.id}/schedule`, { scheduledAt: when })).data;
    assert.equal(scheduled.status, 'scheduled');
    assert.equal(scheduled.scheduledAt, when);
    const canceled = (await ctx.agency.post(`/api/campaigns/${c.id}/cancel`, {})).data;
    assert.equal(canceled.status, 'draft');
    assert.equal(canceled.scheduledAt, null);

    await ctx.agency.post(`/api/campaigns/${c.id}/schedule`, { scheduledAt: when });
    const edited = (await ctx.agency.put(`/api/campaigns/${c.id}`, { coupon: 'NOVO' })).data;
    assert.equal(edited.status, 'draft');
    assert.equal(edited.scheduledAt, null);
    assert.equal(edited.approval, null);
  });

  it('pausa, retoma e cancela uma campanha em andamento', async () => {
    await ctx.agency.post('/api/messaging/stop', {});
    try {
      const c = await create({ name: 'Andamento', message: 'Oi {{primeiro_nome}}' });
      await approve(c.id);
      const started = (await ctx.agency.post(`/api/campaigns/${c.id}/start`, {})).data;
      assert.equal(started.status, 'sending');
      assert.equal(started.audienceSize, 3);
      assert.equal(started.provider, 'simulator');
      await waitFor(async () => (await ctx.agency.get(`/api/campaigns/${c.id}`)).data.waitingReason === 'Aguardando conexão com o WhatsApp', { message: 'aviso de espera' });

      assert.equal((await ctx.agency.post(`/api/campaigns/${c.id}/start`, {})).data.error, 'Esta campanha já foi iniciada.');
      assert.equal((await ctx.agency.put(`/api/campaigns/${c.id}`, { name: 'x' })).data.error, 'Campanhas já disparadas não podem ser editadas. Duplique-a.');

      assert.equal((await ctx.agency.post(`/api/campaigns/${c.id}/pause`, {})).data.status, 'paused');
      assert.equal((await ctx.agency.post(`/api/campaigns/${c.id}/pause`, {})).data.error, 'Só é possível pausar campanhas em andamento.');
      assert.equal((await ctx.agency.del(`/api/campaigns/${c.id}`)).data.error, 'Cancele a campanha antes de excluí-la.');
      assert.equal((await ctx.agency.post(`/api/campaigns/${c.id}/resume`, {})).data.status, 'sending');
      assert.equal((await ctx.agency.post(`/api/campaigns/${c.id}/resume`, {})).data.error, 'A campanha não está pausada.');

      const canceled = (await ctx.agency.post(`/api/campaigns/${c.id}/cancel`, {})).data;
      assert.equal(canceled.status, 'canceled');
      assert.ok(canceled.completedAt);
      const messages = (await ctx.agency.get(`/api/campaigns/${c.id}/messages`)).data;
      assert.equal(messages.length, 3);
      assert.ok(messages.every((m) => m.status === 'skipped' && m.error === 'Campanha cancelada'));
      assert.equal((await ctx.agency.post(`/api/campaigns/${c.id}/cancel`, {})).data.error, 'A campanha já foi encerrada.');
    } finally {
      await ctx.agency.post('/api/messaging/start', {});
    }
  });

  it('duplica sem levar a aprovação', async () => {
    const c = await create({ name: 'Original', message: 'Oi', segment: { tags: ['vip'] }, coupon: 'ORIG' });
    await approve(c.id);
    const copy = await ctx.agency.post(`/api/campaigns/${c.id}/duplicate`, {});
    assert.equal(copy.status, 201);
    assert.equal(copy.data.name, 'Original (cópia)');
    assert.equal(copy.data.status, 'draft');
    assert.equal(copy.data.coupon, 'ORIG');
    assert.deepEqual(copy.data.segment, { tags: ['vip'], match: 'any' });
    assert.ok(!copy.data.approval);
  });

  it('campanha inexistente', async () => {
    const id = '00000000-0000-4000-8000-000000000000';
    assert.equal((await ctx.agency.get(`/api/campaigns/${id}`)).status, 404);
    assert.equal((await ctx.agency.get('/api/campaigns/nao-existe')).status, 404);
    const put = await ctx.agency.put(`/api/campaigns/${id}`, { name: 'x' });
    assert.equal(put.status, 404);
    assert.equal(put.data.error, 'Campanha não encontrada');
    const start = await ctx.agency.post(`/api/campaigns/${id}/start`, {});
    assert.equal(start.status, 400);
    assert.equal(start.data.error, 'Campanha não encontrada.');
    assert.equal((await ctx.agency.post(`/api/campaigns/${id}/duplicate`, {})).data.error, 'Campanha não encontrada');
  });
});
