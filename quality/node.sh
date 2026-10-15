#!/usr/bin/env bash
# Runs a Node script with a real node binary (a shell function or shim named node can be broken).
# Usage: quality/node.sh script.mjs [args...]
set -euo pipefail
n="$(type -P node 2>/dev/null || true)"
if [ -z "$n" ] || ! "$n" -e 0 2>/dev/null; then
  n="$(ls -d "${NVM_DIR:-$HOME/.nvm}"/versions/node/v2[0-4]*/bin/node 2>/dev/null | sort -rV | head -1 || true)"
fi
[ -n "$n" ] || { echo "node.sh: no working node found" >&2; exit 1; }
exec "$n" "$@"
