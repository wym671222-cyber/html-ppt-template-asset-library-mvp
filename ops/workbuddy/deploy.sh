#!/bin/sh

set -eu
umask 077

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=lib.sh
. "$SCRIPT_DIR/lib.sh"

target=''
commit=''
approved_commit=''
release_root=''
source_root=''
node_binary=''

while [ "$#" -gt 0 ]; do
  case "$1" in
    --commit) [ "$#" -ge 2 ] || fail '--commit requires a value'; commit=$2; shift 2 ;;
    --approved-commit) [ "$#" -ge 2 ] || fail '--approved-commit requires a value'; approved_commit=$2; shift 2 ;;
    --target) [ "$#" -ge 2 ] || fail '--target requires a value'; [ -z "$target" ] || fail '--target may be specified only once'; target=$2; shift 2 ;;
    --root) [ "$#" -ge 2 ] || fail '--root requires a value'; release_root=$2; shift 2 ;;
    --source) [ "$#" -ge 2 ] || fail '--source requires a value'; source_root=$2; shift 2 ;;
    *) fail "unknown argument: $1" ;;
  esac
done

validate_commit "$commit"
[ -n "$target" ] || fail '--target is required; production is never the default'

case "$target" in
  local)
    [ -z "$approved_commit" ] || fail '--approved-commit is only valid for production deployment'
    [ -n "$release_root" ] || fail '--root is required for a local rehearsal'
    validate_local_root "$release_root"
    [ -n "$source_root" ] || fail '--source is required for a local rehearsal'
    [ -f "$source_root/.html-ppt-built-release" ] || fail 'local source is not a tool-created built-release fixture'
    require_command node
    node_binary=$(command -v node)
    ;;
  production)
    [ -n "$approved_commit" ] || fail 'production deployment requires --approved-commit with the G2-approved full SHA'
    validate_commit "$approved_commit"
    [ "$approved_commit" = "$commit" ] || fail '--approved-commit must exactly equal --commit'
    [ -z "$release_root" ] || fail '--root cannot override the production release root'
    release_root=/opt/html-ppt
    [ "$(id -u)" -eq 0 ] || fail 'production deployment must run as root after G2 approval'
    id htmlppt >/dev/null 2>&1 || fail 'service account htmlppt does not exist'
    source_root=${source_root:-$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)}
    require_command git
    require_command tar
    require_command runuser
    require_command pnpm
    node_binary=/usr/bin/node
    [ -x "$node_binary" ] || fail 'production deployment requires executable /usr/bin/node'
    [ "$("$node_binary" -p 'process.versions.node.split(".")[0]')" = 22 ] || fail 'production deployment requires /usr/bin/node major 22'
    pnpm_path=$(command -v pnpm)
    case "$pnpm_path" in /*) ;; *) fail 'production pnpm must resolve to an absolute executable path' ;; esac
    pnpm_version=$("$node_binary" "$pnpm_path" --version) || fail 'production pnpm must be executable by /usr/bin/node'
    [ "$pnpm_version" = 9.15.0 ] || fail 'production deployment requires pnpm 9.15.0 under /usr/bin/node'
    resolved_commit=$(git -C "$source_root" rev-parse --verify "$commit^{commit}")
    [ "$resolved_commit" = "$commit" ] || fail 'requested commit is not the exact available commit'
    install -d -o htmlppt -g htmlppt -m 0700 /opt/html-ppt /opt/html-ppt/releases /var/lib/html-ppt
    ;;
  *) fail 'target must be local or production' ;;
esac

releases="$release_root/releases"
release="$releases/$commit"
mkdir -p "$releases"

if [ -d "$release" ]; then
  [ "$(cat "$release/.release-commit" 2>/dev/null || true)" = "$commit" ] || fail 'existing release does not have the expected commit marker'
  note "release already prepared: $release"
else
  incoming="$releases/.incoming-$commit-$$"
  [ ! -e "$incoming" ] || fail "incoming release path already exists: $incoming"
  mkdir "$incoming"

  if [ "$target" = production ]; then
    git -C "$source_root" archive --format=tar "$commit" | tar -xf - -C "$incoming"
    chown -R htmlppt:htmlppt "$incoming"
    runuser -u htmlppt -- "$node_binary" "$pnpm_path" --dir "$incoming" install --frozen-lockfile
    runuser -u htmlppt -- "$node_binary" "$pnpm_path" --dir "$incoming" build
  else
    tar -cf - -C "$source_root" . | tar -xf - -C "$incoming"
  fi

  if [ -L "$release_root/current" ]; then
    current_ref=$(readlink "$release_root/current")
    validate_release_link "$current_ref"
    old_immutable="$release_root/$current_ref/apps/web/build/client/_app/immutable"
    new_immutable="$incoming/apps/web/build/client/_app/immutable"
    if [ -d "$old_immutable" ]; then
      mkdir -p "$new_immutable"
      cp -R -n "$old_immutable/." "$new_immutable/"
    fi
  fi

  [ -f "$incoming/apps/api/dist/index.js" ] || fail 'built API entrypoint is missing from incoming release'
  [ -f "$incoming/apps/web/build/index.js" ] || fail 'adapter-node Web entrypoint is missing from incoming release'
  [ -d "$incoming/apps/web/build/client/_app/immutable" ] || fail 'hashed Web immutable directory is missing from incoming release'
  [ -f "$incoming/ops/systemd/html-ppt-api.service" ] || fail 'systemd candidate is missing from incoming release'
  [ -f "$incoming/ops/caddy/Caddyfile.production" ] || fail 'Caddy candidate is missing from incoming release'
  printf '%s\n' "$commit" > "$incoming/.release-commit"
  if [ "$target" = production ]; then
    chown -R htmlppt:htmlppt "$incoming"
    find "$incoming" -type d -exec chmod 0700 {} +
  fi
  mv "$incoming" "$release"
fi

if [ -L "$release_root/current" ]; then
  current_ref=$(readlink "$release_root/current")
  validate_release_link "$current_ref"
  if [ "$current_ref" != "releases/$commit" ]; then
    atomic_release_link "$release_root" previous "$current_ref" "$node_binary"
  fi
fi
atomic_release_link "$release_root" current "releases/$commit" "$node_binary"
note "current release: $commit"
note 'services, migration, administrator bootstrap and Caddy remain explicit runbook steps'
