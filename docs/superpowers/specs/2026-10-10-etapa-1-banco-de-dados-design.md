# Etapa 1: do arquivo JSON para o PostgreSQL

Data: 2026-10-10 · Branch: `feature/clientes-pedidos-pagamentos` · Roteiro: [2026-10-10-roteiro-plataforma.md](2026-10-10-roteiro-plataforma.md)

## Objetivo

Trocar o armazenamento em `data/db.json` por PostgreSQL **sem mudar o comportamento** do sistema: as mesmas telas, rotas, respostas e regras. É a base das etapas seguintes (pedidos, pagamento e nota fiscal precisam de transações e de consultas que o JSON não oferece).

### Fora do escopo
- Funcionalidades novas, inclusive renomear `conversions` para `orders` (fica para a etapa 2).
- Imagens enviadas: continuam em `data/uploads`.
- Rodar mais de uma instância do servidor (ver "Limites conhecidos").

## Decisões

| Tema | Decisão | Motivo |
|---|---|---|
| Banco | PostgreSQL | Padrão de mercado, opções gerenciadas e fácil de rodar numa VPS |
| Produção | Driver `pg` com pool, configurado por `DATABASE_URL` | — |
| Desenvolvimento e testes | `@electric-sql/pglite`: PostgreSQL embutido. Em `data/pgdata` no desenvolvimento, em memória nos testes | Não exige instalar PostgreSQL nem Docker no Windows |
| Acesso a dados | SQL escrito à mão em repositórios, sem ORM | Poucas dependências, igual ao estilo do projeto; os filtros da etapa 3 serão SQL |
| Esquema | Arquivos `migrations/NNN_nome.sql`, aplicados ao subir o servidor | Histórico versionado e aplicado sozinho |

## Arquitetura

```
src/db/
├── Database.js          ← adaptador único: query/many/one/tx/close (pg ou PGlite)
├── migrate.js           ← aplica migrations/*.sql em ordem, registrando em schema_migrations
├── mapper.js            ← snake_case ⇄ camelCase, Date → ISO, numeric → Number
└── repositories/
    ├── index.js         ← createRepositories(db) + repos.tx(fn)
    ├── restaurants.js
    ├── contacts.js
    ├── campaigns.js
    ├── messages.js
    ├── conversions.js
    ├── users.js
    └── settings.js
migrations/
└── 001_esquema_inicial.sql
src/app.js               ← createApp(): migra, carrega configurações, semeia (se vazio) e monta o Express
src/server.js            ← só sobe o createApp() e trata desligamento
scripts/importar-json.js ← copia um db.json para o banco
```

### Adaptador `Database`
- `Database.open(config)`: com `DATABASE_URL`, usa `pg.Pool`; sem ela, PGlite em `config.pgliteDir`. Nos testes, `memory://`.
- Interface: `query(sql, params) → { rows }`, `many()`, `one()` (linha ou `null`), `tx(async (db) => …)` (BEGIN/COMMIT/ROLLBACK num cliente dedicado) e `close()`.
- Os serviços e as rotas nunca escrevem SQL; só os repositórios escrevem.

### Repositórios
- Um arquivo por entidade, assíncronos, devolvendo objetos no **mesmo formato de hoje**: camelCase, datas como texto ISO (`2026-10-10T12:57:20.235Z`) e valores numéricos como `Number`.
- `update(linhaOuId, patch)` roda `UPDATE … RETURNING *`. Quando recebe o objeto, copia o resultado nele, como o `Collection.update` faz hoje, para que quem guardou a referência continue vendo o estado atual.
- `repos.tx(async (r) => …)` entrega os mesmos repositórios ligados a uma transação.
- Colunas internas (ex.: `phone_key`) não aparecem nos objetos devolvidos.
- Consultas específicas substituem os `filter(fn)` atuais. Exemplos: `contacts.listByRestaurant(id, { tag, status, search })`, `contacts.audience(restaurantId, segment)` (com `tags && $1` para "qualquer" e `tags @> $1` para "todas"), `messages.claimNextQueued(campaignId)` e `conversions.findByOrderId(restaurantId, orderId)`.

