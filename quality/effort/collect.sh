#!/usr/bin/env bash
# Validates one writer's storyboard with its audience, renders a still per scene, and writes a reviewer packet:
# scene-NN.png, packet.md (chapter, type, narration per scene) and, when validate wrote one, reading.md.
# Usage: quality/effort/collect.sh <writer-dir> <audience> <packet-dir>
set -uo pipefail
dir="$(cd "${1:?usage: collect.sh <writer-dir> <audience> <packet-dir>}" && pwd)"
audience="${2:?usage: collect.sh <writer-dir> <audience> <packet-dir>}"
out="${3:?usage: collect.sh <writer-dir> <audience> <packet-dir>}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cli="$here/../../bin/mr-cast"
repo="$dir/repo"
run="$repo/.mr-cast/$(cat "$repo/.mr-cast/.current" 2>/dev/null)"
[ -f "$run/storyboard.json" ] || { echo "$dir: no storyboard"; exit 1; }
rm -rf "$out" "$run/stills" && mkdir -p "$out"
if ! (cd "$repo" && "$cli" validate --audience "$audience") >"$out/../validate.txt" 2>&1; then
  echo "$dir: validation FAILED (see $out/../validate.txt)"; exit 1
fi
(cd "$repo" && "$cli" still --audience "$audience" --out "$run/stills") >"$out/../stills.txt" 2>&1 || { echo "$dir: stills FAILED"; exit 1; }
i=0
for png in $(ls "$run/stills"/*.png | sort); do
  i=$((i + 1))
  cp "$png" "$out/$(printf 'scene-%02d.png' "$i")"
done
bash "$here/../node.sh" "$here/../packet.mjs" "$run/storyboard.json" "$out/packet.md"
[ -f "$run/reading.md" ] && cp "$run/reading.md" "$out/reading.md"
cp "$run/storyboard.json" "$out/../storyboard.json"
echo "$dir: $i stills, packet at $out$( [ -f "$out/reading.md" ] && echo ' (with reading.md)')"
