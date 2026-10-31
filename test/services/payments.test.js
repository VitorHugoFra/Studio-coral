const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { SecretBox } = require('../../src/payments/secretBox');
const { AsaasGateway } = require('../../src/payments/providers/AsaasGateway');

/** fetch falso: responde pela rota e guarda as chamadas. */
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : null });
    const path = new URL(url).pathname.replace(/^\/v3/, '') + new URL(url).search;
    const route = Object.entries(routes).find(([key]) => key === `${init.method} ${path}`);
    if (!route) return { ok: false, status: 404, json: async () => ({ errors: [{ description: `rota ${init.method} ${path}` }] }) };
    const [status, body] = typeof route[1] === 'function' ? route[1](calls.at(-1)) : route[1];
    return { ok: status < 400, status, json: async () => body };
  };
  fn.calls = calls;
  return fn;
}

describe('pagamento: cifra da chave e gateway Asaas', () => {
  it('a chave guardada é cifrada, abre só com o mesmo segredo e nunca aparece em claro', () => {
    const box = new SecretBox('segredo-1');
    const sealed = box.seal('$aact_hmlg_000MinhaChave');
    assert.match(sealed, /^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    assert.ok(!sealed.includes('MinhaChave'));
    assert.notEqual(box.seal('$aact_hmlg_000MinhaChave'), sealed, 'cada cifra usa um IV novo');
    assert.equal(box.open(sealed), '$aact_hmlg_000MinhaChave');
    assert.throws(() => new SecretBox('segredo-2').open(sealed), /ENCRYPTION_KEY mudou/);
    assert.throws(() => box.open('lixo'), /formato desconhecido/);
    assert.equal(box.sign('asaas-webhook:1'), box.sign('asaas-webhook:1'));
    assert.notEqual(box.sign('asaas-webhook:1'), box.sign('asaas-webhook:2'));
  });

  it('cobrança Pix: ambiente, cabeçalhos, cliente procurado pelo CPF, split e QR Code', async () => {
    const fetchImpl = fakeFetch({
      'GET /customers?cpfCnpj=52998224725&limit=1': [200, { data: [] }],
      'POST /customers': [200, { id: 'cus_1' }],
      'POST /payments': [200, { id: 'pay_1', status: 'PENDING', invoiceUrl: 'https://sandbox.asaas.com/i/pay_1' }],
      'GET /payments/pay_1/pixQrCode': [200, { encodedImage: 'iVBOR', payload: '000201PIX', expirationDate: '2026-10-25 23:59:59' }],
    });
    const gw = new AsaasGateway({ apiKey: '$aact_hmlg_abc', environment: 'sandbox', fetchImpl });
    const charge = await gw.createCharge({ orderId: 'o-1', value: 52.9, method: 'pix', description: 'Pedido #7', customer: { name: 'Ana Lima', cpf: '52998224725', phone: '5531999990000' }, split: { walletId: 'w-agencia', percent: 5 } });
    assert.deepEqual(charge, { id: 'pay_1', status: 'pending', url: 'https://sandbox.asaas.com/i/pay_1', pix: { qrCode: 'data:image/png;base64,iVBOR', copyPaste: '000201PIX', expiresAt: '2026-10-25 23:59:59' } });
    const [first, customer, payment] = fetchImpl.calls;
    assert.ok(first.url.startsWith('https://api-sandbox.asaas.com/v3/'));
    assert.equal(first.headers.access_token, '$aact_hmlg_abc');
    assert.match(first.headers['User-Agent'], /StudioCoral/);
    assert.deepEqual(customer.body, { name: 'Ana Lima', cpfCnpj: '52998224725', mobilePhone: '31999990000', notificationDisabled: true });
    assert.equal(payment.body.customer, 'cus_1');
    assert.equal(payment.body.billingType, 'PIX');
    assert.equal(payment.body.value, 52.9);
    assert.equal(payment.body.externalReference, 'o-1');
    assert.equal(payment.body.dueDate, new Date().toLocaleDateString('sv-SE'));
    assert.deepEqual(payment.body.split, [{ walletId: 'w-agencia', percentualValue: 5 }]);
  });

  it('cartão usa a fatura do Asaas; cliente existente é reaproveitado; produção usa a URL de produção', async () => {
    const fetchImpl = fakeFetch({
      'GET /customers?cpfCnpj=52998224725&limit=1': [200, { data: [{ id: 'cus_9' }] }],
      'POST /payments': [200, { id: 'pay_2', status: 'PENDING', invoiceUrl: 'https://www.asaas.com/i/pay_2' }],
    });
    const gw = new AsaasGateway({ apiKey: '$aact_prod_x', environment: 'production', fetchImpl });
    const charge = await gw.createCharge({ orderId: 'o-2', value: 10, method: 'card', customer: { name: 'B', cpf: '52998224725', phone: '' } });
    assert.deepEqual(charge, { id: 'pay_2', status: 'pending', url: 'https://www.asaas.com/i/pay_2', pix: null });
    assert.equal(fetchImpl.calls.length, 2, 'não cria cliente repetido');
    assert.ok(fetchImpl.calls[0].url.startsWith('https://api.asaas.com/v3/'));
    assert.equal(fetchImpl.calls[1].body.billingType, 'CREDIT_CARD');
    assert.equal(fetchImpl.calls[1].body.split, undefined);
  });

  it('situação da cobrança, eventos do webhook, apagar, estornar e erros', async () => {
    assert.equal(AsaasGateway.statusOf('RECEIVED'), 'paid');
    assert.equal(AsaasGateway.statusOf('CONFIRMED'), 'paid');
    assert.equal(AsaasGateway.statusOf('OVERDUE'), 'expired');
    assert.equal(AsaasGateway.statusOf('PENDING', true), 'expired', 'cobrança apagada');
    assert.equal(AsaasGateway.statusOf('REFUND_IN_PROGRESS'), 'refunded');
    assert.equal(AsaasGateway.eventStatus('PAYMENT_RECEIVED'), 'paid');
    assert.equal(AsaasGateway.eventStatus('PAYMENT_DELETED'), 'expired');
    assert.equal(AsaasGateway.eventStatus('PAYMENT_CHECKOUT_VIEWED'), null);

    const fetchImpl = fakeFetch({
      'GET /payments/pay_3': [200, { id: 'pay_3', status: 'RECEIVED' }],
      'DELETE /payments/pay_3': [200, { deleted: true }],
      'POST /payments/pay_3/refund': [200, { id: 'pay_3', status: 'REFUNDED' }],
      'GET /finance/balance': [200, { balance: 123.45 }],
    });
    const gw = new AsaasGateway({ apiKey: 'k', fetchImpl });
    assert.deepEqual(await gw.getCharge('pay_3'), { id: 'pay_3', status: 'paid' });
    assert.deepEqual(await gw.cancelCharge('pay_3'), { deleted: true });
    assert.deepEqual(await gw.refund('pay_3'), { id: 'pay_3', status: 'refunded' });
    assert.deepEqual(await gw.testConnection(), { ok: true, balance: 123.45 });

    const denied = new AsaasGateway({ apiKey: 'k', fetchImpl: fakeFetch({ 'GET /finance/balance': [401, {}] }) });
    await assert.rejects(denied.testConnection(), { status: 400, message: 'Chave do Asaas inválida ou de outro ambiente (sandbox × produção).' });
    const invalidCpf = new AsaasGateway({ apiKey: 'k', fetchImpl: fakeFetch({ 'GET /finance/balance': [400, { errors: [{ description: 'O CPF informado é inválido.' }] }] }) });
    await assert.rejects(invalidCpf.testConnection(), { status: 400, message: 'Asaas: O CPF informado é inválido.' });
    const down = new AsaasGateway({ apiKey: 'k', fetchImpl: async () => { throw new Error('ECONNRESET'); } });
    await assert.rejects(down.testConnection(), { status: 502, message: 'O Asaas não respondeu. Tente de novo em instantes.' });
    assert.throws(() => new AsaasGateway({ apiKey: '' }), { status: 400 });
  });
});