### Configurações (`settings`)
Uma linha com `data jsonb`. O repositório carrega as configurações uma vez ao subir (`await settings.load()`) e mantém cópia em memória. `get()` continua **síncrono** (usado pelo `TemplateService` e pelo registro da mensageria). `update()` grava no banco e atualiza a cópia.

### Contagens e indicadores
- **Uma única implementação das regras de contagem, em SQL**: `messages.summary(filtro)` (com `count(*) FILTER (WHERE …)`) e `conversions.summary(filtro)` devolvem as contagens brutas.
- O `AnalyticsService` só calcula as taxas a partir delas, no mesmo formato de hoje: `processed`, `progress`, `deliveryRate`, `readRate`, `clickRate`, `conversionRate`, `ticket`.
- Regras copiadas de `summarize()`:
  - `queued`: status `queued` ou `sending`;
  - `sent`: tem `sent_at`;
  - `delivered`: tem `delivered_at` ou status `delivered`/`read`;
  - `read`: tem `read_at` ou status `read`;
  - `failed`/`skipped`: pelo status;
  - `clicked`: tem `clicked_at`, e `clicks` é a soma;
  - `replied`: tem `replied_at`;
  - `optOuts`: `opt_out`;
  - `orders`/`revenue`: contagem e soma dos pedidos, com receita arredondada em 2 casas.
- Lista de campanhas: as estatísticas vêm de **uma consulta agrupada** por `campaign_id`, e não de uma consulta por campanha.
- Séries por dia, por dia da semana e itens mais pedidos continuam agrupadas em JavaScript, no fuso do servidor como hoje, sobre as linhas do período (14 dias no painel, o mês no relatório). Só as colunas necessárias são buscadas.

### Fila de disparo: o que muda com acesso assíncrono
O código atual conta com operações síncronas, que não se intercalam. Com banco, cada mudança de estado passa a ser **atômica no SQL**:
- **Reservar a próxima mensagem:** `UPDATE messages SET status='sending' WHERE id = (SELECT id … WHERE campaign_id=$1 AND status='queued' ORDER BY seq LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`. A coluna `seq` preserva a ordem de inserção, como o array de hoje.
- **Confirmações (ack) fora de ordem nunca regridem o status:** `UPDATE … WHERE provider_message_id=$1 AND array_position($ordem, status) < array_position($ordem, $novo)`, com `delivered_at = COALESCE(delivered_at, now())`.
- **Após o envio:** `status = CASE WHEN status IN ('delivered','read') THEN status ELSE 'sent' END`.
- **Clique:** `clicks = clicks + 1, clicked_at = COALESCE(clicked_at, $agora), last_click_at = $agora`.
- **Iniciar campanha:** inserir as mensagens e marcar a campanha como `sending` acontece numa transação. Os códigos dos links são gerados em JavaScript. O índice único em `code` garante que não se repitam: em caso de colisão, a inserção é refeita com códigos novos.
- **Limite diário:** conta `sent_at >= meia-noite UTC de hoje`, a mesma regra do `today()` atual.
- **Ao subir:** mensagens que ficaram em `sending` voltam para `queued` (um `UPDATE` só).

## Esquema (`migrations/001_esquema_inicial.sql`)

Todas as tabelas têm `id uuid PRIMARY KEY`, `created_at timestamptz NOT NULL DEFAULT now()` e `updated_at timestamptz`. Os ids atuais (UUID v4) são mantidos.

