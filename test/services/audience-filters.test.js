const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { normalize, birthdayPairs, isEmpty } = require('../../src/services/audienceFilters');

const fails = (raw, message) => assert.throws(() => normalize(raw), (err) => {
  assert.equal(err.status, 400);
  assert.match(err.message, message);
  return true;
});

describe('filtros de público: normalização', () => {
  it('vazios saem; sem nada, devolve objeto vazio', () => {
    assert.deepEqual(normalize(undefined), {});
    assert.deepEqual(normalize('texto'), {});
    assert.deepEqual(normalize({ orders: { min: '', max: null }, firstOrder: {}, birthday: {}, neighborhoods: [' '], items: [], weekdays: [] }), {});
    assert.equal(isEmpty({}), true);
    assert.equal(isEmpty(normalize({ orders: { min: 1 } })), false);
  });

  it('números, valores em reais, datas e listas', () => {
    assert.deepEqual(normalize({
      orders: { min: '2', max: 10 },
      spent: { min: '99,9' },
      lastOrderDays: { min: 30 },
      firstOrder: { from: '2026-01-01', to: '2026-03-31' },
      lastOrder: { to: '2026-10-01' },
      birthday: { month: '5' },
      neighborhoods: [' Savassi ', 'Savassi', 'Lourdes'],
      items: ['Lasanha'],
      itemsMode: 'qualquer coisa',
      weekdays: [6, '0', 6, 9],
    }), {
      orders: { min: 2, max: 10 },
      spent: { min: 99.9 },
      lastOrderDays: { min: 30 },
      firstOrder: { from: '2026-01-01', to: '2026-03-31' },
      lastOrder: { to: '2026-10-01' },
      birthday: { month: 5 },
      neighborhoods: ['Savassi', 'Lourdes'],
      items: ['Lasanha'],
      itemsMode: 'top',
      weekdays: [0, 6],
    });
    assert.deepEqual(normalize({ items: ['Suco'], itemsMode: 'any' }), { items: ['Suco'], itemsMode: 'any' });
    assert.deepEqual(normalize({ birthday: { nextDays: 7 } }), { birthday: { nextDays: 7 } });
    assert.deepEqual(normalize({ orders: { max: 0 } }), { orders: { max: 0 } }, 'máximo 0: quem nunca comprou');
  });

  it('erros explicam o problema', () => {
    fails({ orders: { min: 5, max: 1 } }, /^Quantidade de pedidos: o mínimo é maior que o máximo\.$/);
    fails({ orders: { min: 1.5 } }, /^Quantidade de pedidos: informe um número inteiro a partir de 0\.$/);
    fails({ spent: { min: -1 } }, /^Total gasto: informe um número a partir de 0\.$/);
    fails({ lastOrderDays: { max: 'dez' } }, /^Dias desde a última compra/);
    fails({ firstOrder: { from: '2026-02-30' } }, /^Primeira compra: data inválida/);
    fails({ lastOrder: { from: '2026-05-01', to: '2026-04-01' } }, /^Última compra: a data inicial é depois da final\.$/);
    fails({ birthday: { month: 13 } }, /^Aniversário: mês inválido\.$/);
    fails({ birthday: { nextDays: 0 } }, /^Aniversário: informe de 1 a 60 dias\.$/);
    fails({ birthday: { nextDays: 61 } }, /^Aniversário: informe de 1 a 60 dias\.$/);
  });

  it('aniversário nos próximos dias: virada de ano e 29/02 em ano não bissexto', () => {
    assert.deepEqual(birthdayPairs(3, new Date(2026, 11, 30, 15)), [[12, 30], [12, 31], [1, 1]]);
    assert.deepEqual(birthdayPairs(2, new Date(2027, 1, 28)), [[2, 28], [2, 29], [3, 1]]);
    assert.deepEqual(birthdayPairs(2, new Date(2028, 1, 28)), [[2, 28], [2, 29]], 'em 2028 o 29/02 existe');
  });
});
