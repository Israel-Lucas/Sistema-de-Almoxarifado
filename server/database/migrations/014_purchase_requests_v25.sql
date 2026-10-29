SET search_path TO almoxarifado, public;

CREATE SEQUENCE IF NOT EXISTS purchase_request_number_seq START 1;
CREATE TABLE IF NOT EXISTS purchase_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number bigint NOT NULL DEFAULT nextval('purchase_request_number_seq') UNIQUE,
  unit_id uuid NOT NULL REFERENCES units(id),
  requested_by uuid NOT NULL REFERENCES users(id),
  item_name varchar(100) NOT NULL,
  quantity smallint NOT NULL CHECK (quantity BETWEEN 1 AND 999),
  justification varchar(500) NOT NULL,
  priority varchar(10) NOT NULL CHECK (priority IN ('BAIXA','NORMAL','ALTA','URGENTE')),
  estimated_value numeric(12,2) CHECK (estimated_value >= 0),
  reference_link varchar(500),
  status varchar(20) NOT NULL DEFAULT 'SOLICITADO' CHECK (status IN ('SOLICITADO','APROVADO','RECUSADO','EM_COMPRA','RECEBIDO')),
  analysis_note varchar(500),
  purchase_note varchar(500),
  analyzed_by uuid REFERENCES users(id), analyzed_at timestamptz,
  purchased_by uuid REFERENCES users(id), purchased_at timestamptz,
  received_by uuid REFERENCES users(id), received_at timestamptz,
  product_id uuid REFERENCES products(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS purchase_request_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_request_id uuid NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
  original_name varchar(255) NOT NULL,
  stored_name varchar(255) NOT NULL UNIQUE,
  mime_type varchar(100) NOT NULL,
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
  uploaded_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_purchase_requests_unit_created ON purchase_requests(unit_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_requests_status ON purchase_requests(status,created_at DESC);
