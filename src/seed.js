/**
 * Dados de demonstração.
 * Todos os contatos são FICTÍCIOS (DDD 00, inexistente) e marcados com
 * demo: true — a fila nunca os envia por um canal real, só pelo simulador.
 *
 *   npm run seed   → apaga a base e recria os dados de demonstração
 *                    (num PostgreSQL de DATABASE_URL, só com: npm run seed -- --force)
 */
const crypto = require('crypto');
const { maskUrl } = require('./db/Database');
const { AuthService } = require('./services/AuthService');
const { ReferralService } = require('./services/ReferralService');

const DAY = 864e5;
const FIRST = ['Marina', 'Lucas', 'Ana', 'Pedro', 'Juliana', 'Rafael', 'Camila', 'Bruno', 'Larissa', 'Thiago', 'Beatriz', 'Gustavo', 'Fernanda', 'Diego', 'Patrícia', 'Felipe', 'Aline', 'Rodrigo', 'Carolina', 'Mateus', 'Letícia', 'André', 'Gabriela', 'Vinícius', 'Isabela', 'Leonardo', 'Natália', 'Eduardo', 'Mariana', 'Henrique', 'Sofia', 'Daniel', 'Renata', 'Caio', 'Vanessa', 'Igor'];
const LAST = ['Souza', 'Oliveira', 'Santos', 'Lima', 'Pereira', 'Costa', 'Almeida', 'Ribeiro', 'Carvalho', 'Gomes', 'Martins', 'Rocha', 'Barbosa', 'Araújo', 'Mendes', 'Freitas'];

function rng(seed) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
}

const RESTAURANTS = [
  {
    name: 'Cantina Bella Nonna',
    slug: 'cantina-bella-nonna',
    segment: 'Italiana · massas artesanais',
    city: 'Belo Horizonte – MG',
    tagline: 'Massa fresca feita todo dia, do jeito da nonna.',
    emoji: '🍝',
    color: '#73350c',
    coupon: 'NONNA10',
    phone: '(31) 3333-0000',
    address: 'Rua dos Timbiras, 1200 · Funcionários',
    hours: 'Ter a Dom · 11h30 às 23h',
    instagram: '@cantinabellanonna',
    audience: 'Famílias e casais de 25 a 50 anos, região centro-sul. Pedem mais no fim de semana.',
    products: 'Lasanha da Nonna, Fettuccine ao funghi, Nhoque de batata-baroa, Tiramisù.',
    goals: 'Tirar dependência dos apps de entrega (taxa de 27%) e levar pedidos para o site próprio.',
    tone: 'Acolhedor, familiar, com toque italiano.',
    menu: [
      { id: 'm1', category: 'Massas', name: 'Lasanha da Nonna', description: 'Ragù de 8 horas, bechamel e parmesão gratinado.', price: 62.9, highlight: true },
      { id: 'm2', category: 'Massas', name: 'Fettuccine ao Funghi', description: 'Massa fresca, mix de cogumelos e creme de trufas.', price: 58.5 },
      { id: 'm3', category: 'Massas', name: 'Nhoque de Baroa', description: 'Nhoque de batata-baroa na manteiga de sálvia.', price: 54.0 },
      { id: 'm4', category: 'Massas', name: 'Spaghetti alla Carbonara', description: 'Guanciale, gema curada e pecorino romano.', price: 56.9 },
      { id: 'm5', category: 'Entradas', name: 'Bruschetta Tricolore', description: 'Tomate confit, burrata e pesto de manjericão.', price: 32.0 },
      { id: 'm6', category: 'Sobremesas', name: 'Tiramisù', description: 'Receita clássica com café coado e mascarpone.', price: 24.9, highlight: true },
      { id: 'm7', category: 'Bebidas', name: 'Vinho da Casa (taça)', description: 'Tinto seco, uva Sangiovese.', price: 26.0 },
    ],
  },
  {
    name: 'Sabor de Minas',
    slug: 'sabor-de-minas',
    segment: 'Comida mineira · self-service e marmitas',
    city: 'Contagem – MG',
    tagline: 'Comida de fogão a lenha, com gosto de casa de vó.',
    emoji: '🍲',
    color: '#092b03',
    coupon: 'UAI15',
    phone: '(31) 3333-1111',
    address: 'Av. João César de Oliveira, 450 · Eldorado',
    hours: 'Seg a Sáb · 11h às 15h',
    instagram: '@sabordeminas',
    audience: 'Trabalhadores da região no almoço e famílias aos sábados.',
    products: 'Feijão tropeiro, frango com quiabo, marmita fitness, doce de leite.',
    goals: 'Aumentar pedidos de marmita no almoço durante a semana.',
    tone: 'Simples, bem-humorado, mineirês na medida.',
    menu: [
      { id: 'n1', category: 'Marmitas', name: 'Marmita Tropeiro', description: 'Feijão tropeiro, arroz, couve, torresmo e ovo.', price: 29.9, highlight: true },
      { id: 'n2', category: 'Marmitas', name: 'Frango com Quiabo', description: 'Acompanha arroz, angu e salada.', price: 27.5 },
      { id: 'n3', category: 'Marmitas', name: 'Marmita Fitness', description: 'Frango grelhado, arroz integral e legumes.', price: 26.0 },
      { id: 'n4', category: 'Porções', name: 'Pão de Queijo (10 un.)', description: 'Queijo canastra, assado na hora.', price: 18.0 },
      { id: 'n5', category: 'Sobremesas', name: 'Doce de Leite com Queijo', description: 'Doce de leite de tacho com queijo minas.', price: 12.0 },
      { id: 'n6', category: 'Bebidas', name: 'Suco de Laranja 500ml', description: 'Natural, sem açúcar.', price: 10.0 },
    ],
  },
];

