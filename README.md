# Studio Coral · Plataforma de Disparos (Etapa 1)

Protótipo funcional do serviço de **disparo de mensagens de marketing personalizadas para restaurantes**, conforme a Etapa 1 do plano de negócio, com a identidade do manual de marca (marrom `#73350c`, verde `#092b03`, amarelo `#ffb800`, Solway + Hemgjord Lettering).

| Página | Endereço |
|---|---|
| Site institucional | `http://localhost:3000/` |
| Painel da agência | `http://localhost:3000/app` |
| Site próprio de demonstração do restaurante | `http://localhost:3000/demo/cantina-bella-nonna` |
| Acompanhamento do pedido (cliente final) | `http://localhost:3000/pedido/:codigo` (o link aparece depois do pedido) |
| Indique e ganhe (cliente final) | `http://localhost:3000/indicar/cantina-bella-nonna` |

| Relatório mensal (A4/PDF) | `http://localhost:3000/relatorio?restaurantId=…&month=AAAA-MM` |

**Acessos de demonstração**

| Perfil | E-mail | Senha |
|---|---|---|
| Agência (definido no `.env`) | `admin@studiocoral.com.br` | `coral123` |
| Gerente · Cantina Bella Nonna | `giulia@bellanonna.com.br` | `bellanonna` |
| Equipe · Cantina Bella Nonna | `marco@bellanonna.com.br` | `marco-nonna` |
| Gerente · Sabor de Minas | `geraldo@sabordeminas.com.br` | `sabordeminas` |

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

- **Sem configurar nada (desenvolvimento):** o sistema usa o **PGlite**, um PostgreSQL embutido, e grava em `data/pgdata`. Não é preciso instalar PostgreSQL. **O PGlite é só para desenvolvimento e testes**: em produção use um PostgreSQL de verdade.
- **Produção:** defina `DATABASE_URL=postgres://usuario:senha@host:5432/banco` no `.env`. As tabelas são criadas e atualizadas sozinhas ao subir o servidor (pasta `migrations/`). Defina também, no ambiente do servidor, `NODE_ENV=production` e `TZ=America/Sao_Paulo`: os dias e os meses dos relatórios (e a janela de horário de envio) seguem o fuso do servidor.
- **Vindo da versão com `data/db.json`:** na primeira subida com o banco vazio, o conteúdo do JSON é importado automaticamente, e o arquivo é mantido como cópia. Para importar à mão: `npm run db:import-json -- caminho/do/db.json`. A importação acontece uma vez só: ela deixa uma marca (`legacyImportedAt`) nas configurações, e se o banco ficar vazio de novo (todos os restaurantes excluídos), a próxima subida cria os dados de demonstração em vez de trazer o JSON de volta.
- `npm run seed` apaga o banco e recria os dados de demonstração (dois restaurantes, campanhas e cerca de 6 meses de pedidos). **Com `DATABASE_URL` definida ele se recusa a rodar**, para não apagar um banco de produção por engano. Para confirmar que é isso mesmo, rode `npm run seed -- --force`: apaga TODOS os dados daquele banco.
- Com o PGlite, só um processo usa a pasta por vez: pare o servidor antes de rodar `npm run seed` ou `npm run db:import-json`.
- **Uma instância do servidor por banco**, também em produção: a fila de disparo, a cópia das configurações e os eventos em tempo real ficam na memória do processo. O servidor garante isso ao subir: trava o banco (um *advisory lock* do PostgreSQL, numa conexão própria, além das do `DATABASE_POOL_MAX`) e, se outra instância já o estiver usando, espera até 30 s (o "para e sobe" de um deploy) e então falha avisando. A trava exige conexão **em modo sessão**: não use um pooler em modo transação, como o do Supabase na porta 6543; use a conexão direta ou o pooler em modo sessão.

### Testes

```bash
npm test
```

Roda a bateria completa com o PostgreSQL embutido e repete os testes HTTP pelo driver `pg`, como em produção. Não precisa de nada instalado além das dependências do projeto (para a segunda parte, o próprio PGlite atende numa porta local). Só a segunda parte: `npm run test:pg`.

## O fluxo do plano de negócio no sistema

