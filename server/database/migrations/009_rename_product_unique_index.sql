SET search_path TO almoxarifado, public;

ALTER INDEX IF EXISTS idx_products_unique_active_record
  RENAME TO idx_products_unique_current_record;
