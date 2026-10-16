const { RestaurantsRepo } = require('./restaurants');
const { UsersRepo } = require('./users');
const { SettingsRepo, DEFAULT_SETTINGS } = require('./settings');
const { ContactsRepo } = require('./contacts');
const { CampaignsRepo } = require('./campaigns');
const { MessagesRepo } = require('./messages');
const { OrdersRepo } = require('./orders');
const { ReferralsRepo } = require('./referrals');
const { CouponsRepo } = require('./coupons');

/**
 * Configurações vistas de dentro de uma transação: leitura da cópia em memória.
 * Gravar ali usaria o banco de fora da transação (e travaria no PGlite), então falha na hora.
 */
const readOnlySettings = (settings) => ({
  get: () => settings.get(),
  load: async () => { throw new Error('As configurações não podem ser recarregadas dentro de uma transação.'); },
  update: async () => { throw new Error('As configurações não podem ser alteradas dentro de uma transação.'); },
});

/**
 * Repositórios ligados a um banco (ou a uma transação).
 * repos.tx(async (r) => …) entrega os mesmos repositórios dentro de uma
 * transação. Dentro do callback use SÓ o `r` recebido (ver Database#tx).
 * Dentro da transação as configurações são só leitura (r.settings.get()).
 */
function createRepositories(db, { settings = new SettingsRepo(db) } = {}) {
  return {
    db,
    settings,
    restaurants: new RestaurantsRepo(db),
    users: new UsersRepo(db),
    contacts: new ContactsRepo(db),
    campaigns: new CampaignsRepo(db),
    messages: new MessagesRepo(db),
    orders: new OrdersRepo(db),
    referrals: new ReferralsRepo(db),
    coupons: new CouponsRepo(db),
    tx(fn) {
      return db.tx((t) => fn(createRepositories(t, { settings: readOnlySettings(settings) })));
    },
    /** Apaga todos os dados (as tabelas filhas vão junto) e volta as configurações ao padrão (npm run seed). */
    async reset() {
      await db.exec("TRUNCATE restaurants, users, contacts, campaigns, messages, orders, referral_links, coupons CASCADE; UPDATE settings SET data = '{}' WHERE id = 1;");
      await settings.load();
    },
  };
}

module.exports = { createRepositories, DEFAULT_SETTINGS };
