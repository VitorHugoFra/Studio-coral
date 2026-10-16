# Criação de contas: acessos, convites e recuperação de senha

Data: 2026-10-16 · Branch: `claude/focused-khorana-6af74b` (a partir de `main`) · Roteiro: [2026-10-10-roteiro-plataforma.md](2026-10-10-roteiro-plataforma.md), acréscimo de 2026-10-13

## Objetivo

Hoje o único jeito de dar acesso ao painel é a agência abrir **Restaurantes → Editar diagnóstico → Acesso do restaurante**, inventar uma senha e passá-la para a pessoa. Não há como o restaurante chamar a própria equipe, nem como recuperar uma senha esquecida.

Esta entrega traz:
- uma **tela de acessos** (agência: todos os restaurantes; gerente do restaurante: a própria equipe), com lista, criação, mudança de papel, novo link de senha e remoção;
- **convite por link**: quem cria o acesso não escolhe a senha de ninguém; a pessoa recebe um link e cria a própria senha;
- **recuperação de senha** por link com token de uso único e validade curta, pedida na tela de entrada;
- o **envio por e-mail atrás de um contrato** (`MailProvider`), como a mensageria. Sem serviço de e-mail configurado (o padrão), o link aparece para quem cuida dos acessos copiar e mandar (WhatsApp, por exemplo).

### Fora do escopo
- Novos usuários da agência: a agência continua sendo o administrador do `.env` (um login só, sem recuperação pelo painel).
- Um serviço de e-mail de verdade (SMTP, SES, Resend…): fica só o contrato e o provedor "nenhum".
- Limite de tentativas de login (força bruta) e verificação em duas etapas.
- Permissões diferentes por papel nas telas de campanha e relatório: gerente e equipe veem e aprovam o mesmo que o restaurante vê hoje. A etapa 2 (pedidos) pode refinar.

## Decisões

| Tema | Decisão | Motivo |
|---|---|---|
| Papéis no restaurante | `manager` (**Gerente**) e `staff` (**Equipe**), na coluna `users.role`, que já existia e sempre valia `restaurant` | O gerente cuida dos acessos; a equipe não. A sessão continua com `role: 'restaurant'`, e o papel vai em `teamRole`, então nada do que já checa `role === 'restaurant'` muda |
| Acessos que já existem | Viram `manager` na migração | Foram criados pela agência como "o acesso do restaurante" |
| Papel não informado | `staff` | O menor acesso. Os acessos de demonstração (`npm run seed`) são gerentes |
| O que o gerente pode | Listar, convidar (gerente ou equipe), mudar papel, gerar link de senha e remover acessos **do próprio restaurante** | "Restaurante convida a própria equipe" (roteiro) |
| Limites do gerente | Não remove o próprio acesso nem muda o próprio papel; não define a senha de ninguém (só gera link) | Ninguém se tranca para fora por engano; senha é de quem a usa |
| Agência | Tudo, em todos os restaurantes, e ainda pode definir uma senha direto (como hoje) | Compatibilidade e atendimento |
| Convite | Acesso criado sem senha (`password_hash` nulo) + link de convite. Até a pessoa criar a senha, o login não entra | Ninguém conhece a senha de outra pessoa |
| Link | `PUBLIC_URL/senha#<token>`; token de 32 bytes aleatórios (base64url) | O token vai depois do `#`: o navegador não o manda ao servidor nem a outros sites, então não aparece em log de acesso nem no `Referer` |
| Token no banco | Só o hash SHA-256, numa tabela própria | Quem lê o banco (ou um backup) não consegue usar um link aberto |
| Validade | Convite: 3 dias. Nova senha: 2 horas | Curto o bastante para um link vazado valer pouco, longo o bastante para o envio manual pelo WhatsApp |
| Uso único | Usar o link o apaga (`DELETE … WHERE token_hash = $1 AND expires_at > $agora RETURNING`), na mesma transação que grava a senha | Dois cliques ao mesmo tempo: só um vale |
| Um link por pessoa | Gerar um link novo apaga os anteriores daquela pessoa; definir a senha (por qualquer caminho) apaga todos | Só o último link mandado funciona |
| Sessões | Trocar ou redefinir a senha encerra as outras sessões daquela pessoa: `users.password_changed_at` contra o `iat` da sessão. Quem trocou a própria senha recebe uma sessão nova e continua dentro | Recuperar a senha de uma conta invadida tira o invasor |
| Papel mudou ou acesso saiu | Vale na próxima requisição (o middleware já lê o usuário no banco a cada pedido; passa a ler o papel também) | Sem esperar a sessão de 12 h vencer |
| "Esqueci minha senha" | Resposta igual exista ou não o e-mail | Não revela quem tem acesso |
| Sem serviço de e-mail | O pedido fica registrado (`users.reset_requested_at`), aparece na tela de acessos da agência e do gerente (com aviso em tempo real), e quem cuida dos acessos gera o link e manda | "O link aparece para a agência copiar e mandar" (pedido da tarefa) |
| Com serviço de e-mail | O pedido gera o link e o manda para o e-mail da pessoa; convites e links gerados na tela também vão por e-mail, e continuam aparecendo na tela | O contrato já deixa o caminho pronto |
| Pedidos repetidos | Um pedido (ou um e-mail) por pessoa a cada 5 minutos; os outros são ignorados em silêncio | Ninguém enche a caixa de alguém nem a tela da agência de avisos |
| Datas | O servidor da aplicação dá o "agora" (validade, uso e sessão), como nas outras datas gravadas pelos repositórios | Um relógio só para comparar |

