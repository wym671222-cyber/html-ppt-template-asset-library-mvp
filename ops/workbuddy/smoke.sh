#!/bin/sh

set -eu
umask 077

origin=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --origin) [ "$#" -ge 2 ] || { printf 'ERROR: --origin requires a value\n' >&2; exit 1; }; origin=$2; shift 2 ;;
    *) printf 'ERROR: unknown argument: %s\n' "$1" >&2; exit 1 ;;
  esac
done
[ "$origin" = https://ppt.ajjy-ai.site ] || { printf 'ERROR: origin must be exactly https://ppt.ajjy-ai.site\n' >&2; exit 1; }

iteration=1
while [ "$iteration" -le 20 ]; do
  headers=$(mktemp /tmp/html-ppt-smoke-headers.XXXXXX)
  body=$(mktemp /tmp/html-ppt-smoke-body.XXXXXX)
  curl --silent --show-error --fail --max-time 20 -H 'Cache-Control: no-cache' -D "$headers" -o "$body" "$origin/login?cold=$iteration"
  grep -Eiq '^content-type: text/html([;[:space:]]|$)' "$headers" || { printf 'ERROR: iteration %s returned non-HTML login\n' "$iteration" >&2; exit 1; }
  asset=$(sed -n 's/.*src="\([^"?]*\/_app\/immutable\/[^"?]*\.js\)".*/\1/p' "$body" | head -n 1)
  [ -n "$asset" ] || { printf 'ERROR: iteration %s did not expose a hashed JavaScript asset\n' "$iteration" >&2; exit 1; }
  asset_headers=$(mktemp /tmp/html-ppt-smoke-asset-headers.XXXXXX)
  curl --silent --show-error --fail --max-time 20 -D "$asset_headers" -o /dev/null "$origin$asset"
  grep -Eiq '^content-type: (application|text)/javascript' "$asset_headers" || { printf 'ERROR: iteration %s returned incorrect JavaScript MIME\n' "$iteration" >&2; exit 1; }
  rm -f "$headers" "$body" "$asset_headers"
  iteration=$((iteration + 1))
done

curl --silent --show-error --fail --max-time 20 "$origin/api/health/ready" | grep -F '"status":"ready"' >/dev/null
printf 'OK: 20 cold HTML/hashed-JS checks and readiness passed\n'
