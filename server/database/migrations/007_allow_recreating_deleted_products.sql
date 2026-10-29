SET search_path TO almoxarifado, public;

ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_normalized_name_normalized_model_type_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_unique_active_record
  ON products(normalized_name, normalized_model, type_id)
  WHERE deleted_at IS NULL;