| Tabela | Colunas (além das comuns) | Restrições e índices |
|---|---|---|
| `restaurants` | name, slug, segment, city, site_url, phone, audience, products, goals, tone, color, coupon, tagline, instagram, emoji, address, hours, logo_url, `menu jsonb`, `banners jsonb`, `require_approval bool DEFAULT true`, `demo bool DEFAULT false` | `slug` único |
| `users` | restaurant_id, role, name, email, password_hash, last_login_at | FK restaurante `ON DELETE CASCADE`; `email` único |
| `contacts` | `seq bigint identity` (ordem de cadastro, usada no público da campanha), restaurant_id, name, phone, phone_key, `tags text[]`, `opt_in bool DEFAULT false`, opt_in_source, `opted_out bool DEFAULT false`, opted_out_at, notes, demo | FK restaurante cascade; único `(restaurant_id, phone)`; GIN em `tags`; índice em `phone_key` |
| `campaigns` | restaurant_id, name, objective, occasion, message, media_url, destination_url, coupon, notes, `segment jsonb`, `include_footer bool DEFAULT true`, `cloud_template jsonb`, status, `approval jsonb`, `approval_log jsonb DEFAULT '[]'`, provider, audience_size, scheduled_at, started_at, completed_at, waiting_reason, last_error, demo | FK restaurante cascade; índices `(restaurant_id, created_at)` e `status` |
| `messages` | `seq bigint identity`, campaign_id, restaurant_id, contact_id, name, phone, phone_key, demo, code, status, text, error, provider, provider_message_id, queued_at, sent_at, delivered_at, read_at, failed_at, clicked_at, last_click_at, replied_at, converted_at, `clicks int DEFAULT 0`, reply, `opt_out bool DEFAULT false` | FK campanha e restaurante cascade; FK contato `ON DELETE SET NULL`; `code` único; índices `(campaign_id, status, seq)`, `provider_message_id`, `sent_at`, `(phone_key, sent_at)`, `(restaurant_id, sent_at)` |
| `conversions` | restaurant_id, campaign_id, message_id, contact_id, code, customer_name, order_id, `value numeric(12,2)`, `items jsonb` | FK restaurante cascade; FK campanha cascade (igual a hoje: excluir a campanha exclui os pedidos dela; muda na etapa 2); FK mensagem e contato `SET NULL`; único `(restaurant_id, order_id)` quando `order_id` existe; índice `(restaurant_id, created_at)` |
| `settings` | `id smallint` fixo em 1, `data jsonb` | uma linha só |
| `schema_migrations` | version, applied_at | — |

`phone_key` é a chave de comparação já usada no `phoneKey()`: DDD + últimos 8 dígitos. É calculada pelo repositório ao gravar e serve para achar o contato quando chega uma resposta como "SAIR".

## Mudanças por arquivo

- `src/config.js`: `databaseUrl` (`DATABASE_URL`), `dataDir` passa a aceitar `DATA_DIR` (usado nos testes) e `pgliteDir` (`data/pgdata`).
- `src/bootstrap.js`: `buildContainer({ db, …overrides })` registra `db` e `repos`. `JsonStore` e o antigo `repositories.js` são removidos.
- `src/app.js` (novo) e `src/server.js`: subir passa a ser assíncrono, na ordem abrir banco → migrar → `settings.load()` → semear se não houver restaurantes → montar o Express → `dispatch.init()`. No desligamento, `await db.close()` (o PGlite precisa fechar para gravar em disco).
- `src/http/api.js` e `src/http/public.js`: as rotas passam a usar `await`. As contagens de `withCounts` vêm de uma consulta agrupada. `/contacts/tags` usa `unnest(tags)`.
- `src/services/AuthService.js`: `login` e o middleware ficam assíncronos.
- `src/services/DispatchService.js`, `AnalyticsService.js`, `ReportService.js`: como descrito acima.
- `src/messaging/index.js` e `TemplateService.js`: sem mudança de lógica (usam o `settings.get()` síncrono).
- `src/seed.js`: assíncrono, dentro de uma transação. `--reset` esvazia as tabelas com `TRUNCATE … CASCADE`.
- Ordenações que hoje usam `localeCompare` (contatos e restaurantes por nome) continuam em JavaScript, para manter a ordem com acentos igual à atual.

## Migração dos dados atuais

**Primeira subida com o banco vazio:** se existir `data/db.json`, ele é importado automaticamente em vez de criar os dados de demonstração. O arquivo é mantido como cópia. Assim, quem atualizar o sistema não perde o que tinha.

`npm run db:import-json -- [caminho]` (padrão `data/db.json`) faz o mesmo à mão:
- Lê o JSON e insere tudo numa transação, coleção por coleção, respeitando as dependências: restaurantes → usuários → contatos → campanhas → mensagens → pedidos → configurações.
- `ON CONFLICT (id) DO NOTHING`: rodar de novo não duplica.
- **Referências quebradas:** o JSON não tem integridade. Excluir um contato hoje deixa as mensagens dele. Regras:
  - contato, mensagem ou campanha inexistente num **pedido**: o campo vira `null` e o pedido é mantido, porque pedido é dado de venda;
  - contato inexistente numa **mensagem**: `contact_id` vira `null`;
  - mensagem de **campanha inexistente**: é ignorada, porque mensagem não existe sem campanha;
  - registro de **restaurante inexistente**: é ignorado.

  Tudo o que for ajustado ou ignorado aparece no relatório final.
