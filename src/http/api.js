const express = require('express');
const { TemplateService } = require('../services/TemplateService');
const { MessagingProvider } = require('../messaging/MessagingProvider');
const { CAMPAIGN_IDEAS } = require('../ideas');
const { AuthService } = require('../services/AuthService');
const { ReportService } = require('../services/ReportService');

const slugify = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'restaurante';

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));
const cleanTags = (tags) => [...new Set((Array.isArray(tags) ? tags : String(tags || '').split(','))
  .map((t) => String(t).trim().toLowerCase()).filter(Boolean))];
const notFound = (message) => Object.assign(new Error(message), { status: 404 });

/** JSON com chaves em ordem, para comparar conteúdo (o jsonb do PostgreSQL reordena as chaves). */
const stable = (value) => JSON.stringify(value, (_key, v) => (v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
  : v));

const RESTAURANT_FIELDS = ['name', 'segment', 'city', 'siteUrl', 'phone', 'audience', 'products', 'goals', 'tone', 'color', 'coupon', 'menu', 'tagline', 'instagram', 'emoji', 'address', 'hours', 'requireApproval', 'banners', 'logoUrl'];
const CAMPAIGN_FIELDS = ['name', 'restaurantId', 'objective', 'occasion', 'message', 'mediaUrl', 'destinationUrl', 'coupon', 'segment', 'includeFooter', 'cloudTemplate', 'notes'];

