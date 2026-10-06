const fs = require('fs');
const { MessagingProvider, MessagingError } = require('../MessagingProvider');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Códigos de ACK do WhatsApp Web → status da plataforma
const ACK_MAP = { '-1': 'failed', 1: 'sent', 2: 'delivered', 3: 'read', 4: 'read' };

const CONNECTED = new Set(['isLogged', 'qrReadSuccess', 'inChat', 'chatsAvailable']);
const DISCONNECTED = new Set(['browserClose', 'qrReadFail', 'autocloseCalled', 'desconnectedMobile', 'disconnectedMobile', 'deleteToken', 'serverClose']);

/**
 * Provedor WPPConnect — WhatsApp Web automatizado (gratuito).
 * Usado na fase inicial, até o início do faturamento. Login por QR Code.
 * Docs: https://wppconnect.io/docs/
 */
class WppConnectProvider extends MessagingProvider {
  static key = 'wppconnect';
  static label = 'WPPConnect (WhatsApp Web)';
  static description = 'Gratuito. Conecta um número de WhatsApp lendo o QR Code, como no WhatsApp Web.';
  static capabilities = { qrLogin: true, templates: false, media: true, typing: true };

  constructor({ session, headless = true, simulateTyping = true, tokensDir, logger = console }) {
    super();
    this.options = { session, headless, simulateTyping, tokensDir };
    this.logger = logger;
    this.client = null;
    this.starting = null;
  }

  loadLibrary() {
    try {
      // Carregado sob demanda: o restante da plataforma funciona mesmo sem o pacote.
      // eslint-disable-next-line global-require
      return require('@wppconnect-team/wppconnect');
    } catch (err) {
      throw new MessagingError(
        'Pacote @wppconnect-team/wppconnect não instalado. Use Node 18+ e rode "npm install".',
        'missing_dependency',
      );
    }
  }

  async start() {
    if (this.client) return;
    if (this.starting) return this.starting;

    let wppconnect;
    try {
      wppconnect = this.loadLibrary();
    } catch (err) {
      this.setState('error', { message: err.message });
      return;
    }

    fs.mkdirSync(this.options.tokensDir, { recursive: true });
    this.setState('starting', { message: 'Abrindo o WhatsApp Web…' });

    this.starting = wppconnect
      .create({
        session: this.options.session,
        headless: this.options.headless,
        folderNameToken: this.options.tokensDir,
        autoClose: 0,
        logQR: false,
        disableWelcome: true,
        updatesLog: false,
        catchQR: (base64Qr, _ascii, attempt) => {
          this.setState('qr', { qr: base64Qr, message: `Escaneie o QR Code (tentativa ${attempt})` });
        },
        statusFind: (status) => {
          this.logger.info?.(`[wppconnect] status: ${status}`);
          if (CONNECTED.has(status) && this.state.state !== 'connected') this.setState('starting', { message: 'Sincronizando conversas…' });
          if (DISCONNECTED.has(status)) this.handleDisconnect(status);
        },
        puppeteerOptions: { args: ['--no-sandbox', '--disable-setuid-sandbox'] },
      })
      .then(async (client) => {
        this.client = client;
        this.attachListeners(client);
        const me = await this.describeMe(client);
        this.setState('connected', { me });
      })
      .catch((err) => {
        this.client = null;
        const raw = err?.message || String(err);
        // Timeout ao injetar o script costuma ser o WhatsApp Web que não abriu (rede/proxy bloqueando)
        const message = /Waiting failed|timeout/i.test(raw)
          ? 'O WhatsApp Web não carregou. Confira se esta rede permite acessar web.whatsapp.com (redes corporativas costumam bloquear) e tente de novo.'
          : raw;
        this.setState('error', { message });
      })
      .finally(() => {
        this.starting = null;
      });

    return this.starting;
  }

  async describeMe(client) {
    try {
      const wid = await client.getWid();
      const number = String(wid).replace(/@.*/, '');
      let name = null;
      try {
        const host = await client.getHostDevice();
        name = host?.pushname || host?.pushName || null;
      } catch { /* opcional */ }
      return { number, name };
    } catch {
      return { number: null, name: null };
    }
  }

  attachListeners(client) {
    client.onAck((ack) => {
      const status = ACK_MAP[ack.ack];
      const providerMessageId = ack?.id?._serialized || ack?.id;
      if (status && providerMessageId) this.emit('ack', { providerMessageId, status });
    });

    client.onMessage((msg) => {
      if (msg.isGroupMsg || msg.fromMe) return;
      this.emit('incoming', { from: String(msg.from).replace(/@.*/, ''), body: msg.body || '', at: new Date().toISOString() });
    });

    client.onStateChange((state) => {
      this.logger.info?.(`[wppconnect] state: ${state}`);
      if (['CONFLICT', 'UNLAUNCHED'].includes(state)) client.useHere().catch(() => {});
      if (state === 'UNPAIRED' || state === 'UNPAIRED_IDLE') this.handleDisconnect(state);
    });
  }

  handleDisconnect(reason) {
    this.client = null;
    this.setState('disconnected', { message: `Sessão encerrada (${reason})` });
  }

  async stop() {
    const { client } = this;
    this.client = null;
    if (client) await client.close().catch(() => {});
    this.setState('disconnected');
  }

  async logout() {
    const { client } = this;
    if (client) await client.logout().catch(() => {});
    await this.stop();
    fs.rmSync(`${this.options.tokensDir}/${this.options.session}`, { recursive: true, force: true });
  }

  async resolveWid(number) {
    const wid = `${number}@c.us`;
    try {
      const check = await this.client.checkNumberStatus(wid);
      if (check && check.numberExists === false) throw new MessagingError('Número não possui WhatsApp', 'not_on_whatsapp');
      return check?.id?._serialized || wid;
    } catch (err) {
      if (err instanceof MessagingError) throw err;
      return wid; // Se a checagem falhar, tenta enviar mesmo assim.
    }
  }

  async send({ to, text, media }) {
    if (!this.client || this.state.state !== 'connected') {
      throw new MessagingError('WhatsApp não conectado. Leia o QR Code na tela Conexão.', 'not_connected');
    }
    const number = MessagingProvider.normalizePhone(to);
    if (number.length < 12) throw new MessagingError('Número inválido', 'invalid_number');

    const wid = await this.resolveWid(number);

    if (this.options.simulateTyping) {
      await this.client.startTyping(wid).catch(() => {});
      await sleep(Math.min(4500, 900 + (text || '').length * 18));
      await this.client.stopTyping(wid).catch(() => {});
    }

    let result;
    try {
      // Arquivo local quando a imagem foi enviada pelo painel; senão, o link externo
      result = media
        ? await this.client.sendImage(wid, media.path || media.publicUrl, media.filename, text)
        : await this.client.sendText(wid, text);
    } catch (err) {
      throw new MessagingError(err?.text || err?.message || 'Falha no envio pelo WhatsApp Web');
    }

    return { providerMessageId: result?.id?._serialized || result?.id || null, to: wid };
  }
}

module.exports = { WppConnectProvider };
