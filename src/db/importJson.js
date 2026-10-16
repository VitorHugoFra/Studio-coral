const fs = require('fs');
const { createRepositories } = require('./repositories');
const { table: restaurants } = require('./repositories/restaurants');
const { table: users } = require('./repositories/users');
const { table: contacts } = require('./repositories/contacts');
const { table: campaigns } = require('./repositories/campaigns');
const { table: messages } = require('./repositories/messages');
const { table: orders } = require('./repositories/orders');

// As chaves são as coleções do antigo JSON; os pedidos (conversions) vão para a tabela orders
const TABLES = { restaurants, users, contacts, campaigns, messages, conversions: orders };
const REPO = { conversions: 'orders' };
const LABELS = { restaurants: 'Restaurantes', users: 'Acessos', contacts: 'Contatos', campaigns: 'Campanhas', messages: 'Mensagens', conversions: 'Pedidos' };
const SHORT = { restaurants: 'restaurantes', users: 'acessos', contacts: 'contatos', campaigns: 'campanhas', messages: 'mensagens', conversions: 'pedidos' };
// Qualquer repetido (id, slug, e-mail, telefone ou número de pedido) é ignorado
const SKIP_EXISTING = 'ON CONFLICT DO NOTHING';

/**
 * Copia o conteúdo de um antigo data/db.json para o banco, numa transação.
 *  • Pode rodar de novo: o que já existe é ignorado e as configurações que já
 *    estão no banco (alteradas no sistema novo) não são sobrescritas.
 *  • O JSON não tinha integridade. Pedidos e mensagens com vínculo quebrado
 *    perdem o vínculo; o que não pode existir sem o pai é ignorado; tudo vai
 *    para o relatório.
 *  • Um erro desfaz tudo e diz em qual coleção aconteceu.
 *  • Ao concluir, grava a marca legacyImportedAt nas configurações: é o que impede a subida do
 *    servidor de importar o mesmo JSON de novo (src/app.js).
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
      try {
        const inserted = await repos[REPO[name] || name].insertMany(rows, { onConflict: SKIP_EXISTING });
        stat.inserted = inserted.length;
        stat.existing = rows.length - inserted.length; // já estavam no banco ou se repetem no próprio JSON
      } catch (err) {
        throw new Error(`Falha ao importar ${name}: ${err.message}`, { cause: err });
      }
    };

    // Restaurantes primeiro; o resto só entra se o restaurante existir
    const restaurantsPart = prepare('restaurants');
    await insert('restaurants', restaurantsPart.rows, restaurantsPart.stat);
    const restaurantIds = await idsOf('restaurants');
    const ofKnownRestaurant = ({ rows, stat }) => rows.filter((row) => restaurantIds.has(row.restaurantId) || (stat.ignored += 1, false));

    // Acessos: o papel antigo 'restaurant' é o gerente de hoje (como na migração 004)
    const legacyRole = (row) => (row.role === 'restaurant' ? { ...row, role: 'manager' } : row);
    for (const name of ['users', 'contacts', 'campaigns']) {
      const part = prepare(name);
      const rows = ofKnownRestaurant(part);
      await insert(name, name === 'users' ? rows.map(legacyRole) : rows, part.stat);
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
      // Na versão com JSON não havia origem nem status: o que veio de campanha é de campanha, e tudo já foi concluído
      return { ...fixed, source: fixed.campaignId ? 'campaign' : 'site', status: 'completed' };
    });
    await insert('conversions', conversionRows, conversionsPart.stat);

    // Configurações salvas no JSON valem por cima dos padrões, mas só as que o banco ainda não tem:
    // rodar a importação de novo não desfaz o que foi alterado no sistema novo
    if (data?.settings && typeof data.settings === 'object') {
      const current = (await t.one('SELECT data FROM settings WHERE id = 1'))?.data || {};
      const fresh = Object.fromEntries(Object.entries(data.settings).filter(([key]) => !Object.hasOwn(current, key)));
      if (Object.keys(fresh).length) {
        await repos.settings.update(fresh);
        report.settings = Object.keys(fresh);
      }
    }

    // Marca de "já importado", na mesma transação: com o banco vazio de novo (todos os restaurantes excluídos), a próxima
    // subida não pode trazer o db.json de volta, com os acessos e as senhas antigas. Fica a data da primeira importação
    // (o que já está no banco vale, como nas outras configurações) e a marca não entra no relatório, que lista só o que veio do JSON
    await t.query(
      `INSERT INTO settings (id, data) VALUES (1, $1)
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data || settings.data`,
      [JSON.stringify({ legacyImportedAt: new Date().toISOString() })],
    );
  });
  return report;
}

/** Lê o antigo db.json; erro com o caminho do arquivo e o que fazer. */
function readLegacyJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8') || '{}');
  } catch (err) {
    throw new Error(`Não foi possível ler ${file}: ${err.message}. Corrija o arquivo ou mova-o para outra pasta (sem ele, o sistema cria os dados de demonstração).`);
  }
}

/** Linhas legíveis do relatório (script de importação). */
function formatReport(report) {
  const lines = Object.entries(report.collections).map(([name, s]) => {
    const extras = [
      s.existing && `${s.existing} repetidos ou já importados`,
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

module.exports = { importJson, readLegacyJson, formatReport, shortSummary };
