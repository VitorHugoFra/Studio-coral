const crypto = require('crypto');

/**
 * Cifra de segredos guardados no banco (as chaves de API do Asaas dos restaurantes): AES-256-GCM, com a chave
 * derivada (SHA-256) do texto de configuração. Formato guardado: v1.<iv>.<tag>.<cifrado>, em base64url.
 */
class SecretBox {
  constructor(secret) {
    if (!secret) throw new Error('[pagamento] Sem chave para cifrar os segredos.');
    this.key = crypto.createHash('sha256').update(String(secret)).digest();
  }

  seal(plain) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
    return ['v1', iv, cipher.getAuthTag(), data].map((p) => (Buffer.isBuffer(p) ? p.toString('base64url') : p)).join('.');
  }

  open(sealed) {
    const [version, iv, tag, data] = String(sealed || '').split('.');
    if (version !== 'v1' || !iv || !tag || !data) throw new Error('Segredo em formato desconhecido.');
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
    } catch {
      throw new Error('Não foi possível ler a chave guardada (a ENCRYPTION_KEY mudou?). Cadastre a chave de novo.');
    }
  }

  /** Assinatura curta e estável (tokens derivados, como o do webhook de cada restaurante). */
  sign(text) {
    return crypto.createHmac('sha256', this.key).update(String(text)).digest('base64url').slice(0, 32);
  }
}

module.exports = { SecretBox };
