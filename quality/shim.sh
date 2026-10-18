#!/usr/bin/env bash
# Give a writer's workdir its own mr-cast: <dir>/bin/mr-cast runs this checkout's CLI with XDG_CONFIG_HOME at
# <dir>/config, XDG_STATE_HOME at <dir>/state, no update check and no scan for other mr-cast processes, and the skill
# copy in <dir>/notes/mr-cast calls that shim instead of the CLI. A writer that forgets the temp config can then never
# overwrite the real ~/.config/mr-cast/last-choices.json, and its ps and stop see only the processes it started.
# Usage: quality/shim.sh <dir>
set -euo pipefail
dir="$(cd "${1:?usage: shim.sh <dir>}" && pwd -P)"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
mkdir -p "$dir/bin" "$dir/config"
cat > "$dir/bin/mr-cast" <<SHIM
#!/usr/bin/env bash
export XDG_CONFIG_HOME="$dir/config" XDG_STATE_HOME="$dir/state" MR_CAST_NO_UPDATE_CHECK=1 MR_CAST_PROCS_SCAN=0
config="\$(cd "\$XDG_CONFIG_HOME" && pwd -P)"
real="\$(cd "\$HOME/.config" 2>/dev/null && pwd -P || echo "\$HOME/.config")"
case "\$config/" in
  "\$real/"*) echo "mr-cast shim: XDG_CONFIG_HOME \$XDG_CONFIG_HOME is the real ~/.config; refusing to run" >&2; exit 1 ;;
esac
exec "$root/bin/mr-cast" "\$@"
SHIM
chmod +x "$dir/bin/mr-cast"
if [ -d "$dir/notes/mr-cast" ]; then
  find "$dir/notes/mr-cast" -name '*.md' -exec perl -pi -e 's{[^\s`"'"'"'(]*/bin/mr-cast\b}{'"$dir"'/bin/mr-cast}g' {} +
fi
