const { defineTable, isUuid } = require('../mapper');
const { Repository } = require('./base');

const table = defineTable({
  name: 'users',
  columns: ['restaurantId', 'role', 'name', 'email', 'passwordHash', 'lastLoginAt'],
  unique: { users_email_key: 'Este e-mail já tem acesso.' },
});

class UsersRepo extends Repository {
  constructor(db) {
    super(db, table);
  }

  byEmail(email) {
    return this.first('email = $1', [String(email)]);
  }

  async listByRestaurant(restaurantId) {
    return isUuid(restaurantId) ? this.where('restaurant_id = $1', [restaurantId]) : [];
  }
}

module.exports = { UsersRepo, table };
