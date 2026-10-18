# 27. A registry of running processes, `ps` and `stop`, and servers that exit when nobody watches

- Status: Accepted
- Date: 2026-10-18

## Context

Agents start `mr-cast play` and `mr-cast plan` as background commands, and often forget them. The user: "sometimes I
can have existing mr-cast servers running by agents that I do not know about, any way to look up and prune existing
processes?". Before 0.28 a player ran until someone pressed Ctrl+C or killed it. Nothing listed the players, and nothing
showed which port, run or repository each one served. A render and play's voice and download children can also run on.
A second `play` of the same run started a second server on the next free port.

## Decision

- **A registry.** play, plan, render, and play's voice and download children each write `<pid>.json` into
  `$XDG_STATE_HOME/mr-cast/procs`, or `~/.local/state/mr-cast/procs` when it is not set, as they start. They remove the
  entry as they exit. The entry holds the kind, pid, parent pid, URL with its token, run directory, run name,
  repository, mr-cast version, the start time as `ps` prints it, the pages open, since when none has been open, and the
  idle limit. The file is mode 0600, since the URL carries the plan page's token. Each process writes only its own
  file, by rename, so no two processes write one file.
- **The state directory, not the cache.** The XDG state directory is per user and holds state that outlives one
  command. `$XDG_RUNTIME_DIR` would suit pid files better, but macOS has none. The cache would work too, but its
  contents are what `prune` deletes, and a user clears it to free space.
- **Every listing checks each entry.** An entry counts only while `ps` shows its pid owned by this user, started at
  the recorded time, and running `bin/mr-cast.mjs` or `bin/lib/voice-child.mjs`. Any other entry is stale and is
  removed: the process died without its exit handler (SIGKILL, a crash in native code), or the pid was reused. The
  start time is `ps -o lstart` in the C locale, to the second. `ps` runs after the entries are read, so a process that
  registers meanwhile is in the table. A killed voice child cannot remove its entry, so play removes it.
- **Older processes are found too.** mr-cast 0.27 and older wrote no entry, so `ps` is scanned for node processes of
  this user running `bin/mr-cast.mjs play`, `plan` or `render`, or a voice child. They are kept only when the script's
  package is `@shiyuphan/mr-cast`. `lsof` gives their working directory and listening port. They are marked
  `unregistered`, as is a 0.28 process that records itself under another `XDG_STATE_HOME`.
- **`mr-cast ps [--json]`** prints one line per process: pid, kind, age, the pages open (or how long until an idle
  server exits), URL and run. A child is indented under its parent.
- **`mr-cast stop <pid|run|all> [--idle] [--older-than 2h] [--dry-run] [--json]`** stops what it picks, with each
  picked process's children. It sends SIGTERM, waits up to 5 seconds, then sends SIGKILL to what is left. Before each
  signal it reads `ps` again and skips a pid that is no longer the same mr-cast process. A target that matches nothing
  stops nothing, like `prune` with an unknown id (ADR 0011).
- **A menu.** `stop --choices --json` prints the menu in prune's shape, each option with the exact `command` and the
  pids it stops as `ids`. `prune --choices` appends it as its last group, `Running processes`. The prune skill runs one
  `stop` with the union of the chosen stop options' ids, then one `prune` for the rest, and never uses `kill`. A test
  checks that the installed skill holds no such instruction.
- **`status`** adds `running: 2 players and 1 render` when anything runs, so the agent learns of forgotten servers from
  the command it runs first.
- **Idle exit.** Each open page holds one `/events` stream, the one it already held for reloads, so the count of open
  streams is the count of pages. A player or plan server exits by itself once no page has been open for 30 minutes,
  counted from the last page leaving or from the start. `--idle-exit <minutes>` changes it, and 0 turns it off. A
  player waits while its first voicing runs, since the page opens only after it.
- **A second server of a run replaces the first.** A `play` of a run that already has a live player stops it and its
  children, then starts. A second `plan` replaces the first plan server the same way. It happens after the storyboard
  or plan validates, so a broken edit does not stop the server that works. Replacing, not reusing, starts the server
  with this command's flags and this mr-cast's code. A reused server would keep an older voice or pace, or an older
  mr-cast after an upgrade. The cost is small, since the clips are on disk and a voiced run starts in under a second
  (ADR 0007).

## Consequences

Good:
- `mr-cast ps` answers "what is running and where", and `mr-cast stop` ends it without the user finding pids.
- A forgotten player ends itself 30 minutes after its last viewer, and a run never has two players.
- `stop` cannot hit a process that only reuses a pid, or a process of another user.

Bad:
- Windows has no `ps` of this shape, so nothing is listed or stopped there. The servers still exit when idle.
- Two `play` commands of one run that start in the same moment can both start, since neither sees the other yet.
- A page left open in a background tab keeps its server alive. That is the point of counting pages, but a tab
  forgotten for days keeps a player for days.
- A render stopped with SIGTERM exits at once without its exit handler, so `stop` removes its entry. The Chrome that
  Remotion started is left to Remotion's own cleanup.
- Tests that run `status` or `prune --choices` see mr-cast processes running anywhere on the machine, so they match
  lines by prefix and drop the `Running processes` group. They must never run a `stop` option.

## Alternatives considered

- **Find servers by port scan or `lsof` alone.** No run, no URL token, and no record of pages open. It is kept only for
  older processes.
- **A lock or pid file per run instead of per process.** It would serve the duplicate rule, but not render, the
  children, or `ps` across repositories.
- **Ask each server over HTTP for its pages.** It needs a port and the token, and a hung server would hang `ps`. The
  server writes its count into its own entry instead.
- **Reuse the running player.** Rejected above: it would ignore the new flags and keep old code running.