// Ilustrações geradas por scripts/gerar-ilustracoes.js
const IMAGES = {
  m1: 'nonna-lasanha', m2: 'nonna-funghi', m3: 'nonna-nhoque', m4: 'nonna-carbonara', m5: 'nonna-bruschetta', m6: 'nonna-tiramisu', m7: 'nonna-vinho',
  n1: 'minas-tropeiro', n2: 'minas-frango', n3: 'minas-fitness', n4: 'minas-paodequeijo', n5: 'minas-docedeleite', n6: 'minas-suco',
};
const BANNERS = { 'cantina-bella-nonna': ['nonna-banner-1', 'nonna-banner-2'], 'sabor-de-minas': ['minas-banner-1', 'minas-banner-2'] };

// Acessos de demonstração dos restaurantes (senha mínima de 8 caracteres)
const RESTAURANT_USERS = {
  'cantina-bella-nonna': { name: 'Giulia Rossi', email: 'giulia@bellanonna.com.br', password: 'bellanonna' },
  'sabor-de-minas': { name: 'Seu Geraldo', email: 'geraldo@sabordeminas.com.br', password: 'sabordeminas' },
};

const TAG_POOL = [['vip'], ['inativo'], ['familia'], ['casal'], ['almoco'], ['fim-de-semana'], ['aniversariante'], []];

// Pedidos de demonstração: bairros, ruas e horários de cada restaurante (dias da semana: 0 = domingo)
const ORDER_PROFILE = {
  'cantina-bella-nonna': {
    city: 'Belo Horizonte',
    cep: '301',
    neighborhoods: ['Funcionários', 'Savassi', 'Lourdes', 'Santo Agostinho', 'Serra', 'Sion', 'Anchieta', 'Cruzeiro', 'Centro', 'Santa Efigênia'],
    streets: ['Rua dos Timbiras', 'Rua Pernambuco', 'Rua Alagoas', 'Av. do Contorno', 'Rua Grão Mogol', 'Rua Professor Moraes', 'Rua Rio de Janeiro', 'Rua Santa Rita Durão'],
    perDay: [6, 0, 3, 3, 3, 6, 8], // fechado na segunda
    lunchShare: 0.3, // o resto é jantar
    delivery: 0.7,
    sources: [['site', 0.65], ['iFood', 0.3], ['Caixa', 0.05]],
    extraCustomers: 40,
  },
  'sabor-de-minas': {
    city: 'Contagem',
    cep: '321',
    neighborhoods: ['Eldorado', 'Novo Eldorado', 'Riacho', 'Jardim Riacho', 'Industrial', 'Inconfidentes', 'Água Branca', 'Centro'],
    streets: ['Av. João César de Oliveira', 'Rua Rio Grande do Sul', 'Av. Olinto Meireles', 'Rua Simão Antônio', 'Rua Joaquim Camargos', 'Av. General David Sarnoff'],
    perDay: [0, 6, 6, 6, 6, 6, 4], // fechado no domingo; almoço de segunda a sábado
    lunchShare: 1,
    delivery: 0.5,
    sources: [['site', 0.5], ['iFood', 0.2], ['Caixa', 0.3]],
    extraCustomers: 30,
  },
};
const ORDER_DAYS = 180;

