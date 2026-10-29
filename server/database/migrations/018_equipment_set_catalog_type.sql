SET search_path TO almoxarifado, public;

ALTER TABLE equipment_sets ADD COLUMN IF NOT EXISTS type_id uuid REFERENCES product_types(id);
UPDATE equipment_sets SET type_id=(SELECT id FROM product_types WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1) WHERE type_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_equipment_sets_type ON equipment_sets(type_id);
