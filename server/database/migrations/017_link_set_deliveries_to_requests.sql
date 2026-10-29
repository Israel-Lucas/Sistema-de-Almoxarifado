SET search_path TO almoxarifado, public;

ALTER TABLE equipment_assignments ADD COLUMN IF NOT EXISTS request_group_id uuid REFERENCES request_groups(id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_equipment_assignment_request_group ON equipment_assignments(request_group_id) WHERE request_group_id IS NOT NULL;
