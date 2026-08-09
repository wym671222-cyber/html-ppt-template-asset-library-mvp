#!/bin/sh

set -eu
umask 077

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

note() {
  printf '%s\n' "$*"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command is unavailable: $1"
}

validate_commit() {
  case "$1" in
    *[!0-9a-f]*|'') fail 'commit must be a full lowercase hexadecimal SHA' ;;
  esac
  [ "${#1}" -eq 40 ] || fail 'commit must contain exactly 40 hexadecimal characters'
}

validate_local_root() {
  case "$1" in
    /tmp/*|/private/tmp/*|/private/var/folders/*) ;;
    *) fail 'local rehearsal root must be an explicit tool-created temporary directory' ;;
  esac
  [ -f "$1/.html-ppt-p16-rehearsal" ] || fail 'local rehearsal root is missing its tool-created marker'
}

validate_release_link() (
  case "$1" in
    releases/[0-9a-f][0-9a-f][0-9a-f][0-9a-f]*) ;;
    *) fail 'release symlink does not point into the managed releases directory' ;;
  esac
  p16_link_commit=${1#releases/}
  validate_commit "$p16_link_commit"
)

atomic_release_link() (
  p16_root=$1
  p16_name=$2
  p16_target=$3
  p16_node_binary=$4
  p16_destination="$p16_root/$p16_name"
  p16_temporary="$p16_root/.${p16_name}.next.$$"
  [ ! -e "$p16_destination" ] || [ -L "$p16_destination" ] || fail "$p16_destination exists and is not a symlink"
  [ ! -e "$p16_temporary" ] && [ ! -L "$p16_temporary" ] || fail "temporary symlink already exists: $p16_temporary"
  ln -s "$p16_target" "$p16_temporary"
  [ -x "$p16_node_binary" ] || fail "atomic rename Node binary is unavailable: $p16_node_binary"
  "$p16_node_binary" -e 'require("node:fs").renameSync(process.argv[1], process.argv[2])' "$p16_temporary" "$p16_destination"
)
