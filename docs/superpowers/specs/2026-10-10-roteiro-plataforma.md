# Roteiro: clientes, pedidos, indicações e pagamentos

Data: 2026-10-10 · Branch: `feature/clientes-pedidos-pagamentos`

Registro das decisões tomadas com o Vitor antes de começar. Cada etapa tem o próprio documento de desenho (`docs/superpowers/specs/`), plano de implementação e testes, e só começa depois que a anterior estiver funcionando.

## Vocabulário

- **Cliente**: o restaurante, cliente da agência.
- **Cliente final**: quem compra no restaurante.

## Etapas

| # | Etapa | Depende de | Situação |
|---|---|---|---|
| 1 | Banco de dados: tudo o que está no `data/db.json` passa para o PostgreSQL | — | desenho aprovado |
| 2 | Pedidos e perfil de compra do cliente final, painel de pedidos do restaurante | 1 | a desenhar (rascunho abaixo) |
| 3 | Filtros de público, ficha do cliente e relatórios | 2 | a desenhar |
| 4 | Indicação com desconto | 2 | a desenhar (decisões abaixo) |
| 5 | Pagamento online pelo site (Asaas) | 2 | a desenhar (decisões abaixo) |
| 6 | Nota fiscal (Focus NFe) | 5 | a desenhar |
| 7 | Documento de custos para publicar o sistema | — | pesquisa em andamento |

## Decisões já tomadas

### Banco de dados (etapa 1)
- PostgreSQL. Em produção, pela `DATABASE_URL`; no desenvolvimento e nos testes, PGlite (PostgreSQL embutido, sem instalar nada).
- SQL escrito à mão com a biblioteca `pg`, organizado em repositórios. Sem ORM.
- Os números de cada cliente (última compra, total de pedidos etc.) são **calculados na hora** a partir dos pedidos, e não gravados no contato.

### Pedidos (etapa 2, rascunho aprovado em conversa)
- O histórico de compras vem de **duas fontes**: o site de pedidos e a importação de planilha (CSV do caixa ou do iFood).
- O checkout do site passa a pedir WhatsApp (obrigatório), endereço completo na entrega (com preenchimento pelo CEP), aniversário (opcional) e a caixa "Quero receber promoções pelo WhatsApp", **desmarcada** por padrão (LGPD).
- O pedido cria ou atualiza o contato pelo telefone. Só autoriza mensagens se a caixa for marcada e nunca desfaz um descadastro.
- A importação de pedidos não duplica (chave: número do pedido) e mostra prévia e erros antes de gravar. Contatos novos da planilha só ficam autorizados se a agência confirmar o consentimento.
- A coleção `conversions` vira `orders`, com telefone, endereço, bairro, origem (site, planilha, campanha, indicação) e desconto. As métricas das campanhas continuam contando só pedidos atribuídos a campanhas.
- Contato ganha aniversário (dia/mês, ano opcional) e bairro (se vazio, vale o do último pedido).
- Painel de pedidos do restaurante: pedidos do site em tempo real, com status (novo, em preparo, saiu para entrega, concluído, cancelado).
- O `seed` passa a gerar uns 6 meses de pedidos de demonstração.

### Filtros de público (etapa 3)
Pedidos pelo Vitor: última compra (data e dias desde), quantidade de pedidos, aniversário, item mais comprado, bairro, data da primeira e da última compra, dia da semana preferido, total de pedidos. Também: melhorar relatórios e dados de compra.

### Indicação (etapa 4)
- O **restaurante** define a regra: desconto do indicado (% ou R$), pedido mínimo e validade.
- O **cliente final** personaliza o próprio link (ex.: `/i/<restaurante>/marina`) e a mensagem de convite.
- O desconto do indicado vale só no primeiro pedido daquele telefone no restaurante.
- **Quem indicou ganha um cupom de uso único** quando o indicado faz o primeiro pedido. O restaurante define o valor, e o cupom é enviado pelo WhatsApp.

### Pagamento (etapa 5)
- Asaas, **na conta do próprio restaurante**: ele cola a chave de API no painel, que fica guardada criptografada. A agência não toca no dinheiro.
- Opcional: repasse automático (split) de uma % para a agência.
- A confirmar na pesquisa: se o Asaas exige CPF do cliente final para gerar a cobrança.

### Nota fiscal (etapa 6)
- Focus NFe ou equivalente. Detalhes (quando emitir, dados fiscais do cardápio, certificado A1 e CSC de cada restaurante) ficam para o desenho da etapa.

### Custos (etapa 7)
- Documento com cenários de 2–5, ~10 e ~30 restaurantes: hospedagem, banco, domínio, WhatsApp (API Oficial × WPPConnect), Asaas, Focus NFe, certificado digital.
