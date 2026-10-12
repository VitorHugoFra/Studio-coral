const { AuthService } = require('../../src/services/AuthService');

const ID = {
  restaurant: '8e5ff564-1299-4909-9c35-f414fed26f24',
  user: 'c939db2c-d1d4-48bc-bbf3-16c9f157d048',
  ana: '11111111-1111-4111-8111-111111111111',
  beto: '22222222-2222-4222-8222-222222222222',
  anaRepetida: '33333333-3333-4333-8333-333333333333',
  orfao: '44444444-4444-4444-8444-444444444444',
  campaign: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  m1: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
  m2: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
  m3: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3',
  v1: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
  v2: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
  gone: '99999999-9999-4999-8999-999999999999',
  goneRestaurant: '98989898-9898-4898-8898-989898989898',
};

/**
 * Um db.json no formato antigo, com os defeitos que o JSON permitia:
 * telefone repetido, contato de restaurante apagado, mensagem de contato
 * apagado, mensagem e pedido de campanha apagada, campo que não existe mais.
 */
function legacyJson() {
  return {
    restaurants: [{ id: ID.restaurant, createdAt: '2026-09-01T12:00:00.000Z', name: 'Cantina Antiga', slug: 'cantina-antiga', color: '#73350c', menu: [{ id: 'm1', name: 'Lasanha', price: 62.9 }], requireApproval: true, demo: false }],
    users: [{ id: ID.user, createdAt: '2026-09-01T12:00:00.000Z', restaurantId: ID.restaurant, role: 'restaurant', name: 'Giulia', email: 'giulia@antiga.com.br', passwordHash: AuthService.hashPassword('senha-giulia-123'), lastLoginAt: '2026-09-10T08:00:00.000Z', updatedAt: '2026-09-10T08:00:00.000Z' }],
    contacts: [
      { id: ID.ana, createdAt: '2026-09-02T12:00:00.000Z', restaurantId: ID.restaurant, name: 'Ana', phone: '5531999000001', tags: ['vip'], optIn: true, optInSource: 'Pedido no site', optedOut: false, campoAntigo: 'x' },
      { id: ID.beto, createdAt: '2026-09-02T12:00:00.000Z', restaurantId: ID.restaurant, name: 'Beto', phone: '5531999000002', tags: [], optIn: true, optedOut: true, optedOutAt: '2026-09-20T10:00:00.000Z' },
      { id: ID.anaRepetida, createdAt: '2026-09-03T12:00:00.000Z', restaurantId: ID.restaurant, name: 'Ana repetida', phone: '5531999000001', tags: [], optIn: true, optedOut: false },
      { id: ID.orfao, createdAt: '2026-09-03T12:00:00.000Z', restaurantId: ID.goneRestaurant, name: 'De restaurante apagado', phone: '5531999000009', tags: [], optIn: true, optedOut: false },
    ],
    campaigns: [{ id: ID.campaign, createdAt: '2026-09-05T12:00:00.000Z', restaurantId: ID.restaurant, name: 'Sextou', message: 'Oi {{link}}', segment: { tags: [], match: 'any' }, includeFooter: true, status: 'completed', approval: { status: 'approved' }, approvalLog: [], provider: 'simulator', audienceSize: 2, startedAt: '2026-09-05T18:00:00.000Z', completedAt: '2026-09-05T18:40:00.000Z' }],
    messages: [
      { id: ID.m1, createdAt: '2026-09-05T18:00:00.000Z', campaignId: ID.campaign, restaurantId: ID.restaurant, contactId: ID.ana, name: 'Ana', phone: '5531999000001', demo: false, code: 'abc1234', status: 'read', error: null, provider: 'simulator', queuedAt: '2026-09-05T18:00:00.000Z', sentAt: '2026-09-05T18:00:00.000Z', deliveredAt: '2026-09-05T18:01:00.000Z', readAt: '2026-09-05T18:30:00.000Z', clickedAt: '2026-09-05T19:00:00.000Z', clicks: 1, convertedAt: '2026-09-05T19:10:00.000Z' },
      { id: ID.m2, createdAt: '2026-09-05T18:00:00.000Z', campaignId: ID.campaign, restaurantId: ID.restaurant, contactId: ID.gone, name: 'Contato apagado', phone: '5531999000005', code: 'abc1235', status: 'delivered', sentAt: '2026-09-05T18:01:00.000Z', clicks: 0 },
      { id: ID.m3, createdAt: '2026-09-05T18:00:00.000Z', campaignId: ID.gone, restaurantId: ID.restaurant, contactId: ID.beto, name: 'Beto', phone: '5531999000002', code: 'abc1236', status: 'sent', sentAt: '2026-09-05T18:02:00.000Z', clicks: 0 },
    ],
    conversions: [
      { id: ID.v1, createdAt: '2026-09-05T19:10:00.000Z', restaurantId: ID.restaurant, campaignId: ID.campaign, messageId: ID.m1, contactId: ID.ana, code: 'abc1234', customerName: 'Ana', orderId: 'PED-1', value: 77.4, items: [{ name: 'Lasanha', qty: 1, price: 62.9 }] },
      { id: ID.v2, createdAt: '2026-09-06T12:00:00.000Z', restaurantId: ID.restaurant, campaignId: ID.gone, messageId: ID.m3, contactId: ID.gone, customerName: 'Beto', orderId: 'PED-2', value: 30, items: [] },
    ],
    settings: { provider: 'whatsapp-cloud', providerEnvBase: 'simulator', footer: 'Rodapé antigo' },
  };
}

module.exports = { legacyJson, ID };
