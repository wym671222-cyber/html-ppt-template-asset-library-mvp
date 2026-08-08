CREATE TABLE content_objects (
  digest text PRIMARY KEY NOT NULL CHECK (length(digest) = 64 AND digest NOT GLOB '*[^0-9a-f]*'),
  media_type text NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size >= 0),
  relative_path text NOT NULL UNIQUE CHECK (relative_path NOT LIKE '/%' AND relative_path NOT LIKE '%..%'),
  created_at integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE template_assets (
  id text PRIMARY KEY NOT NULL,
  title text NOT NULL,
  summary text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'uncategorized',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  current_version_id text REFERENCES template_versions(id),
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE template_versions (
  id text PRIMARY KEY NOT NULL,
  asset_id text NOT NULL REFERENCES template_assets(id),
  version_number integer NOT NULL CHECK (version_number > 0),
  contract_version text NOT NULL,
  source_digest text NOT NULL CHECK (length(source_digest) = 64 AND source_digest NOT GLOB '*[^0-9a-f]*'),
  content_object_digest text REFERENCES content_objects(digest),
  slot_schema text NOT NULL CHECK (json_valid(slot_schema) AND json_type(slot_schema, '$.slots') = 'array'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'verified', 'available', 'unavailable')),
  created_at integer NOT NULL,
  CONSTRAINT template_versions_asset_version_unique UNIQUE(asset_id, version_number)
);
--> statement-breakpoint
CREATE TABLE tags (
  id text PRIMARY KEY NOT NULL,
  label text NOT NULL UNIQUE,
  created_at integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE template_asset_tags (
  asset_id text NOT NULL REFERENCES template_assets(id) ON DELETE CASCADE,
  tag_id text NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  CONSTRAINT template_asset_tags_unique UNIQUE(asset_id, tag_id)
);
--> statement-breakpoint
CREATE TABLE presentations (
  id text PRIMARY KEY NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'archived')),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE presentation_items (
  id text PRIMARY KEY NOT NULL,
  presentation_id text NOT NULL REFERENCES presentations(id) ON DELETE CASCADE,
  template_version_id text NOT NULL REFERENCES template_versions(id),
  position integer NOT NULL CHECK (position >= 0),
  slot_overrides text NOT NULL DEFAULT '{}' CHECK (json_valid(slot_overrides) AND json_type(slot_overrides) = 'object'),
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  CONSTRAINT presentation_items_position_unique UNIQUE(presentation_id, position)
);
--> statement-breakpoint
CREATE TABLE jobs (
  id text PRIMARY KEY NOT NULL,
  type text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  input_snapshot text NOT NULL CHECK (json_valid(input_snapshot)),
  input_revision integer NOT NULL CHECK (input_revision >= 0),
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  diagnostic text NOT NULL DEFAULT '',
  output_digest text REFERENCES content_objects(digest),
  created_at integer NOT NULL,
  started_at integer,
  finished_at integer
);
--> statement-breakpoint
CREATE TABLE audit_events (
  id text PRIMARY KEY NOT NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  result text NOT NULL CHECK (result IN ('success', 'failure')),
  diagnostic text NOT NULL DEFAULT '',
  created_at integer NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER template_assets_current_version_insert
BEFORE INSERT ON template_assets
WHEN NEW.current_version_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM template_versions
    WHERE id = NEW.current_version_id AND asset_id = NEW.id AND status IN ('verified', 'available')
  ) THEN RAISE(ABORT, 'current version must be verified and belong to its asset') END;
END;
--> statement-breakpoint
CREATE TRIGGER template_assets_current_version_update
BEFORE UPDATE OF current_version_id ON template_assets
WHEN NEW.current_version_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM template_versions
    WHERE id = NEW.current_version_id AND asset_id = NEW.id AND status IN ('verified', 'available')
  ) THEN RAISE(ABORT, 'current version must be verified and belong to its asset') END;