## Esquema (`migrations/004_acessos.sql`)

> Número 004: a 003 já está tomada pela etapa 2 (`003_pedidos.sql`, na branch `feature/etapa-2-pedidos`). As duas mexem em tabelas diferentes, então a ordem em que forem aplicadas não muda o resultado.

### `users`

| Mudança | Observação |
|---|---|
| `role`: `restaurant` → `manager`, `DEFAULT 'staff'`, `CHECK (role IN ('manager', 'staff'))` | Papel dentro do restaurante |
| `password_hash` aceita nulo | Convite ainda não aceito |
| `password_changed_at timestamptz` | Sessões emitidas antes disso não valem mais |
| `reset_requested_at timestamptz` | Pedido de nova senha esperando alguém mandar o link |

A importação do antigo `db.json` converte o papel `restaurant` em `manager`, como a migração.

### `password_tokens` (nova)

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | uuid | |
| `created_at`, `updated_at` | timestamptz | |
| `user_id` | uuid NOT NULL | `REFERENCES users ON DELETE CASCADE`: acesso removido leva os links junto |
| `purpose` | text NOT NULL | `invite` ou `reset` (`CHECK`) |
| `token_hash` | text NOT NULL | SHA-256 do token, único |
| `expires_at` | timestamptz NOT NULL | |
| `created_by` | text | Nome de quem gerou ("Esqueci minha senha" quando foi a própria pessoa) |

Índice em `user_id`. A tabela guarda só links abertos: usado, substituído ou vencido sai (os vencidos são apagados sempre que um link novo é gerado).

## Arquitetura

```
src/mail/MailProvider.js              ← contrato de envio de e-mail (key, label, delivers, send)
src/mail/providers/NoMailProvider.js  ← "nenhum": não envia; o link aparece na tela
src/mail/index.js                     ← registro no container (MAIL_PROVIDER no .env)
src/db/repositories/users.js          ← lista com restaurante e situação, pedido de nova senha
src/db/repositories/passwordTokens.js ← gerar, consultar e usar links
src/services/AccessService.js         ← regras: quem pode o quê, convite, links, senha, pedidos
src/services/AuthService.js           ← sessão com iat e teamRole; sessões antigas caem
src/http/api.js                       ← /api/users…, /api/auth/forgot, /api/auth/link…
public/senha.html                     ← criar a senha pelo link (convite ou recuperação)
public/app.html + app.js              ← tela Acessos/Equipe, "Esqueci minha senha" na entrada
```

