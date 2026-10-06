const express = require('express');
const { TemplateService } = require('../services/TemplateService');
const { MessagingProvider } = require('../messaging/MessagingProvider');
const { CAMPAIGN_IDEAS } = require('../ideas');

const slugify = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'restaurante';

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));
const cleanTags = (tags) => [...new Set((Array.isArray(tags) ? tags : String(tags || '').split(','))
  .map((t) => String(t).trim().toLowerCase()).filter(Boolean))];

const RESTAURANT_FIELDS = ['name', 'segment', 'city', 'siteUrl', 'phone', 'audience', 'products', 'goals', 'tone', 'color', 'coupon', 'menu', 'tagline', 'instagram', 'emoji', 'address', 'hours'];
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

  const router = express.Router();
  const wrap = (fn) => (req, res) => Promise.resolve().then(() => fn(req, res)).catch((err) => res.status(err.status || 400).json({ error: err.message }));

  // ── Autenticação ───────────────────────────────────────────
  router.post('/auth/login', (req, res) => {
    const token = auth.login(req.body?.email || '', req.body?.password || '');
    if (!token) return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
    auth.setCookie(res, token);
    return res.json({ ok: true, user: auth.verify(token) });
  });
  router.post('/auth/logout', (req, res) => { auth.clearCookie(res); res.json({ ok: true }); });

  router.use(auth.middleware());
  router.get('/auth/me', (req, res) => res.json({ user: req.user }));

  // ── Tempo real ─────────────────────────────────────────────
  router.get('/events', (req, res) => {
    events.attach(req, res);
    res.write(`event: messaging:status\ndata: ${JSON.stringify(messaging.getStatus())}\n\n`);
  });

  // ── Painel ─────────────────────────────────────────────────
  router.get('/dashboard', (req, res) => {
    res.json(analytics.overview({ restaurantId: req.query.restaurantId || null, days: Number(req.query.days) || 14 }));
  });

  router.get('/meta', (req, res) => {
    res.json({ variables: TemplateService.VARIABLES, ideas: CAMPAIGN_IDEAS, publicUrl: config.publicUrl });
  });

  // ── Restaurantes (Diagnóstico) ─────────────────────────────
  const withCounts = (r) => ({
    ...r,
    contactsCount: repos.contacts.filter((c) => c.restaurantId === r.id).length,
    authorizedCount: repos.contacts.filter((c) => c.restaurantId === r.id && c.optIn && !c.optedOut).length,
    campaignsCount: repos.campaigns.filter((c) => c.restaurantId === r.id).length,
    demoUrl: `${config.publicUrl}/demo/${r.slug}`,
  });

  router.get('/restaurants', (req, res) => {
    res.json(repos.restaurants.all().slice().sort((a, b) => a.name.localeCompare(b.name)).map(withCounts));
  });

  router.get('/restaurants/:id', wrap((req, res) => {
    const r = repos.restaurants.get(req.params.id);
    if (!r) throw Object.assign(new Error('Restaurante não encontrado'), { status: 404 });
    res.json(withCounts(r));
  }));

  const uniqueSlug = (name, ignoreId) => {
    const base = slugify(name);
    let slug = base;
    let i = 2;
    while (repos.restaurants.find((r) => r.slug === slug && r.id !== ignoreId)) slug = `${base}-${i++}`;
    return slug;
  };

  router.post('/restaurants', wrap((req, res) => {
    const data = pick(req.body || {}, RESTAURANT_FIELDS);
    if (!data.name?.trim()) throw new Error('Informe o nome do restaurante.');
    const r = repos.restaurants.create({ color: '#73350c', emoji: '🍽️', menu: [], ...data, slug: uniqueSlug(data.name) });
    res.status(201).json(withCounts(r));
  }));

  router.put('/restaurants/:id', wrap((req, res) => {
    const r = repos.restaurants.get(req.params.id);
    if (!r) throw Object.assign(new Error('Restaurante não encontrado'), { status: 404 });
    const data = pick(req.body || {}, RESTAURANT_FIELDS);
    if (data.name && data.name !== r.name) data.slug = uniqueSlug(data.name, r.id);
    res.json(withCounts(repos.restaurants.update(r, data)));
  }));

  router.delete('/restaurants/:id', wrap((req, res) => {
    const { id } = req.params;
    if (repos.campaigns.find((c) => c.restaurantId === id && ['sending', 'scheduled'].includes(c.status))) {
      throw new Error('Há campanhas em andamento para este restaurante.');
    }
    repos.contacts.removeWhere((c) => c.restaurantId === id);
    repos.messages.removeWhere((m) => m.restaurantId === id);
    repos.conversions.removeWhere((c) => c.restaurantId === id);
    repos.campaigns.removeWhere((c) => c.restaurantId === id);
    repos.restaurants.remove(id);
    res.json({ ok: true });
  }));

  // ── Contatos (base autorizada) ─────────────────────────────
  router.get('/contacts', (req, res) => {
    const { restaurantId, search = '', tag, status } = req.query;
    const q = String(search).toLowerCase();
    const digits = q.replace(/\D/g, '');
    const list = repos.contacts.filter((c) => {
      if (restaurantId && c.restaurantId !== restaurantId) return false;
      if (tag && !(c.tags || []).includes(tag)) return false;
      if (status === 'authorized' && !(c.optIn && !c.optedOut)) return false;
      if (status === 'optedOut' && !c.optedOut) return false;
      if (status === 'pending' && c.optIn) return false;
      if (q && !(c.name || '').toLowerCase().includes(q) && !(digits && c.phone.includes(digits))) return false;
      return true;
    });
    list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    res.json(list);
  });

  router.get('/contacts/tags', (req, res) => {
    const counts = {};
    for (const c of repos.contacts.filter((x) => !req.query.restaurantId || x.restaurantId === req.query.restaurantId)) {
      for (const t of c.tags || []) counts[t] = (counts[t] || 0) + 1;
    }
    res.json(Object.entries(counts).map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count));
  });

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

  router.post('/contacts', wrap((req, res) => {
    const { restaurantId } = req.body || {};
    if (!repos.restaurants.get(restaurantId)) throw new Error('Selecione o restaurante.');
    const data = contactPayload(req.body);
    if (repos.contacts.find((c) => c.restaurantId === restaurantId && c.phone === data.phone)) throw new Error('Este telefone já está na base.');
    res.status(201).json(repos.contacts.create({ restaurantId, ...data, optedOut: false }));
  }));

  router.post('/contacts/import', wrap((req, res) => {
    const { restaurantId, contacts = [], tags = [], optIn = true, optInSource = 'Importação' } = req.body || {};
    if (!repos.restaurants.get(restaurantId)) throw new Error('Selecione o restaurante.');
    const extra = cleanTags(tags);
    const existing = new Map(repos.contacts.filter((c) => c.restaurantId === restaurantId).map((c) => [c.phone, c]));
    const result = { created: 0, updated: 0, invalid: [] };
    const toCreate = [];
    for (const row of contacts) {
      try {
        const data = contactPayload({ ...row, optIn, optInSource });
        data.tags = cleanTags([...data.tags, ...extra]);
        const found = existing.get(data.phone) || toCreate.find((c) => c.phone === data.phone);
        if (found) {
          if (found.id) repos.contacts.update(found, { name: data.name || found.name, tags: cleanTags([...(found.tags || []), ...data.tags]) });
          result.updated += 1;
        } else {
          toCreate.push({ restaurantId, ...data, optedOut: false });
        }
      } catch (err) {
        result.invalid.push({ row, error: err.message });
      }
    }
    repos.contacts.insertMany(toCreate);
    result.created = toCreate.length;
    res.json(result);
  }));

  router.put('/contacts/:id', wrap((req, res) => {
    const c = repos.contacts.get(req.params.id);
    if (!c) throw Object.assign(new Error('Contato não encontrado'), { status: 404 });
    const data = contactPayload({ ...c, ...req.body });
    const patch = { ...data };
    if (req.body.optedOut !== undefined) {
      patch.optedOut = !!req.body.optedOut;
      patch.optedOutAt = req.body.optedOut ? new Date().toISOString() : null;
    }
    res.json(repos.contacts.update(c, patch));
  }));

  router.delete('/contacts/:id', (req, res) => res.json({ ok: repos.contacts.remove(req.params.id) }));

  // ── Campanhas ──────────────────────────────────────────────
  const campaignView = (c) => ({
    ...c,
    restaurant: repos.restaurants.get(c.restaurantId)?.name || '—',
    stats: analytics.campaignStats(c.id),
  });

  router.get('/campaigns', (req, res) => {
    const list = repos.campaigns
      .filter((c) => !req.query.restaurantId || c.restaurantId === req.query.restaurantId)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .map(campaignView);
    res.json(list);
  });

  router.get('/campaigns/:id', wrap((req, res) => {
    const c = repos.campaigns.get(req.params.id);
    if (!c) throw Object.assign(new Error('Campanha não encontrada'), { status: 404 });
    res.json({
      ...campaignView(c),
      audiencePreview: ['draft', 'scheduled'].includes(c.status) ? dispatch.audience(c.restaurantId, c.segment).length : c.audienceSize,
    });
  }));

  router.get('/campaigns/:id/messages', (req, res) => {
    const list = repos.messages
      .filter((m) => m.campaignId === req.params.id)
      .map((m) => dispatch.publicMessage(m));
    res.json(list);
  });

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

  router.post('/campaigns', wrap((req, res) => {
    const data = normalizeCampaign(req.body);
    if (!repos.restaurants.get(data.restaurantId)) throw new Error('Selecione o restaurante.');
    const c = repos.campaigns.create({
      name: 'Nova campanha',
      message: '',
      segment: { tags: [], match: 'any' },
      includeFooter: true,
      ...data,
      status: 'draft',
    });
    res.status(201).json(campaignView(c));
  }));

  router.put('/campaigns/:id', wrap((req, res) => {
    const c = repos.campaigns.get(req.params.id);
    if (!c) throw Object.assign(new Error('Campanha não encontrada'), { status: 404 });
    if (!['draft', 'scheduled'].includes(c.status)) throw new Error('Campanhas já disparadas não podem ser editadas. Duplique-a.');
    res.json(campaignView(repos.campaigns.update(c, normalizeCampaign(req.body))));
  }));

  router.delete('/campaigns/:id', wrap((req, res) => {
    const c = repos.campaigns.get(req.params.id);
    if (c && ['sending', 'paused'].includes(c.status)) throw new Error('Cancele a campanha antes de excluí-la.');
    repos.messages.removeWhere((m) => m.campaignId === req.params.id);
    repos.conversions.removeWhere((x) => x.campaignId === req.params.id);
    repos.campaigns.remove(req.params.id);
    res.json({ ok: true });
  }));

  router.post('/campaigns/:id/duplicate', wrap((req, res) => {
    const c = repos.campaigns.get(req.params.id);
    if (!c) throw new Error('Campanha não encontrada');
    const copy = repos.campaigns.create({
      ...pick(c, CAMPAIGN_FIELDS),
      name: `${c.name} (cópia)`,
      status: 'draft',
    });
    res.status(201).json(campaignView(copy));
  }));

  router.post('/audience/preview', wrap((req, res) => {
    const { restaurantId, segment } = req.body || {};
    const list = dispatch.audience(restaurantId, { tags: cleanTags(segment?.tags), match: segment?.match });
    res.json({ count: list.length, sample: list.slice(0, 5).map((c) => ({ name: c.name, phone: c.phone })) });
  }));

  router.post('/campaigns/:id/start', wrap((req, res) => res.json(campaignView(dispatch.start(req.params.id)))));
  router.post('/campaigns/:id/schedule', wrap((req, res) => res.json(campaignView(dispatch.schedule(req.params.id, req.body?.scheduledAt)))));
  router.post('/campaigns/:id/pause', wrap((req, res) => res.json(campaignView(dispatch.pause(req.params.id)))));
  router.post('/campaigns/:id/resume', wrap((req, res) => res.json(campaignView(dispatch.resume(req.params.id)))));
  router.post('/campaigns/:id/cancel', wrap((req, res) => res.json(campaignView(dispatch.cancel(req.params.id)))));

  router.post('/campaigns/:id/test', wrap(async (req, res) => {
    const c = repos.campaigns.get(req.params.id);
    if (!c) throw new Error('Campanha não encontrada');
    if (!req.body?.phone) throw new Error('Informe o número para teste.');
    const result = await dispatch.sendTest({ campaign: c, phone: req.body.phone });
    res.json({ ok: true, ...result });
  }));

  router.post('/preview', (req, res) => {
    const { restaurantId, message, coupon, includeFooter } = req.body || {};
    const restaurant = repos.restaurants.get(restaurantId);
    const contact = { name: req.body?.sampleName || 'Marina Souza' };
    const text = templates.compose({
      campaign: { message: message || '', coupon, includeFooter },
      contact,
      restaurant,
      link: `${config.publicUrl}/r/exemplo`,
    });
    res.json({ text });
  });

  // ── Mensageria (provedor injetado) ─────────────────────────
  router.get('/messaging/status', (req, res) => res.json({ ...messaging.getStatus(), providers: messaging.listProviders() }));
  router.post('/messaging/start', wrap(async (req, res) => { messaging.start().catch(() => {}); res.json(messaging.getStatus()); }));
  router.post('/messaging/stop', wrap(async (req, res) => { await messaging.stop(); res.json(messaging.getStatus()); }));
  router.post('/messaging/logout', wrap(async (req, res) => { await messaging.logout(); res.json(messaging.getStatus()); }));
  router.post('/messaging/provider', wrap(async (req, res) => {
    if (repos.campaigns.find((c) => c.status === 'sending')) throw new Error('Pause as campanhas em andamento antes de trocar o canal.');
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
  router.delete('/uploads/:file', wrap((req, res) => {
    const url = `/uploads/${req.params.file}`;
    if (repos.campaigns.find((c) => c.mediaUrl === url && ['sending', 'paused', 'scheduled'].includes(c.status))) {
      throw new Error('Esta imagem está em uma campanha em andamento.');
    }
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
  router.get('/settings', (req, res) => res.json(repos.settings.get()));
  router.put('/settings', wrap((req, res) => {
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
    res.json(repos.settings.update(patch));
  }));

  return router;
}

module.exports = { createApi, slugify };
