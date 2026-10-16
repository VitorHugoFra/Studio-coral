# Etapa 3: filtros de público, ficha do cliente e relatórios

Data: 2026-10-16 · Branch: `feature/etapa-3-filtros` (a partir de `feature/etapa-2-pedidos`) · Roteiro: [2026-10-10-roteiro-plataforma.md](2026-10-10-roteiro-plataforma.md)

## Objetivo

Usar o histórico de pedidos da etapa 2 para escolher quem recebe cada campanha, ver tudo sobre um cliente num lugar só e mostrar ao restaurante as vendas de todos os canais, não só as das campanhas.

Filtros pedidos pelo Vitor: última compra (data e dias desde), quantidade de pedidos, aniversário, item mais comprado, bairro, data da primeira e da última compra, dia da semana preferido e total de pedidos.

### Fora do escopo
- Salvar filtros com nome ("públicos salvos") e reaproveitar entre campanhas: a campanha duplicada já leva os filtros.
- Filtros que combinam com "ou" (todos os filtros valem juntos, com "e"; as tags continuam com "qualquer uma" ou "todas").
- Exportar a lista de contatos filtrada.

## Decisões

| Tema | Decisão | Motivo |
|---|---|---|
| Onde ficam | `segment.filters` da campanha, ao lado de `tags` e `match` | O público é calculado na hora do disparo, como hoje; duplicar a campanha leva os filtros |
| Cálculo | SQL, numa consulta: estatísticas por contato a partir de `orders` (sem os cancelados) | Decisão da etapa 1: nada gravado em duplicidade no contato |
| "Total de pedidos" | Valor total gasto (R$); "quantidade de pedidos" é a contagem | São dois itens diferentes na lista |
| Dias desde a última compra | "No mínimo N dias" (sumidos) e "no máximo N dias" (recentes). Quem nunca comprou não entra nesses filtros | Reativação é de quem já comprou |
| Quem nunca comprou | "Quantidade de pedidos: no máximo 0" | Sem filtro especial |
| Aniversário | No mês escolhido ou nos próximos N dias (1 a 60). Nos próximos dias, 29/02 entra junto com 28/02 em ano não bissexto | Dia e mês ficam no contato; o ano é opcional |
| Item mais comprado | O item com mais unidades nos pedidos do cliente (empate: o comprado por último). Opção "já comprou" para qualquer pedido | Campanha de lançamento costuma mirar quem já pediu algo parecido |
| Bairro | O do contato; se vazio, o do último pedido com bairro (regra da etapa 2). Sem diferenciar maiúsculas | — |
| Dia da semana preferido | O dia com mais pedidos, no fuso do servidor (`TZ`) | Mesma regra de dias dos relatórios |
| Datas | `AAAA-MM-DD`, dia inteiro no fuso do servidor | Igual ao histórico de pedidos |
| Aprovação | Mudar os filtros zera a aprovação do restaurante | Mudou quem recebe, como já acontece com as tags |
| Ficha do cliente | Página `#/contatos/:id` (só a agência, como os contatos) | O restaurante continua sem ver a base |
| Relatório | Página 3 nova: vendas do restaurante no mês, todos os canais | As páginas 1 e 2 seguem só com as campanhas |

## Filtros (`segment.filters`)

Todos opcionais; vazios são descartados ao salvar.

| Campo | Formato | Regra |
|---|---|---|
| `orders` | `{ min, max }` inteiros ≥ 0 | quantidade de pedidos |
| `spent` | `{ min, max }` em reais ≥ 0 | total gasto |
| `lastOrderDays` | `{ min, max }` inteiros ≥ 0 | dias desde a última compra |
| `firstOrder`, `lastOrder` | `{ from, to }` datas | período da primeira / última compra |
| `birthday` | `{ month }` (1–12) ou `{ nextDays }` (1–60) | aniversário |
| `neighborhoods` | lista de textos (até 30) | bairro efetivo é um deles |
| `items` | lista de nomes (até 30) + `itemsMode` `top` ou `any` | item mais comprado é um deles / já comprou um deles |
| `weekdays` | lista de 0 (domingo) a 6 | dia preferido é um deles |

`min` maior que `max`, data inválida, mês fora de 1–12 etc.: erro 400 com a explicação.

## Arquitetura

