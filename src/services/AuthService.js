const crypto = require('crypto');

const COOKIE = 'sc_session';
const TTL = 1000 * 60 * 60 * 12; // 12h

/**
 * Autenticação por cookie assinado (HMAC).
 *
 *  • Agência: um administrador definido no .env (acesso total).
 *  • Restaurante: usuários presos ao próprio restaurante. Aprovam campanhas e
 *    veem apenas os próprios relatórios. O papel no restaurante (teamRole) é
 *    'manager' (gerente: também cuida dos acessos da equipe) ou 'staff' (equipe).
 *
 * A sessão leva a hora em que foi emitida (iat): trocar ou redefinir a senha
 * (users.password_changed_at) encerra as sessões anteriores daquela pessoa.
 */
class AuthService {
  constructor({ config, repos }) {
    this.admin = config.admin;
    this.secret = config.sessionSecret;
    this.repos = repos;
  }

  // ── Senhas ─────────────────────────────────────────────────
  static hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
    return `scrypt:${salt}:${hash}`;
  }

  static checkPassword(password, stored) {
    const [, salt, hash] = String(stored || '').split(':');
    if (!salt || !hash) return false;
    const test = crypto.scryptSync(String(password), salt, 64);
    const expected = Buffer.from(hash, 'hex');
    return expected.length === test.length && crypto.timingSafeEqual(expected, test);
  }

  static validatePassword(password) {
    if (String(password || '').length < 8) throw new Error('A senha precisa ter pelo menos 8 caracteres.');
  }

  // ── Sessão ─────────────────────────────────────────────────
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

  /** Token de sessão para um usuário já identificado (usado também na geração do PDF). */
  tokenFor(user) {
    const now = Date.now();
    return this.sign({ ...user, iat: now, exp: now + TTL });
  }

  /** Sessão emitida antes da última troca de senha da pessoa (sessão sem iat é de antes desta regra). */
  static revoked(session, user) {
    return !!user.passwordChangedAt && (session.iat || 0) < Date.parse(user.passwordChangedAt);
  }

  async login(email, password) {
    const mail = String(email).trim().toLowerCase();
    if (this.safeEqual(mail, this.admin.email.toLowerCase()) && this.safeEqual(password, this.admin.password)) {
      return this.tokenFor({ role: 'agency', email: this.admin.email, name: this.admin.name });
    }
    const user = await this.repos.users.byEmail(mail);
    if (!user || !AuthService.checkPassword(password, user.passwordHash)) return null;
    const restaurant = await this.repos.restaurants.get(user.restaurantId);
    if (!restaurant) return null;
    await this.repos.users.update(user, { lastLoginAt: new Date().toISOString() });
    return this.tokenFor({ role: 'restaurant', teamRole: user.role, userId: user.id, restaurantId: user.restaurantId, email: user.email, name: user.name, restaurant: restaurant.name });
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
      const expired = () => res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });
      if (!user) return expired();
      if (user.role !== 'restaurant') {
        req.user = user;
        return next();
      }
      // Usuário de restaurante removido (ou com a senha trocada depois desta sessão) perde o acesso na hora,
      // e o papel no restaurante vale como está no banco, não como estava no login
      return this.repos.users.get(user.userId).then((found) => {
        if (!found || AuthService.revoked(user, found)) return expired();
        req.user = { ...user, teamRole: found.role };
        return next();
      }, next);
    };
  }
}

AuthService.COOKIE = COOKIE;

module.exports = { AuthService };
