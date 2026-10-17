# 18. A PostToolUse hook in the skill runs the checks after every write

- Status: Accepted
- Date: 2026-10-17 (as built: the run's audience and `--read-only`, corrected after review the same release)

## Context

The skill's loop is write, validate, fix (ADR 2). After a compaction or a long edit session the agent can forget to
run it. Claude Code lets a skill's frontmatter define hooks, which register when the skill is invoked and run for the
rest of the session; a PostToolUse command hook gets the tool's input as JSON on stdin, with `tool_input.file_path`,
and exit code 2 shows its stderr to Claude (code.claude.com/docs/en/hooks and /skills, read for this change).

## Decision

- The mr-cast SKILL.md frontmatter declares a PostToolUse hook on `Write|Edit` that runs `<install>/bin/mr-cast hook`.
- `mr-cast hook` reads the event, and only for `storyboard.json` or `article.md` inside a `.mr-cast/<run>/` directory
  runs `validate --read-only` or `article` on that run. On errors it prints them to stderr and exits 2; otherwise it
  prints nothing and exits 0. Warnings never block. When no line of the output is an error (broken JSON, a missing
  hunks.json), it shows the whole of stderr instead.
- The audience is the run's own: every command given `--audience` (or `--simple`) records it in the run's meta.json,
  and the hook passes it on. A run whose commands were given none, such as a quick video, is validated with no
  `--audience`. The user's last choice across runs (last-choices.json) is only the skill's suggestion for the next
  video, so the hook never reads it.
- `--read-only` makes validate write nothing: no review.md, reading.md or plan-built.json is written or removed, and
  neither meta.json nor last-choices.json changes. A check that runs on every write must not change the run behind
  the agent's back.

## Consequences

Good:
- An invalid storyboard or article is reported on the write that broke it, even when the agent forgot the loop.
- Other files cost one Node start, about half a second.

Bad:
- The audience is the one the run's commands were given last; a run validated once with `--audience preread` and then
  once without stays a pre-read for the hook, since a command without the flag records nothing.
- The docs do not say whether skill hooks fire inside subagents, and a skill read as a file (as our quality harness
  does) registers no hook, so the harness does not measure it.

## Alternatives considered

- Only the skill's prose: the eval history shows prose rules are followed unevenly (ADR 2).
- A hook in the user's settings: mr-cast would have to edit the user's config, which it never does.
