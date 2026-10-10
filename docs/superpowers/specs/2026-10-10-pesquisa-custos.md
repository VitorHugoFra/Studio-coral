# Pesquisa de custos (insumo da etapa 7)

Preços consultados em 2026-10-10. Legenda: **C** confirmado na página oficial · **S** fonte secundária · **E** estimativa · **?** não confirmado.

## 1. Hospedagem do app (precisa de ~2 GB de RAM por causa do Chrome do PDF/WPPConnect)

| Opção | Configuração | Preço/mês | Observações | |
|---|---|---|---|---|
| Hostinger VPS (datacenter no Brasil) | KVM 1: 1 vCPU/4 GB · KVM 2: 2 vCPU/8 GB | R$ 29,99 / R$ 43,99 (promo); renova a R$ 59,99 / R$ 77,99 | promo provavelmente exige 24 meses pagos | C (prazo: E) |
| Locaweb VPS Linux (Brasil) | 2 vCPU/2 GB · 2 vCPU/4 GB | R$ 23,90 / R$ 53,90 (contrato 24 meses); renova a R$ 36,90 / R$ 72,90 | tráfego ilimitado | C |
| Magalu Cloud (São Paulo, por hora) | 1 vCPU/2 GB · 2 vCPU/2 GB · 1 vCPU/4 GB · 2 vCPU/4 GB | R$ 54,99 · R$ 69,99 · R$ 82,99 · R$ 102,99 | cobrança em reais; preço de saída de dados ambíguo | C |
| AWS Lightsail São Paulo | 2 GB · 4 GB | US$ 12 · US$ 24 | metade da franquia de tráfego dos EUA | C |
| Oracle Always Free | ~2 OCPU/12 GB Ampere, 200 GB disco, 10 TB saída | US$ 0 | só na região de origem; instância ociosa pode ser recolhida | C |
| Contabo | 4 vCPU/8 GB | ~€ 4,40–5,50 | sem datacenter na América do Sul | C |
| Railway | uso: ~US$ 10/GB RAM + US$ 20/vCPU por mês | app 2 GB ≈ US$ 20–30 | sem região na América do Sul | C/E |
| Render | Standard 2 GB/1 CPU | US$ 25 | sem região na América do Sul | C |
| Fly.io (São Paulo, multiplicador ×1,615) | 1 GB · 2 GB | ≈ US$ 10,82 · ≈ US$ 21,63 | sem plano gratuito | C/E |

## 2. PostgreSQL

| Opção | Preço | Plano gratuito / notas | |
|---|---|---|---|
| No mesmo VPS | R$ 0 a mais | fazer backup (pg_dump para o R2 gratuito) | E |
| Neon (tem São Paulo) | US$ 0,106/hora de computação + US$ 0,35/GB-mês | grátis: 100 h/projeto, 1 GB, dorme após 5 min | C |
| Supabase (tem São Paulo) | Pro US$ 25 (inclui US$ 10 de computação) | grátis: 500 MB, pausa após 1 semana parado | C |
| Render Postgres | US$ 6 (256 MB) · US$ 19 (1 GB) | o gratuito é apagado em 30 dias | C |
| Lightsail banco gerenciado | US$ 15 | | C |
| Magalu PostgreSQL (1 vCPU/4 GB) | R$ 94,22 | | C |
| AWS RDS db.t4g.micro São Paulo | ≈ US$ 25 + armazenamento | | S |

## 3. Domínio, SSL e armazenamento
- `.com.br` no Registro.br: R$ 40/ano (C, via busca).
- SSL Let's Encrypt: gratuito.
- Cloudflare R2: grátis até 10 GB e 1 milhão de gravações/mês; depois US$ 0,015/GB-mês, saída gratuita (C).

## 4. WhatsApp (API Oficial da Meta, Brasil), o maior custo

Cobrança por mensagem de template entregue (modelo vigente desde 1º/07/2025; tabela atual desde 1º/07/2026):

| Categoria | US$ | R$ |
|---|---|---|
| Marketing (sem desconto por volume) | 0,0625 | 0,3217 |
| Utilidade | 0,0068 | 0,0350 |
| Autenticação | 0,0068 | 0,0350 |
| Serviço (respostas fora de template) | 0,0068 | 0,0350 (?) |

