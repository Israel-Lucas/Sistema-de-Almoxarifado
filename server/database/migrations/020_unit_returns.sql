SET search_path TO almoxarifado, public;

DROP TABLE IF EXISTS request_return_events;
ALTER TABLE requests DROP CONSTRAINT IF EXISTS request_return_quantity_check;
ALTER TABLE requests DROP COLUMN IF EXISTS returned_quantity;
ALTER TABLE requests DROP COLUMN IF EXISTS missing_quantity;
ALTER TABLE requests DROP COLUMN IF EXISTS substituted_quantity;

CREATE SEQUENCE IF NOT EXISTS unit_return_number_seq START 1;

CREATE TABLE IF NOT EXISTS unit_return_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_number bigint NOT NULL DEFAULT nextval('unit_return_number_seq') UNIQUE,
  unit_id uuid NOT NULL REFERENCES units(id),
  requested_by uuid NOT NULL REFERENCES users(id),
  reason varchar(500) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'SOLICITADO'
    CHECK (status IN ('SOLICITADO','CANCELADO','RECEBIDO')),
  cancellation_reason varchar(500),
  cancelled_by uuid REFERENCES users(id),
  cancelled_at timestamptz,
  received_by uuid REFERENCES users(id),
  received_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS unit_return_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_group_id uuid NOT NULL REFERENCES unit_return_groups(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  quantity smallint NOT NULL CHECK (quantity BETWEEN 1 AND 999),
  UNIQUE (return_group_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_unit_returns_unit_created
  ON unit_return_groups(unit_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_unit_returns_status_created
  ON unit_return_groups(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_unit_return_items_group
  ON unit_return_items(return_group_id);
