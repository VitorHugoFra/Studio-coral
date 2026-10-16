const crypto = require('crypto');
const { AuthService } = require('./AuthService');

const HOUR = 60 * 60 * 1000;
const ROLES = ['manager', 'staff'];
/** Validade dos links: convite, 3 dias; nova senha, 2 horas (o envio manual pelo WhatsApp cabe nesse prazo). */
const LINK_TTL = { invite: 72 * HOUR, reset: 2 * HOUR };
const LINK_TTL_TEXT = { invite: '3 dias', reset: '2 horas' };
/** Um pedido de nova senha (ou um e-mail) por pessoa a cada 5 minutos. */
const THROTTLE = 5 * 60 * 1000;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const INVALID_LINK = 'Este link não vale mais: ele venceu, já foi usado ou foi trocado por um mais novo. Peça outro a quem mandou, ou use "Esqueci minha senha" na tela de entrada.';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
const normalizeEmail = (email) => String(email || '').trim().toLowerCase();
const publicUser = ({ passwordHash, ...u }) => u;
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';

/**
 * Acessos dos restaurantes: quem pode o quê, convite e nova senha por link, pedidos de "esqueci minha senha".
 *
 *  • Agência: todos os acessos de todos os restaurantes; pode também definir uma senha direto.
 *  • Gerente (teamRole 'manager'): os acessos do próprio restaurante, só por link (não escolhe a senha de ninguém),
 *    sem remover o próprio acesso nem mudar o próprio papel.
 *  • Equipe (teamRole 'staff'): não cuida de acessos (403).
 *
 * Os links levam um token aleatório depois do # (PUBLIC_URL/senha#token); no banco fica só o hash.
 * O e-mail sai pelo contrato MailProvider; sem serviço de e-mail, o link aparece para quem cuida dos acessos.
 */
class AccessService {
  constructor({ repos, mail, events, config, logger = console }) {
    this.repos = repos;
    this.mail = mail;
    this.events = events;
    this.config = config;
    this.logger = logger;
  }

  now() {
    return new Date().toISOString();
  }

  // ── Quem pode o quê ────────────────────────────────────────
  /** Restaurante em que a pessoa logada mexe: a agência escolhe (vazio = todos); o gerente, só o dele. */
  scope(actor, restaurantId = null) {
    if (actor.role !== 'restaurant') return restaurantId || null;
    if (actor.teamRole !== 'manager') throw fail('Só o gerente do restaurante cuida dos acessos da equipe.', 403);
    return actor.restaurantId;
  }

  /** O acesso pedido, se a pessoa logada alcança: de outro restaurante é como se não existisse. */
  async target(actor, id) {
    const scope = this.scope(actor);
    const user = await this.repos.users.get(id);
    if (!user || (scope && user.restaurantId !== scope)) throw fail('Usuário não encontrado.', 404);
    return user;
  }

  // ── Tela de acessos ────────────────────────────────────────
  async list(actor, { restaurantId } = {}) {
    const rows = await this.repos.users.listWithStatus({ restaurantId: this.scope(actor, restaurantId) });
    const now = Date.now();
    return rows
      .map(({ restaurantName, hasPassword, linkPurpose, linkExpiresAt, ...u }) => ({
        ...u,
        restaurant: restaurantName,
        status: !hasPassword ? 'invited' : (u.resetRequestedAt ? 'reset-requested' : 'active'),
        link: linkPurpose ? { purpose: linkPurpose, expiresAt: linkExpiresAt, expired: Date.parse(linkExpiresAt) <= now } : null,
      }))
      .sort((a, b) => a.restaurant.localeCompare(b.restaurant) || a.role.localeCompare(b.role) || a.name.localeCompare(b.name));
  }

