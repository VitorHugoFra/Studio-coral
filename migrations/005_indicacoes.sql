-- Etapa 4: indicação com desconto. O cliente final cria o próprio link; o indicado ganha desconto no primeiro
-- pedido e quem indicou ganha um cupom de uso único quando esse pedido é concluído.

-- Regra do programa (vazia = desligado), editada pela agência na ficha do restaurante
ALTER TABLE restaurants ADD COLUMN referral jsonb;

CREATE TABLE referral_links (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  restaurant_id uuid NOT NULL REFERENCES restaurants (id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts (id) ON DELETE SET NULL,
  slug text NOT NULL,
  name text NOT NULL,
  phone text NOT NULL,
  phone_key text NOT NULL,
  message text NOT NULL DEFAULT '',
  -- Chave guardada no navegador de quem criou: só ela permite editar o link
  edit_token text NOT NULL,
  clicks integer NOT NULL DEFAULT 0,
  CONSTRAINT referral_links_slug UNIQUE (restaurant_id, slug),
  CONSTRAINT referral_links_phone UNIQUE (restaurant_id, phone_key)
);
CREATE INDEX referral_links_contact ON referral_links (contact_id);

CREATE TABLE coupons (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  restaurant_id uuid NOT NULL REFERENCES restaurants (id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts (id) ON DELETE SET NULL,
  referral_id uuid REFERENCES referral_links (id) ON DELETE SET NULL,
  code text NOT NULL,
  discount_type text NOT NULL,
  discount_value numeric(12, 2) NOT NULL,
  min_order numeric(12, 2) NOT NULL DEFAULT 0,
  expires_at timestamptz,
  origin_order_id uuid REFERENCES orders (id) ON DELETE SET NULL,
  used_at timestamptz,
  used_order_id uuid REFERENCES orders (id) ON DELETE SET NULL,
  sent_at timestamptz,
  send_error text,
  CONSTRAINT coupons_code UNIQUE (restaurant_id, code),
  CONSTRAINT coupons_origin_order UNIQUE (origin_order_id),
  CONSTRAINT coupons_discount_type CHECK (discount_type IN ('percent', 'fixed'))
);
CREATE INDEX coupons_referral ON coupons (referral_id);
CREATE INDEX coupons_contact ON coupons (contact_id);
CREATE INDEX coupons_used_order ON coupons (used_order_id);

ALTER TABLE orders
  ADD COLUMN referral_id uuid REFERENCES referral_links (id) ON DELETE SET NULL,
  ADD COLUMN coupon_id uuid REFERENCES coupons (id) ON DELETE SET NULL;
CREATE INDEX orders_referral ON orders (referral_id);
CREATE INDEX orders_coupon ON orders (coupon_id);