END;
--> statement-breakpoint
CREATE TRIGGER template_versions_verified_content_immutable
BEFORE UPDATE OF asset_id, version_number, contract_version, source_digest, content_object_digest, slot_schema ON template_versions
WHEN OLD.status IN ('verified', 'available')
BEGIN
  SELECT RAISE(ABORT, 'verified template version content is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER template_versions_verified_delete_forbidden
BEFORE DELETE ON template_versions
WHEN OLD.status IN ('verified', 'available')
BEGIN
  SELECT RAISE(ABORT, 'verified template version cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER template_versions_current_version_status
BEFORE UPDATE OF status ON template_versions
WHEN OLD.status IN ('verified', 'available')
  AND NEW.status NOT IN ('verified', 'available')
  AND EXISTS (SELECT 1 FROM template_assets WHERE current_version_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'current version must remain verified');
END;
--> statement-breakpoint
CREATE TRIGGER content_objects_append_only_update
BEFORE UPDATE ON content_objects
BEGIN
  SELECT RAISE(ABORT, 'content objects are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER content_objects_append_only_delete
BEFORE DELETE ON content_objects
BEGIN
  SELECT RAISE(ABORT, 'content objects are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER presentations_revision_monotonic
BEFORE UPDATE OF revision ON presentations
WHEN NEW.revision < OLD.revision
BEGIN
  SELECT RAISE(ABORT, 'presentation revision cannot decrease');
END;
--> statement-breakpoint
CREATE TRIGGER presentation_items_position_contiguous_insert
BEFORE INSERT ON presentation_items
WHEN NEW.position != (SELECT count(*) FROM presentation_items WHERE presentation_id = NEW.presentation_id)
BEGIN
  SELECT RAISE(ABORT, 'presentation item positions must be contiguous');
END;
--> statement-breakpoint
CREATE TRIGGER presentation_items_template_version_fixed
BEFORE UPDATE OF template_version_id ON presentation_items
WHEN NEW.template_version_id != OLD.template_version_id
BEGIN
  SELECT RAISE(ABORT, 'presentation item template version is fixed');
END;
--> statement-breakpoint
CREATE TRIGGER presentation_items_position_fixed
BEFORE UPDATE OF position ON presentation_items
WHEN NEW.position != OLD.position
BEGIN
  SELECT RAISE(ABORT, 'presentation item reordering is not available before P07');
END;
--> statement-breakpoint
CREATE TRIGGER presentation_items_non_last_delete_forbidden
BEFORE DELETE ON presentation_items
WHEN OLD.position != (SELECT count(*) - 1 FROM presentation_items WHERE presentation_id = OLD.presentation_id)
BEGIN
  SELECT RAISE(ABORT, 'only the last presentation item can be deleted before P07');
END;
--> statement-breakpoint
CREATE TRIGGER presentation_items_slot_schema_insert
BEFORE INSERT ON presentation_items
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.slot_overrides) AS override
  WHERE NOT EXISTS (
    SELECT 1 FROM template_versions AS version, json_each(version.slot_schema, '$.slots') AS slot
    WHERE version.id = NEW.template_version_id AND slot.value = override.key
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
    WHERE version.id = NEW.template_version_id AND slot.value = override.key
  )
)
BEGIN
  SELECT RAISE(ABORT, 'presentation item contains an undeclared slot');
END;
--> statement-breakpoint
CREATE TRIGGER jobs_verified_output_immutable
BEFORE UPDATE OF output_digest ON jobs
WHEN OLD.status = 'succeeded'
BEGIN
  SELECT RAISE(ABORT, 'verified job output is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER jobs_verified_output_not_failed
BEFORE UPDATE OF status ON jobs
WHEN OLD.status = 'succeeded' AND NEW.status = 'failed'
BEGIN
  SELECT RAISE(ABORT, 'failed job cannot overwrite verified output');
END;
--> statement-breakpoint
CREATE TRIGGER audit_events_append_only_update
BEFORE UPDATE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit events are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER audit_events_append_only_delete
BEFORE DELETE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit events are append-only');
END;
