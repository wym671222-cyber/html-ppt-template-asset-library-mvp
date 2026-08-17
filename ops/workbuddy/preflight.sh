#!/bin/sh

set -eu
umask 077

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
# shellcheck source=lib.sh
. "$SCRIPT_DIR/lib.sh"

target=''
allow_write_override=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    --target) [ "$#" -ge 2 ] || fail '--target requires a value'; target=$2; shift 2 ;;
    --allow-write-override) allow_write_override=true; shift ;;
    *) fail "unknown argument: $1" ;;
  esac
done
[ -n "$target" ] || fail '--target is required'

for required in \
  ops/systemd/html-ppt-api.service \
  ops/systemd/html-ppt-web.service \
  ops/caddy/Caddyfile.production \
  apps/api/drizzle/schema-trigger-contract.json \
  ops/workbuddy/deploy.sh \
  ops/workbuddy/rollback.sh \
  ops/workbuddy/verify-trigger-contract.mjs; do
  [ -f "$REPO_ROOT/$required" ] || fail "release asset is missing: $required"
done

sh -n "$SCRIPT_DIR/lib.sh" "$SCRIPT_DIR/deploy.sh" "$SCRIPT_DIR/rollback.sh" "$0"

if [ "$target" = local ]; then
  [ "$allow_write_override" = false ] || fail '--allow-write-override is only valid for the approval-gated production preflight'
  note 'OK: P16 repository release assets and shell syntax'
  if command -v node >/dev/null 2>&1; then
    node_major=$(node -p 'process.versions.node.split(".")[0]')
    [ "$node_major" = 22 ] && note 'OK: local Node 22' || note "LIMIT: local Node major is $node_major; this is not Node 22 production evidence"
    node --check "$SCRIPT_DIR/verify-trigger-contract.mjs"
    note 'OK: local trigger-contract verifier syntax'
  else
    note 'LIMIT: node is unavailable'
  fi
  if command -v caddy >/dev/null 2>&1; then
    P16_LOG_PATH=/tmp/html-ppt-p16-access.json caddy validate --config "$REPO_ROOT/ops/caddy/Caddyfile.production" --adapter caddyfile
    note 'OK: local Caddy validate'
  else
    note 'LIMIT: caddy is unavailable; production candidate has static tests only'
  fi
  if command -v systemd-analyze >/dev/null 2>&1; then
    systemd-analyze verify "$REPO_ROOT/ops/systemd/html-ppt-api.service" "$REPO_ROOT/ops/systemd/html-ppt-web.service"
    note 'OK: local systemd-analyze verify'
  else
    note 'LIMIT: systemd-analyze is unavailable; units cannot be runtime-verified on this host'
  fi
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    note 'OK: Docker daemon is reachable'
  else
    note 'LIMIT: Docker daemon is unavailable; containerized Caddy validation is not claimed'
  fi
  exit 0
fi

[ "$target" = 119.29.241.146 ] || fail 'production target must be exactly 119.29.241.146'
require_command ip
require_command getent
require_command curl
require_command pnpm
require_command sqlite3
require_command systemctl
require_command systemd-analyze
require_command caddy

