SET search_path TO almoxarifado, public;

ALTER TABLE request_groups ADD COLUMN IF NOT EXISTS equipment_set_id uuid REFERENCES equipment_sets(id);
ALTER TABLE request_groups ADD COLUMN IF NOT EXISTS equipment_set_quantity smallint CHECK (equipment_set_quantity BETWEEN 1 AND 99);
ALTER TABLE request_groups ADD CONSTRAINT request_group_equipment_set_consistency CHECK (
  (equipment_set_id IS NULL AND equipment_set_quantity IS NULL) OR
  (equipment_set_id IS NOT NULL AND equipment_set_quantity IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_request_groups_equipment_set ON request_groups(equipment_set_id) WHERE equipment_set_id IS NOT NULL;
