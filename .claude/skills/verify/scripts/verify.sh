#!/usr/bin/env bash
# Verification harness for mr-cast. Every subcommand takes a run directory: <run>/work holds the demo
# repo, the temp Claude config dir and player logs (deleted by cleanup); <run>/evidence holds proof
# (kept by cleanup). See ../SKILL.md for the recipes.
set -euo pipefail
# Claude Code's shell defines `node` as a broken nvm lazy-load function; only real binaries from here on.
unset -f node npm npx nvm _load_nvm 2>/dev/null || true

HERE="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../../.." && pwd)"
MRC="$REPO/bin/mr-cast"

die() { echo "verify: $*" >&2; exit 1; }

usage() {
  cat <<EOF
usage: verify.sh <command> <run-dir> [args]
  launch  <run>                         create <run>/work/repo (the demo git repo) and <run>/evidence; build the player if dist/ is missing
  doctor  <run>                         read-only health check; exit 1 on any FAIL
  env     <run>                         print exports (eval "\$(verify.sh env <run>)") for ad-hoc commands
  mrc     <run> <label> [--cwd dir] -- <mr-cast args>
                                        run bin/mr-cast in the demo repo (or dir under <run>); save the
                                        command, stdout, stderr and exit code to <run>/evidence/<label>.txt
  play-start <run> <label> [--cwd dir] [play args]
                                        start \`mr-cast play --no-open\` in the background; print its URL
                                        (the full URL, with the write token, is in <run>/work/play/<label>.token-url)
  plan-start <run> <label> [--cwd dir] [plan args]
                                        start \`mr-cast plan --no-open\` in the background; print the plan
                                        page's URL with its write token
  play-stop  <run> [label]              stop the player(s) this run started; copy their logs to evidence
  browse  <run> <label> <url> <step>... drive the player in Chrome Headless Shell (steps: see scripts/browse.mjs)
  probe   <mp4>                         ffprobe duration and streams
  frame   <mp4> <seconds> <out.png>     extract one frame
  cleanup <run>                         stop players, delete <run>/work, keep <run>/evidence
EOF
}

pick_node() {
  local c
  for c in "$(type -P node 2>/dev/null || true)" $(ls -d "${NVM_DIR:-$HOME/.nvm}"/versions/node/v*/bin/node 2>/dev/null | sort -rV); do
    [ -x "$c" ] || continue
    if "$c" -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 12) ? 0 : 1)' 2>/dev/null; then echo "$c"; return; fi
  done
  die "no Node 22.12 or newer found; install Node 24 with nvm (the checkout's .nvmrc)"
}

# ffmpeg and ffprobe ship in the compositor package, which pnpm keeps beside @remotion/renderer.
compositor() {
  "$(pick_node)" -e 'const { createRequire } = require("node:module"); const path = require("node:path");
    const renderer = createRequire(path.join(process.argv[1], "package.json")).resolve("@remotion/renderer/package.json");
    console.log(path.dirname(createRequire(renderer).resolve("@remotion/compositor-darwin-arm64/package.json")))' "$REPO"
}

run_paths() {
  [ -n "${1:-}" ] || die "missing <run-dir>; pick one under your scratchpad or from mktemp -d"
  case "$1" in /*) ;; *) die "<run-dir> must be absolute, got $1" ;; esac
  RUN="$(cd "$1" 2>/dev/null && pwd -P || echo "${1%/}")"
  WORK="$RUN/work"
  EV="$RUN/evidence"
  DEMO="$WORK/repo"
  NODE="$(pick_node)"
  export PATH="$(dirname "$NODE"):$PATH"
  export MR_CAST_NO_UPDATE_CHECK="${MR_CAST_NO_UPDATE_CHECK-1}"
  export CLAUDE_CONFIG_DIR="$WORK/claude"
  export XDG_CONFIG_HOME="$WORK/config"
}

cmd_env() {
  run_paths "$1"
  cat <<EOF
unset -f node npm npx nvm _load_nvm 2>/dev/null
export PATH="$(dirname "$NODE"):\$PATH"
export MR_CAST_NO_UPDATE_CHECK=1
export CLAUDE_CONFIG_DIR="$CLAUDE_CONFIG_DIR" XDG_CONFIG_HOME="$XDG_CONFIG_HOME"
export RUN="$RUN" EV="$EV" DEMO="$DEMO" MRC="$MRC" V="$HERE/verify.sh" REPO="$REPO"
EOF
}

cmd_launch() {
  mkdir -p "${1:?missing <run-dir>}"
  run_paths "$1"
  mkdir -p "$EV" "$WORK" "$CLAUDE_CONFIG_DIR"
  if [ ! -d "$DEMO/.git" ]; then
    bash "$REPO/scripts/demo.sh" "$DEMO" >/dev/null
  fi
  if [ ! -f "$REPO/dist/index.html" ]; then
    echo "verify: building the player (dist/ missing)" >&2
    (cd "$REPO" && "$NODE" node_modules/vite/bin/vite.js build >/dev/null)
  fi
  echo "verify: ready run=$RUN repo=$DEMO evidence=$EV"
}

cmd_doctor() {
  run_paths "$1"
  local fail=0
  check() { if eval "$2" >/dev/null 2>&1; then echo "PASS $1"; else echo "FAIL $1"; fail=1; fi; }
  local version
  version="$("$MRC" --version 2>/dev/null || true)"
  echo "info mr-cast: ${version:-none} at $REPO ($(git -C "$REPO" rev-parse --short HEAD 2>/dev/null))"
  check "launcher runs Node 22.12 or newer" "echo '$version' | grep -Eq '\(node (22\.(1[2-9]|[2-9][0-9])|2[3-9]|[3-9][0-9])\.'"
  check "player built ($REPO/dist/index.html)" "[ -f '$REPO/dist/index.html' ]"
  check "demo repo on feature/rate-limit ahead of main" "[ \"\$(git -C '$DEMO' symbolic-ref --short HEAD)\" = feature/rate-limit ] && [ \"\$(git -C '$DEMO' rev-list --count main..HEAD)\" = 1 ]"
  check "evidence dir exists ($EV)" "[ -d '$EV' ]"
  local cache="${XDG_CACHE_HOME:-$HOME/.cache}/mr-cast"
  check "Chrome Headless Shell cached (renders and browse need it)" "find '$cache/remotion' -name chrome-headless-shell -type f -perm -u+x | grep -q ."
  check "Kokoro voice model cached (voice, play and render without --no-voice)" "[ -d '$cache/models' ]"
  local comp
  comp="$(compositor 2>/dev/null || true)"
  check "ffprobe runs" "DYLD_LIBRARY_PATH='$comp' '$comp/ffprobe' -version"
  local f pid port
  for f in "$WORK"/play/*.pid; do
    [ -f "$f" ] || continue
    pid="$(cat "$f")"
    port="$(sed -n 's/.*:\([0-9]*\)$/\1/p' "${f%.pid}.url" 2>/dev/null)"
    check "player $(basename "${f%.pid}") pid $pid owns port $port" "lsof -nP -a -p '$pid' -iTCP:'$port' -sTCP:LISTEN"
  done
  return "$fail"
}

cmd_mrc() {
  run_paths "$1"
  local label="${2:?missing <label>}"
  shift 2
  local cwd="$DEMO"
  if [ "${1:-}" = "--cwd" ]; then
    cwd="$(cd "$2" && pwd -P)"
    shift 2
  fi
  [ "${1:-}" = "--" ] && shift
  case "$cwd/" in "$RUN"/*) ;; *) die "--cwd $cwd is outside $RUN; drive only directories this run owns" ;; esac
  if [ "${1:-}" = prune ] && printf '%s\n' "$@" | grep -q '^cache:'; then
    case "${XDG_CACHE_HOME:-}" in "$RUN"/*) ;; *) die "refusing to prune cache:* outside $RUN; set XDG_CACHE_HOME=$WORK/xdg (the real ~/.cache/mr-cast holds Chrome and the voice model)" ;; esac
  fi
  mkdir -p "$EV"
  local out="$EV/$label.txt" so se code=0
  so="$(mktemp)"; se="$(mktemp)"
  (cd "$cwd" && "$MRC" "$@") >"$so" 2>"$se" || code=$?
  {
    echo "\$ (cd $cwd) mr-cast $*"
    echo "--- stdout"; cat "$so"
    echo "--- stderr"; cat "$se"
    echo "--- exit $code"
  } >"$out"
  cat "$so"; cat "$se" >&2
  echo "verify: exit $code · $out" >&2
  rm -f "$so" "$se"
  return "$code"
}

# serve_start <play|plan> <run> <label> [--cwd dir] [args]: start the server, wait for its URL line, print the URL.
serve_start() {
  local sub="$1"
  shift
  run_paths "$1"
  local label="${2:?missing <label>}"
  shift 2
  local dir="$WORK/play"
  mkdir -p "$dir"
  [ -f "$dir/$label.pid" ] && kill -0 "$(cat "$dir/$label.pid")" 2>/dev/null && die "player $label already runs (pid $(cat "$dir/$label.pid")); play-stop it first"
  local cwd="$DEMO"
  if [ "${1:-}" = "--cwd" ]; then cwd="$(cd "$2" && pwd -P)"; shift 2; fi
  (cd "$cwd" && exec "$MRC" "$sub" --no-open "$@") >"$dir/$label.out" 2>"$dir/$label.err" &
  local pid=$!
  echo "$pid" >"$dir/$label.pid"
  local url=""
  for _ in $(seq 1 600); do
    url="$(sed -nE 's/^mr-cast (player|plan): //p' "$dir/$label.out" 2>/dev/null)"
    [ -n "$url" ] && break
    kill -0 "$pid" 2>/dev/null || { cat "$dir/$label.err" >&2; rm -f "$dir/$label.pid"; die "player $label exited before serving"; }
    sleep 0.2
  done
  [ -n "$url" ] || die "player $label printed no URL in 120s; see $dir/$label.err"
  # The token is in the URL fragment; recipes append paths to the bare origin.
  echo "${url%%/#*}" | sed 's|/plan#.*||' >"$dir/$label.url"
  echo "$url" >"$dir/$label.token-url"
  if [ "$sub" = plan ]; then echo "$url"; else cat "$dir/$label.url"; fi
}

cmd_play_start() { serve_start play "$@"; }
cmd_plan_start() { serve_start plan "$@"; }

cmd_play_stop() {
  run_paths "$1"
  local dir="$WORK/play" f pid name
  for f in "$dir"/${2:-*}.pid; do
    [ -f "$f" ] || continue
    pid="$(cat "$f")"; name="$(basename "${f%.pid}")"
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid"
      for _ in $(seq 1 50); do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
      kill -0 "$pid" 2>/dev/null && kill -9 "$pid"
    fi
    mkdir -p "$EV"
    cp "$dir/$name.out" "$EV/play-$name.stdout.txt" 2>/dev/null || true
    cp "$dir/$name.err" "$EV/play-$name.stderr.txt" 2>/dev/null || true
    rm -f "$f"
    echo "verify: stopped player $name (pid $pid)"
  done
}

cmd_browse() {
  run_paths "$1"
  local label="${2:?missing <label>}" url="${3:?missing <url>}"
  shift 3
  "$NODE" "$HERE/browse.mjs" "$url" "$EV/$label" "$@"
}

cmd_probe() {
  local comp
  comp="$(compositor)"
  DYLD_LIBRARY_PATH="$comp" "$comp/ffprobe" -v error \
    -show_entries format=duration:stream=codec_type,codec_name,width,height,r_frame_rate -of compact "${1:?missing <mp4>}"
}

cmd_frame() {
  local comp
  comp="$(compositor)"
  DYLD_LIBRARY_PATH="$comp" "$comp/ffmpeg" -v error -y -ss "${2:?missing <seconds>}" -i "${1:?missing <mp4>}" -frames:v 1 "${3:?missing <out.png>}"
  echo "$3"
}

cmd_cleanup() {
  run_paths "$1"
  cmd_play_stop "$1"
  rm -rf "$WORK"
  echo "verify: removed $WORK; evidence kept in $EV:"
  find "$EV" -type f 2>/dev/null | sort | sed "s|^$EV/|  |"
}

command="${1:-}"
[ -n "$command" ] || { usage; exit 2; }
shift
case "$command" in
  launch) cmd_launch "$@" ;;
  doctor) cmd_doctor "$@" ;;
  env) cmd_env "$@" ;;
  mrc) cmd_mrc "$@" ;;
  play-start) cmd_play_start "$@" ;;
  plan-start) cmd_plan_start "$@" ;;
  play-stop) cmd_play_stop "$@" ;;
  browse) cmd_browse "$@" ;;
  probe) cmd_probe "$@" ;;
  frame) cmd_frame "$@" ;;
  cleanup) cmd_cleanup "$@" ;;
  -h|--help|help) usage ;;
  *) usage; exit 2 ;;
esac
