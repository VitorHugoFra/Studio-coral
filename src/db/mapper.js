const toSnake = (key) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const toCamel = (col) => col.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

const isUuid = (value) => typeof value === 'string' && UUID.test(value);

/**
 * Filtro opcional por id: vazio = sem filtro; texto que não é UUID vira o
 * UUID nulo, que não encontra nada (como o filtro do antigo JSON).
 */
const scopeId = (value) => (value ? (isUuid(value) ? value : NIL_UUID) : null);

/**
 * Descrição de uma tabela para os repositórios.
 *  • columns: campos expostos (camelCase), além de id, createdAt e updatedAt
 *  • json: campos jsonb (serializados na escrita; o `pg` transformaria arrays em arrays SQL)
 *  • numeric: campos numeric, que os drivers devolvem como texto
 *  • hidden: colunas internas, gravadas pelo repositório e nunca devolvidas
 *  • unique: nome da restrição de unicidade → mensagem amigável
 */
function defineTable({ name, columns, json = [], numeric = [], hidden = [], unique = {} }) {
  const exposed = ['id', 'createdAt', 'updatedAt', ...columns];
  const writable = new Set([...exposed, ...hidden]);
  const jsonSet = new Set(json);
  const numericSet = new Set(numeric);
  const hiddenSet = new Set(hidden);

  return {
    name,
    unique,
    columns: exposed,
    /** Linha do banco → objeto da aplicação. */
    fromRow(row) {
      if (!row) return null;
      const out = {};
      for (const [col, value] of Object.entries(row)) {
        const key = toCamel(col);
        if (hiddenSet.has(key)) continue;
        if (value instanceof Date) out[key] = value.toISOString();
        else if (numericSet.has(key) && value !== null) out[key] = Number(value);
        else out[key] = value;
      }
      return out;
    },
    /** Objeto da aplicação → colunas para gravar (campo desconhecido é erro de programação). */
    toColumns(data) {
      const map = new Map();
      for (const [key, value] of Object.entries(data)) {
        if (value === undefined) continue;
        if (!writable.has(key)) throw new Error(`Campo desconhecido em ${name}: ${key}`);
        map.set(toSnake(key), jsonSet.has(key) && value !== null ? JSON.stringify(value) : value);
      }
      return map;
    },
  };
}

module.exports = { defineTable, isUuid, scopeId, NIL_UUID, toSnake, toCamel };