| Etapa | Onde |
|---|---|
| 1. Diagnóstico | **Restaurantes** → perfil, público, produtos, objetivos, tom de voz e cardápio |
| 2. Planejamento | **Campanha → Planejamento**: objetivo, ocasião, cupom e destino do link |
| 3. Criação | **Campanha → Mensagem**: variáveis `{{primeiro_nome}}`, variações `{Oi\|Olá}`, modelos prontos, imagem (upload por arrastar e soltar, galeria das já enviadas) e prévia no WhatsApp |
| 4. Segmentação | **Campanha → Público**: tags e filtros de compra (última compra, pedidos, gasto, aniversário, bairro, item, dia preferido), somente contatos autorizados |
| 5. Disparo | Fila com intervalos aleatórios, limite diário, horário comercial, teste, agendamento, pausa e cancelamento |
| 6. Conversão | Um link único por cliente (`/r/xxxx`), que registra o clique e redireciona com UTMs |
| 7. Compra | Pedido no site próprio (`/api/public/orders`), atribuído à campanha quando vem do link; sites externos informam a venda por `/api/public/conversions` ou pelo script `/t.js` |
| 8. Análise | Painel e página da campanha com entregas, leituras, cliques, pedidos e receita em tempo real |

LGPD: a importação exige confirmar o consentimento. Quem responde **SAIR** é descadastrado automaticamente e recebe uma confirmação.

## Acessos ao painel

Há três tipos de acesso:

| Quem | Entra com | O que faz |
|---|---|---|
| **Agência** | O login do `.env` (`ADMIN_EMAIL` e `ADMIN_PASSWORD`) | Tudo, em todos os restaurantes. A senha só muda no `.env` |
| **Gerente** do restaurante | Acesso criado pela agência ou por outro gerente | Painel, pedidos, aprovação de campanhas e relatórios **só do próprio restaurante**, e a tela **Equipe**, onde convida e remove pessoas, muda papéis e gera links de senha |
| **Equipe** do restaurante | Acesso criado pela agência ou pelo gerente | O mesmo que o gerente, menos a tela Equipe |

Gerente e equipe não veem contatos, outros restaurantes, conexão nem configurações (bloqueado também na API).

**Criar um acesso.** A agência usa **Acessos → Novo acesso** (ou **Restaurantes → Editar diagnóstico → Acesso do restaurante → Gerenciar acessos**); o gerente usa **Equipe → Convidar pessoa**. O acesso nasce sem senha e aparece um **link de convite** (`/senha#…`), com os botões **Copiar** e **Mandar pelo WhatsApp**. Com ele, a própria pessoa cria a senha. O link vale por 3 dias e funciona uma vez só; gerar outro cancela o anterior. A agência ainda pode marcar "Definir a senha agora" e passar a senha, como antes.

**Esqueci minha senha.** Na tela de entrada, a pessoa informa o e-mail. A resposta é a mesma exista ou não o acesso (não revela quem tem acesso). Sem serviço de e-mail configurado, o pedido aparece no alto da tela **Acessos** (agência) e **Equipe** (gerente daquele restaurante), com aviso em tempo real: clique em **Gerar link** e mande o link para a pessoa. O link de nova senha vale por 2 horas e funciona uma vez só. Um link novo também pode ser gerado a qualquer momento pelo ícone de link na lista.

**Trocar a senha.** Gerente e equipe trocam a própria senha pelo botão **Senha**, no rodapé do menu. Trocar ou redefinir a senha encerra as outras sessões abertas daquela pessoa; mudar o papel ou remover o acesso vale na hora, sem esperar a sessão vencer.

**Segurança dos links.** O token vai depois do `#`, então não aparece nos logs do servidor; no banco fica só o hash (tabela `password_tokens`). Mande cada link só para a própria pessoa: quem tem o link cria a senha.

**E-mail.** O envio passa pelo contrato `MailProvider` (`src/mail`), como a mensageria. O padrão é `MAIL_PROVIDER=none` (links na tela). Para ligar um serviço de e-mail (SMTP, SES, Resend…), crie uma classe que estenda `MailProvider`, registre a factory em `src/mail/index.js` e mude `MAIL_PROVIDER`. Com e-mail, o "Esqueci minha senha" manda o link direto para a pessoa (no máximo um a cada 5 minutos), e os convites e links gerados na tela também vão por e-mail; se o envio falhar, o pedido cai na tela de acessos e a falha vai para o log.

Detalhes no [documento de desenho](docs/superpowers/specs/2026-10-16-criacao-de-contas-design.md).

## Aprovação de campanhas pelo restaurante

