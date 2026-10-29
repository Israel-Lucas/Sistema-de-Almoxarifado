SET search_path TO almoxarifado, public;

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

  email_subject := 'Solicitação de itens para ' || unit_name;
  email_body := 'Usuário ' || requester_name || ' solicitou ' || NEW.requested_quantity || ' ' || product_name || ' para a unidade de ' || unit_name;

  INSERT INTO email_outbox(recipient, subject, body)
  SELECT DISTINCT recipient, email_subject, email_body
  FROM (
    SELECT 'notificacoes@suaempresa.example'::varchar AS recipient
    UNION ALL
    SELECT u.email FROM users u JOIN units un ON un.id = u.unit_id
    WHERE u.active AND u.deleted_at IS NULL AND u.role = 'MASTER' AND un.code = 'MATRIZ' AND u.email IS NOT NULL
  ) recipients
  WHERE recipient IS NOT NULL;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