/** Rotas autenticadas do painel (/api/*). */
function createApi(container) {
  const repos = container.resolve('repos');
  const auth = container.resolve('auth');
  const messaging = container.resolve('messaging');
  const dispatch = container.resolve('dispatch');
  const analytics = container.resolve('analytics');
  const templates = container.resolve('templates');
  const events = container.resolve('events');
  const config = container.resolve('config');
  const media = container.resolve('media');
  const reports = container.resolve('reports');
  const pdf = container.resolve('pdf');
  const logger = container.resolve('logger');

  const router = express.Router();
  // Códigos SQLSTATE têm 5 caracteres (maiúsculas e dígitos); os códigos da mensageria são minúsculos.
  // Falhas de conexão não trazem SQLSTATE: o Database as marca com err.db
  const isDbError = (err) => typeof err.code === 'string' && /^[0-9A-Z]{5}$/.test(err.code);
  const wrap = (fn) => (req, res) => Promise.resolve().then(() => fn(req, res)).catch((err) => {
    // Falha do banco não mapeada: registra e responde 500 sem expor detalhes
    if (!err.status && (err.db || isDbError(err))) {
      logger.error('[api]', err);
      return res.status(500).json({ error: 'Erro interno. Tente de novo em instantes.' });
    }
    return res.status(err.status || 400).json({ error: err.message });
  });

  // ── Autenticação ───────────────────────────────────────────
  router.post('/auth/login', wrap(async (req, res) => {
    const token = await auth.login(req.body?.email || '', req.body?.password || '');
    if (!token) return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
    auth.setCookie(res, token);
    return res.json({ ok: true, user: auth.verify(token) });
  }));
  router.post('/auth/logout', (req, res) => { auth.clearCookie(res); res.json({ ok: true }); });

  router.use(auth.middleware());

  /*
   * Usuários de restaurante só alcançam estas rotas; dentro delas os dados
   * ficam sempre presos ao restaurante do usuário (ver scopeOf e ownCampaign).
   */
  const RESTAURANT_ROUTES = [
    ['GET', /^\/(auth\/me|events|dashboard|meta|settings|restaurants|campaigns|reports\/months|reports\/monthly|reports\/monthly\.pdf)$/],
    ['GET', /^\/campaigns\/[^/]+(\/messages)?$/],
    ['POST', /^\/campaigns\/[^/]+\/(approve|request-changes)$/],
    ['PUT', /^\/me\/password$/],
  ];
  router.use((req, res, next) => {
    if (req.user.role !== 'restaurant') return next();
    const ok = RESTAURANT_ROUTES.some(([m, re]) => m === req.method && re.test(req.path));
    return ok ? next() : res.status(403).json({ error: 'Seu acesso não permite esta ação.' });
  });
  const isRestaurant = (req) => req.user.role === 'restaurant';
  const scopeOf = (req, fallback) => (isRestaurant(req) ? req.user.restaurantId : (fallback || null));
  const ownCampaign = async (req) => {
    const c = await repos.campaigns.get(req.params.id);
    if (!c || (isRestaurant(req) && c.restaurantId !== req.user.restaurantId)) throw notFound('Campanha não encontrada');
    return c;
  };

  router.get('/auth/me', (req, res) => res.json({ user: req.user }));

  router.put('/me/password', wrap(async (req, res) => {
    if (!isRestaurant(req)) throw new Error('A senha da agência é definida no arquivo .env.');
    const user = await repos.users.get(req.user.userId);
    if (!AuthService.checkPassword(req.body?.current || '', user.passwordHash)) throw new Error('Senha atual incorreta.');
    AuthService.validatePassword(req.body?.password);
    await repos.users.update(user, { passwordHash: AuthService.hashPassword(req.body.password) });
    res.json({ ok: true });
  }));

  // ── Tempo real ─────────────────────────────────────────────
  router.get('/events', (req, res) => {
    events.attach(req, res, { restaurantId: scopeOf(req) });
    if (!isRestaurant(req)) res.write(`event: messaging:status\ndata: ${JSON.stringify(messaging.getStatus())}\n\n`);
  });

  // ── Painel ─────────────────────────────────────────────────
  router.get('/dashboard', wrap(async (req, res) => {
    res.json(await analytics.overview({ restaurantId: scopeOf(req, req.query.restaurantId), days: Number(req.query.days) || 14 }));
  }));

  router.get('/meta', (req, res) => {
    res.json({ variables: TemplateService.VARIABLES, ideas: CAMPAIGN_IDEAS, publicUrl: config.publicUrl });
  });

  // ── Restaurantes (Diagnóstico) ─────────────────────────────
  const ZERO_COUNTS = { contactsCount: 0, authorizedCount: 0, campaignsCount: 0 };
  const withCounts = async (list) => {
    const counts = await repos.restaurants.counts(list.map((r) => r.id));
    return list.map((r) => ({ ...r, ...(counts.get(r.id) || ZERO_COUNTS), demoUrl: `${config.publicUrl}/demo/${r.slug}` }));
  };
  const withCountsOne = async (r) => (await withCounts([r]))[0];

  router.get('/restaurants', wrap(async (req, res) => {
    const list = (await repos.restaurants.all()).filter((r) => !isRestaurant(req) || r.id === req.user.restaurantId);
    res.json(await withCounts(list.sort((a, b) => a.name.localeCompare(b.name))));
  }));

  // ── Acessos dos restaurantes (gerenciados pela agência) ────
  const publicUser = ({ passwordHash, ...u }) => u;

  router.get('/restaurants/:id/users', wrap(async (req, res) => {
    res.json((await repos.users.listByRestaurant(req.params.id)).map(publicUser));
  }));

  router.post('/restaurants/:id/users', wrap(async (req, res) => {
    if (!(await repos.restaurants.get(req.params.id))) throw new Error('Restaurante não encontrado.');
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Informe um e-mail válido.');
    if (email === config.admin.email.toLowerCase() || (await repos.users.byEmail(email))) throw new Error('Este e-mail já tem acesso.');
    AuthService.validatePassword(req.body?.password);
    const user = await repos.users.create({
      restaurantId: req.params.id,
      name: String(req.body?.name || '').trim() || email,
      email,
      role: 'restaurant',
      passwordHash: AuthService.hashPassword(req.body.password),
    });
    res.status(201).json(publicUser(user));
  }));

  router.put('/users/:id/password', wrap(async (req, res) => {
    const user = await repos.users.get(req.params.id);
    if (!user) throw notFound('Usuário não encontrado.');
    AuthService.validatePassword(req.body?.password);
    await repos.users.update(user, { passwordHash: AuthService.hashPassword(req.body.password) });
    res.json({ ok: true });
  }));

  router.delete('/users/:id', wrap(async (req, res) => res.json({ ok: await repos.users.remove(req.params.id) })));

  router.get('/restaurants/:id', wrap(async (req, res) => {
    const r = await repos.restaurants.get(req.params.id);
    if (!r) throw notFound('Restaurante não encontrado');
    res.json(await withCountsOne(r));
  }));

  const uniqueSlug = async (name, ignoreId) => {
    const base = slugify(name);
    let slug = base;
    let i = 2;
    while (await repos.restaurants.slugTaken(slug, ignoreId)) slug = `${base}-${i++}`;
    return slug;
  };

  router.post('/restaurants', wrap(async (req, res) => {
    const data = pick(req.body || {}, RESTAURANT_FIELDS);
    if (!data.name?.trim()) throw new Error('Informe o nome do restaurante.');
    const r = await repos.restaurants.create({ color: '#73350c', emoji: '🍽️', menu: [], ...data, slug: await uniqueSlug(data.name) });
    res.status(201).json(await withCountsOne(r));
  }));

  router.put('/restaurants/:id', wrap(async (req, res) => {
    const r = await repos.restaurants.get(req.params.id);
    if (!r) throw notFound('Restaurante não encontrado');
    const data = pick(req.body || {}, RESTAURANT_FIELDS);
    if (data.name && data.name !== r.name) data.slug = await uniqueSlug(data.name, r.id);
    res.json(await withCountsOne(await repos.restaurants.update(r, data)));
  }));

  router.delete('/restaurants/:id', wrap(async (req, res) => {
    if (await repos.campaigns.hasActive(req.params.id)) throw new Error('Há campanhas em andamento para este restaurante.');
    // Contatos, campanhas, mensagens, pedidos e acessos saem junto (ON DELETE CASCADE)
    await repos.restaurants.remove(req.params.id);
    res.json({ ok: true });
  }));

  // ── Contatos (base autorizada) ─────────────────────────────
  router.get('/contacts', wrap(async (req, res) => {
    const { restaurantId, search = '', tag, status } = req.query;
    const q = String(search).toLowerCase();
    const digits = q.replace(/\D/g, '');
    const list = (await repos.contacts.listByRestaurant({ restaurantId, tag, status }))
      .filter((c) => !q || (c.name || '').toLowerCase().includes(q) || (digits && c.phone.includes(digits)));
    list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    res.json(list);
  }));

  router.get('/contacts/tags', wrap(async (req, res) => {
    res.json(await repos.contacts.tagCounts(req.query.restaurantId));
  }));

  const contactPayload = (body) => {
    const phone = MessagingProvider.normalizePhone(body.phone);
    if (phone.length < 12 || phone.length > 13) throw new Error(`Telefone inválido: ${body.phone || '(vazio)'}`);
    return {
      name: String(body.name || '').trim(),
      phone,
      tags: cleanTags(body.tags),
      optIn: body.optIn !== false,
      optInSource: body.optInSource || 'Cadastro manual',
      notes: body.notes || '',
    };
  };

  router.post('/contacts', wrap(async (req, res) => {
    const { restaurantId } = req.body || {};
    if (!(await repos.restaurants.get(restaurantId))) throw new Error('Selecione o restaurante.');
    const data = contactPayload(req.body);
    if (await repos.contacts.findByPhone(restaurantId, data.phone)) throw new Error('Este telefone já está na base.');
    res.status(201).json(await repos.contacts.create({ restaurantId, ...data, optedOut: false }));
  }));

  router.post('/contacts/import', wrap(async (req, res) => {
    const { restaurantId, contacts = [], tags = [], optIn = true, optInSource = 'Importação' } = req.body || {};
    if (!(await repos.restaurants.get(restaurantId))) throw new Error('Selecione o restaurante.');
    const extra = cleanTags(tags);
    const existing = new Map((await repos.contacts.byRestaurant(restaurantId)).map((c) => [c.phone, c]));
    const result = { created: 0, updated: 0, invalid: [] };
    const toCreate = [];
    const toUpdate = new Map();
    for (const row of contacts) {
      try {
        const data = contactPayload({ ...row, optIn, optInSource });
        data.tags = cleanTags([...data.tags, ...extra]);
        const found = existing.get(data.phone) || toCreate.find((c) => c.phone === data.phone);
        if (found) {
          if (found.id) {
            // Mescla em memória (uma linha repetida mais adiante vê o resultado) e grava no fim
            Object.assign(found, { name: data.name || found.name, tags: cleanTags([...(found.tags || []), ...data.tags]) });
            toUpdate.set(found.id, found);
          }
          result.updated += 1;
        } else {
          toCreate.push({ restaurantId, ...data, optedOut: false });
        }
      } catch (err) {
        result.invalid.push({ row, error: err.message });
      }
    }
    await repos.tx(async (r) => {
      for (const c of toUpdate.values()) await r.contacts.update(c.id, { name: c.name, tags: c.tags });
      await r.contacts.insertMany(toCreate);
    });
    result.created = toCreate.length;
    res.json(result);
  }));

  router.put('/contacts/:id', wrap(async (req, res) => {
    const c = await repos.contacts.get(req.params.id);
    if (!c) throw notFound('Contato não encontrado');
    const data = contactPayload({ ...c, ...req.body });
    const patch = { ...data };
    if (req.body.optedOut !== undefined) {
      patch.optedOut = !!req.body.optedOut;
      patch.optedOutAt = req.body.optedOut ? new Date().toISOString() : null;
    }
    res.json(await repos.contacts.update(c, patch));
  }));

  router.delete('/contacts/:id', wrap(async (req, res) => res.json({ ok: await repos.contacts.remove(req.params.id) })));

  // ── Campanhas ──────────────────────────────────────────────
  const campaignViews = async (list) => {
    const [stats, restaurants] = await Promise.all([analytics.statsForCampaigns(list.map((c) => c.id)), repos.restaurants.all()]);
    const names = new Map(restaurants.map((r) => [r.id, r.name]));
    return list.map((c) => ({ ...c, restaurant: names.get(c.restaurantId) || '—', stats: stats.get(c.id) }));
  };
  const campaignView = async (c) => (await campaignViews([c]))[0];

  router.get('/campaigns', wrap(async (req, res) => {
    const list = (await repos.campaigns.list({ restaurantId: scopeOf(req, req.query.restaurantId) }))
      // o restaurante não vê rascunhos internos da agência, só o que foi para aprovação ou enviado
      .filter((c) => !isRestaurant(req) || c.approval || !['draft'].includes(c.status))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    res.json(await campaignViews(list));
  }));

  router.get('/campaigns/:id', wrap(async (req, res) => {
    const c = await ownCampaign(req);
    const audiencePreview = ['draft', 'scheduled'].includes(c.status) ? (await dispatch.audience(c.restaurantId, c.segment)).length : c.audienceSize;
    res.json({ ...(await campaignView(c)), audiencePreview });
  }));

  router.get('/campaigns/:id/messages', wrap(async (req, res) => {
    const c = await ownCampaign(req);
    res.json((await repos.messages.byCampaign(c.id)).map((m) => dispatch.publicMessage(m)));
  }));

  const normalizeCampaign = (body) => {
    const data = pick(body || {}, CAMPAIGN_FIELDS);
    if (data.segment) data.segment = { tags: cleanTags(data.segment.tags), match: data.segment.match === 'all' ? 'all' : 'any' };
    if (data.cloudTemplate) {
      data.cloudTemplate = data.cloudTemplate.name
        ? { name: String(data.cloudTemplate.name).trim(), language: data.cloudTemplate.language || 'pt_BR', params: (data.cloudTemplate.params || []).filter((p) => p !== '') }
        : null;
    }
    return data;
  };

  router.post('/campaigns', wrap(async (req, res) => {
    const data = normalizeCampaign(req.body);
    if (!(await repos.restaurants.get(data.restaurantId))) throw new Error('Selecione o restaurante.');
    const c = await repos.campaigns.create({
      name: 'Nova campanha',
      message: '',
      segment: { tags: [], match: 'any' },
      includeFooter: true,
      ...data,
      status: 'draft',
    });
    res.status(201).json(await campaignView(c));
  }));

  router.put('/campaigns/:id', wrap(async (req, res) => {
    const c = await repos.campaigns.get(req.params.id);
    if (!c) throw notFound('Campanha não encontrada');
    if (!['draft', 'scheduled'].includes(c.status)) throw new Error('Campanhas já disparadas não podem ser editadas. Duplique-a.');
    const data = normalizeCampaign(req.body);
    if (data.restaurantId !== undefined && !(await repos.restaurants.get(data.restaurantId))) throw new Error('Selecione o restaurante.');
    // Mudou o que o cliente final recebe? Então a aprovação do restaurante deixa de valer.
    const CONTENT = ['message', 'mediaUrl', 'coupon', 'destinationUrl', 'segment', 'includeFooter', 'restaurantId'];
    const changed = CONTENT.some((k) => data[k] !== undefined && stable(data[k]) !== stable(c[k]));
    if (changed && c.approval) {
      data.approval = null;
      data.approvalLog = [...(c.approvalLog || []), { action: 'reset', by: req.user.name, at: new Date().toISOString(), note: 'Conteúdo alterado pela agência' }];
      if (c.status === 'scheduled') { data.status = 'draft'; data.scheduledAt = null; }
    }
    // Só edita a versão que foi lida e ainda não enviada: o disparo ou a alteração de outra pessoa no meio do caminho valem
    const updated = await repos.campaigns.transition(c, ['draft', 'scheduled'], data, { unchangedSince: c.updatedAt ?? null });
    if (!updated) {
      const current = await repos.campaigns.get(c.id);
      if (!current) throw notFound('Campanha não encontrada');
      if (!['draft', 'scheduled'].includes(current.status)) throw new Error('Campanhas já disparadas não podem ser editadas. Duplique-a.');
      throw Object.assign(new Error('A campanha foi alterada por outra pessoa. Recarregue e tente de novo.'), { status: 409 });
    }
    res.json(await campaignView(updated));
  }));

  router.delete('/campaigns/:id', wrap(async (req, res) => {
    const c = await repos.campaigns.get(req.params.id);
    if (c && ['sending', 'paused'].includes(c.status)) throw new Error('Cancele a campanha antes de excluí-la.');
    // Mensagens e pedidos da campanha saem junto (ON DELETE CASCADE)
    await repos.campaigns.remove(req.params.id);
    res.json({ ok: true });
  }));

  router.post('/campaigns/:id/duplicate', wrap(async (req, res) => {
    const c = await repos.campaigns.get(req.params.id);
    if (!c) throw new Error('Campanha não encontrada');
    const copy = await repos.campaigns.create({
      ...pick(c, CAMPAIGN_FIELDS),
      name: `${c.name} (cópia)`,
      status: 'draft',
    });
    res.status(201).json(await campaignView(copy));
  }));

  router.post('/audience/preview', wrap(async (req, res) => {
    const { restaurantId, segment } = req.body || {};
    const list = await dispatch.audience(restaurantId, { tags: cleanTags(segment?.tags), match: segment?.match });
    res.json({ count: list.length, sample: list.slice(0, 5).map((c) => ({ name: c.name, phone: c.phone })) });
  }));

  // ── Aprovação pelo restaurante ─────────────────────────────
  // A entrada do histórico vai sozinha: o banco a acrescenta (setApproval), sem reescrever o que outra pessoa gravou
  const approvalEntry = (entry) => ({ ...entry, at: new Date().toISOString() });
  const publishApproval = (c) => events.publish('approval', { id: c.id, restaurantId: c.restaurantId, name: c.name, approval: c.approval });

  router.post('/campaigns/:id/request-approval', wrap(async (req, res) => {
    const c = await ownCampaign(req);
    if (!['draft', 'scheduled'].includes(c.status)) throw new Error('Só campanhas não enviadas vão para aprovação.');
    if (!c.message?.trim()) throw new Error('Escreva a mensagem antes de pedir aprovação.');
    const saved = await repos.campaigns.setApproval(c, {
      approval: { status: 'pending', requestedAt: new Date().toISOString(), requestedBy: req.user.name },
      entry: approvalEntry({ action: 'requested', by: req.user.name, note: req.body?.note || '' }),
    });
    if (!saved) throw new Error('Só campanhas não enviadas vão para aprovação.');
    publishApproval(c);
    res.json(await campaignView(c));
  }));

  router.post('/campaigns/:id/approve', wrap(async (req, res) => {
    const c = await ownCampaign(req);
    if (c.approval?.status !== 'pending') throw new Error('Esta campanha não está aguardando aprovação.');
    const saved = await repos.campaigns.setApproval(c, {
      approval: { ...c.approval, status: 'approved', decidedAt: new Date().toISOString(), decidedBy: req.user.name, note: req.body?.note || '' },
      entry: approvalEntry({ action: 'approved', by: req.user.name, note: req.body?.note || '' }),
      pendingOnly: true,
    });
    if (!saved) throw new Error('Esta campanha não está aguardando aprovação.');
    publishApproval(c);
    res.json(await campaignView(c));
  }));

  router.post('/campaigns/:id/request-changes', wrap(async (req, res) => {
    const c = await ownCampaign(req);
    if (c.approval?.status !== 'pending') throw new Error('Esta campanha não está aguardando aprovação.');
    const note = String(req.body?.note || '').trim();
    if (!note) throw new Error('Conte o que precisa mudar.');
    const saved = await repos.campaigns.setApproval(c, {
      approval: { ...c.approval, status: 'changes', decidedAt: new Date().toISOString(), decidedBy: req.user.name, note },
      entry: approvalEntry({ action: 'changes', by: req.user.name, note }),
      pendingOnly: true,
    });
    if (!saved) throw new Error('Esta campanha não está aguardando aprovação.');
    publishApproval(c);
    res.json(await campaignView(c));
  }));

  router.post('/campaigns/:id/start', wrap(async (req, res) => res.json(await campaignView(await dispatch.start(req.params.id)))));
  router.post('/campaigns/:id/schedule', wrap(async (req, res) => res.json(await campaignView(await dispatch.schedule(req.params.id, req.body?.scheduledAt)))));
  router.post('/campaigns/:id/pause', wrap(async (req, res) => res.json(await campaignView(await dispatch.pause(req.params.id)))));
  router.post('/campaigns/:id/resume', wrap(async (req, res) => res.json(await campaignView(await dispatch.resume(req.params.id)))));
  router.post('/campaigns/:id/cancel', wrap(async (req, res) => res.json(await campaignView(await dispatch.cancel(req.params.id)))));

  router.post('/campaigns/:id/test', wrap(async (req, res) => {
    const c = await repos.campaigns.get(req.params.id);
    if (!c) throw new Error('Campanha não encontrada');
    if (!req.body?.phone) throw new Error('Informe o número para teste.');
    const result = await dispatch.sendTest({ campaign: c, phone: req.body.phone });
    res.json({ ok: true, ...result });
  }));

  router.post('/preview', wrap(async (req, res) => {
    const { restaurantId, message, coupon, includeFooter } = req.body || {};
    const restaurant = await repos.restaurants.get(restaurantId);
    const contact = { name: req.body?.sampleName || 'Marina Souza' };
    const text = templates.compose({
      campaign: { message: message || '', coupon, includeFooter },
      contact,
      restaurant,
      link: `${config.publicUrl}/r/exemplo`,
    });
    res.json({ text });
  }));

  // ── Mensageria (provedor injetado) ─────────────────────────
  router.get('/messaging/status', (req, res) => res.json({ ...messaging.getStatus(), providers: messaging.listProviders() }));
  router.post('/messaging/start', wrap(async (req, res) => { messaging.start().catch(() => {}); res.json(messaging.getStatus()); }));
  router.post('/messaging/stop', wrap(async (req, res) => { await messaging.stop(); res.json(messaging.getStatus()); }));
  router.post('/messaging/logout', wrap(async (req, res) => { await messaging.logout(); res.json(messaging.getStatus()); }));
  router.post('/messaging/provider', wrap(async (req, res) => {
    if (await repos.campaigns.anySending()) throw new Error('Pause as campanhas em andamento antes de trocar o canal.');
    await messaging.use(req.body?.provider);
    res.json({ ...messaging.getStatus(), providers: messaging.listProviders() });
  }));
  router.post('/messaging/test', wrap(async (req, res) => {
    const { phone, text, mediaUrl } = req.body || {};
    if (!phone) throw new Error('Informe o número.');
    res.json(await messaging.send({ to: phone, text: text || 'Olá! Esta é uma mensagem de teste da Studio Coral.', media: media.resolve(mediaUrl) }));
  }));

  // ── Imagens ────────────────────────────────────────────────
  router.get('/uploads', (req, res) => res.json(media.list().map(({ path: _p, ...m }) => m)));
  router.post('/uploads', wrap((req, res) => {
    const { path: _p, ...info } = media.save(req.body || {});
    res.status(201).json(info);
  }));
  router.delete('/uploads/:file', wrap(async (req, res) => {
    if (await repos.campaigns.mediaInUse(`/uploads/${req.params.file}`)) throw new Error('Esta imagem está em uma campanha em andamento.');
    media.remove(req.params.file);
    res.json({ ok: true });
  }));
  router.get('/messaging/outbox', (req, res) => {
    const sim = messaging.provider('simulator');
    res.json(sim ? sim.getOutbox() : []);
  });
  router.post('/messaging/simulate-reply', wrap((req, res) => {
    const sim = messaging.provider('simulator');
    if (!sim) throw new Error('Simulador indisponível.');
    sim.simulateIncoming(req.body?.from, req.body?.body || 'SAIR');
    res.json({ ok: true });
  }));

  // ── Configurações ──────────────────────────────────────────
  router.get('/settings', (req, res) => {
    const s = repos.settings.get();
    res.json(isRestaurant(req) ? { footer: s.footer } : s);
  });

  // ── Relatório mensal ───────────────────────────────────────
  const reportScope = (req) => {
    const restaurantId = scopeOf(req, req.query.restaurantId);
    if (!restaurantId) throw new Error('Escolha o restaurante.');
    return restaurantId;
  };
  router.get('/reports/months', wrap(async (req, res) => res.json(await reports.availableMonths(reportScope(req)))));
  router.get('/reports/monthly', wrap(async (req, res) => {
    res.json(await reports.monthly({ restaurantId: reportScope(req), month: req.query.month || ReportService.currentMonth() }));
  }));
  router.get('/reports/monthly.pdf', wrap(async (req, res) => {
    const restaurantId = reportScope(req);
    const month = req.query.month || ReportService.currentMonth();
    const report = await reports.monthly({ restaurantId, month }); // valida antes de abrir o navegador
    const file = await pdf.render(`/relatorio?restaurantId=${restaurantId}&month=${month}&print=1`, req.user);
    const { slug } = await repos.restaurants.get(restaurantId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="relatorio-${slug}-${month}.pdf"`);
    res.end(file);
    return report;
  }));
  router.put('/settings', wrap(async (req, res) => {
    const b = req.body || {};
    const patch = {};
    if (b.minDelaySeconds !== undefined) patch.minDelaySeconds = Math.max(1, Number(b.minDelaySeconds) || 1);
    if (b.maxDelaySeconds !== undefined) patch.maxDelaySeconds = Math.max(patch.minDelaySeconds || 1, Number(b.maxDelaySeconds) || 1);
    if (b.dailyLimit !== undefined) patch.dailyLimit = Math.max(1, Number(b.dailyLimit) || 1);
    if (b.businessHoursOnly !== undefined) patch.businessHoursOnly = !!b.businessHoursOnly;
    if (b.businessHours) patch.businessHours = { start: b.businessHours.start || '09:00', end: b.businessHours.end || '21:00' };
    if (b.optOutKeywords) patch.optOutKeywords = cleanTags(b.optOutKeywords);
    if (b.optOutReply !== undefined) patch.optOutReply = String(b.optOutReply);
    if (b.footer !== undefined) patch.footer = String(b.footer);
    res.json(await repos.settings.update(patch));
  }));

  return router;
}

module.exports = { createApi, slugify };
