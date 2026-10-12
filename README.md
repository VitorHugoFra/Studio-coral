# Studio Coral · Plataforma de Disparos (Etapa 1)

Protótipo funcional do serviço de **disparo de mensagens de marketing personalizadas para restaurantes**, conforme a Etapa 1 do plano de negócio, com a identidade do manual de marca (marrom `#73350c`, verde `#092b03`, amarelo `#ffb800`, Solway + Hemgjord Lettering).

| Página | Endereço |
|---|---|
| Site institucional | `http://localhost:3000/` |
| Painel da agência | `http://localhost:3000/app` |
| Site próprio de demonstração do restaurante | `http://localhost:3000/demo/cantina-bella-nonna` |

| Relatório mensal (A4/PDF) | `http://localhost:3000/relatorio?restaurantId=…&month=AAAA-MM` |

**Acessos de demonstração**

| Perfil | E-mail | Senha |
|---|---|---|
| Agência (definido no `.env`) | `admin@studiocoral.com.br` | `coral123` |
| Restaurante · Cantina Bella Nonna | `giulia@bellanonna.com.br` | `bellanonna` |
| Restaurante · Sabor de Minas | `geraldo@sabordeminas.com.br` | `sabordeminas` |

![Página inicial](docs/prints/01-site-inicio.png)

| Painel | Criação de campanha com imagem |
|---|---|
| ![Painel](docs/prints/04-painel.png) | ![Editor](docs/prints/08-nova-campanha-mensagem-e-imagem.png) |
| **Resultado da campanha** | **Site de pedidos do restaurante** |
| ![Resultado](docs/prints/06-resultado-da-campanha.png) | ![Site do restaurante](docs/prints/15-site-do-restaurante.png) |

Mais telas em [`docs/prints`](docs/prints). Os dados exibidos são fictícios.

## Como rodar

```bash
npm install
cp .env.example .env
npm start
```

> **Node 22 ou superior.** O WPPConnect e o relatório em PDF usam o Chrome do Puppeteer, instalado junto com as dependências opcionais (`npm install`).

> **Rede corporativa:** o WPPConnect abre o `web.whatsapp.com` num Chrome interno. Se a rede bloquear esse site (como o Sophos Web Protection da rede atual), a conexão falha e o painel avisa. Use uma rede sem esse bloqueio (casa, 4G) ou peça a liberação do domínio à TI.

### Banco de dados

Os dados ficam no PostgreSQL.

- **Sem configurar nada (desenvolvimento):** o sistema usa o **PGlite**, um PostgreSQL embutido, e grava em `data/pgdata`. Não é preciso instalar PostgreSQL.
- **Produção:** defina `DATABASE_URL=postgres://usuario:senha@host:5432/banco` no `.env`. As tabelas são criadas e atualizadas sozinhas ao subir o servidor (pasta `migrations/`).
- **Vindo da versão com `data/db.json`:** na primeira subida com o banco vazio, o conteúdo do JSON é importado automaticamente, e o arquivo é mantido como cópia. Para importar à mão: `npm run db:import-json -- caminho/do/db.json`.
- `npm run seed` apaga o banco e recria os dados de demonstração.
- Com o PGlite, só um processo usa a pasta por vez: pare o servidor antes de rodar `npm run seed` ou `npm run db:import-json`.
- **Rode uma instância do servidor por vez**, também em produção: a fila de disparo, a cópia das configurações e os eventos em tempo real ficam na memória do processo.

### Testes

```bash
npm test
```

Roda a bateria completa duas vezes: com o PostgreSQL embutido e pelo driver `pg`, como em produção. Não precisa de nada instalado além das dependências do projeto.

## O fluxo do plano de negócio no sistema

| Etapa | Onde |
|---|---|
| 1. Diagnóstico | **Restaurantes** → perfil, público, produtos, objetivos, tom de voz e cardápio |
| 2. Planejamento | **Campanha → Planejamento**: objetivo, ocasião, cupom e destino do link |
| 3. Criação | **Campanha → Mensagem**: variáveis `{{primeiro_nome}}`, variações `{Oi\|Olá}`, modelos prontos, imagem (upload por arrastar e soltar, galeria das já enviadas) e prévia no WhatsApp |
| 4. Segmentação | **Campanha → Segmentação**: filtros por tags, somente contatos autorizados |
| 5. Disparo | Fila com intervalos aleatórios, limite diário, horário comercial, teste, agendamento, pausa e cancelamento |
| 6. Conversão | Um link único por cliente (`/r/xxxx`), que registra o clique e redireciona com UTMs |
| 7. Compra | Pedido no site próprio, atribuído à campanha (`/api/public/conversions` ou script `/t.js`) |
| 8. Análise | Painel e página da campanha com entregas, leituras, cliques, pedidos e receita em tempo real |

LGPD: a importação exige confirmar o consentimento. Quem responde **SAIR** é descadastrado automaticamente e recebe uma confirmação.

## Acesso do restaurante e aprovação

A agência cria o acesso em **Restaurantes → Editar diagnóstico → Acesso do restaurante**. Quem entra com esse acesso:

