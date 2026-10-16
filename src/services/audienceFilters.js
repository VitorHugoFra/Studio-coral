const { invalid, text, round2 } = require('./orderInput');

/**
 * Filtros de público por compras (segment.filters da campanha e filtro da lista de contatos).
 * normalize() descarta o que está vazio e valida o resto: o que sai daqui vai direto para o SQL
 * de ContactsRepo.search() e é o que fica gravado na campanha.
 */
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LIST = 30;
const MAX_NEXT_DAYS = 60;

const blank = (v) => v === undefined || v === null || v === '';

function number(value, label, { integer = true } = {}) {
  if (blank(value)) return null;
  const n = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || (integer && !Number.isInteger(n))) throw invalid(`${label}: informe um número${integer ? ' inteiro' : ''} a partir de 0.`);
  return integer ? n : round2(n);
}

function range(raw, label, options) {
  if (!raw || typeof raw !== 'object') return null;
  const min = number(raw.min, label, options);
  const max = number(raw.max, label, options);
  if (min === null && max === null) return null;
  if (min !== null && max !== null && min > max) throw invalid(`${label}: o mínimo é maior que o máximo.`);
  return { ...(min !== null ? { min } : {}), ...(max !== null ? { max } : {}) };
}

function date(value, label) {
  if (blank(value)) return null;
  const s = String(value);
  const [y, m, d] = s.split('-').map(Number);
  const real = DATE.test(s) && new Date(Date.UTC(y, m - 1, d)).getUTCDate() === d && m >= 1 && m <= 12;
  if (!real) throw invalid(`${label}: data inválida. Use o formato AAAA-MM-DD.`);
  return s;
}

function period(raw, label) {
  if (!raw || typeof raw !== 'object') return null;
  const from = date(raw.from, label);
  const to = date(raw.to, label);
  if (!from && !to) return null;
  if (from && to && from > to) throw invalid(`${label}: a data inicial é depois da final.`);
  return { ...(from ? { from } : {}), ...(to ? { to } : {}) };
}

function list(raw, max = MAX_LIST) {
  const values = (Array.isArray(raw) ? raw : []).map((v) => text(v, 120)).filter(Boolean);
  return [...new Set(values)].slice(0, max);
}

function birthday(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!blank(raw.month)) {
    const month = Number(raw.month);
    if (!Number.isInteger(month) || month < 1 || month > 12) throw invalid('Aniversário: mês inválido.');
    return { month };
  }
  if (!blank(raw.nextDays)) {
    const nextDays = Number(raw.nextDays);
    if (!Number.isInteger(nextDays) || nextDays < 1 || nextDays > MAX_NEXT_DAYS) throw invalid(`Aniversário: informe de 1 a ${MAX_NEXT_DAYS} dias.`);
    return { nextDays };
  }
  return null;
}

/** Filtros limpos; objeto vazio quando não sobra nenhum. */
function normalize(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {
    orders: range(raw.orders, 'Quantidade de pedidos'),
    spent: range(raw.spent, 'Total gasto', { integer: false }),
    lastOrderDays: range(raw.lastOrderDays, 'Dias desde a última compra'),
    firstOrder: period(raw.firstOrder, 'Primeira compra'),
    lastOrder: period(raw.lastOrder, 'Última compra'),
    birthday: birthday(raw.birthday),
  };
  const neighborhoods = list(raw.neighborhoods);
  if (neighborhoods.length) out.neighborhoods = neighborhoods;
  const items = list(raw.items);
  if (items.length) {
    out.items = items;
    out.itemsMode = raw.itemsMode === 'any' ? 'any' : 'top';
  }
  const weekdays = [...new Set((Array.isArray(raw.weekdays) ? raw.weekdays : []).map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort();
  if (weekdays.length) out.weekdays = weekdays;
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== null));
}

const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/**
 * Pares [mês, dia] dos próximos N dias, a partir de hoje (fuso do servidor). Em ano não bissexto,
 * quem faz aniversário em 29/02 comemora junto com o 28/02.
 */
function birthdayPairs(nextDays, now = new Date()) {
  const pairs = [];
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (let i = 0; i < nextDays; i += 1) {
    const m = day.getMonth() + 1;
    const d = day.getDate();
    pairs.push([m, d]);
    if (m === 2 && d === 28 && !isLeap(day.getFullYear())) pairs.push([2, 29]);
    day.setDate(day.getDate() + 1);
  }
  return pairs;
}

const isEmpty = (filters) => !filters || !Object.keys(filters).length;

module.exports = { normalize, birthdayPairs, isEmpty, MAX_NEXT_DAYS };
