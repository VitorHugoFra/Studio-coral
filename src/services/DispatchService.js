const crypto = require('crypto');
const { MessagingProvider } = require('../messaging/MessagingProvider');

const RANK = { queued: 0, sending: 1, sent: 2, delivered: 3, read: 4 };
const ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const normalizeText = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const today = () => new Date().toISOString().slice(0, 10);

/** Chave de comparação de telefone: DDD + últimos 8 dígitos (ignora o 9º dígito). */
const phoneKey = (phone) => {
  const n = MessagingProvider.normalizePhone(phone).replace(/^55/, '');
  return n.length >= 10 ? `${n.slice(0, 2)}${n.slice(-8)}` : n;
};

/**
 * Fila de disparo das campanhas.
 *
 * Depende apenas do contrato de mensageria (injeção de dependência): não sabe
 * se o envio vai pelo WPPConnect, pela API Oficial ou pelo simulador.
 * Um envio por vez, com intervalo aleatório entre mensagens, limite diário e
 * janela de horário — boas práticas para proteger o número do restaurante.
 */
class DispatchService {
  constructor({ repos, messaging, templates, media, events, config, logger = console }) {
    this.repos = repos;
    this.messaging = messaging;
    this.templates = templates;
    this.media = media;
    this.events = events;
    this.config = config;
    this.logger = logger;
    this.timer = null;
    this.busy = false;
  }

  init() {
    this.messaging.on('ack', (e) => this.handleAck(e));
    this.messaging.on('incoming', (e) => this.handleIncoming(e).catch((err) => this.logger.error(err)));
    this.messaging.on('status', (s) => {
      this.events.publish('messaging:status', s);
      if (s.state === 'connected') this.kick();
    });
    this.messaging.on('outbox', (item) => this.events.publish('outbox', item));

    // Mensagens que estavam "enviando" quando o servidor caiu voltam para a fila
    for (const m of this.repos.messages.filter((x) => x.status === 'sending')) {
      this.repos.messages.update(m, { status: 'queued' });
    }
    this.scheduleTimer = setInterval(() => this.checkSchedules(), 15000).unref();
    this.checkSchedules();
    this.kick();
  }

  /** Para a fila e os agendamentos (desligamento do servidor e testes). */
  stop() {
    this.stopped = true;
    clearInterval(this.scheduleTimer);
    clearTimeout(this.timer);
    this.timer = null;
  }

  // ── Público-alvo ───────────────────────────────────────────

  audience(restaurantId, segment = {}) {
    const tags = (segment.tags || []).filter(Boolean);
    const match = segment.match === 'all' ? 'all' : 'any';
    return this.repos.contacts.filter((c) => {
      if (c.restaurantId !== restaurantId || !c.optIn || c.optedOut) return false;
      if (!tags.length) return true;
      const has = (t) => (c.tags || []).includes(t);
      return match === 'all' ? tags.every(has) : tags.some(has);
    });
  }

  // ── Ciclo de vida da campanha ──────────────────────────────

  newCode() {
    for (;;) {
      const bytes = crypto.randomBytes(6);
      const code = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
      if (!this.repos.messages.by('code', code)) return code;
    }
  }

  trackingLink(code) {
    return `${this.config.publicUrl}/r/${code}`;
  }

  start(campaignId) {
    const campaign = this.mustGet(campaignId);
    if (!['draft', 'scheduled'].includes(campaign.status)) throw new Error('Esta campanha já foi iniciada.');
    if (!campaign.message?.trim()) throw new Error('Escreva a mensagem antes de disparar.');
    const restaurant = this.repos.restaurants.get(campaign.restaurantId);
    if (!restaurant) throw new Error('Restaurante não encontrado.');
    this.assertApproved(campaign, restaurant);

    const contacts = this.audience(campaign.restaurantId, campaign.segment);
    if (!contacts.length) throw new Error('Nenhum contato autorizado corresponde a esta segmentação.');

    const at = new Date().toISOString();
    this.repos.messages.insertMany(
      contacts.map((c) => ({
        campaignId: campaign.id,
        restaurantId: campaign.restaurantId,
        contactId: c.id,
        name: c.name,
        phone: c.phone,
        demo: !!c.demo,
        code: this.newCode(),
        status: 'queued',
        queuedAt: at,
        clicks: 0,
      })),
    );
    this.repos.campaigns.update(campaign, {
      status: 'sending',
      startedAt: at,
      audienceSize: contacts.length,
      provider: this.messaging.key,
      waitingReason: null,
    });
    this.publishProgress(campaign.id);
    this.kick();
    return campaign;
  }

