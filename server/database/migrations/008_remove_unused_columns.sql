SET search_path TO almoxarifado, public;

ALTER TABLE requests DROP COLUMN IF EXISTS depleted_matrix_stock;
ALTER TABLE inventory_movements DROP COLUMN IF EXISTS reversal_of;