/** Escolhe por peso: [[valor, peso], …]. */
const weighted = (rand, list) => {
  let x = rand() * list.reduce((s, [, w]) => s + w, 0);
  for (const [value, w] of list) { x -= w; if (x <= 0) return value; }
  return list[list.length - 1][0];
};

/**
 * Seis meses de pedidos de um restaurante, do mais antigo para o mais novo, mais alguns de hoje ainda em
 * andamento (para o quadro de pedidos não abrir vazio). Cada pedido aponta para um cliente da lista (índice)
 * ou para ninguém (balcão sem telefone). Os clientes do começo da lista pedem mais: há quem volte toda semana
 * e quem pediu uma vez só.
 */
function planOrders({ rand, data, customers, now, staff }) {
  const profile = ORDER_PROFILE[data.slug];
  const menu = data.menu.map((m) => [m, m.highlight ? 3 : 1]);
  const weights = customers.map((_, i) => [i, 1 / (i + 1) ** 0.9]);
  const round2 = (v) => Math.round(v * 100) / 100;
  const at = (t) => new Date(t).toISOString();
  const orders = [];
  let imported = 0;

  const items = () => {
    const lines = new Map();
    const count = 1 + Math.floor(rand() * (profile.lunchShare === 1 ? 2 : 3));
    for (let k = 0; k < count; k += 1) {
      const m = weighted(rand, menu);
      lines.set(m.id, (lines.get(m.id) || 0) + 1 + (rand() < 0.2 ? 1 : 0));
    }
    return [...lines].map(([id, qty]) => {
      const m = data.menu.find((x) => x.id === id);
      return { id, name: m.name, qty, price: m.price, note: '' };
    });
  };

  const order = (createdAt, { status = 'completed', active = false } = {}) => {
    const source = active ? 'site' : weighted(rand, profile.sources);
    const lines = items();
    const subtotal = round2(lines.reduce((s, it) => s + it.qty * it.price, 0));
    // Pelo iFood, o telefone nem sempre vem; no caixa, metade é balcão sem cadastro
    const anonymous = (source === 'iFood' && rand() < 0.4) || (source === 'Caixa' && rand() < 0.5);
    const customer = anonymous ? null : weighted(rand, weights);
    const base = { createdAt: at(createdAt), customer, items: lines };
    if (source !== 'site') {
      imported += 1;
      return { ...base, source: 'import', channel: source, status: 'completed', orderId: `${source === 'iFood' ? 'IF' : 'CX'}-${String(10000 + imported)}`, subtotal, discount: 0, value: subtotal };
    }
    // No site, o cupom da casa vale 10% (a mesma regra do checkout)
    const discount = data.coupon ? round2(subtotal * 0.1) : 0;
    const fulfillment = rand() < profile.delivery ? 'delivery' : 'pickup';
    const canceled = !active && rand() < 0.04;
    const steps = canceled ? ['new', 'canceled'] : ['new', 'preparing', 'dispatched', 'completed'].slice(0, active ? ['new', 'preparing', 'dispatched'].indexOf(status) + 1 : 4);
    const minutes = { new: 0, preparing: 4, dispatched: 25, completed: 50, canceled: 6 };
    return {
      ...base,
      source: 'site',
      status: canceled ? 'canceled' : status,
      statusLog: steps.map((s) => ({ status: s, at: at(createdAt + minutes[s] * 60e3), by: s === 'new' ? null : staff })),
      fulfillment,
      subtotal,
      discount,
      coupon: discount ? data.coupon : null,
      value: round2(subtotal - discount),
    };
  };

  for (let d = ORDER_DAYS; d >= 1; d -= 1) {
    const day = new Date(now - d * DAY);
    day.setHours(0, 0, 0, 0);
    const base = profile.perDay[day.getDay()];
    if (!base) continue;
    const growth = 0.8 + 0.4 * (1 - d / ORDER_DAYS); // o site ganha pedidos com o tempo
    const count = Math.round(base * growth * (0.6 + rand() * 0.8));
    for (let k = 0; k < count; k += 1) {
      const lunch = rand() < profile.lunchShare;
      const minute = lunch ? 11 * 60 + 30 + rand() * 180 : 18 * 60 + 30 + rand() * 240;
      orders.push(order(day.getTime() + minute * 60e3));
    }
  }
  orders.sort((x, y) => x.createdAt.localeCompare(y.createdAt));
  // Hoje: chegando, em preparo e a caminho
  for (const [status, minutesAgo] of [['dispatched', 38], ['preparing', 17], ['new', 6], ['new', 2]].slice(0, profile.lunchShare === 1 ? 3 : 4)) {
    orders.push(order(now - minutesAgo * 60e3, { status, active: true }));
  }
  return orders;
}