Fluxo: a agência monta a campanha e clica em **Enviar para aprovação** (passo Envio). O envio fica bloqueado até o restaurante aprovar. Se a agência mudar texto, imagem, cupom, link ou público depois da aprovação, ela é zerada e precisa ser pedida de novo. Tudo fica registrado no histórico da campanha. A exigência pode ser desligada por restaurante.

## Relatório mensal em PDF

Em **Relatórios**, escolha o restaurante e o mês: prévia na tela e botão **Baixar PDF**. O relatório traz números do mês com comparação ao anterior, resumo em texto, gráfico dia a dia, funil, campanhas, itens mais pedidos, melhor dia da semana e evolução da base. A página 3 mostra as **vendas do restaurante** de todos os canais (site, campanhas e planilhas): pedidos, faturamento, ticket médio, clientes novos e que voltaram, vendas por canal, bairros e itens mais vendidos, e quantos clientes estão há mais de 30 dias sem pedir. O PDF é gerado pelo Chrome do Puppeteer (instalado junto com o WPPConnect), a partir da página `/relatorio`, com a sessão de quem pediu.

## Site de pedidos do restaurante

Layout de cardápio digital (`/demo/:slug`): carrossel de fotos, atalhos por seção, abas fixas por categoria, busca, itens com foto, detalhe com quantidade e observação, sacola. Fotos dos itens e do carrossel são enviadas na ficha do restaurante. As ilustrações dos restaurantes de demonstração são geradas por `node scripts/gerar-ilustracoes.js`.

