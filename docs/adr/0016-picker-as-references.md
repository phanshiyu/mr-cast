# 16. The primitive picker lives in the mr-cast skill's references, not in a skill of its own

- Status: Accepted
- Date: 2026-10-17
- Supersedes: 0010 (where the picker lives; its index and one file per scene stay)

## Context

ADR 10 shipped the picker as a second skill, `mr-cast-primitives`, with `user-invocable: false`. A listed skill's
description stays in Claude's context on every turn of every session, and `user-invocable: false` does not remove it;
the listing budget drops the least-used descriptions first (quality/research/skills.md, How the descriptions trigger).
The 0.23 picker eval found that writers did open the index, but they opened it as a file, by the relative link
`../mr-cast-primitives/SKILL.md` in the main skill, not through the Skill tool (the transcript reader in that eval
counted Read calls on the path). Nothing in that evidence needs the picker to be listed.

## Decision

- The index table moves into `skill/mr-cast/references/adapt.md`, read at the adaptation step, and the scene files move
  to `skill/mr-cast/references/scenes/<type>.md`, each linked from SKILL.md, one level deep.
- The article stage never sees them: SKILL.md links them from step 6 only.
- `install-skill` stops writing `mr-cast-primitives`; its manifest removes the old files on the next install.

## Consequences

Good:
- One listed skill instead of two, so no description of a helper sits in every session's context.
- The same files, examples and drift test (`test/primitives.test.mjs`), now at the new path.

Bad:
- A user who invoked `mr-cast-primitives` by name can no longer; it was hidden from the menu, so this is unlikely.

## Alternatives considered

- Keep the separate skill: costs context in every session for a lookup that only an mr-cast run makes.
- One listed skill per scene, as pstack does for principles: about 20 descriptions in every session.
