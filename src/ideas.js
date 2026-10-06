/**
 * Modelos de campanha (Etapa 3 — Criação).
 * Pontos de partida: a equipe ajusta ao cardápio e ao jeito de falar de cada restaurante.
 */
const CAMPAIGN_IDEAS = [
  {
    id: 'reativacao',
    title: 'Cliente sumido',
    objective: 'Reativar clientes inativos',
    occasion: 'Recorrente',
    tags: ['inativo'],
    message:
      '{Oi|Olá}, {{primeiro_nome}}, tudo bem? Aqui é do {{restaurante}}.\n\nFaz um tempo que você não pede com a gente, então deixamos um desconto separado: é só usar o cupom *{{cupom}}* no site até domingo.\n\n{{link}}',
  },
  {
    id: 'fim-de-semana',
    title: 'Sexta-feira',
    objective: 'Aumentar pedidos no fim de semana',
    occasion: 'Sexta-feira',
    tags: [],
    message:
      '{Boa tarde|Oi}, {{primeiro_nome}}! O cardápio de sexta do {{restaurante}} já está no site.\n\nPedindo por lá você usa o cupom *{{cupom}}* e não paga taxa de aplicativo.\n\n{{link}}',
  },
  {
    id: 'lancamento',
    title: 'Prato novo',
    objective: 'Divulgar lançamento de produto',
    occasion: 'Lançamento',
    tags: [],
    message:
      '{{primeiro_nome}}, entrou prato novo no cardápio do {{restaurante}} esta semana. A foto está aí em cima.\n\nDá pra pedir pelo site:\n{{link}}',
  },
  {
    id: 'dia-das-maes',
    title: 'Dia das Mães',
    objective: 'Data comemorativa',
    occasion: 'Dia das Mães',
    tags: ['familia'],
    message:
      'Oi, {{primeiro_nome}}. O {{restaurante}} vai abrir no Dia das Mães com almoço especial.\n\nAs encomendas pelo site vão até sábado e o cupom *{{cupom}}* vale para elas.\n\n{{link}}',
  },
  {
    id: 'dia-dos-namorados',
    title: 'Dia dos Namorados',
    objective: 'Data comemorativa',
    occasion: 'Dia dos Namorados',
    tags: ['casal'],
    message:
      '{{primeiro_nome}}, montamos um menu para dois no Dia dos Namorados: entrada, prato e sobremesa.\n\nPedidos pelo site do {{restaurante}}:\n{{link}}',
  },
  {
    id: 'aniversario',
    title: 'Aniversariante',
    objective: 'Fidelização',
    occasion: 'Aniversário',
    tags: ['aniversariante'],
    message:
      'Feliz aniversário, {{primeiro_nome}}! O {{restaurante}} deixou um presente pra você: o cupom *{{cupom}}* vale o mês inteiro nos pedidos pelo site.\n\n{{link}}',
  },
  {
    id: 'chuva',
    title: 'Dia de chuva',
    objective: 'Oportunidade do clima',
    occasion: 'Clima',
    tags: [],
    message:
      '{{primeiro_nome}}, com essa chuva a entrega do {{restaurante}} está funcionando normal. Se quiser pedir, o cardápio está aqui:\n\n{{link}}',
  },
  {
    id: 'vip',
    title: 'Clientes frequentes',
    objective: 'Recompensar melhores clientes',
    occasion: 'Recorrente',
    tags: ['vip'],
    message:
      '{{primeiro_nome}}, você é um dos clientes que mais pedem no {{restaurante}}, então quisemos agradecer: o cupom *{{cupom}}* dá 15% no próximo pedido pelo site.\n\n{{link}}',
  },
];

module.exports = { CAMPAIGN_IDEAS };
