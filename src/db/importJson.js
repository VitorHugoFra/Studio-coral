const { createRepositories } = require('./repositories');
const { table: restaurants } = require('./repositories/restaurants');
const { table: users } = require('./repositories/users');
const { table: contacts } = require('./repositories/contacts');
const { table: campaigns } = require('./repositories/campaigns');
const { table: messages } = require('./repositories/messages');
const { table: conversions } = require('./repositories/conversions');

const TABLES = { restaurants, users, contacts, campaigns, messages, conversions };
const LABELS = { restaurants: 'Restaurantes', users: 'Acessos', contacts: 'Contatos', campaigns: 'Campanhas', messages: 'Mensagens', conversions: 'Pedidos' };
const SHORT = { restaurants: 'restaurantes', users: 'acessos', contacts: 'contatos', campaigns: 'campanhas', messages: 'mensagens', conversions: 'pedidos' };
// Qualquer repetido (id, slug, e-mail, telefone ou número de pedido) é ignorado
const SKIP_EXISTING = 'ON CONFLICT DO NOTHING';

/**
 * Copia o conteúdo de um antigo data/db.json para o banco, numa transação.
 *  • Pode rodar de novo: o que já existe é ignorado.
 *  • O JSON não tinha integridade. Pedidos e mensagens com vínculo quebrado
 *    perdem o vínculo; o que não pode existir sem o pai é ignorado; tudo vai
 *    para o relatório.
 */
async function importJson(db, data) {
  const report = { collections: {}, warnings: [] };
  await db.tx(async (t) => {
    const repos = createRepositories(t);
    const idsOf = async (table) => new Set((await t.many(`SELECT id FROM ${table}`)).map((r) => r.id));

    const prepare = (name) => {
      const allowed = new Set(TABLES[name].columns);
      const unknown = new Set();
      const rows = (Array.isArray(data?.[name]) ? data[name] : []).map((row) => Object.fromEntries(
        Object.entries(row).filter(([key]) => allowed.has(key) || (unknown.add(key), false)),
      ));
      if (unknown.size) report.warnings.push(`${name}: campos desconhecidos ignorados (${[...unknown].join(', ')})`);
      const stat = { read: rows.length, inserted: 0, existing: 0, ignored: 0, adjusted: 0 };
      report.collections[name] = stat;
      return { rows, stat };
    };

    const insert = async (name, rows, stat) => {
      const inserted = await repos[name].insertMany(rows, { onConflict: SKIP_EXISTING });
      stat.inserted = inserted.length;
      stat.existing = rows.length - inserted.length;
    };

    // Restaurantes primeiro; o resto só entra se o restaurante existir
    const restaurantsPart = prepare('restaurants');
    await insert('restaurants', restaurantsPart.rows, restaurantsPart.stat);
    const restaurantIds = await idsOf('restaurants');
    const ofKnownRestaurant = ({ rows, stat }) => rows.filter((row) => restaurantIds.has(row.restaurantId) || (stat.ignored += 1, false));

    for (const name of ['users', 'contacts', 'campaigns']) {
      const part = prepare(name);
      await insert(name, ofKnownRestaurant(part), part.stat);
    }
    const contactIds = await idsOf('contacts');
    const campaignIds = await idsOf('campaigns');

    // Mensagens: sem campanha não existem; contato apagado vira null
    const messagesPart = prepare('messages');
    const messageRows = ofKnownRestaurant(messagesPart)
      .filter((row) => campaignIds.has(row.campaignId) || (messagesPart.stat.ignored += 1, false))
      .map((row) => {
        if (!row.contactId || contactIds.has(row.contactId)) return row;
        messagesPart.stat.adjusted += 1;
        return { ...row, contactId: null };
      });
    await insert('messages', messageRows, messagesPart.stat);
    const messageIds = await idsOf('messages');

    // Pedidos são dado de venda: perdem o vínculo quebrado, mas ficam
    const conversionsPart = prepare('conversions');
    const conversionRows = ofKnownRestaurant(conversionsPart).map((row) => {
      const fixed = { ...row };
      if (fixed.campaignId && !campaignIds.has(fixed.campaignId)) fixed.campaignId = null;
      if (fixed.messageId && !messageIds.has(fixed.messageId)) fixed.messageId = null;
      if (fixed.contactId && !contactIds.has(fixed.contactId)) fixed.contactId = null;
      if (['campaignId', 'messageId', 'contactId'].some((k) => fixed[k] !== row[k])) conversionsPart.stat.adjusted += 1;
      return fixed;
    });
    await insert('conversions', conversionRows, conversionsPart.stat);

    // Configurações salvas no JSON valem por cima dos padrões
    if (data?.settings && typeof data.settings === 'object' && Object.keys(data.settings).length) {
      await repos.settings.update(data.settings);
      report.settings = Object.keys(data.settings);
    }
  });
  return report;
}

/** Linhas legíveis do relatório (script de importação). */
function formatReport(report) {
  const lines = Object.entries(report.collections).map(([name, s]) => {
    const extras = [
      s.existing && `${s.existing} já existiam`,
      s.ignored && `${s.ignored} ignorados (referência quebrada)`,
      s.adjusted && `${s.adjusted} com vínculo ajustado`,
    ].filter(Boolean).join(', ');
    return `  ${LABELS[name].padEnd(13)} ${String(s.inserted).padStart(5)} de ${s.read}${extras ? ` · ${extras}` : ''}`;
  });
  if (report.settings) lines.push(`  Configurações: ${report.settings.join(', ')}`);
  return [...lines, ...report.warnings.map((w) => `  ⚠ ${w}`)];
}

/** Resumo de uma linha (log da primeira subida). */
function shortSummary(report) {
  return Object.entries(report.collections).map(([name, s]) => `${s.inserted} ${SHORT[name]}`).join(', ');
}

module.exports = { importJson, formatReport, shortSummary };