- vê o painel e os relatórios **só do próprio restaurante**;
- aprova campanhas ou pede ajustes (com comentário), vendo a mensagem como o cliente vai receber;
- não vê contatos, outros restaurantes, conexão nem configurações (bloqueado também na API).

Fluxo: a agência monta a campanha e clica em **Enviar para aprovação** (passo Envio). O envio fica bloqueado até o restaurante aprovar. Se a agência mudar texto, imagem, cupom, link ou público depois da aprovação, ela é zerada e precisa ser pedida de novo. Tudo fica registrado no histórico da campanha. A exigência pode ser desligada por restaurante.

## Relatório mensal em PDF

Em **Relatórios**, escolha o restaurante e o mês: prévia na tela e botão **Baixar PDF**. O relatório traz números do mês com comparação ao anterior, resumo em texto, gráfico dia a dia, funil, campanhas, itens mais pedidos, melhor dia da semana e evolução da base. O PDF é gerado pelo Chrome do Puppeteer (instalado junto com o WPPConnect, Node 18+), a partir da página `/relatorio`, com a sessão de quem pediu.

## Site de pedidos do restaurante

Layout de cardápio digital (`/demo/:slug`): carrossel de fotos, atalhos por seção, abas fixas por categoria, busca, itens com foto, detalhe com quantidade e observação, sacola. Fotos dos itens e do carrossel são enviadas na ficha do restaurante. As ilustrações dos restaurantes de demonstração são geradas por `node scripts/gerar-ilustracoes.js`.

## Imagens nas campanhas

As imagens são enviadas pelo painel (JPG, PNG ou WEBP, até 5 MB; fotos grandes são reduzidas no navegador antes do envio), ficam em `data/uploads` e são servidas em `/uploads`. Cada canal recebe a imagem do jeito certo:

- **Simulador:** exibe a imagem no celular virtual.
- **WPPConnect:** envia o arquivo local com o texto como legenda (`sendImage`).
- **API Oficial:** faz upload para a Meta (`/media`), guarda o id e o reaproveita nos envios seguintes. Em templates, a imagem vai no cabeçalho.

## Injeção de dependência: troca do canal de envio

A fila de disparo (`DispatchService`) conhece apenas o **contrato** `MessagingProvider` (`src/messaging/MessagingProvider.js`). As implementações concretas só são ligadas em um ponto da aplicação (`src/bootstrap.js` + `src/messaging/index.js`):

```
src/messaging/
├── MessagingProvider.js        ← contrato: start, stop, logout, send, getStatus, eventos ack/incoming/status
├── MessagingManager.js         ← delega ao provedor ativo (permite trocar em tempo real)
├── index.js                    ← registro no container de DI
└── providers/
    ├── SimulatorProvider.js     ← demonstração, nada sai do servidor
    ├── WppConnectProvider.js    ← WhatsApp Web via WPPConnect (fase inicial, gratuito)
    └── WhatsAppCloudProvider.js ← API Oficial da Meta (após o faturamento)
```

O canal é escolhido em `MESSAGING_PROVIDER` no `.env` ou na tela **Conexão** do painel.

### Migrar para a API Oficial do WhatsApp

1. Crie o app na Meta e obtenha o `WA_CLOUD_TOKEN` (token permanente) e o `WA_CLOUD_PHONE_NUMBER_ID`.
2. Configure o webhook em `{PUBLIC_URL}/webhooks/whatsapp` com o mesmo `WA_CLOUD_VERIFY_TOKEN` (e, de preferência, `WA_CLOUD_APP_SECRET` para validar as assinaturas).
3. Cadastre e aprove os templates de marketing. Em cada campanha, preencha **Template da API Oficial** (nome, idioma e parâmetros `{{1}}`, `{{2}}`…).
4. Defina `MESSAGING_PROVIDER=whatsapp-cloud`. Nenhuma outra parte do código precisa mudar.

Para adicionar outro canal (Z-API, Twilio, SMS…), crie uma classe que estenda `MessagingProvider` e registre a factory em `src/messaging/index.js`.

## Observações

- **Dados de demonstração**: os contatos são fictícios (DDD `00`) e estão marcados com `demo: true`. A fila **nunca** os envia por um canal real; com o WPPConnect ou a API Oficial, eles são ignorados.
- **WPPConnect**: use um número dedicado, mantenha intervalos de envio naturais e envie só para a base autorizada. A automação do WhatsApp Web não é oficial e pode levar ao bloqueio do número.
- **Links em produção**: `PUBLIC_URL` precisa ser um endereço público (HTTPS), para que os links abram no celular dos clientes.
- **Fonte Hemgjord Lettering**: a versão gratuita é só para uso pessoal; para uso comercial é preciso comprar a licença. Coloque o arquivo como `public/fonts/hemgjord-lettering.otf` (ou `.woff2`). Ele fica fora do Git (`.gitignore`) para não ser redistribuído; sem ele, a fonte *Lobster* é usada.
- **Logo**: extraído do PDF do manual (baixa resolução). Para mais nitidez, substitua `public/brand/coral-wordmark.png` e `coral-snake.png` pelos arquivos originais com fundo transparente. A cor é aplicada via CSS mask.
- **Banco**: PostgreSQL acessado por repositórios (`src/db/repositories`); o SQL fica só dentro de `src/db`.
