SET search_path TO almoxarifado, public;

ALTER TABLE products ADD COLUMN IF NOT EXISTS control_mode varchar(20) NOT NULL DEFAULT 'QUANTITY';
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_control_mode_check;
ALTER TABLE products ADD CONSTRAINT products_control_mode_check CHECK (control_mode IN ('QUANTITY','EQUIPMENT'));

CREATE SEQUENCE IF NOT EXISTS equipment_delivery_number_seq START 1;

CREATE TABLE IF NOT EXISTS equipment_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(100) NOT NULL,
  normalized_name varchar(100) NOT NULL,
  description varchar(500),
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_equipment_sets_current_name ON equipment_sets(normalized_name) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS equipment_set_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id uuid NOT NULL REFERENCES equipment_sets(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  quantity smallint NOT NULL CHECK (quantity BETWEEN 1 AND 99),
  required boolean NOT NULL DEFAULT true,
  position smallint NOT NULL DEFAULT 0,
  UNIQUE(set_id,product_id)
);

CREATE TABLE IF NOT EXISTS equipment_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_number bigint NOT NULL DEFAULT nextval('equipment_delivery_number_seq') UNIQUE,
  set_id uuid NOT NULL REFERENCES equipment_sets(id),
  unit_id uuid NOT NULL REFERENCES units(id),
  status varchar(20) NOT NULL DEFAULT 'DELIVERED' CHECK (status IN ('DELIVERED','PARTIAL_RETURN','RETURNED')),
  delivery_note varchar(500),
  return_note varchar(500),
  delivered_by uuid NOT NULL REFERENCES users(id),
  delivered_at timestamptz NOT NULL DEFAULT now(),
  returned_by uuid REFERENCES users(id),
  returned_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS equipment_assignment_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES equipment_assignments(id) ON DELETE CASCADE,
  source_component_id uuid REFERENCES equipment_set_components(id) ON DELETE SET NULL,
  product_id uuid NOT NULL REFERENCES products(id),
  required boolean NOT NULL,
  delivered_quantity smallint NOT NULL CHECK (delivered_quantity BETWEEN 1 AND 99),
  returned_quantity smallint NOT NULL DEFAULT 0 CHECK (returned_quantity >= 0),
  missing_quantity smallint NOT NULL DEFAULT 0 CHECK (missing_quantity >= 0),
  substituted_quantity smallint NOT NULL DEFAULT 0 CHECK (substituted_quantity >= 0),
  UNIQUE(assignment_id,source_component_id),
  CHECK (returned_quantity + missing_quantity + substituted_quantity <= delivered_quantity)
);

CREATE TABLE IF NOT EXISTS equipment_component_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_component_id uuid NOT NULL REFERENCES equipment_assignment_components(id) ON DELETE CASCADE,
  event_type varchar(20) NOT NULL CHECK (event_type IN ('DELIVERED','RETURNED','MISSING','SUBSTITUTED')),
  quantity smallint NOT NULL CHECK (quantity BETWEEN 1 AND 99),
  substitute_product_id uuid REFERENCES products(id),
  note varchar(500),
  performed_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((event_type='SUBSTITUTED' AND substitute_product_id IS NOT NULL) OR (event_type<>'SUBSTITUTED' AND substitute_product_id IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_equipment_assignments_unit_status ON equipment_assignments(unit_id,status,delivered_at DESC);
CREATE INDEX IF NOT EXISTS idx_equipment_events_component ON equipment_component_events(assignment_component_id,created_at);
