# Etapa 2: pedidos, perfil de compra e painel de pedidos

Data: 2026-10-16 · Branch: `feature/etapa-2-pedidos` · Roteiro: [2026-10-10-roteiro-plataforma.md](2026-10-10-roteiro-plataforma.md)

## Objetivo

Transformar o registro de "conversões" em **pedidos de verdade**: o checkout do site passa a pedir os dados do cliente final, o pedido cria ou atualiza o contato, o restaurante acompanha e muda o status dos pedidos em tempo real, o cliente final acompanha o próprio pedido por um link, e a agência importa o histórico de pedidos de planilhas (caixa ou iFood). É a base dos filtros de público (etapa 3), da indicação (etapa 4), do pagamento (etapa 5) e da nota fiscal (etapa 6).

### Fora do escopo
- Pagamento online (etapa 5) e nota fiscal (etapa 6). O CPF já é pedido, mas é opcional enquanto não há cobrança nem nota.
- Filtros de público, ficha completa do cliente e relatórios novos (etapa 3). Aqui o perfil de compra aparece só como colunas na lista de contatos.
- Mensagem automática no WhatsApp a cada mudança de status (custo por mensagem na API Oficial; fica para depois).
- Taxa de entrega, área de entrega e tempo estimado.
- Criação de contas pela interface (acréscimo de 2026-10-13, sem etapa definida).

## Decisões

| Tema | Decisão | Motivo |
|---|---|---|
| Tabela | `conversions` é renomeada para `orders` (mesmas linhas, colunas novas) | Roteiro; os pedidos antigos continuam valendo |
| Origem (`source`) | `site`, `campaign`, `import`, `referral` (indicação, etapa 4) | Roteiro. Pedido do site vindo de um link de campanha é `campaign` |
| Atribuição | Continua sendo `campaign_id IS NOT NULL` | As métricas das campanhas não mudam |
| Campanha excluída | O pedido fica, sem a campanha (`ON DELETE SET NULL`) | Pedido é dado de venda do restaurante; a etapa 1 já previa a mudança |
| Status | `new` (recebido), `preparing` (em preparo), `dispatched` (saiu para entrega; na retirada, "pronto para retirar"), `completed` (concluído), `canceled` (cancelado) | Roteiro. Pedido importado ou vindo de site externo já nasce `completed` |
| Mudança de status | Só para a frente (pode pular etapas) ou para cancelado; concluído e cancelado são finais. `UPDATE … WHERE status = $atual`, com histórico acrescentado no SQL | Duas pessoas no painel não se atropelam, como na aprovação de campanhas |
| Preço | O servidor recalcula itens, subtotal, desconto e total a partir do cardápio | O preço não pode vir do navegador |
| Cupom | Mesma regra do site atual: com cupom (da campanha ou da casa), 10% de desconto | Mantém o comportamento; a etapa 4 traz as regras de desconto |
| Número do pedido | Sequencial por restaurante (`#1`, `#2`…), só para pedidos do site | Fácil de falar na cozinha e no balcão |
| Pedido repetido | O site manda uma chave aleatória por sacola (`orderKey`), gravada em `order_id`; reenviar devolve o mesmo pedido | Duplo clique ou rede instável não duplicam |
| Acompanhamento | Link `/pedido/:codigo`, com código aleatório de 12 caracteres; a página consulta o status a cada 15 s | Sem login para o cliente final; o código não é adivinhável |
| CEP | O navegador consulta o ViaCEP e preenche rua, bairro, cidade e UF; se falhar, digita-se à mão | Gratuito e sem chave |
| Dados do cliente no aparelho | Nome, WhatsApp e endereço ficam no `localStorage` do navegador para o próximo pedido (CPF não) | Facilita o segundo pedido |
| Perfil de compra | Calculado na hora a partir dos pedidos (decisão da etapa 1) | Nada é gravado em duplicidade no contato |

## Esquema (`migrations/003_pedidos.sql`)

### `orders` (antiga `conversions`)

