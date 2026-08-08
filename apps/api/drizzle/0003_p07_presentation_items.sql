DROP TRIGGER presentation_items_position_contiguous_insert;
--> statement-breakpoint
DROP TRIGGER presentation_items_position_fixed;
--> statement-breakpoint
DROP TRIGGER presentation_items_non_last_delete_forbidden;
--> statement-breakpoint
DROP TRIGGER presentation_items_slot_schema_insert;
--> statement-breakpoint
DROP TRIGGER presentation_items_slot_schema_update;
--> statement-breakpoint
CREATE TRIGGER presentation_items_slot_schema_insert
BEFORE INSERT ON presentation_items
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.slot_overrides) AS override
  WHERE NOT EXISTS (
    SELECT 1 FROM template_versions AS version, json_each(version.slot_schema, '$.slots') AS slot
    WHERE version.id = NEW.template_version_id AND json_extract(slot.value, '$.id') = override.key
  )
)
BEGIN
  SELECT RAISE(ABORT, 'presentation item contains an undeclared slot');
END;
--> statement-breakpoint
CREATE TRIGGER presentation_items_slot_schema_update
BEFORE UPDATE OF slot_overrides ON presentation_items
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.slot_overrides) AS override
  WHERE NOT EXISTS (
    SELECT 1 FROM template_versions AS version, json_each(version.slot_schema, '$.slots') AS slot
    WHERE version.id = NEW.template_version_id AND json_extract(slot.value, '$.id') = override.key
  )
)
BEGIN
  SELECT RAISE(ABORT, 'presentation item contains an undeclared slot');
END;