- Há conflito sobre mensagens de serviço: a documentação ainda diz gratuitas, mas a calculadora e parceiros dizem cobradas desde 1º/10/2026 (1.000 grátis por número/mês). Orçar como cobradas.
- Faturamento em reais disponível desde 1º/07/2026 para clientes no Brasil (C).
- WPPConnect: gratuito, mas os termos do WhatsApp proíbem automação não oficial, com risco de banimento do número (C).
- Escala (E):
  - 5 restaurantes × 1.000–5.000 mensagens de marketing/mês ≈ US$ 310–1.560/mês;
  - 30 restaurantes ≈ US$ 1.875–9.375/mês (≈ R$ 9,7 mil–48 mil).

## 5. Asaas (pagamentos)
- **Mensalidade:** sem mensalidade nem adesão.
- **Pix e boleto:** R$ 1,99 por transação (R$ 0,99 nos 3 primeiros meses).
- **Cartão de crédito:**
  - à vista: 2,99% + R$ 0,49;
  - 2–6x: 3,49% + R$ 0,49;
  - 7–12x: 3,99% + R$ 0,49;
  - recebimento em D+32, com antecipação a 1,25%/mês.
- **Débito:** 1,89% + R$ 0,35.
- **Transferências:** Pix para CPF grátis; para CNPJ, 30 grátis/mês e depois R$ 2.
- **Webhooks e split:** sem custo listado. O split é calculado sobre o valor líquido.
- **Subcontas:** exigem conta-mãe CNPJ; no período de avaliação, no máximo 10 subcontas de R$ 2.000. Isso reforça a decisão pela conta própria de cada restaurante.
- **CPF/CNPJ é obrigatório** para criar o cliente, e toda cobrança precisa de um cliente (C). Alternativa: o Asaas Checkout (`POST /v3/checkouts`), em que o pagador preenche os dados na página do Asaas; não está confirmado se exige CPF ali (?).
- **Comparação:**
  - Mercado Pago: Pix 0,99%; cartão 4,98% (na hora) até 3,98% (D+30) (C).
  - Pagar.me: Pix 0,99%; cartão à vista 4,19% (C).
  - Com tíquete abaixo de ~R$ 201, os 0,99% de Pix ficam mais baratos que os R$ 1,99 fixos do Asaas (E).

## 6. Nota fiscal (NFC-e)

| Focus NFe | Preço/mês | CNPJs | Inclui | Excedente |
|---|---|---|---|---|
| Retail (NFC-e) | R$ 62,90 | 1 | 500 NFC-e + 100 NF-e | R$ 0,055 por NFC-e |
| Retail+ | R$ 657,90 | ilimitados | 9.000 NFC-e + 1.000 NF-e | R$ 0,065 por NFC-e |

- Sem adesão nem fidelidade; 30 dias de teste. A confirmar com a Focus: se o plano Retail inclui acesso por API.
- Escala (E): 5 restaurantes ≈ R$ 315/mês; com 10 restaurantes, o Retail+ empata.
- Alternativas:
  - NFE.io: R$ 220/mês por 2.000 notas;
  - Webmania: R$ 249,90/mês por 500 notas;
  - PlugNotas: preço sob consulta.

**O que cada restaurante precisa (MG):**
- inscrição estadual ativa e credenciamento na NFC-e pelo SIARE, que é irreversível e é quando sai o CSC;
- certificado digital e-CNPJ A1, ≈ R$ 203–275/ano (S).

**Entrega:** a NFC-e é permitida para entrega em domicílio dentro de MG (Resolução SEF 5.874/2025). Na entrega, a nota precisa ter **CPF e endereço do cliente**, ou a SEFAZ rejeita (S).

**Desde 1º/08/2026:** acabou a nota "série D".

## Não confirmado
- Cobrança das mensagens de serviço do WhatsApp.
- Taxa das subcontas Asaas e CPF no Asaas Checkout.
- Prazo da promoção da Hostinger.
- Preço do RDS em São Paulo.
- Parcelamento do Pagar.me.
- Saída de dados da Magalu.
- API no plano Retail da Focus.