Colunas novas:

| Coluna | Tipo | Observação |
|---|---|---|
| `number` | integer | Sequencial por restaurante; só pedidos do site |
| `tracking_code` | text | Único; só pedidos do site |
| `source` | text NOT NULL DEFAULT 'site' | `site`, `campaign`, `import`, `referral`. Na migração: `campaign` se tem campanha |
| `channel` | text | Detalhe livre da origem na importação (ex.: "iFood", "Caixa") |
| `status` | text NOT NULL DEFAULT 'completed' | Pedidos antigos ficam concluídos |
| `status_log` | jsonb NOT NULL DEFAULT '[]' | `[{ status, at, by }]` |
| `fulfillment` | text | `delivery` ou `pickup` (vazio nos importados e externos) |
| `phone` | text | WhatsApp do cliente, normalizado |
| `cpf` | text | Só dígitos, validado |
| `address` | jsonb | `{ cep, street, number, complement, neighborhood, city, state }` |
| `neighborhood` | text | Bairro (copiado do endereço; é o que os filtros usam) |
| `notes` | text | Observações do pedido |
| `subtotal`, `discount` | numeric(12,2) | `value` continua sendo o total |
| `coupon` | text | Cupom aplicado |

Restrições e índices: `tracking_code` único; `(restaurant_id, number)` único; `CHECK` de `status`, `source` e `fulfillment`; índice parcial `orders_active (restaurant_id, created_at)` só com os pedidos em andamento, para o quadro (o perfil de compra usa o `orders_contact`, que já existia). A FK de campanha passa a `ON DELETE SET NULL`. As restrições e índices herdados mudam de `conversions_*` para `orders_*`.

**Data do pedido:** `created_at` continua sendo a data da compra, como já é no seed e nas métricas. Na importação, ela vem da planilha: um pedido importado hoje com data de março conta como compra de março. Os importados não têm campanha, então não mudam as métricas das campanhas.

### `contacts`

Colunas novas: `birth_day smallint` (1–31), `birth_month smallint` (1–12), `birth_year smallint` (opcional), `neighborhood text` (bairro informado; se vazio, vale o do último pedido). `CHECK` nos intervalos; dia e mês vêm juntos.

### `restaurants`

Coluna nova: `order_seq integer NOT NULL DEFAULT 0`, o contador do número do pedido (`UPDATE … SET order_seq = order_seq + 1 RETURNING order_seq`, atômico).

## Arquitetura

```
src/db/repositories/orders.js   ← antigo conversions.js + quadro, histórico, status, importação e perfil de compra
src/services/OrderService.js     ← regras do pedido: checkout, contato, status e importação
src/services/orderInput.js       ← validação e normalização (telefone, CPF, CEP, datas, valores, itens da planilha)
src/http/public.js               ← POST /api/public/orders, GET /api/public/orders/:code, GET /pedido/:code
src/http/api.js                  ← /api/orders…
public/pedido.html               ← acompanhamento do pedido (cliente final)
public/demo.html                 ← checkout com os dados novos
public/app.html + app.js         ← página Pedidos (quadro, histórico, detalhe, importação) e perfil na lista de contatos
```

### Checkout do site (`POST /api/public/orders`)

Corpo: `restaurantSlug`, `ref` (código do link da campanha, opcional), `orderKey`, `items: [{ id, qty, note }]`, `customer: { name, phone, cpf?, birthDay?, birthMonth?, birthYear? }`, `fulfillment`, `address` (na entrega), `notes`, `marketingOptIn`.

Validação, com mensagem clara por campo (400): nome; WhatsApp brasileiro válido; CPF com dígitos verificadores (se informado); itens do cardápio (id existente, quantidade de 1 a 50, até 50 linhas); na entrega, CEP de 8 dígitos, rua, número, bairro e cidade; aniversário com dia e mês válidos e ano entre 1900 e o ano atual.

