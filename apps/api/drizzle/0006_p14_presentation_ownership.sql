ALTER TABLE presentations ADD COLUMN owner_user_id text NOT NULL REFERENCES users(id);
--> statement-breakpoint
CREATE INDEX presentations_owner_updated_idx ON presentations(owner_user_id, updated_at, id);
--> statement-breakpoint
CREATE TRIGGER presentations_owner_required_insert
BEFORE INSERT ON presentations
WHEN NEW.owner_user_id IS NULL
BEGIN
  SELECT RAISE(ABORT, 'presentation owner user is required');
END;
--> statement-breakpoint
CREATE TRIGGER presentations_owner_immutable
BEFORE UPDATE OF owner_user_id ON presentations
WHEN NEW.owner_user_id IS NOT OLD.owner_user_id
BEGIN
  SELECT RAISE(ABORT, 'presentation owner user is immutable');
END;