### Contrato de e-mail

```js
class MailProvider {
  static key; static label;
  get delivers()              // true se o e-mail sai de verdade
  async send({ to, subject, text })
}
```

`MAIL_PROVIDER=none` (padrão) registra o `NoMailProvider` (`delivers = false`). Para ligar um serviço, cria-se uma classe que estende `MailProvider` e registra-se a factory em `src/mail/index.js`, como os canais de mensagem. Provedor desconhecido no `.env` impede a subida, com a lista dos disponíveis. Falha no envio não derruba o pedido: fica registrada no log e o fluxo cai no manual (o pedido aparece na tela).

### Rotas

Abertas (antes do login):

| Rota | Corpo | Resposta |
|---|---|---|
| `POST /api/auth/forgot` | `{ email }` | `{ ok, delivery: 'email' \| 'manual' }`, sempre igual para o mesmo serviço de e-mail |
| `POST /api/auth/link` | `{ token }` | `{ purpose, name, email, restaurant, expiresAt }` ou 400 "Este link não vale mais…" |
| `POST /api/auth/link/password` | `{ token, password }` | `{ ok, email }`; a senha é validada antes de o link ser gasto |

O token vai no corpo (POST), nunca na URL da API.

Com login (agência e gerente; `RESTAURANT_ROUTES` libera para o restaurante, e o serviço barra a equipe com 403):

| Rota | O que faz |
|---|---|
| `GET /api/users?restaurantId=` | Lista: nome, e-mail, papel, restaurante, situação (`active`, `invited`, `reset-requested`), link aberto (`{ purpose, expiresAt }`) e último acesso. O gerente vê só o próprio restaurante |
| `POST /api/users` | `{ restaurantId, name, email, role, password? }`. Sem senha: devolve o link de convite. Senha só a agência define |
| `PUT /api/users/:id` | `{ name?, role? }` |
| `POST /api/users/:id/link` | Novo link: convite se a pessoa ainda não tem senha, nova senha se tem. Apaga o pedido de nova senha |
| `DELETE /api/users/:id` | Remove (a sessão cai na hora, como hoje) |
| `PUT /api/users/:id/password` | Só a agência: define a senha direto (já existia) |
| `PUT /api/me/password` | Troca a própria senha (já existia); agora encerra as outras sessões e renova a atual |

`GET` e `POST /api/restaurants/:id/users` continuam funcionando para a agência (mesma regra do `POST /api/users`).

Erros, em português: e-mail inválido; e-mail que já tem acesso (inclusive o da agência); papel inválido ("Escolha o papel: gerente ou equipe."); restaurante inexistente; acesso de outro restaurante (404 "Usuário não encontrado."); equipe tentando cuidar de acessos (403 "Só o gerente do restaurante cuida dos acessos da equipe."); gerente removendo a si mesmo ou mudando o próprio papel; gerente tentando definir senha.

### Eventos em tempo real

`access:request` (`{ restaurantId, userId, name }`) quando alguém pede nova senha e não há serviço de e-mail: a agência e o gerente daquele restaurante recebem um aviso e a tela de acessos se atualiza.

## Telas

### Acessos (agência) / Equipe (gerente) — `#/acessos`

- Menu: **Acessos** para a agência (depois de Restaurantes), **Equipe** para o gerente. A equipe não vê o item.
- Agência: seletor de restaurante no topo, como em Contatos.
- **Pedidos de nova senha** em destaque no alto, com o botão **Gerar link**.
- Tabela: nome (com o e-mail e, sem filtro, o restaurante), papel, situação ("Ativo", "Convite pendente", "Convite vencido", "Pediu nova senha", com a validade do link aberto ou o último acesso), e as ações em ícones: **Gerar link** (de convite ou de nova senha), **Editar** (nome e papel; a agência também pode definir senha) e **Remover**. Ninguém gera link nem remove o próprio acesso pela lista.
- **Novo acesso** (agência) / **Convidar pessoa** (gerente): restaurante (agência), nome, e-mail e papel (com o que cada um pode). A agência pode marcar "Definir a senha agora". Ao concluir, a janela mostra o link com **Copiar** e **Mandar pelo WhatsApp** (abre o WhatsApp com a mensagem pronta), a validade e o aviso de que ele vale uma vez só.
- Rodapé da tela da agência: a agência entra com o login do `.env` (não aparece na lista).

