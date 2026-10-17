# 18. A PostToolUse hook in the skill runs the checks after every write

- Status: Accepted
- Date: 2026-10-17

## Context

The skill's loop is write, validate, fix (ADR 2). After a compaction or a long edit session the agent can forget to
run it. Claude Code lets a skill's frontmatter define hooks, which register when the skill is invoked and run for the
rest of the session; a PostToolUse command hook gets the tool's input as JSON on stdin, with `tool_input.file_path`,
and exit code 2 shows its stderr to Claude (code.claude.com/docs/en/hooks and /skills, read for this change).

## Decision

- The mr-cast SKILL.md frontmatter declares a PostToolUse hook on `Write|Edit` that runs `<install>/bin/mr-cast hook`.
- `mr-cast hook` reads the event, and only for `storyboard.json` or `article.md` inside a `.mr-cast/<run>/` directory
  runs `validate` (with the last audience the user chose) or `article` on that run. On errors it prints them to stderr
  and exits 2; otherwise it prints nothing and exits 0. Warnings never block.

## Consequences

Good:
- An invalid storyboard or article is reported on the write that broke it, even when the agent forgot the loop.
- Other files cost one Node start, about half a second.

Bad:
- The audience comes from the last remembered choice, not the flags of this run, so an audience-specific error can be
  missed or shown under another audience; errors rarely depend on the audience.
- The docs do not say whether skill hooks fire inside subagents, and a skill read as a file (as our quality harness
  does) registers no hook, so the harness does not measure it.

## Alternatives considered

- Only the skill's prose: the eval history shows prose rules are followed unevenly (ADR 2).
- A hook in the user's settings: mr-cast would have to edit the user's config, which it never does.
