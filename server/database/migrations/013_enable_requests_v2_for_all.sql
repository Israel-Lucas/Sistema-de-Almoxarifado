SET search_path TO almoxarifado, public;

ALTER TABLE units DROP COLUMN IF EXISTS requests_v2_enabled;
