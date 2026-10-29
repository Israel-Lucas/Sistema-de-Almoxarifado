SET search_path TO almoxarifado, public;

ALTER TABLE requests ADD COLUMN IF NOT EXISTS returned_quantity smallint NOT NULL DEFAULT 0 CHECK (returned_quantity >= 0);
ALTER TABLE requests ADD COLUMN IF NOT EXISTS missing_quantity smallint NOT NULL DEFAULT 0 CHECK (missing_quantity >= 0);
ALTER TABLE requests ADD COLUMN IF NOT EXISTS substituted_quantity smallint NOT NULL DEFAULT 0 CHECK (substituted_quantity >= 0);
ALTER TABLE requests ADD CONSTRAINT request_return_quantity_check CHECK (
  returned_quantity + missing_quantity + substituted_quantity <= COALESCE(approved_quantity,0)
);

CREATE TABLE IF NOT EXISTS request_return_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  event_type varchar(20) NOT NULL CHECK (event_type IN ('RETURNED','MISSING','SUBSTITUTED')),
  quantity smallint NOT NULL CHECK (quantity BETWEEN 1 AND 999),
  substitute_product_id uuid REFERENCES products(id),
  note varchar(500),
  performed_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((event_type='SUBSTITUTED' AND substitute_product_id IS NOT NULL) OR (event_type<>'SUBSTITUTED' AND substitute_product_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_request_return_events_request ON request_return_events(request_id,created_at);
