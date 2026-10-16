# Roteiro: clientes, pedidos, indicações e pagamentos

Data: 2026-10-10 · Branch: `feature/clientes-pedidos-pagamentos`

Registro das decisões tomadas com o Vitor antes de começar. Cada etapa tem o próprio documento de desenho (`docs/superpowers/specs/`), plano de implementação e testes, e só começa depois que a anterior estiver funcionando.

## Vocabulário

- **Cliente**: o restaurante, cliente da agência.
- **Cliente final**: quem compra no restaurante.

## Etapas

| # | Etapa | Depende de | Situação |
|---|---|---|---|
| 1 | Banco de dados: tudo o que está no `data/db.json` passa para o PostgreSQL | — | concluída |
| 2 | Pedidos e perfil de compra do cliente final, painel de pedidos do restaurante | 1 | implementada, aguardando conferência ([desenho](2026-10-16-etapa-2-pedidos-design.md)) |
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
- Pesquisa de preços salva em [2026-10-10-pesquisa-custos.md](2026-10-10-pesquisa-custos.md).

## Achados da pesquisa que afetam as próximas etapas
- **CPF no checkout (etapas 2, 5 e 6):** o Asaas exige CPF/CNPJ para gerar cobrança. A NFC-e de entrega precisa de CPF e endereço do cliente. O checkout da etapa 2 já deve pedir CPF: opcional na retirada sem nota, obrigatório para pagar online ou receber nota de entrega.
- **Taxa do Pix (etapa 5):** o Asaas cobra R$ 1,99 fixo por Pix; Mercado Pago e Pagar.me cobram 0,99%. Para tíquetes abaixo de ~R$ 201, os dois saem mais baratos no Pix. Em compensação, o cartão do Asaas é mais barato (2,99% + R$ 0,49, recebendo em 32 dias). Reavaliar no desenho da etapa 5, mantendo o pagamento atrás de um contrato (como a mensageria), para dá para trocar de gateway.
- **WhatsApp é o maior custo:** cada mensagem de marketing pela API Oficial custa ~R$ 0,32. Com 30 restaurantes, são R$ 9,7 mil–48 mil/mês, e esse custo precisa entrar no preço cobrado dos restaurantes.
- **Nota fiscal (etapa 6):** Focus NFe Retail custa R$ 62,90/mês por CNPJ, com 500 NFC-e. Cada restaurante precisa de inscrição estadual, credenciamento na NFC-e em MG (irreversível) e certificado A1 (~R$ 200–275/ano).

## Acréscimos ao roteiro (2026-10-13)
- **Criação de contas:** tela para cadastrar acessos (agência cria restaurantes e usuários; restaurante convida a equipe), com troca e recuperação de senha. Hoje não há como criar login pela interface.
- **Acompanhar pedido (cliente final):** página/link onde o cliente vê o status do pedido feito pelo site (recebido, em preparo, saiu para entrega, entregue). Entra na Etapa 2, junto com o painel de pedidos. *Feito na etapa 2 (`/pedido/:codigo`).*
- **Mais informações no pedido:** pedir no checkout os dados que os filtros e a nota precisam: nome, telefone, CPF (opcional, para a NFe), endereço com bairro, data de aniversário e observações. Entra na Etapa 2. *Feito na etapa 2.*
