const { RestaurantsRepo } = require('./restaurants');
const { UsersRepo } = require('./users');
const { SettingsRepo, DEFAULT_SETTINGS } = require('./settings');

/**
 * Repositórios ligados a um banco (ou a uma transação).
 * repos.tx(async (r) => …) entrega os mesmos repositórios dentro de uma
 * transação. Dentro do callback use SÓ o `r` recebido (ver Database#tx).
 * As configurações são compartilhadas: a cópia em memória é uma só.
 */
function createRepositories(db, { settings = new SettingsRepo(db) } = {}) {
  return {
    db,
    settings,
    restaurants: new RestaurantsRepo(db),
    users: new UsersRepo(db),
    tx(fn) {
      return db.tx((t) => fn(createRepositories(t, { settings })));
    },
  };
}

module.exports = { createRepositories, DEFAULT_SETTINGS };
