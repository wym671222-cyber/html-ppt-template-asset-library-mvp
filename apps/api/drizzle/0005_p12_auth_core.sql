CREATE TABLE users (
  id text PRIMARY KEY NOT NULL,
  username text COLLATE NOCASE NOT NULL,
  password_hash text NOT NULL CHECK (
    length(password_hash) BETWEEN 64 AND 512
    AND substr(password_hash, 1, 10) = '$argon2id$'
    AND instr(password_hash, char(10)) = 0
    AND instr(password_hash, char(13)) = 0
    AND instr(password_hash, char(9)) = 0
  ),
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'disabled')),
  must_change_password integer NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
  approved_by text REFERENCES users(id),
  approved_at integer,
  password_changed_at integer NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  CHECK (
    username = lower(trim(username))
    AND length(username) BETWEEN 3 AND 32
    AND username GLOB '[a-z]*'
    AND username NOT GLOB '*[^a-z0-9._-]*'
  ),
  CHECK ((approved_by IS NULL) = (approved_at IS NULL)),
  CHECK (password_changed_at >= created_at),
  CHECK (updated_at >= created_at)
);
--> statement-breakpoint
CREATE UNIQUE INDEX users_username_nocase_unique ON users(username COLLATE NOCASE);
--> statement-breakpoint
CREATE UNIQUE INDEX users_single_admin_unique ON users(role) WHERE role = 'admin';
--> statement-breakpoint
CREATE INDEX users_status_created_idx ON users(status, created_at, id);
--> statement-breakpoint
CREATE TABLE sessions (
  id text PRIMARY KEY NOT NULL,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE CHECK (
    length(token_hash) = 64
    AND token_hash NOT GLOB '*[^0-9a-f]*'
  ),
  expires_at integer NOT NULL,
  created_at integer NOT NULL,
  CHECK (expires_at = created_at + 604800000)
);
--> statement-breakpoint
CREATE INDEX sessions_user_created_idx ON sessions(user_id, created_at, id);
--> statement-breakpoint
CREATE INDEX sessions_expiry_idx ON sessions(expires_at, id);
--> statement-breakpoint
CREATE TRIGGER sessions_fixed_update
BEFORE UPDATE ON sessions
BEGIN
  SELECT RAISE(ABORT, 'sessions are fixed and cannot be updated');
END;
--> statement-breakpoint
CREATE TRIGGER users_password_change_revokes_sessions
AFTER UPDATE OF password_hash ON users
WHEN NEW.password_hash != OLD.password_hash
BEGIN
  DELETE FROM sessions WHERE user_id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER users_disable_revokes_sessions
AFTER UPDATE OF status ON users
WHEN NEW.status = 'disabled' AND OLD.status != 'disabled'
BEGIN
  DELETE FROM sessions WHERE user_id = NEW.id;
END;
--> statement-breakpoint
CREATE TABLE auth_throttle (
  key_hash text PRIMARY KEY NOT NULL CHECK (
    length(key_hash) = 64
    AND key_hash NOT GLOB '*[^0-9a-f]*'
  ),
  window_started_at integer NOT NULL,
  count integer NOT NULL CHECK (count >= 0),
  blocked_until integer,
  CHECK (blocked_until IS NULL OR blocked_until >= window_started_at)
);
