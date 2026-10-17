# 15. Restructure the skill: schema out, branches into references, checks into the CLI

- Status: Accepted (as built in 0.24.0; see As built); its references per step and per mode superseded by 0019
- Date: 2026-10-17

## Context

The installed `mr-cast` SKILL.md is about 1,297 lines, 17,180 words and about 25k tokens, of which 883 lines are the
inlined schema (ADR 2). Anthropic's guidance is under 500 lines and about 5k tokens. After auto-compaction Claude Code
keeps only the first 5,000 tokens of each skill, which end near the start of step 5: a long run that compacts loses the
schema, Teach the change, Shared rules, the voice rules, every audience mode, and steps 6 and 7
(quality/research/skills.md, Audit). SkillsBench found focused skills beat comprehensive ones (+18.8 against -2.9 points).

## Decision

- Move the schema out of SKILL.md: a `mr-cast schema <type>` command, or leaves generated from `src/types.ts` doc
  comments, so the agent loads only the types it uses.
- Split mode-specific sections (each audience, quick mode, the scene catalog) into references read only when that branch
  is taken, each linked from SKILL.md with its condition. The primitive picker (ADR 10) becomes reference files here.
- Move checkable rules into `validate` or the CLI, and delete the prose that restates them: question payloads from
  `status`, a scaffold that writes exact skip reasons from plan picks, user-facing messages from `play` and `render`.
- Add a size test that fails when the installed SKILL.md passes a character budget.
- Add a PostToolUse hook in the skill frontmatter that runs `mr-cast validate` after writes to a storyboard.
- Keep the step list, the validate loop and where to re-read everything else in the first 5,000 tokens.

## Consequences

Good:
- Moving the schema alone saves about 9.7k tokens per run (skills.md, Top changes).
- The writing rules land inside the part that survives compaction, and one rule has one home.

Bad:
- More files to keep linked; references must not depend on each other for required content.
- Every change must be run old against new on the quality harness (ADR 13), which costs time.

## Alternatives considered

- Trim prose in place: does not fix the schema's size or its middle position in the file.
- `context: fork` for the whole skill: the explanation source needs the conversation, which a fork does not see.

## As built (0.24.0)

- The schema is a command, `mr-cast schema [type]`, which prints a scene's doc-commented type and every type it uses
  from `src/types.ts`; `install-skill` no longer fills a schema into SKILL.md. Generated leaves were not needed.
- SKILL.md holds the seven steps, the mode table and the commands, about 3,400 tokens, so all of it survives a
  compaction. Every reference is linked from it with its step or condition: questions, plan, article, reader-test,
  adapt (the scene picker), voice, one per audience, quick, branch, explanation, review, highlight-audit, and
  `scenes/<type>.md` (ADR 16).
- Duplicated rules and prose that restated `validate` were cut; the four contradictions in skills.md were fixed (a
  follow-up "save it" is row 0 of the mode table; the reading scene is required for the branch and optional for an
  explanation; the bare "It" rule points at `validate`; "include it" applies only to the reviewer and the new reader).
- The PostToolUse hook is built (ADR 18). Tests fail when the installed SKILL.md passes 500 lines or about 5,000 tokens,
  when a reference is not linked from SKILL.md or a link does not resolve, and when `schema` misses a type.
- Not done: question payloads from `status`, a scaffold that writes skip reasons from plan picks, and a trigger test
  set for the description.
