const crypto = require('crypto');
const { MessagingProvider } = require('../messaging/MessagingProvider');

const ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const normalizeText = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
/** Meia-noite (UTC) de hoje: o limite diário conta os envios desde então. */
const startOfTodayUtc = () => `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;

/** Chave de comparação de telefone: DDD + últimos 8 dígitos (ignora o 9º dígito). */
const phoneKey = (phone) => MessagingProvider.phoneKey(phone);

/**
 * Fila de disparo das campanhas.
 *
 * Depende apenas do contrato de mensageria (injeção de dependência): não sabe
 * se o envio vai pelo WPPConnect, pela API Oficial ou pelo simulador.
 * Um envio por vez, com intervalo aleatório entre mensagens, limite diário e
 * janela de horário — boas práticas para proteger o número do restaurante.
 * As mudanças de estado são atômicas no banco (reserva da mensagem, status
 * que nunca volta, conclusão que respeita uma pausa).
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
    this.rekick = false;
    this.stopped = false;
    this.checking = false;
    this.pending = new Set();
  }

  async init() {
    this.messaging.on('ack', (e) => this.track(this.handleAck(e)));
    this.messaging.on('incoming', (e) => this.track(this.handleIncoming(e)));
    this.messaging.on('status', (s) => {
      this.events.publish('messaging:status', s);
      if (s.state === 'connected') this.kick();
    });
    this.messaging.on('outbox', (item) => this.events.publish('outbox', item));

    // Mensagens que estavam "enviando" quando o servidor caiu voltam para a fila
    await this.repos.messages.requeueSending();
    this.scheduleTimer = setInterval(() => this.track(this.checkSchedules()), 15000).unref();
    await this.checkSchedules();
    this.kick();
  }

  /** Acompanha tarefas em segundo plano (confirmações, respostas) e registra os erros. */
  track(promise) {
    const task = Promise.resolve(promise).catch((err) => this.logger.error('[dispatch]', err));
    this.pending.add(task);
    task.finally(() => this.pending.delete(task));
    return task;
  }

  /** Para a fila e os agendamentos (desligamento do servidor e testes). */
  stop() {
    this.stopped = true;
    clearInterval(this.scheduleTimer);
    clearTimeout(this.timer);
    this.timer = null;
  }

  /** Espera o passo atual e as tarefas em andamento (antes de fechar o banco). */
  async idle() {
    while (this.busy || this.pending.size) {
      await Promise.all([...this.pending]);
      if (this.busy) await new Promise((r) => { setTimeout(r, 10); });
    }
  }

  // ── Público-alvo ───────────────────────────────────────────

  audience(restaurantId, segment = {}) {
    return this.repos.contacts.audience(restaurantId, segment);
  }

  // ── Ciclo de vida da campanha ──────────────────────────────

  newCode() {
    const bytes = crypto.randomBytes(6);
    return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
  }

  trackingLink(code) {
    return `${this.config.publicUrl}/r/${code}`;
  }

  async start(campaignId) {
    const campaign = await this.mustGet(campaignId);
    if (!['draft', 'scheduled'].includes(campaign.status)) throw new Error('Esta campanha já foi iniciada.');
    if (!campaign.message?.trim()) throw new Error('Escreva a mensagem antes de disparar.');
    const restaurant = await this.repos.restaurants.get(campaign.restaurantId);
    if (!restaurant) throw new Error('Restaurante não encontrado.');
    this.assertApproved(campaign, restaurant);

    const contacts = await this.audience(campaign.restaurantId, campaign.segment);
    if (!contacts.length) throw new Error('Nenhum contato autorizado corresponde a esta segmentação.');

    const at = new Date().toISOString();
    const queue = contacts.map((c) => ({
      campaignId: campaign.id,
      restaurantId: campaign.restaurantId,
      contactId: c.id,
      name: c.name,
      phone: c.phone,
      demo: !!c.demo,
      status: 'queued',
      queuedAt: at,
      clicks: 0,
    }));
    // A fila e o novo status entram juntos. Se um código de link colidir
    // (índice único), a transação é desfeita e refeita com códigos novos.
    for (let attempt = 1; ; attempt += 1) {
      try {
        await this.repos.tx(async (r) => {
          const moved = await r.campaigns.transition(campaign, ['draft', 'scheduled'], {
            status: 'sending',
            startedAt: at,
            audienceSize: contacts.length,
            provider: this.messaging.key,
            waitingReason: null,
          });
          if (!moved) throw new Error('Esta campanha já foi iniciada.');
          await r.messages.insertMany(queue.map((m) => ({ ...m, code: this.newCode() })));
        });
        break;
      } catch (err) {
        if (err.constraint !== 'messages_code_key' || attempt >= 3) throw err;
      }
    }
    this.publishProgress(campaign);
    this.kick();
    return campaign;
  }

  async schedule(campaignId, when) {
    const campaign = await this.mustGet(campaignId);
    if (!['draft', 'scheduled'].includes(campaign.status)) throw new Error('Esta campanha já foi iniciada.');
    this.assertApproved(campaign, await this.repos.restaurants.get(campaign.restaurantId));
    const date = new Date(when);
    if (Number.isNaN(date.getTime()) || date.getTime() < Date.now() - 60000) throw new Error('Escolha uma data futura.');
    // Mudanças de status são condicionais: se outro pedido já mexeu na campanha (ex.: o disparo começou), este perde
    if (!(await this.repos.campaigns.transition(campaign, ['draft', 'scheduled'], { status: 'scheduled', scheduledAt: date.toISOString() }))) {
      throw new Error('Esta campanha já foi iniciada.');
    }
    this.publishProgress(campaign);
    return campaign;
  }

  async pause(campaignId) {
    const c = await this.mustGet(campaignId);
    if (c.status !== 'sending') throw new Error('Só é possível pausar campanhas em andamento.');
    if (!(await this.repos.campaigns.transition(c, ['sending'], { status: 'paused' }))) throw new Error('Só é possível pausar campanhas em andamento.');
    this.publishProgress(c);
    return c;
  }

  async resume(campaignId) {
    const c = await this.mustGet(campaignId);
    if (c.status !== 'paused') throw new Error('A campanha não está pausada.');
    if (!(await this.repos.campaigns.transition(c, ['paused'], { status: 'sending' }))) throw new Error('A campanha não está pausada.');
    this.publishProgress(c);
    this.kick();
    return c;
  }

  async cancel(campaignId) {
    const c = await this.mustGet(campaignId);
    if (['completed', 'canceled'].includes(c.status)) throw new Error('A campanha já foi encerrada.');
    if (c.status === 'scheduled' || c.status === 'draft') {
      if (!(await this.repos.campaigns.transition(c, ['draft', 'scheduled'], { status: 'draft', scheduledAt: null }))) throw new Error('A campanha já foi encerrada.');
    } else {
      // O status muda primeiro: se a campanha acabou de concluir, o pedido é recusado sem mexer na fila
      if (!(await this.repos.campaigns.transition(c, ['sending', 'paused'], { status: 'canceled', completedAt: new Date().toISOString() }))) throw new Error('A campanha já foi encerrada.');
      await this.repos.messages.skipQueued(c.id, 'Campanha cancelada');
    }
    this.publishProgress(c);
    return c;
  }

  async checkSchedules() {
    if (this.checking) return;
    this.checking = true;
    try {
      const due = await this.repos.campaigns.dueScheduled(new Date().toISOString());
      for (const c of due) {
        try {
          await this.start(c.id);
        } catch (err) {
          // Só volta para rascunho se ainda estiver agendada (não desfaz um envio que começou)
          if (await this.repos.campaigns.transition(c, ['scheduled'], { status: 'draft', lastError: err.message })) this.publishProgress(c);
        }
      }
    } finally {
      this.checking = false;
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
    if (this.stopped) return;
    // Pedido durante um passo em andamento: o passo roda de novo ao terminar (não se perde)
    if (this.busy) { this.rekick = true; return; }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.tick(), delay);
  }

  async tick() {
    this.timer = null;
    if (this.stopped) return;
    this.busy = true;
    this.rekick = false;
    let next = null;
    try {
      next = await this.step();
    } catch (err) {
      this.logger.error('[dispatch]', err);
      next = 5000;
    } finally {
      this.busy = false;
    }
    if (this.rekick && next === null) next = 50;
    this.rekick = false;
    if (next !== null && !this.stopped) this.timer = setTimeout(() => this.tick(), next);
  }

  async setWaiting(campaigns, reason) {
    for (const c of campaigns) {
      if (c.waitingReason !== reason) {
        await this.repos.campaigns.update(c, { waitingReason: reason });
        this.publishProgress(c);
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
    const active = await this.repos.campaigns.byStatus('sending');
    if (!active.length) return null;

    const settings = this.repos.settings.get();
    if (!this.messaging.isConnected()) {
      await this.setWaiting(active, 'Aguardando conexão com o WhatsApp');
      return 5000;
    }
    if (!this.withinBusinessHours(settings)) {
      await this.setWaiting(active, `Fora do horário de envio (${settings.businessHours.start}–${settings.businessHours.end})`);
      return 60000;
    }
    if ((await this.repos.messages.countSentSince(startOfTodayUtc())) >= settings.dailyLimit) {
      await this.setWaiting(active, `Limite diário de ${settings.dailyLimit} envios atingido`);
      return 60000;
    }

    let message = null;
    let campaign = null;
    for (const c of active) {
      message = await this.repos.messages.claimNext(c.id);
      if (message) { campaign = c; break; }
      await this.complete(c);
    }
    if (!message) return null;
    if (campaign.waitingReason) await this.repos.campaigns.update(campaign, { waitingReason: null });

    const sent = await this.deliver(campaign, message);
    if (!(await this.repos.messages.hasQueued(campaign.id))) await this.complete(campaign);

    if (!sent) return 300; // ignorada/falhou sem tocar no WhatsApp: segue rápido
    const simulator = this.messaging.key === 'simulator';
    const pace = this.config.simulatorPace || { min: 0.8, max: 2.2 };
    const min = simulator ? pace.min : settings.minDelaySeconds;
    const max = simulator ? pace.max : Math.max(settings.maxDelaySeconds, settings.minDelaySeconds);
    return Math.round((min + Math.random() * (max - min)) * 1000);
  }

  async complete(campaign) {
    if (campaign.status !== 'sending') return;
    // Só conclui se ainda estiver enviando: uma pausa no meio do caminho vale
    const done = await this.repos.campaigns.transition(campaign, ['sending'], { status: 'completed', completedAt: new Date().toISOString(), waitingReason: null });
    if (done) this.publishProgress(campaign);
  }

  async deliver(campaign, message) {
    const [contact, restaurant] = await Promise.all([
      this.repos.contacts.get(message.contactId),
      this.repos.restaurants.get(campaign.restaurantId),
    ]);

    if (!contact || contact.optedOut || !contact.optIn) {
      await this.updateMessage(campaign, message, { status: 'skipped', error: 'Contato descadastrado' });
      return false;
    }
    if (contact.demo && this.messaging.key !== 'simulator') {
      await this.updateMessage(campaign, message, { status: 'skipped', error: 'Contato fictício (só é enviado no simulador)' });
      return false;
    }

    const link = this.trackingLink(message.code);
    const text = this.templates.compose({ campaign, contact, restaurant, link });
    const vars = this.templates.buildVars({ contact, restaurant, campaign, link });
    const template = campaign.cloudTemplate?.name
      ? { ...campaign.cloudTemplate, params: this.templates.templateParams(campaign, vars) }
      : undefined;

    await this.updateMessage(campaign, message, { status: 'sending', text });
    try {
      const media = this.media.resolve(campaign.mediaUrl);
      const res = await this.messaging.send({ to: contact.phone, text, media, template });
      const sent = await this.repos.messages.markSent(message.id, {
        provider: this.messaging.key,
        providerMessageId: res.providerMessageId,
        sentAt: new Date().toISOString(),
      });
      this.publishMessage(campaign, sent || message);
    } catch (err) {
      await this.updateMessage(campaign, message, { status: 'failed', error: err.message, failedAt: new Date().toISOString() });
    }
    return true;
  }

  async updateMessage(campaign, message, patch) {
    const updated = await this.repos.messages.update(message, patch);
    this.publishMessage(campaign, updated || message);
  }

  publishMessage(campaign, message) {
    this.events.publish('message:update', this.publicMessage(message));
    this.publishProgress(campaign);
  }

  publicMessage(m) {
    const { text, ...rest } = m;
    return { ...rest, preview: text ? text.slice(0, 160) : null };
  }

  // ── Confirmações e respostas ───────────────────────────────

  async handleAck({ providerMessageId, status, error }, attempt = 1) {
    const at = new Date().toISOString();
    const message = status === 'failed'
      ? await this.repos.messages.markFailedByProvider(providerMessageId, error || 'Falha reportada pelo WhatsApp', at)
      : await this.repos.messages.applyAck(providerMessageId, status, at);
    if (message) {
      this.events.publish('message:update', this.publicMessage(message));
      await this.publishProgressById(message.campaignId);
      return;
    }
    // A confirmação pode chegar antes de o envio ser gravado: tenta de novo em instantes
    if (attempt < 4 && !this.stopped && !(await this.repos.messages.byProviderId(providerMessageId))) {
      await new Promise((r) => { setTimeout(r, 250 * attempt); });
      await this.handleAck({ providerMessageId, status, error }, attempt + 1);
    }
  }

  async handleIncoming({ from, body }) {
    const key = phoneKey(from);
    const contacts = await this.repos.contacts.byPhoneKey(key);
    const settings = this.repos.settings.get();
    const text = normalizeText(body);
    const isOptOut = settings.optOutKeywords.map(normalizeText).includes(text);
    const at = new Date().toISOString();

    if (isOptOut) {
      await this.repos.contacts.markOptedOut(contacts.map((c) => c.id), at);
      if (settings.optOutReply) {
        await this.messaging.send({ to: from, text: settings.optOutReply }).catch(() => {});
      }
    }

    const last = await this.repos.messages.lastSentToPhoneKey(key);
    if (last && !last.repliedAt) {
      const updated = await this.repos.messages.registerReply(last.id, { reply: String(body).slice(0, 280), optOut: isOptOut, at });
      if (updated) {
        this.events.publish('message:update', this.publicMessage(updated));
        await this.publishProgressById(updated.campaignId);
      }
    }

    this.events.publish('incoming', { from, body, optOut: isOptOut, contacts: contacts.map((c) => c.name) });
  }

  // ── Teste ──────────────────────────────────────────────────

  async sendTest({ campaign, phone }) {
    const restaurant = await this.repos.restaurants.get(campaign.restaurantId);
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

  async mustGet(id) {
    const c = await this.repos.campaigns.get(id);
    if (!c) throw new Error('Campanha não encontrada.');
    return c;
  }

  publishProgress(campaign) {
    this.events.publish('campaign:progress', { id: campaign.id, restaurantId: campaign.restaurantId, status: campaign.status, waitingReason: campaign.waitingReason || null });
  }

  async publishProgressById(campaignId) {
    const campaign = await this.repos.campaigns.get(campaignId);
    if (campaign) this.publishProgress(campaign);
  }
}

module.exports = { DispatchService, phoneKey };
