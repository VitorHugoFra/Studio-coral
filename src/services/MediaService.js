const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_BYTES = 5 * 1024 * 1024; // limite de imagem do WhatsApp

/**
 * Imagens das campanhas. Ficam em data/uploads e são servidas em /uploads.
 * Os provedores recebem tanto o caminho local (WPPConnect envia o arquivo,
 * a API Oficial faz upload para a Meta) quanto a URL pública.
 */
class MediaService {
  constructor({ config }) {
    this.dir = path.join(config.dataDir, 'uploads');
    this.publicUrl = config.publicUrl;
    fs.mkdirSync(this.dir, { recursive: true });
  }

  save({ name, dataUrl }) {
    const match = /^data:([\w/+.-]+);base64,(.+)$/.exec(String(dataUrl || ''));
    if (!match) throw new Error('Arquivo inválido.');
    const mimetype = match[1];
    const ext = TYPES[mimetype];
    if (!ext) throw new Error('Use imagens JPG, PNG ou WEBP.');
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length > MAX_BYTES) throw new Error('A imagem passa de 5 MB, o limite do WhatsApp.');

    const file = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
    fs.writeFileSync(path.join(this.dir, file), buffer);
    fs.writeFileSync(path.join(this.dir, `${file}.json`), JSON.stringify({ name: String(name || file).slice(0, 120), mimetype, size: buffer.length, createdAt: new Date().toISOString() }));
    return this.info(file);
  }

  info(file) {
    const full = path.join(this.dir, path.basename(file));
    if (!fs.existsSync(full)) return null;
    let meta = {};
    try { meta = JSON.parse(fs.readFileSync(`${full}.json`, 'utf8')); } catch { /* sem metadados */ }
    const ext = path.extname(file).slice(1);
    return {
      file: path.basename(file),
      url: `/uploads/${path.basename(file)}`,
      path: full,
      mimetype: meta.mimetype || Object.keys(TYPES).find((k) => TYPES[k] === ext) || 'image/jpeg',
      size: meta.size || fs.statSync(full).size,
      name: meta.name || path.basename(file),
      createdAt: meta.createdAt || fs.statSync(full).mtime.toISOString(),
    };
  }

  list() {
    return fs.readdirSync(this.dir)
      .filter((f) => !f.endsWith('.json'))
      .map((f) => this.info(f))
      .filter(Boolean)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  remove(file) {
    const full = path.join(this.dir, path.basename(file));
    fs.rmSync(full, { force: true });
    fs.rmSync(`${full}.json`, { force: true });
  }

  /**
   * Converte o campo mediaUrl da campanha no objeto entregue aos provedores.
   * @returns {{ url: string, publicUrl: string, path?: string, mimetype: string, filename: string } | undefined}
   */
  resolve(mediaUrl) {
    if (!mediaUrl) return undefined;
    if (mediaUrl.startsWith('/uploads/')) {
      const info = this.info(mediaUrl.slice('/uploads/'.length));
      if (!info) throw new Error('A imagem da campanha não foi encontrada. Envie-a novamente.');
      return { url: info.url, publicUrl: `${this.publicUrl}${info.url}`, path: info.path, mimetype: info.mimetype, filename: info.file };
    }
    const filename = (mediaUrl.split('?')[0].split('/').pop() || 'imagem.jpg');
    return { url: mediaUrl, publicUrl: mediaUrl, mimetype: 'image/jpeg', filename };
  }
}

module.exports = { MediaService };
