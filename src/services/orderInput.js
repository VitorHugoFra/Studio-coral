const { MessagingProvider } = require('../messaging/MessagingProvider');

/**
 * Validação e normalização dos dados que chegam de fora: o checkout do site, a ficha do contato e as
 * linhas da planilha de pedidos. Um lugar só para as regras, com mensagens em português.
 */
const invalid = (message) => Object.assign(new Error(message), { status: 400 });
const round2 = (v) => Math.round(v * 100) / 100;
const text = (value, max) => String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const MAX_VALUE = 9999999999.99; // limite do numeric(12,2) do banco

/** Telefone brasileiro só com dígitos e DDI 55 (fixo ou celular); vazio devolve null quando não é obrigatório. */
function phone(raw, { required = true, label = 'o WhatsApp' } = {}) {
  const p = MessagingProvider.normalizePhone(raw);
  if (!p) {
    if (required) throw invalid(`Informe ${label}.`);
    return null;
  }
  if (p.length < 12 || p.length > 13) throw invalid(`Telefone inválido: ${text(raw, 40)}`);
  return p;
}

/** CPF com os dígitos verificadores conferidos; vazio devolve null. */
function cpf(raw) {
  const d = String(raw ?? '').replace(/\D/g, '');
  if (!d) return null;
  const check = (len) => {
    const sum = [...d.slice(0, len)].reduce((s, n, i) => s + Number(n) * (len + 1 - i), 0);
    return ((sum * 10) % 11) % 10;
  };
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d) || check(9) !== Number(d[9]) || check(10) !== Number(d[10])) throw invalid('CPF inválido.');
  return d;
}

const isRealDate = (y, m, d) => {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
};

/** Aniversário: dia e mês juntos, ano opcional. Tudo vazio devolve os três como null. */
function birthday({ birthDay, birthMonth, birthYear } = {}) {
  const blank = (v) => v === undefined || v === null || v === '';
  if (blank(birthDay) && blank(birthMonth)) {
    if (!blank(birthYear)) throw invalid('Informe o dia e o mês do aniversário.');
    return { birthDay: null, birthMonth: null, birthYear: null };
  }
  if (blank(birthDay) || blank(birthMonth)) throw invalid('Informe o dia e o mês do aniversário.');
  const day = Number(birthDay);
  const month = Number(birthMonth);
  const year = blank(birthYear) ? null : Number(birthYear);
  const thisYear = new Date().getFullYear();
  if (year !== null && (!Number.isInteger(year) || year < 1900 || year > thisYear)) throw invalid('Ano de nascimento inválido.');
  // Sem o ano, 29/02 vale (ano bissexto)
  if (!Number.isInteger(day) || !Number.isInteger(month) || !isRealDate(year ?? 2000, month, day)) throw invalid('Data de aniversário inválida.');
  return { birthDay: day, birthMonth: month, birthYear: year };
}

const STATES = new Set(['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO']);

/** Endereço de entrega: CEP de 8 dígitos, rua, número, bairro e cidade obrigatórios. */
function address(raw = {}) {
  const a = raw && typeof raw === 'object' ? raw : {};
  const cep = String(a.cep ?? '').replace(/\D/g, '');
  if (cep.length !== 8) throw invalid('Informe o CEP com 8 dígitos.');
  const out = {
    cep,
    street: text(a.street, 160),
    number: text(a.number, 20),
    complement: text(a.complement, 120),
    neighborhood: text(a.neighborhood, 80),
    city: text(a.city, 80),
    state: text(a.state, 2).toUpperCase(),
  };
  if (!out.street) throw invalid('Informe a rua da entrega.');
  if (!out.number) throw invalid('Informe o número da entrega (ou "s/n").');
  if (!out.neighborhood) throw invalid('Informe o bairro da entrega.');
  if (!out.city) throw invalid('Informe a cidade da entrega.');
  if (out.state && !STATES.has(out.state)) throw invalid('UF inválida.');
  return out;
}

/**
 * Valor em reais de uma planilha: "1.234,56", "1234,56", "1234.56", "R$ 12", "1,234.56".
 * Com os dois separadores, o último é o decimal; só com ponto, "1.234" é milhar (centavos têm 2 casas).
 */
function money(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? round2(raw) : NaN;
  let s = String(raw ?? '').replace(/r\$|\s/gi, '');
  if (!s) return NaN;
  const negative = /^-|^\(.*\)$/.test(s);
  s = s.replace(/[-()]/g, '');
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    s = s.split(',').length > 2 ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (lastDot >= 0 && (s.split('.').length > 2 || /^\d{1,3}\.\d{3}$/.test(s))) {
    s = s.replace(/\./g, '');
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
  const value = round2(Number(s));
  return negative ? -value : value;
}

/**
 * Data da planilha no fuso do servidor: "dd/mm/aaaa", "dd/mm/aa", "aaaa-mm-dd", com hora opcional
 * ("hh:mm" ou "hh:mm:ss", separada por espaço ou T). Devolve um Date, ou null se não for uma data válida.
 */
function sheetDate(raw) {
  const s = String(raw ?? '').trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  let y; let mo; let d;
  if (m) {
    [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (m[3].length === 2) y += 2000;
  } else {
    m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?$/);
    if (!m) return null;
    [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  }
  const [h, min, sec] = [Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0)];
  if (!isRealDate(y, mo, d) || h > 23 || min > 59 || sec > 59) return null;
  return new Date(y, mo - 1, d, h, min, sec);
}

/** Itens da planilha: "2x Lasanha; 1 Suco | Coca" → [{ name, qty }]. Sem preço por item. */
function sheetItems(raw) {
  return String(raw ?? '').split(/[;|\n]+/).map((part) => part.trim()).filter(Boolean).slice(0, 50).map((part) => {
    const m = part.match(/^(\d{1,3})\s*(?:x|un\.?|\*)?\s+(.+)$/i) || part.match(/^(\d{1,3})x(.+)$/i);
    return m ? { name: text(m[2], 120), qty: Math.max(1, Number(m[1])), price: null } : { name: text(part, 120), qty: 1, price: null };
  });
}

/**
 * Uma linha da planilha de pedidos (já separada em colunas pelo navegador) → dados do pedido.
 * Lança um erro com a explicação quando a linha não pode entrar.
 */
function sheetOrder(row = {}) {
  const orderId = text(row.orderId, 60);
  if (!orderId) throw invalid('Sem número do pedido.');
  const date = sheetDate(row.date);
  if (!date) throw invalid(`Data inválida: ${text(row.date, 30) || '(vazia)'}`);
  if (date.getTime() > Date.now() + 60 * 60 * 1000) throw invalid('Data no futuro.');
  const total = money(row.total);
  if (!Number.isFinite(total) || total < 0 || total > MAX_VALUE) throw invalid(`Total inválido: ${text(row.total, 30) || '(vazio)'}`);
  const discount = row.discount === undefined || row.discount === '' ? 0 : money(row.discount);
  if (!Number.isFinite(discount) || discount < 0 || discount > MAX_VALUE) throw invalid(`Desconto inválido: ${text(row.discount, 30)}`);
  return {
    orderId,
    createdAt: date.toISOString(),
    customerName: text(row.name, 120) || null,
    phone: phone(row.phone, { required: false }),
    value: total,
    discount,
    subtotal: round2(total + discount),
    neighborhood: text(row.neighborhood, 80) || null,
    items: sheetItems(row.items),
  };
}

module.exports = { invalid, text, round2, phone, cpf, birthday, address, money, sheetDate, sheetItems, sheetOrder, MAX_VALUE };
