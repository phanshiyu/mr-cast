#!/usr/bin/env bash
# For every fixture whose repo has .mr-cast/storyboard.json: validate it, render stills of every scene,
# and write <workdir>/<fixture>/packet/ (scene-NN.png + packet.md) for the reviewer.
# Usage: quality/collect.sh <workdir>
set -uo pipefail
work="$(cd "${1:?usage: collect.sh <workdir>}" && pwd)"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cli="$here/../bin/mr-cast"
for dir in "$work"/*/; do
  name="$(basename "$dir")"
  repo="$dir/repo"
  [ -f "$repo/.mr-cast/storyboard.json" ] || { echo "$name: no storyboard, skipped"; continue; }
  rm -rf "$dir/packet" "$repo/.mr-cast/stills"
  if (cd "$repo" && "$cli" validate) >"$dir/validate.txt" 2>&1; then
    echo pass >"$dir/validate.status"
  else
    echo fail >"$dir/validate.status"
    echo "$name: validation FAILED (see $dir/validate.txt)"
    continue
  fi
  # still renders from the saved storyboard and ignores voice-over; there is no --no-voice flag on it
  if ! (cd "$repo" && "$cli" still --out "$repo/.mr-cast/stills") >"$dir/stills.txt" 2>&1; then
    echo "$name: still rendering FAILED (see $dir/stills.txt)"
    continue
  fi
  mkdir -p "$dir/packet"
  i=0
  for png in $(ls "$repo/.mr-cast/stills"/*.png | sort); do
    i=$((i + 1))
    cp "$png" "$dir/packet/$(printf 'scene-%02d.png' "$i")"
  done
  bash "$here/node.sh" "$here/packet.mjs" "$repo/.mr-cast/storyboard.json" "$dir/packet/packet.md"
  echo "$name: validation pass, $i stills, packet at $dir/packet"
done