  schedule(campaignId, when) {
    const campaign = this.mustGet(campaignId);
    if (!['draft', 'scheduled'].includes(campaign.status)) throw new Error('Esta campanha já foi iniciada.');
    this.assertApproved(campaign, this.repos.restaurants.get(campaign.restaurantId));
    const date = new Date(when);
    if (Number.isNaN(date.getTime()) || date.getTime() < Date.now() - 60000) throw new Error('Escolha uma data futura.');
    this.repos.campaigns.update(campaign, { status: 'scheduled', scheduledAt: date.toISOString() });
    this.publishProgress(campaign.id);
    return campaign;
  }

  pause(campaignId) {
    const c = this.mustGet(campaignId);
    if (c.status !== 'sending') throw new Error('Só é possível pausar campanhas em andamento.');
    this.repos.campaigns.update(c, { status: 'paused' });
    this.publishProgress(c.id);
    return c;
  }

  resume(campaignId) {
    const c = this.mustGet(campaignId);
    if (c.status !== 'paused') throw new Error('A campanha não está pausada.');
    this.repos.campaigns.update(c, { status: 'sending' });
    this.publishProgress(c.id);
    this.kick();
    return c;
  }

  cancel(campaignId) {
    const c = this.mustGet(campaignId);
    if (['completed', 'canceled'].includes(c.status)) throw new Error('A campanha já foi encerrada.');
    if (c.status === 'scheduled' || c.status === 'draft') {
      this.repos.campaigns.update(c, { status: 'draft', scheduledAt: null });
    } else {
      for (const m of this.repos.messages.filter((x) => x.campaignId === c.id && x.status === 'queued')) {
        this.repos.messages.update(m, { status: 'skipped', error: 'Campanha cancelada' });
      }
      this.repos.campaigns.update(c, { status: 'canceled', completedAt: new Date().toISOString() });
    }
    this.publishProgress(c.id);
    return c;
  }

  checkSchedules() {
    const due = this.repos.campaigns.filter((c) => c.status === 'scheduled' && new Date(c.scheduledAt) <= new Date());
    for (const c of due) {
      try {
        this.repos.campaigns.update(c, { status: 'draft' });
        this.start(c.id);
      } catch (err) {
        this.repos.campaigns.update(c, { status: 'draft', lastError: err.message });
        this.publishProgress(c.id);
      }
    }
  }

  /** Restaurantes com aprovação ligada só recebem campanhas aprovadas por eles. */
  assertApproved(campaign, restaurant) {
    if (restaurant?.requireApproval !== false && campaign.approval?.status !== 'approved') {
      throw new Error('Esta campanha precisa ser aprovada pelo restaurante antes do envio.');
    }
  }

  // ── Worker ─────────────────────────────────────────────────

