CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS almoxarifado;
SET search_path TO almoxarifado, public;

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('MASTER', 'USER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE request_status AS ENUM ('SOLICITADO', 'APROVADO', 'RECUSADO', 'APROVADO_PARCIALMENTE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE delivery_status AS ENUM ('AGUARDANDO_ANALISE', 'PREPARANDO', 'ENTREGUE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE movement_kind AS ENUM ('ENTRADA', 'SAIDA', 'RESERVA_PEDIDO', 'ENTREGA_PEDIDO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(100) NOT NULL UNIQUE,
  name varchar(100) NOT NULL,
  normalized_name varchar(100) NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true,
  protected boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username varchar(100) NOT NULL,
  normalized_username varchar(100) NOT NULL UNIQUE,
  name varchar(100) NOT NULL,
  password_hash varchar(100) NOT NULL,
  role user_role NOT NULL DEFAULT 'USER',
  unit_id uuid NOT NULL REFERENCES units(id),
  active boolean NOT NULL DEFAULT true,
  failed_login_attempts smallint NOT NULL DEFAULT 0 CHECK (failed_login_attempts BETWEEN 0 AND 10),
  locked_until timestamptz,
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS product_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(100) NOT NULL,
  normalized_name varchar(100) NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(100) NOT NULL,
  normalized_name varchar(100) NOT NULL,
  model varchar(100) NOT NULL,
  normalized_model varchar(100) NOT NULL,
  description varchar(500),
  type_id uuid NOT NULL REFERENCES product_types(id),
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (normalized_name, normalized_model, type_id)
);

CREATE TABLE IF NOT EXISTS inventory (
  product_id uuid NOT NULL REFERENCES products(id),
  unit_id uuid NOT NULL REFERENCES units(id),
  quantity smallint NOT NULL DEFAULT 0 CHECK (quantity BETWEEN 0 AND 999),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, unit_id)
);

CREATE TABLE IF NOT EXISTS requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id),
  unit_id uuid NOT NULL REFERENCES units(id),
  requested_by uuid NOT NULL REFERENCES users(id),
  requested_quantity smallint NOT NULL CHECK (requested_quantity BETWEEN 1 AND 999),
  approved_quantity smallint CHECK (approved_quantity BETWEEN 1 AND 999),
  reason varchar(500) NOT NULL,
  requested_full_stock boolean NOT NULL DEFAULT false,
  depleted_matrix_stock boolean NOT NULL DEFAULT false,
  status request_status NOT NULL DEFAULT 'SOLICITADO',
  delivery_status delivery_status NOT NULL DEFAULT 'AGUARDANDO_ANALISE',
  decision_note varchar(500),
  decided_by uuid REFERENCES users(id),
  decided_at timestamptz,
  delivered_by uuid REFERENCES users(id),
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT request_decision_consistency CHECK (
    (status = 'SOLICITADO' AND approved_quantity IS NULL AND delivery_status = 'AGUARDANDO_ANALISE') OR
    (status = 'RECUSADO' AND approved_quantity IS NULL AND delivery_status = 'AGUARDANDO_ANALISE' AND decision_note IS NOT NULL) OR
    (status = 'APROVADO' AND approved_quantity = requested_quantity AND delivery_status IN ('PREPARANDO', 'ENTREGUE')) OR
    (status = 'APROVADO_PARCIALMENTE' AND approved_quantity < requested_quantity AND delivery_status IN ('PREPARANDO', 'ENTREGUE') AND decision_note IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id),
  unit_id uuid NOT NULL REFERENCES units(id),
  request_id uuid REFERENCES requests(id),
  performed_by uuid NOT NULL REFERENCES users(id),
  kind movement_kind NOT NULL,
  quantity smallint NOT NULL CHECK (quantity BETWEEN 1 AND 999),
  quantity_before smallint NOT NULL CHECK (quantity_before BETWEEN 0 AND 999),
  quantity_after smallint NOT NULL CHECK (quantity_after BETWEEN 0 AND 999),
  note varchar(500),
  reversal_of uuid REFERENCES inventory_movements(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_sessions (
  sid varchar NOT NULL PRIMARY KEY,
  sess json NOT NULL,
  expire timestamp(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expire ON user_sessions(expire);
CREATE INDEX IF NOT EXISTS idx_requests_unit ON requests(unit_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status, delivery_status);
CREATE INDEX IF NOT EXISTS idx_movements_product_unit ON inventory_movements(product_id, unit_id, created_at DESC);
