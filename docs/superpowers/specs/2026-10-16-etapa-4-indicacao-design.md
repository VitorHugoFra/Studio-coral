# Etapa 4: indicação com desconto

Data: 2026-10-16 · Branch: `feature/etapa-4-indicacao` · Roteiro: [2026-10-10-roteiro-plataforma.md](2026-10-10-roteiro-plataforma.md)

## Objetivo

O cliente final indica o restaurante para os amigos com um link próprio. O amigo ganha desconto no primeiro pedido e, quando esse pedido é concluído, quem indicou recebe pelo WhatsApp um cupom de uso único.

Decisões do roteiro: o **restaurante** define a regra (desconto do indicado em % ou R$, pedido mínimo e validade); o **cliente final** personaliza o próprio link (`/i/<restaurante>/marina`) e a mensagem de convite; o desconto do indicado vale só no **primeiro pedido daquele telefone** no restaurante; **quem indicou ganha um cupom de uso único** quando o indicado faz o primeiro pedido, com o valor definido pelo restaurante, enviado pelo WhatsApp.

### Fora do escopo
- Ranking ou níveis de indicadores, cupom acumulado por várias indicações (cada indicação gera o seu cupom).
- Indicação em sites externos (o link leva ao site de pedidos da plataforma).
- Pagamento (etapa 5).

## Decisões

| Tema | Decisão | Motivo |
|---|---|---|
| Regra | `restaurants.referral` (jsonb), editada pela agência na ficha do restaurante, aba **Indicação** | Um programa por restaurante; o restaurante não edita a própria ficha hoje |
| Validade | Data final do programa (opcional) para o desconto do indicado; validade em dias para o cupom de quem indicou | "Validade" do roteiro, sem precisar de controle por visitante |
| Criação do link | Página pública `/indicar/<restaurante>`: nome, WhatsApp, apelido do link e mensagem de convite. Um link por telefone no restaurante | O cliente final não tem login; o telefone identifica |
| Editar o link | Só no mesmo aparelho: a criação devolve uma chave de edição guardada no navegador | Sem login, ninguém altera o link de outra pessoa |
| Contato | Quem cria o link vira contato (pelo telefone), **sem** autorização de marketing, a não ser que marque a caixa | Mesma regra LGPD do checkout |
| Primeiro pedido | O telefone não tem pedido (não cancelado) no restaurante, de nenhuma origem, inclusive importado | "Primeiro pedido daquele telefone" |
| Autoindicação | O telefone de quem compra não pode ser o do link | Evita desconto em causa própria |
| Desconto | Não acumula: vale o maior entre o cupom da casa ou da campanha, o da indicação e o cupom digitado | Regra simples de explicar no balcão |
| Pedido mínimo | Abaixo dele, o pedido entra sem o desconto da indicação, e a sacola avisa | O cliente não perde o pedido |
| Origem do pedido | `referral` quando o desconto da indicação foi o aplicado; o vínculo com o link fica em `orders.referral_id` | Etapa 2 já previa a origem |
| Cupom de quem indicou | Gerado quando o pedido indicado fica **concluído** (cancelado não gera). Um cupom por pedido indicado | Evita cupom por pedido que nunca aconteceu |
| Uso do cupom | Código de 8 caracteres, uso único, no campo "Tem um cupom?" do checkout, com pedido mínimo e validade; quem usa pode ser qualquer pessoa | O cupom é um presente; o código não é adivinhável |
| Envio do cupom | Mensagem pelo canal ativo, com o texto da regra (variáveis). Não envia para descadastrado nem para contato fictício fora do simulador; o cupom continua valendo e aparece no painel, com "reenviar" | Mesmas proteções da fila de campanhas |

## Esquema (`migrations/005_indicacoes.sql`)

- `restaurants.referral jsonb`: `{ enabled, discountType ('percent'|'fixed'), discountValue, minOrder, validUntil (AAAA-MM-DD), rewardType, rewardValue, rewardMinOrder, rewardValidDays, inviteMessage, rewardMessage }`. Vazio = programa desligado.
- `referral_links`: `restaurant_id`, `contact_id`, `slug`, `name`, `phone`, `phone_key`, `message`, `edit_token` (interno), `clicks`. Únicos: `(restaurant_id, slug)` e `(restaurant_id, phone_key)`.
- `coupons`: `restaurant_id`, `contact_id`, `referral_id`, `code`, `discount_type`, `discount_value`, `min_order`, `expires_at`, `origin_order_id` (único), `used_at`, `used_order_id`, `sent_at`, `send_error`. Único `(restaurant_id, code)`.
- `orders.referral_id` e `orders.coupon_id`.

O número da migração é 005 porque a criação de contas usa a 004; as duas não dependem uma da outra.

## Fluxo

1. **Programa**: a agência liga a indicação na ficha do restaurante e define desconto, mínimo, validade, recompensa e mensagens.
2. **Criar o link** (`POST /api/public/referrals`): devolve o link `/i/<restaurante>/<apelido>`, a mensagem pronta e o botão de compartilhar no WhatsApp. Apelido: letras, números e hífen, 3 a 30; sem apelido, vem do primeiro nome; repetido ganha um número.
3. **Abrir o link** (`GET /i/:restaurante/:apelido`): conta o clique (robôs de pré-visualização não contam) e leva ao site com `?indicacao=<apelido>`. O site guarda a indicação por 30 dias e mostra a faixa "Você foi indicado por Marina: R$ 10 no primeiro pedido acima de R$ 40".
4. **Checkout**: o pedido leva `referral` e, se houver, `couponCode`. Numa transação: confere as regras, escolhe o maior desconto, marca o cupom como usado (`UPDATE … WHERE used_at IS NULL`) e grava o pedido.
5. **Pedido concluído**: se veio de indicação e ainda não gerou cupom, cria o cupom de quem indicou e envia a mensagem.
6. **Painel → Indicações** (agência e restaurante, este só o próprio): links com cliques, pedidos indicados e faturamento; cupons com situação (enviado, falhou, usado, vencido) e "reenviar" (agência).

## Erros

- Cupom digitado inexistente, usado, vencido, de outro restaurante ou abaixo do mínimo: 400 com o motivo; o pedido não entra até a pessoa corrigir ou apagar o cupom.
- Indicação que não vale (programa desligado ou vencido, link inexistente, autoindicação, não é o primeiro pedido, abaixo do mínimo): o pedido entra sem esse desconto e a resposta diz o motivo (`referral.reason`), que o site mostra.
- Apelido repetido ou fora do padrão, telefone inválido: 400.

## Testes

1. Regra: normalização e validação da configuração; cálculo de % e R$, teto no subtotal, maior desconto.
2. Link: criação, apelido automático e repetido, um link por telefone, edição só com a chave, clique.
3. Checkout: desconto do indicado no primeiro pedido; não vale no segundo, abaixo do mínimo, com programa vencido ou desligado, nem para o próprio indicador; pedido importado conta como pedido anterior.
4. Cupom: gerado ao concluir (não ao cancelar), uma vez só, enviado pelo simulador com o texto da regra; usado uma vez, recusado depois, vencido e abaixo do mínimo; dois pedidos ao mesmo tempo com o mesmo cupom (um ganha).
5. Painel: listas e totais; restaurante vê só o próprio; reenviar.
6. Bateria atual passando, também pelo driver `pg`.
