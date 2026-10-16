const { defineTable, isUuid } = require('../mapper');
const { Repository } = require('./base');

const table = defineTable({
  name: 'password_tokens',
  columns: ['userId', 'purpose', 'expiresAt', 'createdBy'],
  hidden: ['tokenHash'],
  unique: { password_tokens_hash_key: 'Não foi possível gerar o link. Tente de novo.' },
});

/**
 * Links de convite e de nova senha. A tabela guarda só links abertos e só o hash do token:
 * usar, substituir ou deixar vencer tira o link daqui.
 */
class PasswordTokensRepo extends Repository {
  constructor(db) {
    super(db, table);
  }

  /** Grava um link novo para a pessoa, apagando os anteriores dela e os vencidos de todo mundo. */
  async issue({ userId, purpose, tokenHash, expiresAt, createdBy = null }, { now }) {
    await this.db.query('DELETE FROM password_tokens WHERE user_id = $1 OR expires_at <= $2', [userId, now]);
    return this.create({ userId, purpose, tokenHash, expiresAt, createdBy });
  }

  /** Link ainda válido com este hash, sem gastá-lo. */
  async findValid(tokenHash, { now }) {
    return this.first('token_hash = $1 AND expires_at > $2', [String(tokenHash), now]);
  }

  /**
   * Gasta o link: apaga e devolve, se ainda valer. Atômico: de dois usos ao mesmo tempo, só um recebe o link.
   * Use dentro da mesma transação que grava a senha.
   */
  async redeem(tokenHash, { now }) {
    return this.map(await this.db.one('DELETE FROM password_tokens WHERE token_hash = $1 AND expires_at > $2 RETURNING *', [String(tokenHash), now]));
  }

  /** Apaga todos os links abertos da pessoa (a senha foi definida por outro caminho). */
  async clearUser(userId) {
    if (!isUuid(userId)) return;
    await this.db.query('DELETE FROM password_tokens WHERE user_id = $1', [userId]);
  }

  /** O link mais recente que a pessoa recebeu nos últimos `withinMs` (limite de e-mails seguidos). */
  async recentFor(userId, { now, withinMs }) {
    if (!isUuid(userId)) return null;
    const since = new Date(Date.parse(now) - withinMs).toISOString();
    return this.first('user_id = $1 AND created_at > $2', [userId, since], 'created_at DESC, id');
  }
}

module.exports = { PasswordTokensRepo, table };
