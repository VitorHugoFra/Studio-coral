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

// Acessos de demonstração dos restaurantes (senha mínima de 8 caracteres): gerentes, que cuidam da equipe…
const RESTAURANT_USERS = {
  'cantina-bella-nonna': { name: 'Giulia Rossi', email: 'giulia@bellanonna.com.br', password: 'bellanonna' },
  'sabor-de-minas': { name: 'Seu Geraldo', email: 'geraldo@sabordeminas.com.br', password: 'sabordeminas' },
};
// …e alguém da equipe, que aprova campanhas e vê relatórios, mas não cuida dos acessos
const TEAM_USERS = {
  'cantina-bella-nonna': { name: 'Marco Bianchi', email: 'marco@bellanonna.com.br', password: 'marco-nonna' },
};

const TAG_POOL = [['vip'], ['inativo'], ['familia'], ['casal'], ['almoco'], ['fim-de-semana'], ['aniversariante'], []];

async function seed(repos, { reset = false } = {}) {
  if (reset) await repos.reset();
  const rand = rng(42);
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
        await r.users.create({ restaurantId: restaurant.id, role: 'manager', name: login.name, email: login.email, passwordHash: AuthService.hashPassword(login.password) });
      }
      const team = TEAM_USERS[data.slug];
      if (team) {
        await r.users.create({ restaurantId: restaurant.id, role: 'staff', name: team.name, email: team.email, passwordHash: AuthService.hashPassword(team.password) });
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
      const saved = await r.contacts.insertMany(contacts);
      const eligible = saved.filter((c) => c.optIn && !c.optedOut);

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
            const value = Math.round(items.reduce((s, it) => s + it.price, 0) * 0.9 * 100) / 100;
            const at = iso(new Date(m.clickedAt).getTime() + 8 * 60e3);
            await r.conversions.create({
              restaurantId: restaurant.id,
              campaignId: campaign.id,
              messageId: m.id,
              contactId: c.id,
              code: m.code,
              customerName: c.name,
              orderId: `DEMO-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
              value,
              items: items.map((it) => ({ name: it.name, qty: 1, price: it.price })),
              createdAt: at,
            });
            await r.messages.update(m, { convertedAt: at });
          }
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
