CREATE TABLE template_preview_derivatives_renderer_identity (
  template_version_id text NOT NULL REFERENCES template_versions(id),
  kind text NOT NULL CHECK (kind IN ('preview', 'thumbnail')),
  source_digest text NOT NULL REFERENCES content_objects(digest),
  content_digest text NOT NULL REFERENCES content_objects(digest),
  renderer_version text NOT NULL CHECK (length(renderer_version) > 0),
  security_diagnostic text NOT NULL CHECK (json_valid(security_diagnostic)),
  created_at integer NOT NULL,
  PRIMARY KEY (template_version_id, kind, source_digest, renderer_version)
);
--> statement-breakpoint
INSERT INTO template_preview_derivatives_renderer_identity (
  template_version_id,
  kind,
  source_digest,
  content_digest,
  renderer_version,
  security_diagnostic,
  created_at
)
SELECT
  template_version_id,
  kind,
  source_digest,
  content_digest,
  renderer_version,
  security_diagnostic,
  created_at
FROM template_preview_derivatives;
--> statement-breakpoint
DROP TABLE template_preview_derivatives;
--> statement-breakpoint
ALTER TABLE template_preview_derivatives_renderer_identity RENAME TO template_preview_derivatives;
--> statement-breakpoint
CREATE TRIGGER template_preview_derivatives_verified_source_insert
BEFORE INSERT ON template_preview_derivatives
WHEN NOT EXISTS (
  SELECT 1 FROM template_versions
  WHERE id = NEW.template_version_id
    AND source_digest = NEW.source_digest
    AND content_object_digest = NEW.source_digest
    AND status IN ('verified', 'available')
)
BEGIN
  SELECT RAISE(ABORT, 'preview derivative requires its verified template source');
END;
--> statement-breakpoint
CREATE TRIGGER template_preview_derivatives_png_insert
BEFORE INSERT ON template_preview_derivatives
WHEN NOT EXISTS (
  SELECT 1 FROM content_objects
  WHERE digest = NEW.content_digest AND media_type = 'image/png'
)
BEGIN
  SELECT RAISE(ABORT, 'preview derivative requires a PNG content object');
END;
--> statement-breakpoint
CREATE TRIGGER template_preview_derivatives_append_only_update
BEFORE UPDATE ON template_preview_derivatives
BEGIN
  SELECT RAISE(ABORT, 'preview derivatives are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER template_preview_derivatives_append_only_delete
BEFORE DELETE ON template_preview_derivatives
BEGIN
  SELECT RAISE(ABORT, 'preview derivatives are append-only');
END;
