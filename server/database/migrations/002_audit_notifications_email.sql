SET search_path TO almoxarifado, public;

ALTER TABLE users ADD COLUMN IF NOT EXISTS email varchar(254);
ALTER TABLE users ADD COLUMN IF NOT EXISTS normalized_email varchar(254);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_normalized_email ON users(normalized_email) WHERE normalized_email IS NOT NULL AND deleted_at IS NULL;

CREATE SEQUENCE IF NOT EXISTS request_number_seq;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS request_number bigint;
UPDATE requests SET request_number = nextval('request_number_seq') WHERE request_number IS NULL;
ALTER TABLE requests ALTER COLUMN request_number SET DEFAULT nextval('request_number_seq');
ALTER TABLE requests ALTER COLUMN request_number SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_requests_number ON requests(request_number);

CREATE TABLE IF NOT EXISTS audit_logs (
  id bigserial PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  unit_id uuid REFERENCES units(id),
  method varchar(10) NOT NULL,
  action varchar(100) NOT NULL,
  resource varchar(500) NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_address varchar(64),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title varchar(100) NOT NULL,
  message varchar(500) NOT NULL,
  link varchar(500),
  request_id uuid REFERENCES requests(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notification_recipients (
  notification_id uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  read_at timestamptz,
  PRIMARY KEY (notification_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_notification_recipient_unread ON notification_recipients(user_id, read_at, notification_id);

CREATE TABLE IF NOT EXISTS email_outbox (
  id bigserial PRIMARY KEY,
  recipient varchar(254) NOT NULL,
  subject varchar(200) NOT NULL,
  body varchar(2000) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'FAILED')),
  attempts smallint NOT NULL DEFAULT 0,
  last_error varchar(500),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_email_outbox_pending ON email_outbox(status, created_at);

CREATE OR REPLACE FUNCTION notify_request_created() RETURNS trigger AS $$
DECLARE
  product_name varchar(100);
  unit_name varchar(100);
  requester_name varchar(100);
  v_notification_id uuid;
  email_subject varchar(200);
  email_body varchar(2000);
BEGIN
  SELECT p.name, un.name, u.name INTO product_name, unit_name, requester_name
  FROM products p, units un, users u
  WHERE p.id = NEW.product_id AND un.id = NEW.unit_id AND u.id = NEW.requested_by;

  INSERT INTO notifications(title, message, link, request_id)
  VALUES (
    'Nova solicitação',
    'Solicitação ' || NEW.request_number || ': ' || requester_name || ' solicitou ' || NEW.requested_quantity || ' de ' || product_name || ' para ' || unit_name || '.',
    '/html/pedidos.html',
    NEW.id
  ) RETURNING id INTO v_notification_id;

  INSERT INTO notification_recipients(notification_id, user_id)
  SELECT v_notification_id, u.id
  FROM users u JOIN units un ON un.id = u.unit_id
  WHERE u.active AND u.deleted_at IS NULL AND u.role = 'MASTER' AND un.code = 'MATRIZ' AND un.active;

  email_subject := 'Solicitação ' || NEW.request_number || ' para ' || unit_name;
  email_body := 'Usuario ' || requester_name || ' solicitou ' || NEW.requested_quantity || ' quantidade do item ' || product_name || ' para a unidade ' || unit_name;

  INSERT INTO email_outbox(recipient, subject, body)
  SELECT DISTINCT u.email, email_subject, email_body
  FROM users u JOIN units un ON un.id = u.unit_id
  WHERE u.active AND u.deleted_at IS NULL AND u.role = 'MASTER'
    AND un.code = 'MATRIZ' AND u.email IS NOT NULL;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notify_request_created ON requests;
CREATE TRIGGER trg_notify_request_created AFTER INSERT ON requests
FOR EACH ROW EXECUTE FUNCTION notify_request_created();

CREATE OR REPLACE FUNCTION notify_request_updated() RETURNS trigger AS $$
DECLARE
  product_name varchar(100);
  status_text varchar(100);
  v_notification_id uuid;
BEGIN
  IF NEW.status = OLD.status AND NEW.delivery_status = OLD.delivery_status THEN RETURN NEW; END IF;
  SELECT name INTO product_name FROM products WHERE id = NEW.product_id;
  status_text := CASE
    WHEN NEW.delivery_status = 'ENTREGUE' THEN 'foi entregue'
    WHEN NEW.delivery_status = 'PREPARANDO' THEN 'está em preparação'
    WHEN NEW.status = 'RECUSADO' THEN 'foi recusada'
    ELSE 'foi atualizada'
  END;
  INSERT INTO notifications(title, message, link, request_id)
  VALUES ('Solicitação atualizada', 'A solicitação ' || NEW.request_number || ' de ' || product_name || ' ' || status_text || '.', '/html/pedidos.html', NEW.id)
  RETURNING id INTO v_notification_id;
  INSERT INTO notification_recipients(notification_id, user_id)
  SELECT v_notification_id, id FROM users WHERE active AND deleted_at IS NULL AND unit_id = NEW.unit_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notify_request_updated ON requests;
CREATE TRIGGER trg_notify_request_updated AFTER UPDATE OF status, delivery_status ON requests
FOR EACH ROW EXECUTE FUNCTION notify_request_updated();
