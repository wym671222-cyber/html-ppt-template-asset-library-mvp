CREATE TABLE jobs_p04 (
  id text PRIMARY KEY NOT NULL,
  type text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),
  input_snapshot text NOT NULL CHECK (json_valid(input_snapshot)),
  input_revision integer NOT NULL CHECK (input_revision >= 0),
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts >= 1),
  diagnostic text NOT NULL DEFAULT '',
  output_digest text REFERENCES content_objects(digest),
  created_at integer NOT NULL,
  started_at integer,
  finished_at integer,
  lease_owner text,
  lease_expires_at integer,
  CHECK ((lease_owner IS NULL) = (lease_expires_at IS NULL)),
  CHECK ((status = 'running') = (lease_owner IS NOT NULL))
);
--> statement-breakpoint
INSERT INTO jobs_p04 (id, type, status, input_snapshot, input_revision, attempt, max_attempts, diagnostic, output_digest, created_at, started_at, finished_at)
SELECT id, type, CASE WHEN status IN ('queued', 'running') THEN 'pending' ELSE status END, input_snapshot, input_revision, attempt, 3, diagnostic, output_digest, created_at, started_at, finished_at
FROM jobs;
--> statement-breakpoint
DROP TABLE jobs;
--> statement-breakpoint
ALTER TABLE jobs_p04 RENAME TO jobs;
--> statement-breakpoint
CREATE INDEX jobs_pending_created_idx ON jobs(status, created_at, id);
--> statement-breakpoint
CREATE INDEX jobs_running_lease_idx ON jobs(status, lease_expires_at);
--> statement-breakpoint
CREATE TRIGGER jobs_succeeded_output_immutable
BEFORE UPDATE ON jobs
WHEN OLD.status = 'succeeded' AND (NEW.status != 'succeeded' OR NEW.output_digest != OLD.output_digest)
BEGIN
  SELECT RAISE(ABORT, 'failed job cannot overwrite verified output');
END;
--> statement-breakpoint
CREATE TRIGGER jobs_succeeded_requires_output
BEFORE INSERT ON jobs
WHEN NEW.status = 'succeeded' AND NEW.output_digest IS NULL
BEGIN
  SELECT RAISE(ABORT, 'succeeded job requires a verified output');
END;
--> statement-breakpoint
CREATE TRIGGER jobs_succeeded_update_requires_output
BEFORE UPDATE OF status, output_digest ON jobs
WHEN NEW.status = 'succeeded' AND NEW.output_digest IS NULL
BEGIN
  SELECT RAISE(ABORT, 'succeeded job requires a verified output');
END;
