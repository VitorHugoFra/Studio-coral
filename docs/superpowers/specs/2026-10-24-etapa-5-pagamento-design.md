# Etapa 5: pagamento online pelo site (Asaas)

Data: 2026-10-24 · Branch: `feature/etapa-5-pagamento` · Roteiro: [2026-10-10-roteiro-plataforma.md](2026-10-10-roteiro-plataforma.md) · Custos: [2026-10-10-pesquisa-custos.md](2026-10-10-pesquisa-custos.md)

## Objetivo

O cliente final paga o pedido no site, por Pix ou cartão, direto na conta Asaas do restaurante. Quem prefere continua pagando na entrega ou na retirada.

Decisões do roteiro: Asaas **na conta do próprio restaurante** (ele cola a chave de API no painel, que fica guardada criptografada; a agência não toca no dinheiro); repasse automático opcional (split) de uma porcentagem para a agência; pagamento atrás de um contrato, como a mensageria, para dá para trocar de gateway. A pesquisa confirmou que o Asaas exige CPF/CNPJ do cliente para gerar a cobrança.

### Fora do escopo
- Cartão digitado no nosso site (exige PCI e tokenização): o cartão é pago na fatura do Asaas (`invoiceUrl`).
- Boleto e parcelamento.
- Nota fiscal (etapa 6) e conciliação financeira.
- Registro automático do webhook no Asaas: a agência cadastra a URL e o token mostrados no painel.

## Decisões

| Tema | Decisão | Motivo |
|---|---|---|
| Contrato | `PaymentGateway` (`createCharge`, `getCharge`, `cancelCharge`, `refund`, `testConnection`) com dois provedores: **Asaas** e **simulador** | Igual à mensageria; o simulador permite demonstrar e testar sem conta |
| Configuração | `restaurants.payment` (jsonb público: ligado, provedor, ambiente, formas aceitas, % de repasse, prazo) e `restaurants.payment_secret` (coluna interna, nunca devolvida) | A chave nunca sai da API, nem para a agência |
| Criptografia | AES-256-GCM com a chave de `ENCRYPTION_KEY` (sem ela, deriva de `SESSION_SECRET`, com aviso) | Chave de terceiros guardada cifrada; trocar a `ENCRYPTION_KEY` exige recadastrar as chaves |
| Webhook | `POST /webhooks/asaas/:restaurantId`, autenticado pelo cabeçalho `asaas-access-token`, com token derivado (HMAC) do restaurante | Um token por restaurante, sem guardar mais um segredo |
| Formas | Na entrega/retirada (como hoje), Pix (QR Code e copia e cola na página de acompanhamento) e cartão (fatura do Asaas) | Cartão sem PCI no nosso lado |
| CPF | Obrigatório para pagar online; continua opcional para pagar na entrega | Exigência do Asaas |
| Cliente no Asaas | Procurado pelo CPF (`GET /customers?cpfCnpj=`); se não existe, criado com notificações do Asaas desligadas | Não duplica cliente; o restaurante não recebe e-mails do Asaas por pedido |
| Quadro de pedidos | Pedido online aparece em Novos só depois de pago (aviso e som nessa hora); antes fica em "Aguardando pagamento" | A cozinha não prepara pedido não pago |
| Prazo | Pedido online não pago em `timeoutMinutes` (padrão 30) é cancelado e a cobrança apagada no Asaas; se o Asaas disser que já foi paga, vale o pagamento | Pix esquecido não fica pendurado |
| Confirmação | Webhook; e, como reserva, a página de acompanhamento consulta o Asaas a cada 15 s enquanto o pagamento está pendente | Funciona mesmo sem webhook (desenvolvimento, webhook pausado) |
| Cancelar pedido pago | Estorno total pelo gateway; se falhar, o pedido é cancelado e o erro do estorno fica visível no detalhe | O restaurante não perde a ação de cancelar |
| Repasse (split) | `split: [{ walletId: AGENCY_ASAAS_WALLET_ID, percentualValue }]` quando o restaurante tem % e a variável está definida | Opcional, como no roteiro |
| Cupom e cobrança que falha | Cobrança não gerada cancela o pedido e devolve o cupom usado | O cliente pode tentar de novo |

## Esquema (`migrations/006_pagamentos.sql`)

- `restaurants.payment jsonb`, `restaurants.payment_secret jsonb` (interna: `{ apiKeyEnc }`).
- `orders`: `payment_method` (`on_delivery`, `pix`, `card`; padrão `on_delivery`), `payment_status` (`none`, `pending`, `paid`, `expired`, `failed`, `refunded`; padrão `none`), `payment_provider`, `payment_id` (único quando existe), `payment_url`, `payment_pix jsonb` (`{ qrCode, copyPaste, expiresAt }`), `paid_at`, `payment_error`, `payment_checked_at`.

## Fluxo

1. **Configuração** (ficha do restaurante, aba **Pagamento**, só a agência): liga, escolhe provedor e ambiente, cola a chave (aparece só o final), escolhe Pix e/ou cartão, % de repasse e prazo. Botão **Testar conexão** (`GET /finance/balance`). A aba mostra a URL e o token do webhook para cadastrar no Asaas.
2. **Checkout**: o site mostra as formas aceitas. Online: o pedido é gravado com pagamento pendente (mesma transação, número, cupom e indicação da etapa 4) e, logo depois, a cobrança é criada. A resposta traz o Pix ou o link do cartão, e o site leva à página de acompanhamento.
3. **Acompanhamento**: com pagamento pendente, mostra o QR Code, o copia e cola e o prazo (ou o botão do cartão). No simulador, um botão "Simular pagamento".
4. **Pago** (webhook, consulta ou simulador): `payment_status = paid` (atualização condicional, idempotente), o pedido entra em Novos com aviso em tempo real.
5. **Vencido** (prazo, `PAYMENT_OVERDUE` ou `PAYMENT_DELETED`): pedido cancelado, pagamento `expired`, cupom devolvido.
6. **Cancelado pelo restaurante** depois de pago: estorno total; pagamento `refunded`.

## Erros

- Forma de pagamento não aceita, programa desligado ou chave ausente: 400 com a explicação.
- Sem CPF ou CPF inválido no pagamento online: 400.
- Gateway fora do ar ou chave inválida ao criar a cobrança: 502 "Não foi possível gerar o pagamento agora. Tente de novo ou escolha pagar na entrega."; o pedido fica cancelado e o cupom é devolvido.
- Webhook com token errado: 401. Evento desconhecido ou de cobrança que não é nossa: 200 sem efeito.

## Testes

1. Criptografia: cifra e decifra; chave errada falha; o valor guardado não contém a chave.
2. Asaas com `fetch` falso: cabeçalhos (`access_token`, User-Agent), ambiente certo, cliente procurado e criado, cobrança Pix e cartão, split, mapeamento dos status, erros da API.
3. Checkout com o simulador: online exige CPF e forma aceita; pedido pendente fora do quadro; pagamento confirma e publica o pedido; prazo vencido cancela e devolve cupom; falha do gateway cancela; cancelar pago estorna.
4. Webhook: token por restaurante, eventos de pago, vencido e estornado, repetidos sem efeito.
5. Painel: configuração sem vazar a chave (nem nas listas de restaurantes do restaurante), teste de conexão, URL do webhook.
6. Bateria atual passando, também pelo driver `pg`.
