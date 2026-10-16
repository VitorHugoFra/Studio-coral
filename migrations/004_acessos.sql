-- Criação de contas: papéis no restaurante, convite por link e recuperação de senha.
-- (A 003 é a da etapa 2, pedidos; as duas mexem em tabelas diferentes.)

-- Papel dentro do restaurante. A coluna existia e valia sempre 'restaurant': os acessos criados
-- até aqui foram "o acesso do restaurante", criado pela agência, e viram gerentes.
UPDATE users SET role = 'manager' WHERE role = 'restaurant';
ALTER TABLE users
  ALTER COLUMN role SET DEFAULT 'staff',
  ADD CONSTRAINT users_role_check CHECK (role IN ('manager', 'staff')),
  -- Sem senha: convite ainda não aceito (o login não entra)
  ALTER COLUMN password_hash DROP NOT NULL,
  -- Sessões emitidas antes disso deixam de valer
  ADD COLUMN password_changed_at timestamptz,
  -- "Esqueci minha senha" esperando alguém mandar o link (sem serviço de e-mail)
  ADD COLUMN reset_requested_at timestamptz;

-- Links abertos de convite e de nova senha. Só o hash do token fica no banco; usado, substituído
-- ou vencido, o link sai da tabela.
CREATE TABLE password_tokens (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  purpose text NOT NULL,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_by text,
  CONSTRAINT password_tokens_hash_key UNIQUE (token_hash),
  CONSTRAINT password_tokens_purpose_check CHECK (purpose IN ('invite', 'reset'))
);
CREATE INDEX password_tokens_user ON password_tokens (user_id);
