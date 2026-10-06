const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const { MessagingProvider, MessagingError } = require('../MessagingProvider');

/**
 * Provedor da API OFICIAL do WhatsApp (Meta Cloud API).
 * Pronto para quando a Studio Coral iniciar o faturamento.
 *
 * Observações da API oficial:
 *  - Mensagens de marketing fora da janela de 24h exigem um *template*
 *    aprovado pela Meta. Configure o template na campanha (campo
 *    "Template da API Oficial"); as variáveis {{1}}, {{2}}… recebem, em ordem,
 *    os parâmetros definidos.
 *  - Status de entrega/leitura e respostas chegam via webhook:
 *    GET/POST {PUBLIC_URL}/webhooks/whatsapp
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api
 */
class WhatsAppCloudProvider extends MessagingProvider {
  static key = 'whatsapp-cloud';
  static label = 'API Oficial do WhatsApp (Meta)';
  static description = 'Canal oficial, estável e escalável. Cobrado por conversa; exige templates aprovados para marketing.';
  static capabilities = { qrLogin: false, templates: true, media: true, typing: false, webhook: true };

  constructor({ token, phoneNumberId, apiVersion = 'v21.0', verifyToken, appSecret }) {
    super();
    this.options = { token, phoneNumberId, apiVersion, verifyToken, appSecret };
  }

  request(method, pathname, body) {
    const payload = body ? JSON.stringify(body) : null;
    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          method,
          hostname: 'graph.facebook.com',
          path: `/${this.options.apiVersion}/${pathname}`,
          headers: {
            Authorization: `Bearer ${this.options.token}`,
            'Content-Type': 'application/json',
            ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          },
          timeout: 20000,
        },
        (res) => {
          let raw = '';
          res.on('data', (c) => { raw += c; });
          res.on('end', () => {
            let json = {};
            try { json = raw ? JSON.parse(raw) : {}; } catch { json = { raw }; }
            if (res.statusCode >= 400) {
              const msg = json?.error?.error_user_msg || json?.error?.message || `HTTP ${res.statusCode}`;
              reject(new MessagingError(msg, `meta_${json?.error?.code || res.statusCode}`));
            } else resolve(json);
          });
        },
      );
      req.on('timeout', () => req.destroy(new MessagingError('Tempo esgotado ao falar com a Meta', 'timeout')));
      req.on('error', (err) => reject(err instanceof MessagingError ? err : new MessagingError(err.message, 'network')));
      if (payload) req.write(payload);
      req.end();
    });
  }

  async start() {
    const { token, phoneNumberId } = this.options;
    if (!token || !phoneNumberId) {
      this.setState('error', { message: 'Defina WA_CLOUD_TOKEN e WA_CLOUD_PHONE_NUMBER_ID no arquivo .env.' });
      return;
    }
    this.setState('starting', { message: 'Validando credenciais na Meta…' });
    try {
      const info = await this.request('GET', `${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`);
      this.setState('connected', {
        me: { number: info.display_phone_number, name: info.verified_name, quality: info.quality_rating },
      });
    } catch (err) {
      this.setState('error', { message: err.message });
    }
  }

  async stop() {
    this.setState('disconnected');
  }

  async send({ to, text, media, template }) {
    if (this.state.state !== 'connected') throw new MessagingError('API Oficial não conectada.', 'not_connected');
    const number = MessagingProvider.normalizePhone(to);
    if (number.length < 12) throw new MessagingError('Número inválido', 'invalid_number');

    const image = media ? await this.imageRef(media) : null;
    let body;
    if (template?.name) {
      const components = [];
      if (image) components.push({ type: 'header', parameters: [{ type: 'image', image }] });
      if (template.params?.length) {
        components.push({ type: 'body', parameters: template.params.map((p) => ({ type: 'text', text: String(p) })) });
      }
      body = { type: 'template', template: { name: template.name, language: { code: template.language || 'pt_BR' }, components } };
    } else if (image) {
      body = { type: 'image', image: { ...image, caption: text } };
    } else {
      body = { type: 'text', text: { body: text, preview_url: true } };
    }

    const res = await this.request('POST', `${this.options.phoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: number,
      ...body,
    });
    return { providerMessageId: res?.messages?.[0]?.id || null, to: number };
  }

  /**
   * Imagens enviadas pelo painel sobem para a Meta (/media) e são reaproveitadas
   * pelo id; links externos são enviados direto.
   */
  async imageRef(media) {
    if (!media.path) return { link: media.publicUrl };
    this.mediaIds = this.mediaIds || new Map();
    if (!this.mediaIds.has(media.path)) {
      const id = await this.uploadMedia(media);
      this.mediaIds.set(media.path, id);
    }
    return { id: this.mediaIds.get(media.path) };
  }

  uploadMedia(media) {
    const boundary = `----coral${crypto.randomBytes(8).toString('hex')}`;
    const part = (name, value) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
    const payload = Buffer.concat([
      Buffer.from(part('messaging_product', 'whatsapp') + part('type', media.mimetype)),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${media.filename}"\r\nContent-Type: ${media.mimetype}\r\n\r\n`),
      fs.readFileSync(media.path),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return new Promise((resolve, reject) => {
      const req = https.request({
        method: 'POST',
        hostname: 'graph.facebook.com',
        path: `/${this.options.apiVersion}/${this.options.phoneNumberId}/media`,
        headers: { Authorization: `Bearer ${this.options.token}`, 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': payload.length },
        timeout: 60000,
      }, (res) => {
        let raw = '';
        res.on('data', (c) => { raw += c; });
        res.on('end', () => {
          let json = {};
          try { json = JSON.parse(raw); } catch { /* resposta vazia */ }
          if (res.statusCode >= 400 || !json.id) reject(new MessagingError(json?.error?.message || 'Falha ao enviar a imagem para a Meta', 'meta_media'));
          else resolve(json.id);
        });
      });
      req.on('timeout', () => req.destroy(new MessagingError('Tempo esgotado ao enviar a imagem', 'timeout')));
      req.on('error', (err) => reject(err instanceof MessagingError ? err : new MessagingError(err.message, 'network')));
      req.end(payload);
    });
  }

  // ── Webhook ─────────────────────────────────────────────────

  verifyWebhook(query) {
    if (query['hub.mode'] === 'subscribe' && query['hub.verify_token'] === this.options.verifyToken) {
      return query['hub.challenge'];
    }
    return null;
  }

  isValidSignature(rawBody, signatureHeader) {
    if (!this.options.appSecret) return true;
    if (!signatureHeader || !rawBody) return false;
    const expected = `sha256=${crypto.createHmac('sha256', this.options.appSecret).update(rawBody).digest('hex')}`;
    const a = Buffer.from(expected);
    const b = Buffer.from(String(signatureHeader));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  handleWebhook(body) {
    for (const entry of body?.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value || {};
        for (const st of value.statuses || []) {
          const status = { sent: 'sent', delivered: 'delivered', read: 'read', failed: 'failed' }[st.status];
          if (status) {
            this.emit('ack', { providerMessageId: st.id, status, error: st.errors?.[0]?.title });
          }
        }
        for (const msg of value.messages || []) {
          const bodyText = msg.text?.body || msg.button?.text || msg.interactive?.button_reply?.title || '';
          this.emit('incoming', { from: msg.from, body: bodyText, at: new Date(Number(msg.timestamp) * 1000 || Date.now()).toISOString() });
        }
      }
    }
  }
}

module.exports = { WhatsAppCloudProvider };
