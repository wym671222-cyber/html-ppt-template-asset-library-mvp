#!/bin/sh

set -eu
umask 077

REPO_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$REPO_ROOT"

[ "$(id -u)" -ne 0 ] || { printf 'ERROR: P16 rehearsal must run as a non-root user\n' >&2; exit 1; }

P16_TEMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/html-ppt-p16.XXXXXX")
P16_TEMP_ROOT=$(CDPATH= cd -- "$P16_TEMP_ROOT" && pwd -P)
case "$P16_TEMP_ROOT" in /tmp/*|/private/tmp/*|/var/folders/*|/private/var/folders/*) ;; *) printf 'ERROR: mktemp returned an unexpected root\n' >&2; exit 1 ;; esac
chmod 0700 "$P16_TEMP_ROOT"
printf 'p16\n' > "$P16_TEMP_ROOT/.html-ppt-p16-rehearsal"

expect_failure() {
  failure_label=$1
  expected_message=$2
  shift 2
  failure_log="$P16_TEMP_ROOT/$failure_label.stderr"
  if "$@" > /dev/null 2>"$failure_log"; then
    printf 'ERROR: expected command to fail: %s\n' "$failure_label" >&2
    exit 1
  fi
  grep -F -- "$expected_message" "$failure_log" >/dev/null || {
    printf 'ERROR: failure did not match the expected contract: %s\n' "$failure_label" >&2
    exit 1
  }
}

negative_commit=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
negative_other=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
expect_failure deploy-no-target '--target is required; production is never the default' \
  bash ops/workbuddy/deploy.sh --commit "$negative_commit"
expect_failure rollback-no-target '--target is required; production is never the default' \
  bash ops/workbuddy/rollback.sh --commit "$negative_commit" --expected-current "$negative_other"
expect_failure deploy-missing-approval 'production deployment requires --approved-commit' \
  bash ops/workbuddy/deploy.sh --target production --commit "$negative_commit"
expect_failure deploy-mismatched-approval '--approved-commit must exactly equal --commit' \
  bash ops/workbuddy/deploy.sh --target production --commit "$negative_commit" --approved-commit "$negative_other"
expect_failure local-preflight-write-override '--allow-write-override is only valid for the approval-gated production preflight' \
  bash ops/workbuddy/preflight.sh --target local --allow-write-override

api_pid=''
web_pid=''
proxy_pid=''
cleanup() {
  [ -z "$proxy_pid" ] || kill "$proxy_pid" 2>/dev/null || true
  [ -z "$web_pid" ] || kill "$web_pid" 2>/dev/null || true
  [ -z "$api_pid" ] || kill "$api_pid" 2>/dev/null || true
  wait "$proxy_pid" "$web_pid" "$api_pid" 2>/dev/null || true
  case "$P16_TEMP_ROOT" in /tmp/html-ppt-p16.*|/private/tmp/html-ppt-p16.*|/var/folders/*/html-ppt-p16.*|/private/var/folders/*/html-ppt-p16.*) rm -rf "$P16_TEMP_ROOT" ;; esac
}
trap cleanup EXIT HUP INT TERM

free_port() {
  node -e "const s=require('node:net').createServer();s.listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close()})"
}

wait_http() {
  url=$1
  attempts=0
  until curl --silent --output /dev/null "$url"; do
    attempts=$((attempts + 1))
    [ "$attempts" -lt 80 ] || return 1
    sleep 0.1
  done
}

npx -y pnpm@9.15.0 build >/dev/null

api_port=$(free_port)
web_port=$(free_port)
proxy_port=$(free_port)
data_root="$P16_TEMP_ROOT/data"
mkdir -m 0700 "$data_root"

ASSET_LIBRARY_DATA_ROOT="$data_root" NODE_ENV=test API_PORT="$api_port" ORIGIN=http://127.0.0.1:5173 \
  node apps/api/dist/index.js >"$P16_TEMP_ROOT/api.log" 2>&1 &
api_pid=$!
wait_http "http://127.0.0.1:$api_port/api/health/ready"

ASSET_LIBRARY_DATA_ROOT="$data_root" NODE_ENV=test HOST=127.0.0.1 PORT="$web_port" \
  ORIGIN=http://127.0.0.1:5173 P15_BROWSER_ORIGIN="http://127.0.0.1:$proxy_port" \
  P06_API_URL="http://127.0.0.1:$api_port" ADDRESS_HEADER=x-forwarded-for XFF_DEPTH=1 \
  node apps/web/build/index.js >"$P16_TEMP_ROOT/web.log" 2>&1 &
web_pid=$!

P16_PROXY_PORT="$proxy_port" P16_WEB_PORT="$web_port" node tests/p16-trusted-proxy.mjs >"$P16_TEMP_ROOT/proxy.log" 2>&1 &
proxy_pid=$!
wait_http "http://127.0.0.1:$proxy_port/login"

status=$(curl --silent --show-error --output "$P16_TEMP_ROOT/register.json" --write-out '%{http_code}' \
  -H "Origin: http://127.0.0.1:$proxy_port" \
  -H 'Content-Type: application/json' \
  -H 'X-Forwarded-For: 203.0.113.77' \
  --data '{"username":"proxy.user","password":"short"}' \
  "http://127.0.0.1:$proxy_port/api/auth/register")
[ "$status" = 400 ] || { printf 'ERROR: expected password-policy response through trusted proxy, got %s\n' "$status" >&2; exit 1; }

P16_DATABASE="$data_root/asset-library.db" node --input-type=module <<'NODE'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
const require = createRequire(new URL('./apps/api/package.json', import.meta.url))
const Database = require('better-sqlite3')
const hash = (key) => createHash('sha256').update(`auth-throttle/v1\0${key}`, 'utf8').digest('hex')
const database = new Database(process.env.P16_DATABASE, { readonly: true, fileMustExist: true })
database.pragma('query_only = ON')
const rows = database.prepare('SELECT key_hash FROM auth_throttle').all().map((row) => row.key_hash)
database.close()
if (!rows.includes(hash('register:ip:127.0.0.1'))) throw new Error('trusted proxy did not preserve the direct browser address')
if (rows.includes(hash('register:ip:203.0.113.77'))) throw new Error('browser-forged X-Forwarded-For reached the API throttle key')
const { mode: databaseMode } = (await import('node:fs')).statSync(process.env.P16_DATABASE)
const { mode: rootMode } = (await import('node:fs')).statSync(new URL('.', `file://${process.env.P16_DATABASE}`).pathname)
if ((databaseMode & 0o777) !== 0o600 || (rootMode & 0o777) !== 0o700) throw new Error('isolated data permissions do not match 0600/0700')
NODE

if grep -Eq 'short|203\.0\.113\.77|__Host-ppt_session|Authorization:[[:space:]]*Bearer' "$P16_TEMP_ROOT/api.log" "$P16_TEMP_ROOT/web.log" "$P16_TEMP_ROOT/proxy.log"; then
  printf 'ERROR: rehearsal logs contain a credential or browser-forged address pattern\n' >&2
  exit 1
fi

[ "$(ps -o uid= -p "$api_pid" | tr -d ' ')" = "$(id -u)" ] || { printf 'ERROR: API rehearsal process UID changed\n' >&2; exit 1; }
[ "$(ps -o uid= -p "$web_pid" | tr -d ' ')" = "$(id -u)" ] || { printf 'ERROR: Web rehearsal process UID changed\n' >&2; exit 1; }

kill "$proxy_pid" "$web_pid" "$api_pid"
wait "$proxy_pid" "$web_pid" "$api_pid" 2>/dev/null || true
proxy_pid=''; web_pid=''; api_pid=''

ASSET_LIBRARY_DATA_ROOT="$data_root" NODE_ENV=test node apps/api/dist/db/migrate.js >"$P16_TEMP_ROOT/repeat-migrate.json"
[ ! -d "$data_root/backups" ] || [ -z "$(find "$data_root/backups" -mindepth 1 -maxdepth 1 -type f -print -quit)" ] || {
  printf 'ERROR: no-op migration created a backup\n' >&2
  exit 1
}

emit_database_triggers() {
  P16_DATABASE=$1 node --input-type=module <<'NODE'
import { createRequire } from 'node:module'
const require = createRequire(new URL('./apps/api/package.json', import.meta.url))
const Database = require('better-sqlite3')
const database = new Database(process.env.P16_DATABASE, { readonly: true, fileMustExist: true })
database.pragma('query_only = ON')
for (const row of database.prepare("SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name").all()) console.log(row.name)
database.close()
NODE
}

emit_contract_triggers() {
  node -e 'const c=require(process.argv[1]); const count=process.argv[2]; const names=[...c.triggersThroughMigration5]; if (Number(count)>=6) names.push(...c.migration6TriggerAdditions); if (Number(count)>=7) names.push(...c.migration7TriggerAdditions); process.stdout.write(`${names.sort().join("\n")}\n`)' \
    "$REPO_ROOT/apps/api/drizzle/schema-trigger-contract.json" "$1"
}

trigger_verifier="$REPO_ROOT/ops/workbuddy/verify-trigger-contract.mjs"
trigger_contract="$REPO_ROOT/apps/api/drizzle/schema-trigger-contract.json"
emit_database_triggers "$data_root/asset-library.db" | node "$trigger_verifier" --contract "$trigger_contract" --migration-count 7 >/dev/null
for migration_count in 5 6 7; do
  emit_contract_triggers "$migration_count" | node "$trigger_verifier" --contract "$trigger_contract" --migration-count "$migration_count" >/dev/null
done
if { emit_contract_triggers 7; printf 'unexpected_p16_trigger\n'; } | node "$trigger_verifier" --contract "$trigger_contract" --migration-count 7 > /dev/null 2>"$P16_TEMP_ROOT/unknown-trigger.stderr"; then
  printf 'ERROR: unknown trigger passed the approved trigger contract\n' >&2
  exit 1
fi
grep -F 'unapproved trigger' "$P16_TEMP_ROOT/unknown-trigger.stderr" >/dev/null
if emit_contract_triggers 7 | node "$trigger_verifier" --contract "$trigger_contract" --migration-count 6 > /dev/null 2>"$P16_TEMP_ROOT/wrong-ledger.stderr"; then
  printf 'ERROR: migration 7 trigger set passed the migration 6 contract\n' >&2
  exit 1
fi

commit_a=1111111111111111111111111111111111111111
commit_b=2222222222222222222222222222222222222222
for commit in "$commit_a" "$commit_b"; do
  source_root="$P16_TEMP_ROOT/source-$commit"
  mkdir -p "$source_root/apps/api/dist" "$source_root/apps/web/build/client/_app/immutable/chunks" "$source_root/ops/systemd" "$source_root/ops/caddy"
  printf 'fixture\n' > "$source_root/.html-ppt-built-release"
  printf 'api\n' > "$source_root/apps/api/dist/index.js"
  printf 'web\n' > "$source_root/apps/web/build/index.js"
  printf '%s\n' "$commit" > "$source_root/apps/web/build/client/_app/immutable/chunks/$commit.js"
  cp ops/systemd/html-ppt-api.service "$source_root/ops/systemd/html-ppt-api.service"
  cp ops/caddy/Caddyfile.production "$source_root/ops/caddy/Caddyfile.production"
  bash ops/workbuddy/deploy.sh --target local --root "$P16_TEMP_ROOT" --source "$source_root" --commit "$commit" >/dev/null
done

[ "$(readlink "$P16_TEMP_ROOT/current")" = "releases/$commit_b" ]
[ "$(readlink "$P16_TEMP_ROOT/previous")" = "releases/$commit_a" ]
[ -f "$P16_TEMP_ROOT/releases/$commit_b/apps/web/build/client/_app/immutable/chunks/$commit_a.js" ]
[ -f "$P16_TEMP_ROOT/releases/$commit_b/apps/web/build/client/_app/immutable/chunks/$commit_b.js" ]

bash ops/workbuddy/rollback.sh --target local --root "$P16_TEMP_ROOT" --commit "$commit_a" --expected-current "$commit_b" >/dev/null
[ "$(readlink "$P16_TEMP_ROOT/current")" = "releases/$commit_a" ]
[ -d "$P16_TEMP_ROOT/releases/$commit_b" ]

printf 'OK: P16 non-root API/Web, isolated migration, trusted-proxy negative case, cumulative immutable assets, atomic release and rollback rehearsal passed\n'
