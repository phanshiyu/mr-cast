# 2. The storyboard is JSON written by the agent and checked by `mr-cast validate`

- Status: Accepted; how the skill gets the schema is superseded by 0015 (`mr-cast schema`)
- Date: 2026-10-15

## Context

The agent writes the video's content and the CLI draws it, so they need a contract. Agent prose instructions are followed
unevenly: in the early eval, focus limits were made validator errors "so the agent must comply", and a trial agent's
code-heavy, late-diagram walkthrough was fixed by a validator rule, not by more skill text (quality/research/skills.md,
"Our own evidence"). Research on self-correction finds that a check the model runs beats asking it to check its own work
(skills.md, Huang et al., CRITIC).

## Decision

- The agent writes `storyboard.json`, which points at diff hunks by id instead of copying code (README).
- `src/types.ts` defines the schema. Its doc comments are the schema the skill reads: `install-skill` copies the storyboard
  section of `src/types.ts` into the installed SKILL.md in place of `{{STORYBOARD_TYPES}}` (bin/lib/install-skill.mjs).
- `mr-cast validate` checks every storyboard before it plays or renders. The skill's loop is: write, validate, fix what it
  names, repeat until `✓ storyboard ok` (skill/mr-cast/SKILL.md).
- A rule that can be checked goes into `validate`, with a message that names the fix. Skill prose is kept for judgment.
  Examples: text fit runs the player's own layout code (0.14.0), spoken code names and long sentences (0.18.0), counts the
  voice says (0.21.0), reading-order coverage (0.22.0), words that name a dark part (0.23.0).

## Consequences

Good:
- The schema cannot drift from the renderer, because both come from `src/types.ts`.
- Errors are exact and fixable, such as a label that "does not fit its message label, even at 15px" with a fix (0.14.0).
- Warnings let older storyboards keep validating while new rules land (0.18.0).

Bad:
- The schema inlined into SKILL.md is large: the installed file is about 1,297 lines and about 25k tokens, of which the
  schema is 883 lines (skills.md, Audit). ADR 15 proposes moving it out.
- Rules are sometimes both in `validate` and in skill prose, so they get loaded twice (skills.md, Duplicated rules).

## Alternatives considered

- A free-form script or Remotion code written by the agent: more expressive, but nothing to check against.
- A hand-written schema document for the skill: it would drift from the renderer.
- Rules in skill prose only: cheaper to write, and the eval showed agents skip them.