  /**
   * Cria um acesso. Sem senha (o normal), a pessoa recebe um link de convite e cria a própria senha;
   * a resposta traz o link para copiar. Só a agência define uma senha na criação.
   */
  async create(actor, { restaurantId, name, email, role, password } = {}) {
    const scope = this.scope(actor, restaurantId);
    if (!scope) throw fail('Selecione o restaurante.');
    const restaurant = await this.repos.restaurants.get(scope);
    if (!restaurant) throw fail('Restaurante não encontrado.');
    const mail = normalizeEmail(email);
    if (!EMAIL.test(mail)) throw fail('Informe um e-mail válido.');
    if (mail === this.config.admin.email.toLowerCase() || (await this.repos.users.byEmail(mail))) throw fail('Este e-mail já tem acesso.');
    const teamRole = role === undefined || role === null || role === '' ? 'staff' : role;
    if (!ROLES.includes(teamRole)) throw fail('Escolha o papel: gerente ou equipe.');
    const withPassword = password !== undefined && password !== null && password !== '';
    if (withPassword) {
      if (actor.role === 'restaurant') throw fail('Mande o link de convite: a senha quem cria é a própria pessoa.');
      AuthService.validatePassword(password);
    }

    const passwordHash = withPassword ? AuthService.hashPassword(password) : null;
    let link = null;
    const user = await this.repos.tx(async (r) => {
      const created = await r.users.create({ restaurantId: scope, name: String(name || '').trim() || mail, email: mail, role: teamRole, passwordHash });
      if (!withPassword) link = await this.issueToken(r, created, 'invite', actor.name);
      return created;
    });
    if (link) link.emailed = await this.deliver(user, link, restaurant.name);
    return { ...publicUser(user), ...(link ? { link } : {}) };
  }

  /** Muda nome e papel. Ninguém muda o próprio papel (o gerente não se rebaixa por engano). */
  async update(actor, id, { name, role } = {}) {
    const user = await this.target(actor, id);
    const patch = {};
    if (name !== undefined) {
      patch.name = String(name).trim();
      if (!patch.name) throw fail('Informe o nome.');
    }
    if (role !== undefined && role !== user.role) {
      if (!ROLES.includes(role)) throw fail('Escolha o papel: gerente ou equipe.');
      if (actor.userId === user.id) throw fail('Você não pode mudar o próprio papel.');
      patch.role = role;
    }
    return publicUser(Object.keys(patch).length ? await this.repos.users.update(user, patch) : user);
  }

  async remove(actor, id) {
    const user = await this.target(actor, id);
    if (actor.userId === user.id) throw fail('Você não pode remover o próprio acesso.');
    return this.repos.users.remove(user.id);
  }

  /**
   * Link novo para a pessoa: de convite, se ela ainda não tem senha; de nova senha, se tem.
   * Substitui os links anteriores e atende o pedido de nova senha, se houver.
   */
  async issueLink(actor, id) {
    const user = await this.target(actor, id);
    const restaurant = await this.repos.restaurants.get(user.restaurantId);
    const link = await this.repos.tx(async (r) => {
      const issued = await this.issueToken(r, user, user.passwordHash ? 'reset' : 'invite', actor.name);
      if (user.resetRequestedAt) await r.users.update(user.id, { resetRequestedAt: null });
      return issued;
    });
    link.emailed = await this.deliver(user, link, restaurant?.name);
    return link;
  }

  /** A agência define a senha de alguém direto (atendimento). */
  async setPassword(actor, id, password) {
    if (actor.role === 'restaurant') throw fail('Mande um link de nova senha: a senha quem cria é a própria pessoa.', 403);
    const user = await this.target(actor, id);
    AuthService.validatePassword(password);
    await this.storePassword(user, password);
  }

  /** Troca da própria senha. A rota renova a sessão de quem trocou; as outras caem. */
  async changeOwnPassword(actor, { current, password } = {}) {
    if (actor.role !== 'restaurant') throw fail('A senha da agência é definida no arquivo .env.');
    const user = await this.repos.users.get(actor.userId);
    if (!AuthService.checkPassword(current || '', user?.passwordHash)) throw fail('Senha atual incorreta.');
    AuthService.validatePassword(password);
    await this.storePassword(user, password);
  }

  // ── Fora do painel: "Esqueci minha senha" e a página do link ─
  /**
   * Pedido de nova senha. A resposta é a mesma com ou sem acesso para o e-mail (não revela quem tem acesso).
   * Com serviço de e-mail, o link vai para a pessoa; sem ele (ou se o envio falhar), o pedido aparece na tela de acessos.
   */
  async requestReset(email) {
    const delivery = this.mail.delivers ? 'email' : 'manual';
    const mail = normalizeEmail(email);
    if (!EMAIL.test(mail)) throw fail('Informe um e-mail válido.');
    const user = await this.repos.users.byEmail(mail);
    if (!user) return { delivery };
    const now = this.now();
    if (this.mail.delivers) {
      if (await this.repos.passwordTokens.recentFor(user.id, { now, withinMs: THROTTLE })) return { delivery };
      const restaurant = await this.repos.restaurants.get(user.restaurantId);
      const link = await this.repos.tx((r) => this.issueToken(r, user, user.passwordHash ? 'reset' : 'invite', 'Esqueci minha senha'));
      if (await this.deliver(user, link, restaurant?.name)) return { delivery };
    }
    if (await this.repos.users.requestReset(user.id, { now, throttleMs: THROTTLE })) {
      this.events.publish('access:request', { restaurantId: user.restaurantId, userId: user.id, name: user.name });
    }
    return { delivery };
  }

