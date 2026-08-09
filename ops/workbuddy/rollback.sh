#!/bin/sh

set -eu
umask 077

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=lib.sh
. "$SCRIPT_DIR/lib.sh"

target=''
commit=''
expected_current=''
release_root=''
node_binary=''

while [ "$#" -gt 0 ]; do
  case "$1" in
    --commit) [ "$#" -ge 2 ] || fail '--commit requires a value'; commit=$2; shift 2 ;;
    --expected-current) [ "$#" -ge 2 ] || fail '--expected-current requires a value'; expected_current=$2; shift 2 ;;
    --target) [ "$#" -ge 2 ] || fail '--target requires a value'; [ -z "$target" ] || fail '--target may be specified only once'; target=$2; shift 2 ;;
    --root) [ "$#" -ge 2 ] || fail '--root requires a value'; release_root=$2; shift 2 ;;
    *) fail "unknown argument: $1" ;;
  esac
done

validate_commit "$commit"
validate_commit "$expected_current"
[ -n "$target" ] || fail '--target is required; production is never the default'

case "$target" in
  local)
    [ -n "$release_root" ] || fail '--root is required for a local rehearsal'
    validate_local_root "$release_root"
    require_command node
    node_binary=$(command -v node)
    ;;
  production)
    [ -z "$release_root" ] || fail '--root cannot override the production release root'
    release_root=/opt/html-ppt
    [ "$(id -u)" -eq 0 ] || fail 'production rollback must run as root after operator authorization'
    node_binary=/usr/bin/node
    [ -x "$node_binary" ] || fail 'production rollback requires executable /usr/bin/node'
    [ "$("$node_binary" -p 'process.versions.node.split(".")[0]')" = 22 ] || fail 'production rollback requires /usr/bin/node major 22'
    ;;
  *) fail 'target must be local or production' ;;
esac

[ -L "$release_root/current" ] || fail 'current release symlink is missing'
current_ref=$(readlink "$release_root/current")
validate_release_link "$current_ref"
[ "$current_ref" = "releases/$expected_current" ] || fail 'current release changed since rollback approval'

release="$release_root/releases/$commit"
[ -d "$release" ] || fail 'requested rollback release does not exist'
[ "$(cat "$release/.release-commit" 2>/dev/null || true)" = "$commit" ] || fail 'rollback release marker does not match the requested commit'

atomic_release_link "$release_root" previous "$current_ref" "$node_binary"
atomic_release_link "$release_root" current "releases/$commit" "$node_binary"
note "current release rolled back to: $commit"
note 'no release, backup, database, CAS, Caddy or PM2 artifact was deleted'
note 'restart and data/Caddy restoration remain explicit, approval-gated runbook steps'
