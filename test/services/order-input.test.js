const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const input = require('../../src/services/orderInput');
const { OrderService } = require('../../src/services/OrderService');

const fails = (fn, message) => assert.throws(fn, (err) => {
  assert.equal(err.status, 400);
  if (message) assert.match(err.message, message);
  return true;
});

describe('dados do pedido: validação e normalização', () => {
  it('telefone: celular e fixo com DDI 55; vazio só quando não é obrigatório', () => {
    assert.equal(input.phone('(31) 99999-8888'), '5531999998888');
    assert.equal(input.phone('+55 31 3333-0000'), '553133330000');
    assert.equal(input.phone('', { required: false }), null);
    fails(() => input.phone(''), /^Informe o WhatsApp\.$/);
    fails(() => input.phone('9999-8888'), /^Telefone inválido/);
  });

  it('CPF: confere os dígitos verificadores e rejeita sequências repetidas', () => {
    assert.equal(input.cpf('529.982.247-25'), '52998224725');
    assert.equal(input.cpf(''), null);
    assert.equal(input.cpf(undefined), null);
    fails(() => input.cpf('529.982.247-24'), /^CPF inválido\.$/);
    fails(() => input.cpf('111.111.111-11'), /^CPF inválido\.$/);
    fails(() => input.cpf('1234'), /^CPF inválido\.$/);
  });

  it('aniversário: dia e mês juntos, ano opcional; 29/02 vale sem o ano', () => {
    assert.deepEqual(input.birthday({}), { birthDay: null, birthMonth: null, birthYear: null });
    assert.deepEqual(input.birthday({ birthDay: '14', birthMonth: '5' }), { birthDay: 14, birthMonth: 5, birthYear: null });
    assert.deepEqual(input.birthday({ birthDay: 29, birthMonth: 2 }), { birthDay: 29, birthMonth: 2, birthYear: null });
    assert.deepEqual(input.birthday({ birthDay: 29, birthMonth: 2, birthYear: 2000 }), { birthDay: 29, birthMonth: 2, birthYear: 2000 });
    fails(() => input.birthday({ birthDay: 29, birthMonth: 2, birthYear: 2001 }), /^Data de aniversário inválida\.$/);
    fails(() => input.birthday({ birthDay: 31, birthMonth: 4 }), /^Data de aniversário inválida\.$/);
    fails(() => input.birthday({ birthDay: 10 }), /^Informe o dia e o mês do aniversário\.$/);
    fails(() => input.birthday({ birthYear: 1990 }), /^Informe o dia e o mês do aniversário\.$/);
    fails(() => input.birthday({ birthDay: 1, birthMonth: 1, birthYear: new Date().getFullYear() + 1 }), /^Ano de nascimento inválido\.$/);
  });

  it('endereço de entrega: CEP de 8 dígitos e campos obrigatórios', () => {
    const ok = { cep: '30140-071', street: ' Rua  dos Timbiras ', number: '1200', neighborhood: 'Funcionários', city: 'Belo Horizonte', state: 'mg' };
    assert.deepEqual(input.address(ok), { cep: '30140071', street: 'Rua dos Timbiras', number: '1200', complement: '', neighborhood: 'Funcionários', city: 'Belo Horizonte', state: 'MG' });
    fails(() => input.address({ ...ok, cep: '3014' }), /CEP/);
    fails(() => input.address({ ...ok, street: '' }), /rua/);
    fails(() => input.address({ ...ok, number: '' }), /número/);
    fails(() => input.address({ ...ok, neighborhood: '' }), /bairro/);
    fails(() => input.address({ ...ok, city: '' }), /cidade/);
    fails(() => input.address({ ...ok, state: 'XX' }), /UF/);
    fails(() => input.address(null), /CEP/);
  });

  it('valores da planilha nos formatos brasileiro e americano', () => {
    assert.equal(input.money('R$ 1.234,56'), 1234.56);
    assert.equal(input.money('1234,5'), 1234.5);
    assert.equal(input.money('1234.56'), 1234.56);
    assert.equal(input.money('1,234.56'), 1234.56);
    assert.equal(input.money('1.234'), 1234);
    assert.equal(input.money('12.5'), 12.5);
    assert.equal(input.money('-10,00'), -10);
    assert.equal(input.money(42), 42);
    assert.ok(Number.isNaN(input.money('')));
    assert.ok(Number.isNaN(input.money('abc')));
  });

  it('datas da planilha no fuso do servidor', () => {
    assert.equal(input.sheetDate('05/03/2026').getTime(), new Date(2026, 2, 5).getTime());
    assert.equal(input.sheetDate('05/03/26 19:40').getTime(), new Date(2026, 2, 5, 19, 40).getTime());
    assert.equal(input.sheetDate('2026-03-05T19:40:10').getTime(), new Date(2026, 2, 5, 19, 40, 10).getTime());
    assert.equal(input.sheetDate('2026-03-05 08:05').getTime(), new Date(2026, 2, 5, 8, 5).getTime());
    assert.equal(input.sheetDate('31/02/2026'), null);
    assert.equal(input.sheetDate('05/03/2026 25:00'), null);
    assert.equal(input.sheetDate('ontem'), null);
  });

  it('itens da planilha: quantidade opcional, separados por ; ou |', () => {
    assert.deepEqual(input.sheetItems('2x Lasanha; 1 Suco | Coca 2L;3xPão'), [
      { name: 'Lasanha', qty: 2, price: null },
      { name: 'Suco', qty: 1, price: null },
      { name: 'Coca 2L', qty: 1, price: null },
      { name: 'Pão', qty: 3, price: null },
    ]);
    assert.deepEqual(input.sheetItems(''), []);
  });

  it('linha da planilha: número, data e total obrigatórios; subtotal = total + desconto', () => {
    const order = input.sheetOrder({ orderId: ' 9001 ', date: '05/03/2026 12:30', name: 'Ana Lima', phone: '31 98888-7777', total: '45,90', discount: '5', neighborhood: 'Savassi', items: '1x Marmita' });
    assert.deepEqual(order, {
      orderId: '9001',
      createdAt: new Date(2026, 2, 5, 12, 30).toISOString(),
      customerName: 'Ana Lima',
      phone: '5531988887777',
      value: 45.9,
      discount: 5,
      subtotal: 50.9,
      neighborhood: 'Savassi',
      items: [{ name: 'Marmita', qty: 1, price: null }],
    });
    assert.equal(input.sheetOrder({ orderId: '1', date: '2026-03-05', total: '10' }).phone, null);
    fails(() => input.sheetOrder({ date: '05/03/2026', total: '10' }), /^Sem número do pedido\.$/);
    fails(() => input.sheetOrder({ orderId: '1', date: '32/03/2026', total: '10' }), /^Data inválida/);
    fails(() => input.sheetOrder({ orderId: '1', date: '05/03/2026', total: '' }), /^Total inválido/);
    fails(() => input.sheetOrder({ orderId: '1', date: '05/03/2026', total: '-3' }), /^Total inválido/);
    fails(() => input.sheetOrder({ orderId: '1', date: '05/03/2026', total: '3', phone: '123' }), /^Telefone inválido/);
    const tomorrow = new Date(Date.now() + 2 * 864e5);
    fails(() => input.sheetOrder({ orderId: '1', date: tomorrow.toLocaleDateString('pt-BR'), total: '3' }), /^Data no futuro\.$/);
  });

  it('status do pedido: só para a frente ou para cancelado; concluído e cancelado são finais', () => {
    assert.equal(OrderService.canMove('new', 'preparing'), true);
    assert.equal(OrderService.canMove('new', 'completed'), true, 'pode pular passos');
    assert.equal(OrderService.canMove('dispatched', 'canceled'), true);
    assert.equal(OrderService.canMove('preparing', 'new'), false);
    assert.equal(OrderService.canMove('completed', 'canceled'), false);
    assert.equal(OrderService.canMove('canceled', 'new'), false);
    assert.equal(OrderService.canMove('new', 'new'), false);
    assert.equal(OrderService.canMove('new', 'lost'), false);
  });

  it('itens da sacola com o preço do cardápio, nunca o do navegador', () => {
    const menu = [{ id: 'm1', name: 'Lasanha', price: 62.9 }, { id: 'm2', name: 'Suco', price: '10' }];
    assert.deepEqual(OrderService.priceItems([{ id: 'm1', qty: 2, price: 0.01, note: ' sem queijo ' }, { id: 'm2', qty: 1 }], menu), [
      { id: 'm1', name: 'Lasanha', qty: 2, price: 62.9, note: 'sem queijo' },
      { id: 'm2', name: 'Suco', qty: 1, price: 10, note: '' },
    ]);
    fails(() => OrderService.priceItems([], menu), /sacola está vazia/);
    fails(() => OrderService.priceItems([{ id: 'xx', qty: 1 }], menu), /não está mais no cardápio/);
    fails(() => OrderService.priceItems([{ id: 'm1', qty: 0 }], menu), /Quantidade inválida para Lasanha/);
    fails(() => OrderService.priceItems([{ id: 'm1', qty: 1.5 }], menu), /Quantidade inválida/);
  });
});