  /** O que a página do link mostra (sem gastar o link). */
  async inspectLink(token) {
    const found = token ? await this.repos.passwordTokens.findValid(hashToken(token), { now: this.now() }) : null;
    const user = found && (await this.repos.users.get(found.userId));
    if (!user) throw fail(INVALID_LINK);
    const restaurant = await this.repos.restaurants.get(user.restaurantId);
    return { purpose: found.purpose, name: user.name, email: user.email, restaurant: restaurant?.name || '', expiresAt: found.expiresAt };
  }

  /** Cria a senha pelo link. A senha é conferida antes: senha recusada não gasta o link. */
  async redeemLink(token, password) {
    AuthService.validatePassword(password);
    const passwordHash = AuthService.hashPassword(password);
    const now = this.now();
    const user = await this.repos.tx(async (r) => {
      const found = token ? await r.passwordTokens.redeem(hashToken(token), { now }) : null;
      const owner = found && (await r.users.get(found.userId));
      if (!owner) throw fail(INVALID_LINK);
      await this.savePasswordHash(r, owner, passwordHash, now);
      return owner;
    });
    this.events.publish('access:update', { restaurantId: user.restaurantId, userId: user.id });
    return { email: user.email };
  }

  // ── Internos ───────────────────────────────────────────────
  async storePassword(user, password) {
    const passwordHash = AuthService.hashPassword(password);
    await this.repos.tx((r) => this.savePasswordHash(r, user, passwordHash, this.now()));
  }

  /** Grava a senha, marca a troca (as sessões anteriores caem), atende o pedido e apaga os links abertos. */
  async savePasswordHash(repos, user, passwordHash, now) {
    await repos.users.update(user, { passwordHash, passwordChangedAt: now, resetRequestedAt: null });
    await repos.passwordTokens.clearUser(user.id);
  }

  async issueToken(repos, user, purpose, createdBy) {
    const token = crypto.randomBytes(32).toString('base64url');
    const now = this.now();
    const expiresAt = new Date(Date.parse(now) + LINK_TTL[purpose]).toISOString();
    await repos.passwordTokens.issue({ userId: user.id, purpose, tokenHash: hashToken(token), expiresAt, createdBy: createdBy || null }, { now });
    return { url: `${this.config.publicUrl}/senha#${token}`, purpose, expiresAt };
  }

  /** Manda o link por e-mail, se houver serviço. Falha no envio fica no log e não derruba o pedido. */
  async deliver(user, link, restaurant) {
    if (!this.mail.delivers) return false;
    try {
      await this.mail.send({ to: user.email, ...AccessService.message(user, link, restaurant) });
      return true;
    } catch (err) {
      this.logger.error('[mail]', `Não foi possível enviar o link para ${user.email}:`, err.message);
      return false;
    }
  }

  static message(user, link, restaurant) {
    const hello = `Olá${firstName(user.name) && !user.name.includes('@') ? `, ${firstName(user.name)}` : ''}!`;
    const where = `o painel da Studio Coral${restaurant ? ` (${restaurant})` : ''}`;
    const validity = `O link vale por ${LINK_TTL_TEXT[link.purpose]} e funciona uma vez só.`;
    if (link.purpose === 'invite') {
      return {
        subject: 'Seu acesso ao painel da Studio Coral',
        text: `${hello}\n\nVocê recebeu um acesso para ${where}. Crie a sua senha neste link:\n${link.url}\n\n${validity}`,
      };
    }
    return {
      subject: 'Crie uma nova senha · Studio Coral',
      text: `${hello}\n\nRecebemos um pedido de nova senha para o seu acesso a ${where}. Crie a nova senha neste link:\n${link.url}\n\n${validity} Se você não pediu, ignore este e-mail: a sua senha continua a mesma.`,
    };
  }
}

AccessService.ROLES = ROLES;
AccessService.LINK_TTL = LINK_TTL;
AccessService.THROTTLE = THROTTLE;

module.exports = { AccessService, hashToken };
