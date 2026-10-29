SET search_path TO almoxarifado, public;

DROP TRIGGER IF EXISTS trg_notify_request_created ON requests;
DROP TRIGGER IF EXISTS trg_notify_request_updated ON requests;
ALTER TABLE requests DROP CONSTRAINT IF EXISTS request_decision_consistency;
ALTER TABLE requests ALTER COLUMN status DROP DEFAULT;
CREATE TYPE request_status_v11 AS ENUM ('SOLICITADO','APROVADO','RECUSADO','APROVADO_PARCIALMENTE','CANCELADO');
ALTER TABLE requests ALTER COLUMN status TYPE request_status_v11 USING status::text::request_status_v11;
DROP TYPE request_status;
ALTER TYPE request_status_v11 RENAME TO request_status;
ALTER TABLE requests ALTER COLUMN status SET DEFAULT 'SOLICITADO'::request_status;
