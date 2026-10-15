#!/usr/bin/env bash
# For every fixture whose repo's current run (.mr-cast/<.current>/) has a storyboard.json: validate it,
# render stills of every scene, and write <workdir>/<fixture>/packet/ (scene-NN.png + packet.md) for the reviewer.
# Usage: quality/collect.sh <workdir>
set -uo pipefail
work="$(cd "${1:?usage: collect.sh <workdir>}" && pwd)"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cli="$here/../bin/mr-cast"
for dir in "$work"/*/; do
  name="$(basename "$dir")"
  repo="$dir/repo"
  run="$repo/.mr-cast/$(cat "$repo/.mr-cast/.current" 2>/dev/null)"
  [ -f "$run/storyboard.json" ] || { echo "$name: no storyboard, skipped"; continue; }
  rm -rf "$dir/packet" "$run/stills"
  if (cd "$repo" && "$cli" validate) >"$dir/validate.txt" 2>&1; then
    echo pass >"$dir/validate.status"
  else
    echo fail >"$dir/validate.status"
    echo "$name: validation FAILED (see $dir/validate.txt)"
    continue
  fi
  # still renders from the saved storyboard and ignores voice-over; there is no --no-voice flag on it
  if ! (cd "$repo" && "$cli" still --out "$run/stills") >"$dir/stills.txt" 2>&1; then
    echo "$name: still rendering FAILED (see $dir/stills.txt)"
    continue
  fi
  mkdir -p "$dir/packet"
  i=0
  for png in $(ls "$run/stills"/*.png | sort); do
    i=$((i + 1))
    cp "$png" "$dir/packet/$(printf 'scene-%02d.png' "$i")"
  done
  bash "$here/node.sh" "$here/packet.mjs" "$run/storyboard.json" "$dir/packet/packet.md"
  echo "$name: validation pass, $i stills, packet at $dir/packet"
done