O modal do restaurante mantém, na aba **Acesso do restaurante**, a exigência de aprovação e passa a mostrar quantas pessoas têm acesso, com o botão **Gerenciar acessos** (abre `#/acessos` com o restaurante escolhido).

### Entrada (`/app`)

Link **Esqueci minha senha**: pede o e-mail e mostra, sem dizer se o e-mail existe, "Enviamos um link para o seu e-mail" (com serviço de e-mail) ou "Avisamos quem cuida dos acessos (o gerente do restaurante ou a Studio Coral). Você vai receber um link para criar uma senha nova." (sem).

### Criar senha (`/senha#token`)

Página avulsa, com a marca: "Olá, Giulia. Crie a senha do seu acesso ao painel (Cantina Bella Nonna)", e-mail mostrado (e lido pelo gerenciador de senhas), senha e confirmação. Depois: "Senha criada" e o botão **Entrar no painel**. Não entra sozinha: quem testa o link no próprio navegador não perde a sessão em que estava. Link vencido, usado ou trocado: explica e orienta a pedir outro (ou usar "Esqueci minha senha").

## Testes

1. **Migração** (`test/db`): sobre um banco da etapa 1, os acessos viram gerentes, com a senha preservada; a tabela de links existe; papel inválido é barrado pelo banco. A lista de tabelas do teste de migrações ganha `password_tokens`.
2. **Importação do `db.json`**: o papel antigo vira `manager`.
3. **Acessos pela agência** (`test/http/access.test.js`): lista com restaurante, papel e situação, filtro por restaurante, nada de hash de senha; criação com convite e com senha; validações; mudança de papel; remoção.
4. **Convite e link**: o link mostra quem é; senha curta não gasta o link; criar a senha libera o login; o link vale uma vez; link vencido e link substituído não valem; definir a senha direto apaga o convite.
5. **Recuperação**: resposta igual para e-mail com e sem acesso; sem e-mail, o pedido aparece na lista e some ao gerar o link; com e-mail (provedor falso nos testes), o link chega no e-mail certo e pedidos seguidos não mandam outro; redefinir encerra as sessões abertas da pessoa e a senha antiga para de valer.
6. **Gerente e equipe**: o gerente vê e cuida só do próprio restaurante, convida, muda papel, gera link, remove; não remove a si mesmo, não muda o próprio papel, não define senha, não alcança outro restaurante (404). A equipe recebe 403. Rebaixar o gerente vale na requisição seguinte.
7. **Troca da própria senha**: a sessão atual continua, as outras caem.
8. Os testes atuais continuam passando; o papel do acesso criado sem papel passa de `restaurant` para `staff`. A bateria HTTP roda também pelo driver `pg` (`npm run test:pg`).

## Critérios de aceite

1. `npm test` passa.
2. Conferido no navegador: agência cria um acesso por convite, abre o link, cria a senha e entra; gerente convida alguém da equipe; "Esqueci minha senha" aparece para a agência, que gera e copia o link.
3. README explica os acessos (papéis, convite, recuperação, e-mail).

## Limites conhecidos

- Sem serviço de e-mail, a recuperação depende de alguém da agência ou o gerente mandar o link.
- A senha da agência continua no `.env`; esquecê-la exige acesso ao servidor.
- Sem limite de tentativas no login (fica para quando o sistema for publicado; ver o documento de custos).
- Quem tem o link de convite ou de nova senha entra na conta: por isso a validade curta, o uso único e o aviso na tela para mandar o link só para a própria pessoa.
