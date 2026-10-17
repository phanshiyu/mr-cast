# 9. The lit part matches the words: a linter plus one fresh audit subagent

- Status: Accepted; the audit subagent superseded by 0019, the linter kept
- Date: 2026-10-17

## Context

The user: "when explaining things like bubble sort, the focus/highlighting is very very horrible, often explaining things
that are not lit up" (v023 highlight brief). One root cause was timing: a step's changes land as it starts, before its
words, so a step that said "compare five and one, so they swap" showed the swap while the voice still compared. Every
writer tried wrote it that way (CHANGELOG 0.23.0).

Research on self-critique says a writer judging its own output does not improve it and can make it worse: GPT-3.5 fell
from 75.8 to 41.8 on CommonSenseQA after two rounds without external feedback (Huang et al.), and models favour and
recognise their own text (Xu et al.; Panickssery et al.) (quality/research/planning.md, section F).

## Decision

- Fix the root cause in the skill: a comparison gets its own step that lights both cells, and the swap goes in the next
  step. The array primitive holds the full rule; SKILL.md keeps one sentence (CHANGELOG 0.23.0; v023 merge brief, 3).
- A deterministic linter in `validate`, for what is decidable: it warns when a step's words name a cell value or index, a
  pointer, a `memory` value, or a label of two or more words that the step leaves dark, and about a swap no earlier step
  lit. Counts such as "two passes" and labels the sentence denies do not warn.
- `mr-cast steps` prints each step's words beside what is lit and what changes as it starts.
- After `validate` passes, Claude makes one `Agent` call with `model: "sonnet"` that starts a fresh subagent with
  `references/highlight-audit.md` and the `steps` output. The writer never audits itself: no resuming an agent that wrote
  the storyboard, and no answering the audit in place of the call. One call per video; quick mode skips it.

## Consequences

Good:
- Over 150 earlier storyboards and 1,963 steps the linter warns once, about a step that does name a dark field
  (CHANGELOG 0.23.0).
- The audit covers what the linter cannot decide: "the left one", light that lags its words, a change one step early.

Bad:
- One extra model call per full video.
- Measured on 4 bubble-sort storyboards from the 0.22 skill (19 hand-labelled mismatches) and 8 mismatches seeded into other diagram types: the Sonnet audit alone found 12 of 19 real and 8 of 8 seeded, with no false positives, in about 10 to 20 s a call. Haiku found 11 and 8, with 4 false positives, and was slower. The linter alone found 19 of 19 real but 1 of 8 seeded. Linter plus Sonnet found all 27. Sonnet misses swaps described only as a reason; the linter misses lagging or misplaced light on non-array diagrams. Small sample: one topic for the real cases.

## Alternatives considered

- The writer re-reads its own steps: rejected on the self-critique evidence above.
- The linter alone: it cannot resolve references like "the left one" or judge timing.
- One audit call per scene: more cost, and the brief limited it to one call.
