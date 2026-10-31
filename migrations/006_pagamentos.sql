-- Etapa 5: pagamento online pelo site (Pix e cartão), na conta Asaas de cada restaurante.

-- Configuração pública do pagamento (ligado, provedor, ambiente, formas, repasse, prazo) e a parte secreta
-- (a chave de API cifrada), que o repositório nunca devolve
ALTER TABLE restaurants
  ADD COLUMN payment jsonb,
  ADD COLUMN payment_secret jsonb;

ALTER TABLE orders
  ADD COLUMN payment_method text NOT NULL DEFAULT 'on_delivery',
  ADD COLUMN payment_status text NOT NULL DEFAULT 'none',
  ADD COLUMN payment_provider text,
  ADD COLUMN payment_id text,
  ADD COLUMN payment_url text,
  ADD COLUMN payment_pix jsonb,
  ADD COLUMN paid_at timestamptz,
  ADD COLUMN payment_error text,
  ADD COLUMN payment_checked_at timestamptz,
  ADD CONSTRAINT orders_payment_method CHECK (payment_method IN ('on_delivery', 'pix', 'card')),
  ADD CONSTRAINT orders_payment_status CHECK (payment_status IN ('none', 'pending', 'paid', 'expired', 'failed', 'refunded'));

-- A cobrança do gateway aponta para um pedido só (webhook e consulta acham o pedido por ela)
CREATE UNIQUE INDEX orders_payment_id ON orders (payment_provider, payment_id) WHERE payment_id IS NOT NULL;
-- Varredura dos pagamentos pendentes (prazo vencido)
CREATE INDEX orders_payment_pending ON orders (created_at) WHERE payment_status = 'pending';
