SET search_path TO almoxarifado, public;

ALTER TABLE products DROP COLUMN IF EXISTS active;
