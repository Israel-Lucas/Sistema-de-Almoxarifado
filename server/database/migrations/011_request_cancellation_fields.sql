SET search_path TO almoxarifado, public;

ALTER TABLE requests
  ADD COLUMN IF NOT EXISTS cancellation_reason varchar(500),
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

ALTER TABLE requests DROP CONSTRAINT IF EXISTS request_decision_consistency;
ALTER TABLE requests ADD CONSTRAINT request_decision_consistency CHECK (
  (status = 'SOLICITADO' AND approved_quantity IS NULL AND delivery_status = 'AGUARDANDO_ANALISE') OR
  (status = 'CANCELADO' AND approved_quantity IS NULL AND delivery_status = 'AGUARDANDO_ANALISE' AND cancellation_reason IS NOT NULL AND cancelled_by IS NOT NULL AND cancelled_at IS NOT NULL) OR
  (status = 'RECUSADO' AND approved_quantity IS NULL AND delivery_status = 'AGUARDANDO_ANALISE' AND decision_note IS NOT NULL) OR
  (status = 'APROVADO' AND approved_quantity = requested_quantity AND delivery_status IN ('PREPARANDO', 'ENTREGUE')) OR
  (status = 'APROVADO_PARCIALMENTE' AND approved_quantity < requested_quantity AND delivery_status IN ('PREPARANDO', 'ENTREGUE') AND decision_note IS NOT NULL)
);

CREATE OR REPLACE FUNCTION notify_request_updated() RETURNS trigger AS $$
DECLARE product_name varchar(100); status_text varchar(100); v_notification_id uuid;
BEGIN
  IF NEW.status = OLD.status AND NEW.delivery_status = OLD.delivery_status THEN RETURN NEW; END IF;
  SELECT name INTO product_name FROM products WHERE id = NEW.product_id;
  status_text := CASE WHEN NEW.status = 'CANCELADO' THEN 'foi cancelada' WHEN NEW.delivery_status = 'ENTREGUE' THEN 'foi entregue' WHEN NEW.delivery_status = 'PREPARANDO' THEN 'está em preparação' WHEN NEW.status = 'RECUSADO' THEN 'foi recusada' ELSE 'foi atualizada' END;
  INSERT INTO notifications(title,message,link,request_id) VALUES ('Solicitação atualizada','A solicitação ' || NEW.request_number || ' de ' || product_name || ' ' || status_text || '.','/html/pedidos.html',NEW.id) RETURNING id INTO v_notification_id;
  INSERT INTO notification_recipients(notification_id,user_id)
  SELECT DISTINCT v_notification_id,u.id FROM users u JOIN units un ON un.id=u.unit_id WHERE u.active AND u.deleted_at IS NULL AND (u.unit_id=NEW.unit_id OR (u.role='MASTER' AND un.code='MATRIZ'));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE INDEX IF NOT EXISTS idx_requests_created_id ON requests(created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_audit_created_id ON audit_logs(created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_products_name_current ON products(name) WHERE deleted_at IS NULL;

CREATE TRIGGER trg_notify_request_created AFTER INSERT ON requests
FOR EACH ROW EXECUTE FUNCTION notify_request_created();

CREATE TRIGGER trg_notify_request_updated AFTER UPDATE OF status,delivery_status ON requests
FOR EACH ROW EXECUTE FUNCTION notify_request_updated();
