const crypto = require('crypto');

const COOKIE = 'sc_session';
const TTL = 1000 * 60 * 60 * 12; // 12h

/**
 * Autenticação simples por cookie assinado (HMAC). Um único usuário
 * administrador definido no .env — suficiente para o protótipo.
 */
class AuthService {
  constructor({ config }) {
    this.admin = config.admin;
    this.secret = config.sessionSecret;
  }

  sign(payload) {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.createHmac('sha256', this.secret).update(body).digest('base64url');
    return `${body}.${sig}`;
  }

  verify(token) {
    if (!token || !token.includes('.')) return null;
    const [body, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', this.secret).update(body).digest('base64url');
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    try {
      const data = JSON.parse(Buffer.from(body, 'base64url').toString());
      return data.exp > Date.now() ? data : null;
    } catch {
      return null;
    }
  }

  safeEqual(a, b) {
    const ha = crypto.createHash('sha256').update(String(a)).digest();
    const hb = crypto.createHash('sha256').update(String(b)).digest();
    return crypto.timingSafeEqual(ha, hb);
  }

  login(email, password) {
    const ok = this.safeEqual(String(email).trim().toLowerCase(), this.admin.email.toLowerCase()) && this.safeEqual(password, this.admin.password);
    if (!ok) return null;
    return this.sign({ email: this.admin.email, name: this.admin.name, exp: Date.now() + TTL });
  }

  readCookie(req) {
    const raw = req.headers.cookie || '';
    const match = raw.split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
    return match ? decodeURIComponent(match.slice(COOKIE.length + 1)) : null;
  }

  setCookie(res, token) {
    res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${TTL / 1000}`);
  }

  clearCookie(res) {
    res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  }

  middleware() {
    return (req, res, next) => {
      const user = this.verify(this.readCookie(req));
      if (!user) return res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });
      req.user = user;
      return next();
    };
  }
}

module.exports = { AuthService };
