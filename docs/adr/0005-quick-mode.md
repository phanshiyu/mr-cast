# 5. Quick mode: no questions, 1 to 3 scenes, a separate quick run

- Status: Accepted; its scene and length warnings superseded by 0019; the intent scene superseded by 0026
- Date: 2026-10-17

## Context

The user asked for "a feature where we can quickly generate a short video very very fast so i can quickly ask to explain
this flow in a diagram" (quick-build brief). A full video asks up to three questions, opens the plan page, and needs an
intent scene, diagrams, code and tests, which takes minutes.

## Decision

- The skill picks the mode from one trigger table. "quick", "just a diagram", "explain this flow in a diagram", or a bare
  `/mr-cast` with selected code, make a quick video. Quick words win over "the PR" unless the user asks for an MP4, and
  "save it" after a quick video renders that video (CHANGELOG 0.21.0; skill/mr-cast/SKILL.md step 1).
- Quick mode asks nothing and opens no plan page. It writes 1 to 3 scenes, about a minute of narration. Its first line
  says which mode and source it picked and how to switch (0.21.0).
- `init --quick` starts the run in `.mr-cast/quick-<title-slug>/`, so it never overwrites a full run. `validate` lets a
  quick video open without an intent scene and warns past 3 scenes or about 60 seconds; every other check still applies
  (0.21.0).
- A later full `init` of the same title copies the quick storyboard, snippets and voice clips; `--reset` starts empty.
- The video ends on a card of next steps: "go deeper", "the whole branch", "save it".

## Consequences

Good:
- A quick video was on screen in about 20 seconds in 0.21.0. Since 0.23.0, a 2-scene, 43-second quick video opens with
  its voice in about 16 seconds on a first run (CHANGELOG 0.21.0, 0.23.0).
- Correctness and text-fit checks still run, so a quick video is not a lower-quality video, only a shorter one.
- Quick mode skips the highlight audit (ADR 9) to stay fast.

Bad:
- Two modes means a trigger table with precedence rules. Review round 1 found "save it" after a quick video started the
  full flow, and "a quick video of the PR" went to full mode, both fixed by reordering the table (review021 fix brief, M4).
- A selection reaches Claude only when Claude Code is connected to the IDE (0.21.0).

## Alternatives considered

- Make the full flow faster instead: the questions and plan page are the point of a full video.
- A quick audience flag on the same run directory: it would overwrite a full run of the same branch.