Numa transação:
1. Pedido repetido (`orderKey` já gravado no restaurante): nada muda e devolve o pedido existente.
2. Recalcula os itens com o preço do cardápio, o subtotal, o desconto e o total.
3. **Contato pelo telefone** (mesma `phone_key` no restaurante):
   - não existe: é criado com nome, aniversário e `opt_in` igual à caixa de promoções (origem "Pedido no site");
   - existe: completa o nome se estiver vazio e grava o aniversário informado. A caixa marcada autoriza quem ainda não estava autorizado; desmarcada, não muda nada. **Descadastrado continua descadastrado.**
4. Atribuição: com `ref` válido do mesmo restaurante, grava campanha e mensagem, marca a mensagem como convertida e a origem vira `campaign`.
5. Reserva o próximo número e grava o pedido com status `new`, código de acompanhamento e a primeira entrada do histórico.

Resposta 201: `{ ok, id, number, trackingCode, trackingUrl, subtotal, discount, total }`. Evento em tempo real `order` (com `restaurantId`, para o painel do restaurante).

`POST /api/public/conversions` e o script `/t.js` continuam funcionando para sites externos: gravam em `orders` com origem `campaign` (com `ref`) ou `site`, status `completed`, sem contato novo.

### Painel de pedidos (`#/pedidos`)

Agência e restaurante (o restaurante vê só os próprios pedidos; a rota é liberada para ele).

- **Quadro** com três colunas: Novos, Em preparo, Saiu para entrega / pronto. Cada cartão mostra número, nome, há quanto tempo chegou, itens, total, entrega ou retirada com o bairro, e o botão do próximo passo. Chegou pedido novo: aparece na hora (evento `order`), com aviso na tela.
- **Histórico**: tabela com filtro por status, origem, período e busca (nome, telefone ou número), até 200 linhas.
- **Detalhe** (janela): itens com observação, endereço, WhatsApp, CPF, observações, histórico de status, link de acompanhamento, botões de status e cancelamento.
- Rotas: `GET /api/orders` (filtros; `active=1` para o quadro), `GET /api/orders/:id`, `PUT /api/orders/:id/status` (`{ status }`; 409 se outra pessoa mudou antes). Evento `order:update`.

### Acompanhamento (`/pedido/:codigo`)

Página pública com a marca do restaurante: número, linha do tempo (recebido → em preparo → saiu para entrega ou pronto para retirar → entregue/retirado), horários de cada passo, itens e total. Pedido cancelado mostra o cancelamento e o telefone do restaurante. **Não mostra** telefone, CPF nem endereço (quem tem o link vê só o andamento). `GET /api/public/orders/:code` devolve esses dados.

Depois do pedido, o site mostra o botão **Acompanhar pedido** e guarda o código no aparelho: voltando ao cardápio com um pedido em andamento, aparece o atalho para acompanhá-lo.

### Importação de pedidos (agência)

Em **Pedidos → Importar planilha**: escolher o restaurante, o canal (Caixa, iFood, outro), colar ou enviar o CSV.

- O navegador separa as colunas pelo cabeçalho (número do pedido, data, cliente, telefone, total, desconto, bairro, itens), como já faz na importação de contatos. O servidor normaliza e valida cada linha: é a única regra.
- **Prévia** (`POST /api/orders/import/preview`): quantos pedidos entram, quantos já existem (mesmo número de pedido no restaurante, inclusive repetidos na própria planilha), quantos contatos novos serão criados e a lista de erros por linha (sem número, data ou total inválidos, telefone inválido). Nada é gravado.
- **Gravar** (`POST /api/orders/import`): a mesma validação, numa transação; repetidos são ignorados (`ON CONFLICT DO NOTHING`). Telefone sem contato cria o contato **sem autorização**, a não ser que a agência marque "Os clientes desta planilha autorizaram receber mensagens"; contatos existentes não mudam de autorização.
- Formatos aceitos: data `dd/mm/aaaa [hh:mm]` ou `aaaa-mm-dd[Thh:mm]`; valores `1.234,56`, `1234,56`, `1234.56`, com ou sem `R$`; itens `2x Lasanha; 1 Suco` (sem preço por item).
- Pedidos importados: origem `import`, status `completed`, data da compra (`created_at`) da planilha.

