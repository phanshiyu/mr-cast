# 27. A registry of running processes, `ps` and `stop`, and servers that exit when nobody watches

- Status: Accepted
- Date: 2026-10-18

## Context

Agents start `mr-cast play` and `mr-cast plan` as background commands, and often forget them. The user: "sometimes I
can have existing mr-cast servers running by agents that I do not know about, any way to look up and prune existing
processes?". Before 0.27.1 a player ran until someone pressed Ctrl+C or killed it. Nothing listed the players, and nothing
showed which port, run or repository each one served. A render and play's voice and download children can also run on.
A second `play` of the same run started a second server on the next free port.

## Decision

- **A registry.** play, plan, render, and play's voice and download children each write `<pid>.json` into
  `$XDG_STATE_HOME/mr-cast/procs`, or `~/.local/state/mr-cast/procs` when it is not set, as they start. They remove the
  entry as they exit. The entry holds the kind, pid, parent pid, URL with its token, run directory, run name,
  repository, mr-cast version, the start time as `ps` prints it, the pages open, since when none has been open, and the
  idle limit, when an idle server exits, and the process's command line as `ps` prints it. The file is mode 0600,
  since the URL carries the plan page's token, in a directory of mode 0700 that must be the user's own and not a
  symlink. Each process writes only its own file, through a uniquely named temp file opened with O_EXCL and renamed,
  so no two processes write one file. A listing removes temp files a writer left more than a minute ago.
- **The state directory, not the cache.** The XDG state directory is per user and holds state that outlives one
  command. `$XDG_RUNTIME_DIR` would suit pid files better, but macOS has none. The cache would work too, but its
  contents are what `prune` deletes, and a user clears it to free space.
- **Every listing checks each entry.** An entry counts only while `ps` shows its pid owned by this user, started at
  the recorded time, and running exactly the recorded command line, which must be node running `bin/mr-cast.mjs` or
  `bin/lib/voice-child.mjs`. The recorded command line, not a pattern, is what makes a play started as
  `node bin/mr-cast.mjs play` match itself. The start time is `ps -o lstart` in the C locale with `TZ=UTC0`, to the
  second, so processes started under different time zones agree. An entry is removed only when `ps` answered with a
  whole table, one that shows the listing process itself, and that table shows the pid gone or started at another
  time: the process died without its exit handler (SIGKILL, a crash in native code), or the pid was reused. A failed
  or empty `ps` removes nothing, since removing a live entry hides a server from replace-on-play. `ps` runs after the
  entries are read, so a process that registers meanwhile is in the table. A killed voice child cannot remove its
  entry, so play removes it.
- **Older processes are found too.** mr-cast 0.27.0 and older wrote no entry, so `ps` is scanned for processes of
  this user whose argv[0] is node and whose first non-option argument is `bin/mr-cast.mjs` followed by `play`, `plan`
  or `render`, or the voice child. A wrapper whose arguments only name mr-cast, such as `zsh -c`, `sh -c`,
  `caffeinate` or `timeout`, is not one, so `stop all` never signals it. A relative script path is resolved against
  the process's working directory. They are kept only when the script's package is `@shiyuphan/mr-cast`. `lsof`
  gives their working directory and listening port. They are marked `unregistered`, as is a 0.27.1 process that
  records itself under another `XDG_STATE_HOME`. The scan sees every mr-cast of the user on the machine, so
  `MR_CAST_PROCS_SCAN=0` turns it off for tests and sandboxes, which must touch only their own processes.
- **`mr-cast ps [--json]`** prints one line per process: pid, kind, age, the pages open (or how long until an idle
  server exits), URL and run. A child is indented under its parent.
- **`mr-cast stop <pid|run|all> [--idle] [--older-than 2h] [--dry-run] [--json]`** stops what it picks, with each
  picked process's children. It sends SIGTERM, waits up to 5 seconds, then sends SIGKILL to what is left. Before each
  signal it reads `ps` again and skips a pid that is no longer the same mr-cast process. A run name matches within
  the current repository, since names such as `rate-limiter` repeat across repositories; `--any-repo` widens it. A
  pid that no longer runs at all is skipped with a note, so a menu answered after a process ended still stops the
  rest. A pid running something else, or a run with nothing running, stops nothing, like `prune` with an unknown id
  (ADR 0011). A render stopped with SIGTERM closes its browser before it exits.
- **A menu.** `stop --choices --json` prints the menu in prune's shape. Each option's `command` is `stop <pids>` of
  the top-level processes it counts, and `ids` are those pids. Children are left out, since voice children come and
  go with each voicing, and no option says `all`, which would stop whatever runs when the user answers.
  `prune --choices` appends it as its last group, `Running processes`. The prune skill runs one `stop` with the union
  of the chosen stop options' ids, then one `prune` for the rest, and never uses `kill`. A test checks that the
  installed skill holds no such instruction.
- **`status`** adds `running: 2 players and 1 render` when anything runs, so the agent learns of forgotten servers from
  the command it runs first.
- **Idle exit.** Each open page holds one `/events` stream, the one it already held for reloads, so the count of open
  streams is the count of pages. A player or plan server exits by itself once no page has been open for 30 minutes,
  counted from the last page leaving or from the start. `--idle-exit <minutes>` changes it, and 0 turns it off. A
  player does not count while any voicing runs: the page opens only after the first, and an edit's reloads an open
  page once it is voiced. The count starts over when the voicing ends. The server records the time it will exit,
  which `ps` prints, or `voicing` while one holds the count off.
- **A second server of a run replaces the first.** A `play` of a run that already has a live player stops it and its
  children, then starts. A second `plan` replaces the first plan server the same way. It happens after the storyboard
  or plan validates, so a broken edit does not stop the server that works. The old server gets SIGUSR2, on which it
  stops its voicing but lets a voice model download finish: the download fills the shared cache, and the new
  server's download waits for it on the engine's lock instead of starting over. Replacing, not reusing, starts the server
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
- A render closes its browser on SIGTERM, then exits. A test checks on macOS that its Chrome Headless Shell
  processes are gone after `stop`, and runs only where `MR_CAST_TEST_RENDER_CACHE` names a cache holding Chrome. On
  Linux, where Chrome may outlive a render that exits without closing it, the same handler should close it; that
  is untested here. A SIGKILL after the 5-second grace still leaves Chrome to exit by itself.
- Without `MR_CAST_PROCS_SCAN=0`, `status`, `ps`, `prune --choices` and `stop all` see mr-cast processes running
  anywhere on the machine, other checkouts and other agents included. The tests set it, stop only pids they started,
  and still match `status` lines by prefix and drop the `Running processes` group.

## Alternatives considered

- **Find servers by port scan or `lsof` alone.** No run, no URL token, and no record of pages open. It is kept only for
  older processes.
- **A lock or pid file per run instead of per process.** It would serve the duplicate rule, but not render, the
  children, or `ps` across repositories.
- **Ask each server over HTTP for its pages.** It needs a port and the token, and a hung server would hang `ps`. The
  server writes its count into its own entry instead.
- **Reuse the running player.** Rejected above: it would ignore the new flags and keep old code running.
