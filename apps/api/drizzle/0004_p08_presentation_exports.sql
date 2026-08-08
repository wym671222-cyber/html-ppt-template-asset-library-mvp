CREATE TABLE presentation_exports (
  id text PRIMARY KEY NOT NULL,
  presentation_id text NOT NULL REFERENCES presentations(id),
  presentation_revision integer NOT NULL CHECK (presentation_revision >= 0),
  manifest_digest text NOT NULL REFERENCES content_objects(digest),
  html_digest text NOT NULL REFERENCES content_objects(digest),
  zip_digest text NOT NULL REFERENCES content_objects(digest),
  created_at integer NOT NULL,
  CONSTRAINT presentation_exports_revision_unique UNIQUE (presentation_id, presentation_revision)
);
--> statement-breakpoint
CREATE TRIGGER presentation_exports_current_revision_insert
BEFORE INSERT ON presentation_exports
WHEN NOT EXISTS (
  SELECT 1 FROM presentations
  WHERE id = NEW.presentation_id AND revision = NEW.presentation_revision
)
BEGIN
  SELECT RAISE(ABORT, 'presentation export requires the current fixed revision');
END;
--> statement-breakpoint
CREATE TRIGGER presentation_exports_content_types_insert
BEFORE INSERT ON presentation_exports
WHEN NOT EXISTS (
  SELECT 1 FROM content_objects AS manifest, content_objects AS html, content_objects AS zip
  WHERE manifest.digest = NEW.manifest_digest
    AND manifest.media_type = 'application/vnd.html-presentation-export-manifest+json'
    AND html.digest = NEW.html_digest
    AND html.media_type = 'text/html; charset=utf-8'
    AND zip.digest = NEW.zip_digest
    AND zip.media_type = 'application/zip'
)
BEGIN
  SELECT RAISE(ABORT, 'presentation export requires verified local output objects');
END;
--> statement-breakpoint
CREATE TRIGGER presentation_exports_append_only_update
BEFORE UPDATE ON presentation_exports
BEGIN
  SELECT RAISE(ABORT, 'presentation exports are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER presentation_exports_append_only_delete
BEFORE DELETE ON presentation_exports
BEGIN
  SELECT RAISE(ABORT, 'presentation exports are append-only');
END;