- **Campos desconhecidos:** são listados como aviso (não deve haver nenhum).
- No fim, imprime as contagens lidas e gravadas por coleção.

## Erros

- **Banco fora do ar ao subir:** mensagem clara (qual URL, qual erro) e o processo encerra.
- **Unicidade violada (código `23505`):** vira a mesma mensagem amigável de hoje. Exemplos: "Este telefone já está na base.", "Este e-mail já tem acesso.". A troca de telefone pela edição de contato, que hoje pode duplicar, passa a ser barrada.
- **Pedido repetido:** `INSERT … ON CONFLICT DO NOTHING` devolve `{ ok: true, duplicated: true }`, sem condição de corrida.
- **Falha no meio de uma escrita com vários passos:** a transação desfaz tudo.

## Testes

Usam o `node --test` que já vem no Node 22. `npm test` não precisa de nada instalado além das dependências do projeto.

1. **Testes de caracterização (antes de migrar).** Uma bateria HTTP que sobe o app (`createApp`) numa porta livre, com dados próprios, e confere o comportamento atual:
   - login da agência, de restaurante e com senha errada, além das rotas bloqueadas para restaurante;
   - CRUD de restaurante e dos acessos dele;
   - contatos: criação, duplicado, importação, tags, filtros e busca;
   - campanha: criação, edição, aprovação, pedido de ajuste e reset da aprovação ao editar;
   - prévia de público;
   - disparo pelo simulador (com provedor sem falhas aleatórias) até `completed`, com mensagens, confirmações e progresso;
   - clique em `/r/:code`, com contagem e redirecionamento com UTMs; robôs de pré-visualização não contam;
   - pedido em `/api/public/conversions`: atribuição, duplicado e venda direta;
   - resposta "SAIR" pelo simulador (descadastro e resposta registrada);
   - painel (`/dashboard`) e relatório mensal (`/reports/monthly`), com números conferidos;
   - excluir campanha e restaurante, com o efeito em cascata.

   A bateria roda **primeiro contra o código atual (JSON)** e tem de passar. Depois roda contra o PostgreSQL e tem de continuar passando.
2. **Testes dos repositórios** (PGlite em memória): mapeamento de tipos, `update` copiando no objeto, transação desfeita em erro, reserva atômica de mensagem, ack fora de ordem que não regride status, importação do JSON com referências quebradas.
3. **Caminho de produção:** a mesma bateria HTTP roda uma vez com `DATABASE_URL` apontando para o PGlite exposto como servidor PostgreSQL local (`@electric-sql/pglite-socket`). Isso cobre o driver `pg` sem instalar PostgreSQL. Se o pacote não funcionar no Windows, isso fica registrado e o driver `pg` é coberto por um teste menor.

## Critérios de aceite

1. `npm test` passa: caracterização + repositórios + caminho de produção.
2. `npm run db:import-json` importa o `data/db.json` atual, com as contagens batendo.
3. Conferido no navegador:
   - login da agência e do restaurante;
   - painel;
   - criar campanha, aprovar como restaurante e disparar no simulador;
   - clicar no link e fazer pedido no site de demonstração;
   - relatório mensal.
4. Não sobra uso de `JsonStore`. O README explica `DATABASE_URL`, `npm test`, `npm run seed` e `npm run db:import-json`.

## Limites conhecidos (documentados no README)

- **Uma instância só:** a fila de disparo, a cópia das configurações em memória e os eventos em tempo real (SSE) são do processo. Rodar mais de uma instância exige uma etapa própria (fila no banco com `SKIP LOCKED`, que já fica pronta, e eventos via `LISTEN/NOTIFY`).
- **PGlite é só para desenvolvimento e testes:** aceita uma conexão por vez. Produção usa PostgreSQL de verdade.
