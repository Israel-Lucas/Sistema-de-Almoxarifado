SET search_path TO almoxarifado, public;

CREATE OR REPLACE FUNCTION notify_matrix_low_stock() RETURNS trigger AS $$
DECLARE
  product_name varchar(100);
BEGIN
  IF NEW.quantity > 5 OR OLD.quantity <= 5 THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM units
    WHERE id = NEW.unit_id AND code = 'MATRIZ' AND active AND deleted_at IS NULL
  ) THEN
    RETURN NEW;
  END IF;

  SELECT name INTO product_name FROM products WHERE id = NEW.product_id;

  INSERT INTO email_outbox(recipient, subject, body)
  SELECT DISTINCT recipient,
    'Estoque baixo',
    'O item ' || product_name || ' está com o estoque ' || NEW.quantity || ', solicitar compra ou devolução'
  FROM (
    SELECT 'notificacoes@suaempresa.example'::varchar AS recipient
    UNION ALL
    SELECT u.email
    FROM users u
    JOIN units un ON un.id = u.unit_id
    WHERE u.active AND u.deleted_at IS NULL AND u.role = 'MASTER'
      AND un.code = 'MATRIZ' AND u.email IS NOT NULL
  ) recipients
  WHERE recipient IS NOT NULL;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notify_matrix_low_stock ON inventory;
CREATE TRIGGER trg_notify_matrix_low_stock
AFTER UPDATE OF quantity ON inventory
FOR EACH ROW EXECUTE FUNCTION notify_matrix_low_stock();
