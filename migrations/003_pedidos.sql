-- Etapa 2: as conversões viram pedidos de verdade (dados do cliente, status, origem e acompanhamento).

ALTER TABLE conversions RENAME TO orders;
ALTER TABLE orders RENAME CONSTRAINT conversions_pkey TO orders_pkey;
ALTER TABLE orders RENAME CONSTRAINT conversions_restaurant_id_fkey TO orders_restaurant_id_fkey;
ALTER TABLE orders RENAME CONSTRAINT conversions_message_id_fkey TO orders_message_id_fkey;
ALTER TABLE orders RENAME CONSTRAINT conversions_contact_id_fkey TO orders_contact_id_fkey;
ALTER INDEX conversions_restaurant_order RENAME TO orders_restaurant_order;
ALTER INDEX conversions_restaurant_created RENAME TO orders_restaurant_created;
ALTER INDEX conversions_campaign RENAME TO orders_campaign;
ALTER INDEX conversions_message RENAME TO orders_message;
ALTER INDEX conversions_contact RENAME TO orders_contact;

-- Pedido é dado de venda do restaurante: excluir a campanha não apaga mais os pedidos dela
ALTER TABLE orders DROP CONSTRAINT conversions_campaign_id_fkey;
ALTER TABLE orders ADD CONSTRAINT orders_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns (id) ON DELETE SET NULL;

ALTER TABLE orders
  ADD COLUMN number integer,
  ADD COLUMN tracking_code text,
  ADD COLUMN source text NOT NULL DEFAULT 'site',
  ADD COLUMN channel text,
  -- Os pedidos que já existiam (e os importados ou vindos de sites externos) estão concluídos
  ADD COLUMN status text NOT NULL DEFAULT 'completed',
  ADD COLUMN status_log jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN fulfillment text,
  ADD COLUMN phone text,
  ADD COLUMN cpf text,
  ADD COLUMN address jsonb,
  ADD COLUMN neighborhood text,
  ADD COLUMN notes text,
  ADD COLUMN subtotal numeric(12, 2),
  ADD COLUMN discount numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN coupon text,
  ADD CONSTRAINT orders_source CHECK (source IN ('site', 'campaign', 'import', 'referral')),
  ADD CONSTRAINT orders_status CHECK (status IN ('new', 'preparing', 'dispatched', 'completed', 'canceled')),
  ADD CONSTRAINT orders_fulfillment CHECK (fulfillment IN ('delivery', 'pickup')),
  ADD CONSTRAINT orders_tracking_code_key UNIQUE (tracking_code),
  ADD CONSTRAINT orders_restaurant_number UNIQUE (restaurant_id, number);

UPDATE orders SET source = 'campaign' WHERE campaign_id IS NOT NULL;

-- Quadro de pedidos: só os que estão em andamento
CREATE INDEX orders_active ON orders (restaurant_id, created_at) WHERE status IN ('new', 'preparing', 'dispatched');

-- Contador do número do pedido do site (#1, #2…), por restaurante
ALTER TABLE restaurants ADD COLUMN order_seq integer NOT NULL DEFAULT 0;

-- Aniversário (dia e mês; ano opcional) e bairro informado. Sem bairro, vale o do último pedido.
ALTER TABLE contacts
  ADD COLUMN birth_day smallint,
  ADD COLUMN birth_month smallint,
  ADD COLUMN birth_year smallint,
  ADD COLUMN neighborhood text,
  ADD CONSTRAINT contacts_birthday CHECK (
    (birth_day IS NULL) = (birth_month IS NULL)
    AND (birth_day IS NULL OR (birth_day BETWEEN 1 AND 31 AND birth_month BETWEEN 1 AND 12))
    AND (birth_year IS NULL OR (birth_day IS NOT NULL AND birth_year BETWEEN 1900 AND 2100))
  );
