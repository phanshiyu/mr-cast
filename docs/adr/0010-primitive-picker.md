# 10. A primitive picker: one hidden skill, an index by kind of idea, one file per scene

- Status: Superseded by 0016 (the picker's place); its index and scene files stay
- Date: 2026-10-17

## Context

mr-cast has about 20 scene types. The user asked for "a skill that the agent can quickly look up to 'ask' which
primitive should i use? take inspiration from poteto-stack" (v023 picker brief). pstack keeps a short index in its main
skill, each line saying when a principle applies, and a small leaf per principle that the agent reads only when needed.

## Decision

- A new skill, `mr-cast-primitives`, with `user-invocable: false`, installed with the others. It has one job: which scene
  explains this idea with the least cognitive load for the viewer (CHANGELOG 0.23.0).
- Its SKILL.md is an index keyed by kind of idea, phrased as an article would state it ("each pass bubbles the largest
  remaining value to the end", "it retries after 1, 2, then 4 seconds"). Each row gives the scene or a short sequence,
  why it is least load, and when the runner-up wins (skill/mr-cast-primitives/SKILL.md).
- One file per scene type under `primitives/`: when it lowers load, when it adds load, what to use instead, the mistakes
  seen in practice, and a minimal example.
- A drift test: `test/primitives.test.mjs` validates every example against the demo's diff and fails when a scene type is
  added to `src/types.ts` without a file.
- The main skill points at it where the scene is chosen. `install-skill` installs every file under each skill folder.

## Consequences

Good:
- The agent reads only the leaves for the scenes it writes.
- Examples cannot rot silently, and a new scene type cannot ship without guidance.

Bad:
- A listed skill's description stays in context on every turn even with `user-invocable: false`, and the listing budget
  drops the least-used descriptions first. quality/research/skills.md advises that the picker become reference files
  under `skill/mr-cast/references/` during the restructure (ADR 15), keeping one skill listed.
- Some guidance now lives in two places (the array leaf and a SKILL.md sentence) and must stay consistent (v023 merge
  brief, 3).

## Alternatives considered

- One listed skill per primitive, as pstack does for principles: about 20 descriptions in every session's context.
- Keep the scene catalog in SKILL.md: it is part of the 3,065-word Shared rules and sits past the compaction cut
  (skills.md, Audit).
- Generate leaves from `src/types.ts` doc comments: proposed in skills.md for the restructure; not done yet.