```
src/services/audienceFilters.js     ← normaliza e valida os filtros; pares (mês, dia) dos próximos N dias
src/db/repositories/contacts.js     ← search(): contatos + estatísticas de compra + filtros, numa consulta
                                       audience() passa a usar search() (só autorizados)
                                       facets(): bairros e itens com contagem, para as opções dos filtros
src/db/repositories/orders.js       ← byContact() (ficha) e monthSales() (relatório)
src/db/repositories/messages.js     ← byContact() (ficha: campanhas recebidas)
src/http/api.js                     ← filtros em /campaigns, /audience/preview e /contacts; /contacts/facets; GET /contacts/:id
src/services/ReportService.js       ← bloco sales no relatório mensal
public/app.html + app.js            ← janela de filtros (campanha e contatos), ficha do cliente
public/relatorio.html               ← página 3
```

### Consulta (`contacts.search`)

Uma CTE agrega `orders` por `contact_id` (restaurante e status `<> 'canceled'`): quantidade, soma, primeira e última compra, bairro do último pedido com bairro e o dia da semana mais frequente (`mode()` sobre `extract(dow FROM created_at AT TIME ZONE $tz)`). Outra CTE escolhe o item mais comprado (`jsonb_array_elements(items)`, somando `qty`). O `LEFT JOIN` com os contatos aplica tags, situação e filtros. Devolve o contato com `purchase: { orders, total, firstAt, lastAt, lastNeighborhood, weekday, topItem }`, na ordem de cadastro (`seq`), que é a ordem de envio.

A lista de contatos (`GET /contacts`) usa a mesma consulta, com os filtros em `?filters=<JSON>`. O `orders.profiles` da etapa 2 sai: a consulta nova cobre o perfil de compra.

### Ficha do cliente (`GET /api/contacts/:id`)

Contato com o perfil de compra, mais:
- números: pedidos, total, ticket médio, primeira e última compra, dias desde a última, dia preferido, item mais comprado, bairro;
- itens que mais pediu (top 5, com quantidade);
- pedidos (até 100, do mais novo), com origem, situação e valor;
- campanhas recebidas (até 50): campanha, situação da mensagem, leitura, clique e se virou pedido.

No painel, o nome do contato na lista abre a ficha; a ficha tem os botões que a lista já tinha (editar, descadastrar).

### Relatório mensal: página 3, "Vendas do restaurante"

Todos os pedidos do mês, exceto cancelados, de todas as origens:
- pedidos, faturamento e ticket médio, com a variação sobre o mês anterior;
- clientes que compraram, novos (primeira compra no mês) e que voltaram;
- por origem (site, campanha, planilha), com pedidos e faturamento;
- bairros com mais pedidos (top 5) e itens mais vendidos (top 6);
- clientes para reativar: já compraram, mas não compram há mais de 30 dias no fim do mês (ou hoje, no mês corrente), e quantos deles estão autorizados a receber mensagem.

## Interface

- **Campanha → Público**: além das tags, o botão **Filtrar por compras** abre a janela de filtros, com a contagem de quem recebe atualizando a cada mudança. Os filtros ativos aparecem como etiquetas com resumo ("sem pedir há 30+ dias", "3+ pedidos", "aniversário em outubro") e um "limpar".
- **Contatos**: o mesmo botão e as mesmas etiquetas filtram a lista (todas as situações; a contagem na janela é de autorizados, como na campanha).
- **Modelos de campanha**: "Cliente sumido" passa a usar "sem pedir há 30+ dias"; "Clientes frequentes", "5+ pedidos"; "Aniversariante", "aniversário nos próximos 30 dias". Nesses três, o filtro de compras substitui a tag manual (inativo, vip, aniversariante); nos outros modelos, as tags continuam valendo quando o restaurante as tem.
- O resumo dos filtros aparece também no passo Envio, na página da campanha e na tela de aprovação do restaurante.

## Testes

1. **Filtros** (`test/services`): normalização (vazios saem, números, datas, mês, próximos dias, listas), erros, pares de aniversário com virada de ano e 29/02.
2. **Público** (`test/http`): cada filtro sozinho e combinados, com pedidos de datas, bairros, itens e dias da semana controlados; quem nunca comprou; cancelados não contam; disparo de campanha com filtro envia só para quem passa; mudar filtro zera a aprovação; restaurante não usa as rotas de contatos.
3. **Ficha do cliente**: números, itens, pedidos e campanhas recebidas; 404 para id inválido ou de restaurante que não existe.
4. **Relatório**: página de vendas com todas as origens, novos e recorrentes, bairros, itens, reativação; cancelados fora.
5. A bateria atual continua passando, também pelo driver `pg`.

## Critérios de aceite

1. `npm test` passa.
2. Conferido no navegador: campanha com filtro de compras (contagem certa e disparo no simulador), lista de contatos filtrada, ficha do cliente, página 3 do relatório e PDF com 3 páginas.
3. README atualizado.