**Checkout:** nome e WhatsApp (obrigatórios), entrega ou retirada, endereço completo na entrega (o CEP preenche rua, bairro e cidade pelo ViaCEP), CPF (opcional, para a nota fiscal), aniversário (opcional), observações e a caixa "Quero receber as promoções deste restaurante pelo WhatsApp", **desmarcada** por padrão. O servidor recalcula os preços pelo cardápio (com cupom, 10% de desconto) e numera os pedidos por restaurante (#1, #2…). Enviar a mesma sacola de novo não duplica o pedido. O navegador lembra nome, WhatsApp e endereço para o próximo pedido (o CPF não).

**Contato do cliente final:** o pedido cria o contato pelo telefone ou atualiza o que já existe. Ele só fica autorizado a receber mensagens se a caixa for marcada, e um descadastrado nunca volta a ser autorizado pelo pedido. A lista de **Contatos** mostra, calculados na hora a partir dos pedidos, quantos pedidos o cliente fez, quanto gastou e quando foi a última compra; a ficha ganha aniversário e bairro (vazio, vale o do último pedido).

**Acompanhamento:** depois do pedido, o cliente recebe o link `/pedido/:codigo`, que mostra o andamento (recebido, em preparo, saiu para entrega ou pronto para retirar, entregue) e se atualiza sozinho. A página não mostra telefone, CPF nem endereço.

## Filtros de público e ficha do cliente

Os filtros usam o histórico de pedidos (sem os cancelados), calculado na hora:

| Filtro | Exemplo |
|---|---|
| Quantidade de pedidos | 5 ou mais; máximo 0 = quem nunca comprou |
| Total gasto | a partir de R$ 300 |
| Dias desde a última compra | sem comprar há 30+ dias (quem nunca comprou não entra) ou compraram nos últimos 7 dias |
| Primeira e última compra | períodos de datas |
| Aniversário | no mês escolhido ou nos próximos N dias (até 60) |
| Bairro | o do contato ou, se vazio, o do último pedido |
| Item | o que o cliente mais pede, ou qualquer item que já pediu |
| Dia da semana preferido | o dia em que mais pediu |

Todos valem juntos, e junto com as tags. Na campanha, ficam em **Público → Filtrar por compras**, com a contagem de quem recebe atualizando na hora; mudar os filtros zera a aprovação do restaurante, como mudar as tags. Os modelos "Cliente sumido", "Clientes frequentes" e "Aniversariante" já vêm com o filtro certo. Em **Contatos**, o mesmo botão filtra a lista.

Clicar no nome de um contato abre a **ficha do cliente**: pedidos, total gasto, ticket médio, primeira e última compra, dia preferido, o que mais pede, o histórico de pedidos e as campanhas que recebeu (com leitura, clique e pedido). A ficha é só da agência, como a lista de contatos.

## Indicação com desconto

Na ficha do restaurante, aba **Indicação**, a agência liga o programa e define o desconto do indicado (R$ ou %), o pedido mínimo, até quando o programa vale, o cupom de quem indicou (valor, pedido mínimo e validade em dias) e as mensagens.

- O cliente final cria o próprio link em `/indicar/<restaurante>`: nome, WhatsApp, apelido do link (`/i/<restaurante>/marina`) e a mensagem de convite, com botão para mandar no WhatsApp. Um link por telefone; só o aparelho que criou o link consegue mudar a mensagem.
- Quem abre o link vê no site a faixa "Você foi indicado por Marina". O desconto vale só no **primeiro pedido daquele telefone** no restaurante (pedidos importados contam), acima do mínimo, e nunca para quem indicou. Os descontos não acumulam: vale o maior entre o cupom da casa ou da campanha, o da indicação e o cupom digitado.
- Quando o pedido indicado é **concluído**, quem indicou ganha um cupom de uso único (8 caracteres), enviado pelo WhatsApp com a mensagem da regra. Pedido cancelado não gera cupom. O cupom é digitado no campo "Tem um cupom?" da sacola, ou já vem preenchido pelo link da mensagem.
- Em **Indicações**, agência e restaurante veem os links (cliques, pedidos e vendas) e os cupons (enviado, usado, vencido ou não enviado); a agência pode reenviar um cupom.

## Pagamento online (Asaas)

Na ficha do restaurante, aba **Pagamento**, a agência liga o pagamento online, escolhe o provedor (**Simulador** para demonstrar, sem cobrar nada, ou **Asaas**), o ambiente (sandbox ou produção), cola a chave de API da conta Asaas **do restaurante** e escolhe Pix e/ou cartão, o prazo para pagar e a % de repasse para a agência. O dinheiro cai direto na conta do restaurante.

- A chave fica guardada cifrada (AES-256-GCM, com `ENCRYPTION_KEY` do `.env`) e nunca volta para a tela; aparece só o final. **Defina `ENCRYPTION_KEY` em produção e não troque depois.**
- No checkout, o cliente escolhe pagar na entrega/retirada, por **Pix** (QR Code e copia e cola na página do pedido) ou **cartão** (fatura do Asaas). Pagar online exige CPF.
- O pedido online só entra em **Novos** depois de pago (com aviso e som). Antes, aparece em "Aguardando pagamento". Não pago no prazo, é cancelado sozinho e o cupom usado volta.
- A confirmação vem pelo webhook do Asaas e, como reserva, pela própria página do pedido, que consulta o Asaas enquanto o pagamento está pendente. Para o webhook, cadastre no Asaas (Integrações → Webhooks) a URL e o token mostrados na aba Pagamento.
- Cancelar um pedido pago estorna o valor. Se o estorno falhar, o pedido é cancelado e o erro aparece no detalhe.
- Repasse para a agência: defina `AGENCY_ASAAS_WALLET_ID` e a % no restaurante (split do Asaas).

## Pedidos (painel)

Em **Pedidos**, agência e restaurante veem os pedidos em tempo real (o restaurante, só os dele):

- **Quadro** com Novos, Em preparo e Saiu para entrega / pronto. Pedido novo chega na hora, com aviso na tela e um som curto. Cada cartão tem o botão do próximo passo; o pedido só avança (pode pular passos) ou é cancelado, e concluído e cancelado são finais. Se duas pessoas mudarem o mesmo pedido ao mesmo tempo, a segunda recebe o aviso para recarregar.
- **Histórico** com filtros por situação, origem (site, campanha, planilha), período e busca por nome, telefone ou número.
- **Detalhe** com itens, endereço, WhatsApp, CPF, observações, histórico de status (com quem mudou) e o link de acompanhamento.

**Importar planilha** (só a agência): escolha o restaurante e de onde vêm os pedidos (iFood, caixa ou outro), envie ou cole o CSV e clique em **Conferir planilha**. A prévia mostra quantos pedidos entram, quantos já existiam (mesmo número de pedido), quantos contatos novos serão criados e os erros por linha, sem gravar nada. As colunas são reconhecidas pelo cabeçalho: número do pedido, data, cliente, telefone, total, desconto, bairro e itens (`2x Lasanha; 1 Suco`); número, data e total são obrigatórios. Os contatos novos da planilha só ficam autorizados se a agência confirmar o consentimento.

Excluir uma campanha não apaga mais os pedidos dela: eles ficam no histórico do restaurante, sem a campanha. As métricas das campanhas continuam contando só os pedidos que vieram dos links.

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