ip -o -4 addr show | awk '{print $4}' | cut -d/ -f1 | grep -Fx "$target" >/dev/null || fail 'this host does not own the approved production address'
ip -o -4 addr show | awk '{print $4}' | grep -Fx '172.18.0.1/16' >/dev/null || fail 'verified Docker bridge address 172.18.0.1/16 is absent or drifted'
getent ahostsv4 ppt.ajjy-ai.site | awk '{print $1}' | grep -Fx "$target" >/dev/null || fail 'production DNS does not resolve to the approved target'
[ -x /usr/bin/node ] || fail 'systemd Node runtime /usr/bin/node is unavailable'
[ "$(/usr/bin/node -p 'process.versions.node.split(".")[0]')" = 22 ] || fail 'systemd Node runtime /usr/bin/node is not major 22'
pnpm_path=$(command -v pnpm)
case "$pnpm_path" in /*) ;; *) fail 'production pnpm must resolve to an absolute executable path' ;; esac
pnpm_version=$(/usr/bin/node "$pnpm_path" --version) || fail 'production pnpm cannot execute under /usr/bin/node'
[ "$pnpm_version" = 9.15.0 ] || fail 'production pnpm is not 9.15.0 under /usr/bin/node'
/usr/bin/node --check "$SCRIPT_DIR/verify-trigger-contract.mjs"
id htmlppt >/dev/null 2>&1 || fail 'service account htmlppt is absent'

api_environment=/etc/html-ppt/api.env
if [ -e "$api_environment" ]; then
  [ ! -L "$api_environment" ] || fail '/etc/html-ppt/api.env must not be a symlink'
  [ "$(stat -c '%a' "$api_environment")" = 600 ] || fail '/etc/html-ppt/api.env mode must be 0600'
  [ "$(stat -c '%U:%G' "$api_environment")" = root:root ] || fail '/etc/html-ppt/api.env must be owned by root:root'
  api_environment_content=$(awk 'NF && $1 !~ /^#/ { print }' "$api_environment")
  case "$api_environment_content" in APP_READ_ONLY=true|APP_READ_ONLY=false) ;; *) fail '/etc/html-ppt/api.env may contain only one APP_READ_ONLY=true|false assignment' ;; esac
  if [ "$api_environment_content" = APP_READ_ONLY=false ]; then
    [ "$allow_write_override" = true ] || fail 'APP_READ_ONLY=false requires the explicit post-gate --allow-write-override preflight'
    note 'OK: explicit post-gate API write override is root-owned 0600'
  else
    [ "$allow_write_override" = false ] || fail '--allow-write-override requires APP_READ_ONLY=false in /etc/html-ppt/api.env'
    note 'OK: optional API read-only override remains fail closed and is root-owned 0600'
  fi
else
  [ "$allow_write_override" = false ] || fail '--allow-write-override requires /etc/html-ppt/api.env with APP_READ_ONLY=false'
  note 'OK: API read-only override is absent; systemd defaults APP_READ_ONLY=true'
fi

P16_LOG_PATH=/tmp/html-ppt-p16-preflight-access.json caddy validate --config "$REPO_ROOT/ops/caddy/Caddyfile.production" --adapter caddyfile
systemd-analyze verify "$REPO_ROOT/ops/systemd/html-ppt-api.service" "$REPO_ROOT/ops/systemd/html-ppt-web.service"

tls_status=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --connect-timeout 5 --max-time 15 https://ppt.ajjy-ai.site/api/health/live)
case "$tls_status" in 200|401|403|503) ;; *) fail "unexpected HTTPS health status: $tls_status" ;; esac

available_kib=$(df -Pk /opt | awk 'NR==2 {print $4}')
[ "$available_kib" -ge 2097152 ] || fail 'less than 2 GiB is available below /opt'

if [ -e /var/lib/html-ppt ]; then
  [ ! -L /var/lib/html-ppt ] || fail '/var/lib/html-ppt must not be a symlink'
  [ "$(stat -c '%a' /var/lib/html-ppt)" = 700 ] || fail '/var/lib/html-ppt mode must be 0700'
fi

database=/var/lib/html-ppt/asset-library.db
if [ -e "$database" ]; then
  [ ! -L "$database" ] || fail 'production database must not be a symlink'
  [ "$(stat -c '%a' "$database")" = 600 ] || fail 'production database mode must be 0600'
  uri="file:$database?mode=ro&immutable=1"
  [ "$(sqlite3 "$uri" 'PRAGMA query_only=ON; PRAGMA quick_check;')" = ok ] || fail 'production database quick_check failed'
  [ "$(sqlite3 "$uri" 'PRAGMA query_only=ON; PRAGMA foreign_keys=ON; SELECT count(*) FROM pragma_foreign_key_check;')" = 0 ] || fail 'production database foreign_key_check failed'
  tables=$(sqlite3 "$uri" "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;")
  known='__drizzle_migrations auth_throttle audit_events content_objects jobs presentation_exports presentation_items presentations sessions tags template_asset_tags template_assets template_preview_derivatives template_versions users'
  for table in $tables; do
    case " $known " in *" $table "*) ;; *) fail "unknown production table: $table" ;; esac
  done
  migration_count=$(sqlite3 "$uri" 'SELECT count(*) FROM __drizzle_migrations;')
  [ "$migration_count" -ge 5 ] && [ "$migration_count" -le 8 ] || fail 'production migration ledger count is outside the approved 5..8 preflight range'
  triggers=$(sqlite3 "$uri" "SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name;")
  printf '%s\n' "$triggers" | /usr/bin/node "$SCRIPT_DIR/verify-trigger-contract.mjs" \
    --contract "$REPO_ROOT/apps/api/drizzle/schema-trigger-contract.json" \
    --migration-count "$migration_count"
  for table in presentations presentation_items presentation_exports; do
    count=$(sqlite3 "$uri" "SELECT count(*) FROM $table;")
    [ "$count" = 0 ] || fail "P14 ownership mapping required: $table=$count"
  done
  note "OK: production SQLite quick/FK/known-table/trigger/ledger gates; migration_count=$migration_count and ownership counts are zero"
else
  note 'OK: no production database exists; deployment will follow the fresh-database path'
fi

backup_count=0
if [ -d /var/lib/html-ppt/backups ]; then
  backup_count=$(find /var/lib/html-ppt/backups -mindepth 1 -maxdepth 1 -type f | wc -l | tr -d ' ')
fi
note "OK: production preflight passed; existing migration backup files=$backup_count"
note 'No service, Caddy, database, CAS, release, remote or Git state was changed.'
