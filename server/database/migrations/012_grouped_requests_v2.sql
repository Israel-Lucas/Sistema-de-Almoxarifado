SET search_path TO almoxarifado, public;

ALTER TABLE units ADD COLUMN IF NOT EXISTS requests_v2_enabled boolean NOT NULL DEFAULT false;
UPDATE units SET requests_v2_enabled = true WHERE code = 'MATRIZ';

CREATE SEQUENCE IF NOT EXISTS request_group_number_seq START 1;
CREATE TABLE IF NOT EXISTS request_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number bigint NOT NULL DEFAULT nextval('request_group_number_seq'),
  unit_id uuid NOT NULL REFERENCES units(id), requested_by uuid NOT NULL REFERENCES users(id),
  reason varchar(500) NOT NULL,
  status varchar(30) NOT NULL DEFAULT 'SOLICITADO' CHECK (status IN ('SOLICITADO','APROVADO','APROVADO_PARCIALMENTE','RECUSADO','CANCELADO')),
  delivery_status delivery_status NOT NULL DEFAULT 'AGUARDANDO_ANALISE',
  cancellation_reason varchar(500), cancelled_by uuid REFERENCES users(id), cancelled_at timestamptz,
  decided_by uuid REFERENCES users(id), decided_at timestamptz,
  delivered_by uuid REFERENCES users(id), delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_number)
);
ALTER TABLE requests ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES request_groups(id);
INSERT INTO request_groups (id,order_number,unit_id,requested_by,reason,status,delivery_status,cancellation_reason,cancelled_by,cancelled_at,decided_by,decided_at,delivered_by,delivered_at,created_at,updated_at)
SELECT r.id,r.request_number,r.unit_id,r.requested_by,r.reason,r.status::text,r.delivery_status,r.cancellation_reason,r.cancelled_by,r.cancelled_at,r.decided_by,r.decided_at,r.delivered_by,r.delivered_at,r.created_at,r.updated_at
FROM requests r WHERE r.group_id IS NULL ON CONFLICT (id) DO NOTHING;
UPDATE requests SET group_id=id WHERE group_id IS NULL;
ALTER TABLE requests ALTER COLUMN group_id SET NOT NULL;
SELECT setval('request_group_number_seq',GREATEST(COALESCE((SELECT max(order_number) FROM request_groups),0)+1,1),false);
CREATE INDEX IF NOT EXISTS idx_request_groups_unit_created ON request_groups(unit_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_request_groups_status ON request_groups(status,delivery_status);
CREATE INDEX IF NOT EXISTS idx_requests_group ON requests(group_id);

CREATE OR REPLACE FUNCTION notify_request_created() RETURNS trigger AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql;
CREATE OR REPLACE FUNCTION notify_request_updated() RETURNS trigger AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql;