  kick(delay = 50) {
    if (this.busy || this.stopped) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.tick(), delay);
  }

  async tick() {
    this.timer = null;
    this.busy = true;
    let next = null;
    try {
      next = await this.step();
    } catch (err) {
      this.logger.error('[dispatch]', err);
      next = 5000;
    } finally {
      this.busy = false;
    }
    if (next !== null && !this.stopped) this.timer = setTimeout(() => this.tick(), next);
  }

  setWaiting(campaigns, reason) {
    for (const c of campaigns) {
      if (c.waitingReason !== reason) {
        this.repos.campaigns.update(c, { waitingReason: reason });
        this.publishProgress(c.id);
      }
    }
  }

  withinBusinessHours(settings) {
    if (!settings.businessHoursOnly) return true;
    const hhmm = new Date().toTimeString().slice(0, 5);
    return hhmm >= settings.businessHours.start && hhmm <= settings.businessHours.end;
  }

  /** Processa uma mensagem. Retorna em quantos ms rodar novamente (ou null se a fila acabou). */
  async step() {
    const active = this.repos.campaigns
      .filter((c) => c.status === 'sending')
      .sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
    if (!active.length) return null;

    const settings = this.repos.settings.get();
    if (!this.messaging.isConnected()) {
      this.setWaiting(active, 'Aguardando conexão com o WhatsApp');
      return 5000;
    }
    if (!this.withinBusinessHours(settings)) {
      this.setWaiting(active, `Fora do horário de envio (${settings.businessHours.start}–${settings.businessHours.end})`);
      return 60000;
    }
    const sentToday = this.repos.messages.filter((m) => m.sentAt && m.sentAt.slice(0, 10) === today()).length;
    if (sentToday >= settings.dailyLimit) {
      this.setWaiting(active, `Limite diário de ${settings.dailyLimit} envios atingido`);
      return 60000;
    }

    let message = null;
    let campaign = null;
    for (const c of active) {
      message = this.repos.messages.find((m) => m.campaignId === c.id && m.status === 'queued');
      if (message) { campaign = c; break; }
      this.complete(c);
    }
    if (!message) return null;
    if (campaign.waitingReason) this.repos.campaigns.update(campaign, { waitingReason: null });

    const sent = await this.deliver(campaign, message);
    if (!this.repos.messages.find((m) => m.campaignId === campaign.id && m.status === 'queued')) this.complete(campaign);

    if (!sent) return 300; // ignorada/falhou sem tocar no WhatsApp: segue rápido
    const simulator = this.messaging.key === 'simulator';
    const pace = this.config.simulatorPace || { min: 0.8, max: 2.2 };
    const min = simulator ? pace.min : settings.minDelaySeconds;
    const max = simulator ? pace.max : Math.max(settings.maxDelaySeconds, settings.minDelaySeconds);
    return Math.round((min + Math.random() * (max - min)) * 1000);
  }

  complete(campaign) {
    if (campaign.status !== 'sending') return;
    this.repos.campaigns.update(campaign, { status: 'completed', completedAt: new Date().toISOString(), waitingReason: null });
    this.publishProgress(campaign.id);
  }

  async deliver(campaign, message) {
    const contact = this.repos.contacts.get(message.contactId);
    const restaurant = this.repos.restaurants.get(campaign.restaurantId);

    if (!contact || contact.optedOut || !contact.optIn) {
      this.updateMessage(message, { status: 'skipped', error: 'Contato descadastrado' });
      return false;
    }
    if (contact.demo && this.messaging.key !== 'simulator') {
      this.updateMessage(message, { status: 'skipped', error: 'Contato fictício (só é enviado no simulador)' });
      return false;
    }

    const link = this.trackingLink(message.code);
    const text = this.templates.compose({ campaign, contact, restaurant, link });
    const vars = this.templates.buildVars({ contact, restaurant, campaign, link });
    const template = campaign.cloudTemplate?.name
      ? { ...campaign.cloudTemplate, params: this.templates.templateParams(campaign, vars) }
      : undefined;

    this.updateMessage(message, { status: 'sending', text });
    try {
      const media = this.media.resolve(campaign.mediaUrl);
      const res = await this.messaging.send({ to: contact.phone, text, media, template });
      this.updateMessage(message, {
        status: RANK[message.status] > RANK.sent ? message.status : 'sent',
        provider: this.messaging.key,
        providerMessageId: res.providerMessageId,
        sentAt: new Date().toISOString(),
        error: null,
      });
    } catch (err) {
      this.updateMessage(message, { status: 'failed', error: err.message, failedAt: new Date().toISOString() });
    }
    return true;
  }

  updateMessage(message, patch) {
    this.repos.messages.update(message, patch);
    this.events.publish('message:update', this.publicMessage(message));
    this.publishProgress(message.campaignId);
  }

  publicMessage(m) {
    const { text, ...rest } = m;
    return { ...rest, preview: text ? text.slice(0, 160) : null };
  }

  // ── Confirmações e respostas ───────────────────────────────

  handleAck({ providerMessageId, status, error }) {
    const message = this.repos.messages.by('providerMessageId', providerMessageId);
    if (!message) return;
    const at = new Date().toISOString();
    if (status === 'failed') {
      this.updateMessage(message, { status: 'failed', error: error || 'Falha reportada pelo WhatsApp', failedAt: at });
      return;
    }
    if ((RANK[status] ?? -1) <= (RANK[message.status] ?? -1)) return;
    const patch = { status };
    if (status === 'delivered' || status === 'read') patch.deliveredAt = message.deliveredAt || at;
    if (status === 'read') patch.readAt = at;
    this.updateMessage(message, patch);
  }

  async handleIncoming({ from, body }) {
    const key = phoneKey(from);
    const contacts = this.repos.contacts.filter((c) => phoneKey(c.phone) === key);
    const settings = this.repos.settings.get();
    const text = normalizeText(body);
    const isOptOut = settings.optOutKeywords.map(normalizeText).includes(text);
    const at = new Date().toISOString();

    if (isOptOut) {
      contacts.forEach((c) => this.repos.contacts.update(c, { optedOut: true, optedOutAt: at }));
      if (settings.optOutReply) {
        await this.messaging.send({ to: from, text: settings.optOutReply }).catch(() => {});
      }
    }

    const last = this.repos.messages
      .filter((m) => phoneKey(m.phone) === key && m.sentAt)
      .sort((a, b) => b.sentAt.localeCompare(a.sentAt))[0];
    if (last && !last.repliedAt) this.updateMessage(last, { repliedAt: at, reply: String(body).slice(0, 280), optOut: isOptOut });

    this.events.publish('incoming', { from, body, optOut: isOptOut, contacts: contacts.map((c) => c.name) });
  }

  // ── Teste ──────────────────────────────────────────────────

  async sendTest({ campaign, phone }) {
    const restaurant = this.repos.restaurants.get(campaign.restaurantId);
    const destination = this.destinationFor(campaign, restaurant);
    const link = `${destination}${destination.includes('?') ? '&' : '?'}utm_source=whatsapp&utm_medium=teste`;
    const contact = { name: 'Cliente Teste', phone };
    const text = `🧪 *TESTE*\n\n${this.templates.compose({ campaign, contact, restaurant, link })}`;
    const vars = this.templates.buildVars({ contact, restaurant, campaign, link });
    const template = campaign.cloudTemplate?.name
      ? { ...campaign.cloudTemplate, params: this.templates.templateParams(campaign, vars) }
      : undefined;
    return this.messaging.send({ to: phone, text, media: this.media.resolve(campaign.mediaUrl), template });
  }

  destinationFor(campaign, restaurant) {
    const url = campaign?.destinationUrl || restaurant?.siteUrl;
    if (url) return url;
    return `${this.config.publicUrl}/demo/${restaurant?.slug || ''}`;
  }

  // ── Utilidades ─────────────────────────────────────────────

  mustGet(id) {
    const c = this.repos.campaigns.get(id);
    if (!c) throw new Error('Campanha não encontrada.');
    return c;
  }

  publishProgress(campaignId) {
    const campaign = this.repos.campaigns.get(campaignId);
    if (!campaign) return;
    this.events.publish('campaign:progress', { id: campaignId, restaurantId: campaign.restaurantId, status: campaign.status, waitingReason: campaign.waitingReason || null });
  }
}

module.exports = { DispatchService, phoneKey };