### Contatos e perfil de compra

- A ficha do contato ganha aniversário (dia, mês e ano opcional) e bairro.
- A lista de contatos ganha, calculados na hora a partir dos pedidos: quantidade de pedidos, total gasto, primeira e última compra e o bairro efetivo (o do contato ou, se vazio, o do último pedido). Uma consulta agrupada por `contact_id` (`orders.profiles(restaurantId)`), sem consulta por contato.

## Dados de demonstração (`npm run seed`)

- Cerca de 6 meses de pedidos por restaurante, com mais pedidos no fim de semana (Cantina) e no almoço de dias úteis (Sabor de Minas), clientes que voltam com frequências diferentes e bairros da cidade.
- Os contatos de demonstração ganham aniversário (parte deles) e bairro (parte deles). Entram clientes que pediram sem marcar a caixa de promoções (contatos sem autorização).
- Origens misturadas: site, importados do iFood e do caixa, e os pedidos das campanhas, como hoje.
- Alguns pedidos de hoje em Novos, Em preparo e Saiu para entrega, para o quadro não abrir vazio.

## Erros

- Validação do checkout e da importação: mensagens em português, por campo ou por linha.
- Restaurante inexistente: 404. `ref` de outro restaurante: o pedido entra sem atribuição.
- Mudança de status inválida (para trás, ou a partir de concluído/cancelado): 400 com a explicação. Status mudado por outra pessoa: 409.
- Pedido repetido no checkout: 200 com o pedido existente (`duplicated: true`).

## Testes

1. **Migração** (`test/db`): a migração 003 sobre um banco com conversões da etapa 1 mantém as linhas, com origem e status certos; os nomes de tabela e índices; excluir campanha mantém o pedido.
2. **Validação** (`test/services`): telefone, CPF, CEP, aniversário, datas e valores da planilha, itens da planilha.
3. **Checkout** (`test/http`): pedido válido com preço recalculado e desconto; erros por campo; contato criado com e sem a caixa marcada; contato existente autorizado pela caixa; descadastrado continua descadastrado; pedido pelo link da campanha atribuído; pedido repetido; número sequencial por restaurante; acompanhamento sem dados pessoais.
4. **Painel de pedidos**: quadro e histórico com filtros; restaurante vê só os próprios pedidos e muda o status; transições inválidas; corrida de duas mudanças ao mesmo tempo (uma ganha, a outra recebe 409).
5. **Importação**: prévia sem gravar; erros por linha; repetidos ignorados (no banco e na própria planilha); contatos novos com e sem consentimento.
6. **Perfil de compra** na lista de contatos.
7. Os testes atuais continuam passando, com dois ajustes previstos: excluir campanha não apaga mais os pedidos dela, e a tabela se chama `orders`. A bateria HTTP roda também pelo driver `pg` (`npm run test:pg`).

## Critérios de aceite

1. `npm test` passa.
2. Conferido no navegador:
   - pedido no site de demonstração com entrega (CEP preenchendo o endereço), com e sem a caixa de promoções;
   - o pedido aparece na hora no quadro do restaurante; mudar o status atualiza a página de acompanhamento;
   - pedido pelo link de uma campanha conta na campanha;
   - importação de uma planilha com prévia, erros e repetidos;
   - lista de contatos com pedidos e última compra.
3. README atualizado (pedidos, acompanhamento, importação de pedidos).

## Limites conhecidos

- O preço do pedido é o do cardápio na hora do pedido; mudar o cardápio depois não altera pedidos antigos (os itens ficam gravados com o preço).
- A página de acompanhamento consulta a cada 15 s, em vez de receber eventos: simples e suficiente para o volume de um restaurante.
- O ViaCEP é um serviço externo e gratuito; fora do ar, o cliente digita o endereço.
