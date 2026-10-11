-- Etapa 1: o mesmo modelo do antigo data/db.json, agora em tabelas.
-- Os ids são os UUIDs que a aplicação já usa; datas em timestamptz.

CREATE TABLE restaurants (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  name text NOT NULL,
  slug text NOT NULL,
  segment text,
  city text,
  site_url text,
  phone text,
  audience text,
  products text,
  goals text,
  tone text,
  color text,
  coupon text,
  tagline text,
  instagram text,
  emoji text,
  address text,
  hours text,
  logo_url text,
  menu jsonb NOT NULL DEFAULT '[]',
  banners jsonb NOT NULL DEFAULT '[]',
  require_approval boolean NOT NULL DEFAULT true,
  demo boolean NOT NULL DEFAULT false,
  CONSTRAINT restaurants_slug_key UNIQUE (slug)
);

CREATE TABLE users (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  restaurant_id uuid NOT NULL REFERENCES restaurants (id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'restaurant',
  name text NOT NULL,
  email text NOT NULL,
  password_hash text NOT NULL,
  last_login_at timestamptz,
  CONSTRAINT users_email_key UNIQUE (email)
);
CREATE INDEX users_restaurant ON users (restaurant_id);

CREATE TABLE contacts (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  restaurant_id uuid NOT NULL REFERENCES restaurants (id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  phone text NOT NULL,
  phone_key text NOT NULL,
  tags text[] NOT NULL DEFAULT '{}',
  opt_in boolean NOT NULL DEFAULT false,
  opt_in_source text,
  opted_out boolean NOT NULL DEFAULT false,
  opted_out_at timestamptz,
  notes text NOT NULL DEFAULT '',
  demo boolean NOT NULL DEFAULT false,
  CONSTRAINT contacts_restaurant_phone UNIQUE (restaurant_id, phone)
);
CREATE INDEX contacts_tags ON contacts USING gin (tags);
CREATE INDEX contacts_phone_key ON contacts (phone_key);

CREATE TABLE campaigns (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  restaurant_id uuid NOT NULL REFERENCES restaurants (id) ON DELETE CASCADE,
  name text NOT NULL,
  objective text,
  occasion text,
  message text NOT NULL DEFAULT '',
  media_url text,
  destination_url text,
  coupon text,
  notes text,
  segment jsonb NOT NULL DEFAULT '{"tags": [], "match": "any"}',
  include_footer boolean NOT NULL DEFAULT true,
  cloud_template jsonb,
  status text NOT NULL DEFAULT 'draft',
  approval jsonb,
  approval_log jsonb NOT NULL DEFAULT '[]',
  provider text,
  audience_size integer,
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  waiting_reason text,
  last_error text,
  demo boolean NOT NULL DEFAULT false
);
CREATE INDEX campaigns_restaurant ON campaigns (restaurant_id, created_at);
CREATE INDEX campaigns_status ON campaigns (status);

CREATE TABLE messages (
  id uuid PRIMARY KEY,
  seq bigint GENERATED ALWAYS AS IDENTITY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  campaign_id uuid NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL REFERENCES restaurants (id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts (id) ON DELETE SET NULL,
  name text,
  phone text NOT NULL,
  phone_key text NOT NULL,
  demo boolean NOT NULL DEFAULT false,
  code text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  text text,
  error text,
  provider text,
  provider_message_id text,
  queued_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  clicked_at timestamptz,
  last_click_at timestamptz,
  replied_at timestamptz,
  converted_at timestamptz,
  clicks integer NOT NULL DEFAULT 0,
  reply text,
  opt_out boolean NOT NULL DEFAULT false,
  CONSTRAINT messages_code_key UNIQUE (code)
);
CREATE INDEX messages_queue ON messages (campaign_id, status, seq);
CREATE INDEX messages_provider_id ON messages (provider_message_id);
CREATE INDEX messages_sent_at ON messages (sent_at);
CREATE INDEX messages_phone_key ON messages (phone_key, sent_at);
CREATE INDEX messages_restaurant_sent ON messages (restaurant_id, sent_at);

CREATE TABLE conversions (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  restaurant_id uuid NOT NULL REFERENCES restaurants (id) ON DELETE CASCADE,
  -- Igual a hoje: excluir a campanha exclui os pedidos dela (muda na etapa 2)
  campaign_id uuid REFERENCES campaigns (id) ON DELETE CASCADE,
  message_id uuid REFERENCES messages (id) ON DELETE SET NULL,
  contact_id uuid REFERENCES contacts (id) ON DELETE SET NULL,
  code text,
  customer_name text,
  order_id text,
  value numeric(12, 2) NOT NULL DEFAULT 0,
  items jsonb NOT NULL DEFAULT '[]'
);
CREATE UNIQUE INDEX conversions_restaurant_order ON conversions (restaurant_id, order_id) WHERE order_id IS NOT NULL;
CREATE INDEX conversions_restaurant_created ON conversions (restaurant_id, created_at);
CREATE INDEX conversions_campaign ON conversions (campaign_id);

CREATE TABLE settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  data jsonb NOT NULL DEFAULT '{}'
);
INSERT INTO settings (id, data) VALUES (1, '{}');