async function seed(repos, { reset = false } = {}) {
  if (reset) await repos.reset();
  const rand = rng(42);
  const orderRand = rng(2026);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const now = Date.now();
  const iso = (t) => new Date(t).toISOString();

  // Numa transação: ou a demonstração entra inteira, ou nada entra
  await repos.tx(async (r) => {
    for (const [ri, data] of RESTAURANTS.entries()) {
      const restaurant = await r.restaurants.create({
        ...data,
        demo: true,
        requireApproval: true,
        menu: data.menu.map((it) => ({ ...it, image: IMAGES[it.id] ? `/demo-assets/${IMAGES[it.id]}.svg` : '' })),
        banners: (BANNERS[data.slug] || []).map((b) => `/demo-assets/${b}.svg`),
      });
      const login = RESTAURANT_USERS[data.slug];
      if (login) {
        await r.users.create({ restaurantId: restaurant.id, role: 'restaurant', name: login.name, email: login.email, passwordHash: AuthService.hashPassword(login.password) });
      }

      // Contatos fictícios
      const contacts = [];
      const total = ri === 0 ? 48 : 34;
      for (let i = 0; i < total; i += 1) {
        const tags = [...new Set([...pick(TAG_POOL), ...(rand() < 0.3 ? pick(TAG_POOL) : [])])];
        contacts.push({
          restaurantId: restaurant.id,
          name: `${pick(FIRST)} ${pick(LAST)}`,
          phone: `55009${String(80000000 + ri * 1000 + i * 37).padStart(8, '0')}`,
          tags,
          optIn: i % 17 !== 5,
          optInSource: pick(['Pedido no site', 'Cadastro no balcão', 'QR Code na mesa', 'Programa de fidelidade']),
          optedOut: i % 23 === 7,
          demo: true,
          createdAt: iso(now - (30 + i) * DAY),
        });
      }
      // Pedidos usam outra sequência de sorteio: os contatos e as campanhas acima continuam iguais aos de antes
      const profile = ORDER_PROFILE[data.slug];
      // Clientes que pediram pelo site sem marcar a caixa de promoções
      for (let i = 0; i < profile.extraCustomers; i += 1) {
        contacts.push({
          restaurantId: restaurant.id,
          name: `${FIRST[Math.floor(orderRand() * FIRST.length)]} ${LAST[Math.floor(orderRand() * LAST.length)]}`,
          phone: `55009${String(80500000 + ri * 1000 + i * 13).padStart(8, '0')}`,
          tags: [],
          optIn: false,
          optInSource: null,
          optedOut: false,
          demo: true,
          createdAt: iso(now - Math.floor(orderRand() * ORDER_DAYS) * DAY),
        });
      }
      // Bairro de cada cliente (usado nos pedidos); parte deles tem o bairro e o aniversário na ficha
      const homes = contacts.map(() => profile.neighborhoods[Math.floor(orderRand() * profile.neighborhoods.length)]);
      contacts.forEach((c, i) => {
        if (orderRand() < 0.3) c.neighborhood = homes[i];
        if (orderRand() < 0.6) {
          const month = 1 + Math.floor(orderRand() * 12);
          Object.assign(c, { birthMonth: month, birthDay: 1 + Math.floor(orderRand() * (month === 2 ? 28 : 30)), birthYear: orderRand() < 0.5 ? 1960 + Math.floor(orderRand() * 45) : null });
        }
      });
      // A ordem dos clientes define quem pede mais: os primeiros voltam sempre
      const ranking = contacts.map((_, i) => i).sort(() => orderRand() - 0.5);
      const plan = planOrders({ rand: orderRand, data, customers: ranking, now, staff: RESTAURANT_USERS[data.slug].name })
        .map((o) => ({ ...o, customer: o.customer === null ? null : ranking[o.customer] }));
      // Ninguém vira contato depois do primeiro pedido
      for (const o of plan) {
        if (o.customer !== null && o.createdAt < contacts[o.customer].createdAt) contacts[o.customer].createdAt = o.createdAt;
      }
      const saved = await r.contacts.insertMany(contacts);
      const byPhone = new Map(saved.map((c) => [c.phone, c]));
      const eligible = saved.filter((c) => c.optIn && !c.optedOut);

      const address = (neighborhood) => ({
        cep: `${profile.cep}${String(10000 + Math.floor(orderRand() * 89999)).slice(0, 5)}`,
        street: profile.streets[Math.floor(orderRand() * profile.streets.length)],
        number: String(10 + Math.floor(orderRand() * 1990)),
        complement: orderRand() < 0.4 ? `apto ${100 + Math.floor(orderRand() * 900)}` : '',
        neighborhood,
        city: profile.city,
        state: 'MG',
      });
      const orderRows = plan.map(({ customer, ...o }) => {
        const c = customer === null ? null : byPhone.get(contacts[customer].phone);
        const neighborhood = customer === null ? null : homes[customer];
        return {
          ...o,
          restaurantId: restaurant.id,
          contactId: c?.id || null,
          customerName: c?.name || (o.source === 'import' ? 'Balcão' : null),
          phone: c?.phone || null,
          neighborhood: o.fulfillment === 'pickup' ? null : neighborhood,
          address: o.fulfillment === 'delivery' ? address(neighborhood) : null,
        };
      });
      const homeOf = new Map(saved.map((c) => [c.id, homes[contacts.findIndex((x) => x.phone === c.phone)]]));

      // Campanhas históricas concluídas
      const history = ri === 0
        ? [
          { name: 'Sextou com Massa Fresca', daysAgo: 12, objective: 'Aumentar pedidos no fim de semana', occasion: 'Sexta-feira', coupon: 'NONNA10', perf: [0.97, 0.78, 0.34, 0.42] },
          { name: 'Saudade da Nonna', daysAgo: 6, objective: 'Reativar clientes inativos', occasion: 'Recorrente', coupon: 'VOLTA15', perf: [0.95, 0.81, 0.41, 0.38] },
          { name: 'Lançamento: Nhoque de Baroa', daysAgo: 2, objective: 'Divulgar lançamento de produto', occasion: 'Lançamento', coupon: 'NONNA10', perf: [0.98, 0.74, 0.29, 0.33] },
        ]
        : [
          { name: 'Marmita da Semana', daysAgo: 9, objective: 'Aumentar pedidos no almoço', occasion: 'Recorrente', coupon: 'UAI15', perf: [0.96, 0.83, 0.38, 0.47] },
          { name: 'Dia de Chuva, Dia de Tropeiro', daysAgo: 4, objective: 'Oportunidade do clima', occasion: 'Clima', coupon: 'UAI15', perf: [0.94, 0.77, 0.31, 0.4] },
        ];

      for (const h of history) {
        const start = now - h.daysAgo * DAY + 18 * 3600e3 - (new Date().getHours() * 3600e3);
        const campaign = await r.campaigns.create({
          restaurantId: restaurant.id,
          name: h.name,
          objective: h.objective,
          occasion: h.occasion,
          coupon: h.coupon,
          message: '{Oi|Olá}, {{primeiro_nome}}! Aqui é do {{restaurante}}. Esta semana o cupom *{{cupom}}* vale nos pedidos pelo site:\n\n{{link}}',
          segment: { tags: [], match: 'any' },
          includeFooter: true,
          status: 'completed',
          approval: { status: 'approved', decidedBy: RESTAURANT_USERS[data.slug].name, decidedAt: iso(start - DAY / 2) },
          provider: 'simulator',
          audienceSize: eligible.length,
          startedAt: iso(start),
          completedAt: iso(start + 40 * 60e3),
          createdAt: iso(start - DAY),
          demo: true,
        });
        const [deliv, read, click, conv] = h.perf;
        for (const [i, c] of eligible.entries()) {
          const sentAt = start + i * 50e3;
          const ok = rand() < deliv;
          const wasRead = ok && rand() < read;
          const clicked = wasRead && rand() < click / read * 0.9 + 0.05;
          const converted = clicked && rand() < conv;
          const m = await r.messages.create({
            campaignId: campaign.id,
            restaurantId: restaurant.id,
            contactId: c.id,
            name: c.name,
            phone: c.phone,
            demo: true,
            code: crypto.randomBytes(5).toString('base64url'),
            status: ok ? (wasRead ? 'read' : 'delivered') : 'failed',
            error: ok ? null : 'Número não possui WhatsApp',
            provider: 'simulator',
            queuedAt: iso(start),
            sentAt: iso(sentAt),
            deliveredAt: ok ? iso(sentAt + 60e3) : null,
            readAt: wasRead ? iso(sentAt + (5 + rand() * 120) * 60e3) : null,
            clickedAt: clicked ? iso(sentAt + (10 + rand() * 600) * 60e3) : null,
            clicks: clicked ? 1 + Math.floor(rand() * 2) : 0,
            createdAt: iso(start),
          });
          if (converted) {
            const items = [pick(data.menu), pick(data.menu)];
            const subtotal = Math.round(items.reduce((s, it) => s + it.price, 0) * 100) / 100;
            const value = Math.round(subtotal * 0.9 * 100) / 100;
            const placed = new Date(m.clickedAt).getTime() + 8 * 60e3;
            const at = iso(placed);
            const staff = RESTAURANT_USERS[data.slug].name;
            // Pedido feito no site pelo link da campanha (entra na numeração junto com os outros, abaixo)
            orderRows.push({
              restaurantId: restaurant.id,
              campaignId: campaign.id,
              messageId: m.id,
              contactId: c.id,
              code: m.code,
              customerName: c.name,
              phone: c.phone,
              source: 'campaign',
              status: 'completed',
              statusLog: [['new', 0, null], ['preparing', 4, staff], ['dispatched', 25, staff], ['completed', 50, staff]].map(([status, min, by]) => ({ status, at: iso(placed + min * 60e3), by })),
              fulfillment: 'delivery',
              neighborhood: homeOf.get(c.id),
              address: address(homeOf.get(c.id)),
              subtotal,
              discount: Math.round((subtotal - value) * 100) / 100,
              coupon: h.coupon,
              value,
              items: items.map((it) => ({ id: it.id, name: it.name, qty: 1, price: it.price, note: '' })),
              createdAt: at,
            });
            await r.messages.update(m, { convertedAt: at });
          }
        }
      }

      // Pedidos em ordem de data: os do site (e os que vieram pelo link da campanha) recebem o número #1, #2…
      orderRows.sort((x, y) => x.createdAt.localeCompare(y.createdAt));
      let number = 0;
      for (const o of orderRows) {
        if (o.source === 'import') continue;
        number += 1;
        o.number = number;
        o.trackingCode = crypto.randomBytes(9).toString('base64url');
      }
      const savedOrders = await r.orders.insertMany(orderRows);
      await r.restaurants.update(restaurant, { orderSeq: number });

      // Indicação (etapa 4), só na Cantina: três clientes fiéis indicaram amigos que fizeram o primeiro pedido pelo site
      if (data.slug === 'cantina-bella-nonna') {
        const rule = ReferralService.normalizeRule({ enabled: true, discountType: 'fixed', discountValue: 15, minOrder: 50, rewardType: 'percent', rewardValue: 20, rewardMinOrder: 40, rewardValidDays: 30 });
        await r.restaurants.update(restaurant, { referral: rule });
        const count = new Map();
        for (const o of savedOrders) if (o.contactId) count.set(o.contactId, (count.get(o.contactId) || 0) + 1);
        const fans = eligible.filter((c) => count.get(c.id) >= 5).slice(0, 3);
        const links = [];
        for (const [i, c] of fans.entries()) {
          const slug = `${ReferralService.slugify(c.name.split(' ')[0])}-${i + 1}`;
          links.push(await r.referrals.create({ restaurantId: restaurant.id, contactId: c.id, slug, name: c.name, phone: c.phone, message: '', editToken: crypto.randomBytes(18).toString('base64url'), clicks: 4 + Math.floor(orderRand() * 20), createdAt: iso(now - 80 * DAY) }));
        }
        // Primeiro pedido (do site, nos últimos 75 dias) de clientes que entraram depois: vira pedido indicado
        const firstOf = new Map();
        for (const o of savedOrders) if (o.contactId && !firstOf.has(o.contactId)) firstOf.set(o.contactId, o);
        const referredOrders = [...firstOf.values()]
          .filter((o) => o.source === 'site' && o.subtotal >= rule.minOrder && o.createdAt > iso(now - 75 * DAY) && !fans.some((f) => f.id === o.contactId))
          .slice(0, 7);
        for (const [i, o] of referredOrders.entries()) {
          const link = links[i % links.length];
          if (!link) break;
          const updated = await r.orders.update(o.id, { source: 'referral', referralId: link.id, discount: rule.discountValue, coupon: `INDICAÇÃO ${link.name.split(' ')[0].toUpperCase()}`, value: Math.round((o.subtotal - rule.discountValue) * 100) / 100 });
          if (updated.status !== 'completed') continue;
          const at = new Date(updated.createdAt).getTime() + 60 * 60e3;
          await r.coupons.create({
            restaurantId: restaurant.id, contactId: link.contactId, referralId: link.id, code: ReferralService.newCode(),
            discountType: rule.rewardType, discountValue: rule.rewardValue, minOrder: rule.rewardMinOrder,
            expiresAt: iso(at + rule.rewardValidDays * DAY), originOrderId: updated.id, sentAt: iso(at), createdAt: iso(at),
          });
        }
      }

      // Rascunho pronto para demonstrar o disparo ao vivo
      await r.campaigns.create({
        restaurantId: restaurant.id,
        name: ri === 0 ? 'Clientes VIP · Menu Degustação' : 'Sábado em Família',
        objective: ri === 0 ? 'Recompensar melhores clientes' : 'Aumentar pedidos no fim de semana',
        occasion: ri === 0 ? 'Recorrente' : 'Sábado',
        coupon: ri === 0 ? 'VIPNONNA' : 'UAI15',
        message: ri === 0
          ? '{{primeiro_nome}}, esta semana a {{restaurante}} vai servir um menu degustação de 5 tempos, só para quem já é cliente da casa.\n\nAs reservas e pedidos são pelo site, com o cupom *{{cupom}}*:\n{{link}}'
          : '{Bom dia|Opa}, {{primeiro_nome}}! Sábado o {{restaurante}} abre às 11h com feijão tropeiro e frango com quiabo no fogão a lenha.\n\nSe pedir pelo site, use o cupom *{{cupom}}*:\n{{link}}',
        segment: { tags: ri === 0 ? ['vip'] : ['familia', 'fim-de-semana'], match: 'any' },
        includeFooter: true,
        status: 'draft',
        // A da Cantina já foi enviada para o restaurante aprovar
        ...(ri === 0 ? {
          approval: { status: 'pending', requestedAt: iso(now - 3 * 3600e3), requestedBy: 'Equipe Studio Coral' },
          approvalLog: [{ action: 'requested', by: 'Equipe Studio Coral', at: iso(now - 3 * 3600e3), note: 'Menu degustação de outubro. Confere se o cupom está certo?' }],
        } : {}),
      });
    }
  });
}

/**
 * `npm run seed` apaga TUDO. No PGlite local (sem DATABASE_URL) isso é o esperado; num PostgreSQL de
 * verdade, que pode ser o de produção, só com --force. Devolve a mensagem de recusa, ou null se pode seguir.
 */
function resetRefusal({ databaseUrl, args }) {
  if (!databaseUrl || !args.includes('--reset') || args.includes('--force')) return null;
  return `npm run seed apaga TODOS os dados de ${maskUrl(databaseUrl)}. Para confirmar, rode: npm run seed -- --force`;
}

module.exports = { seed, resetRefusal };

if (require.main === module) {
  (async () => {
    /* eslint-disable global-require */
    const config = require('./config');
    const { Database } = require('./db/Database');
    const { migrate } = require('./db/migrate');
    const { createRepositories } = require('./db/repositories');
    /* eslint-enable global-require */
    const args = process.argv.slice(2);
    const refusal = resetRefusal({ databaseUrl: config.databaseUrl, args });
    if (refusal) {
      // Antes de abrir o banco: nada é tocado. exitCode (e não exit) deixa a mensagem terminar de sair
      console.error(`✖ ${refusal}`);
      process.exitCode = 1;
      return;
    }
    const db = await Database.open(config);
    try {
      await migrate(db);
      const repos = createRepositories(db);
      await repos.settings.load();
      await seed(repos, { reset: args.includes('--reset') });
      console.log('🌱 Base de demonstração recriada.');
    } finally {
      await db.close();
    }
  })().catch((err) => {
    console.error(`✖ ${err.message}`);
    process.exit(1);
  });
}
