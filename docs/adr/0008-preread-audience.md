# 8. A pre-read audience: no code on screen, then the order to read it in

- Status: Accepted
- Date: 2026-10-17

## Context

The user asked for "a mode/option to have no code references, but still keep all the most important ideas", because
"this can help my cognitive load a lot when i review MRs, because eventually i still have to look at the code" (nocode
brief). So the video is a pre-read for a reviewer who reads the code next. It is not the team overview, which cuts
coverage.

## Decision

- It is an audience, not a run-wide switch: `--audience preread`, "A reviewer who will read the code next", with the
  reviewer's order and rules plus no code on screen. A first design with a `noCode` field and a plan page switch was cut
  after UX and product reviews (nocode brief v2, 1 and 2; CHANGELOG 0.22.0).
- No code on screen: `validate` fails on a `code` scene, a code cell in a `compare` and a `review` scene, and warns about
  a label that writes an expression. Labels carry the real identifiers, files and values.
- Coverage is carried by the reading order, not the narration. The closing `reading` scene, `reading.md`, `outline` and
  a player panel list every substantial hunk to read, main behaviour first, with what to check; `validate` warns about a
  hunk in neither the order nor `skipped`.
- A scene's `from` names up to 3 hunk ids it explains, shown as "In the code: limiter.ts, server.ts". `validate` warns
  when no label names a cited hunk's file or identifiers.
- Review findings sit on reading items, not on diagram steps.

## Consequences

Good:
- The reading order outlives the video as a checklist for the merge request.
- In a small test with AI reviewers allowed one `git diff --stat` and two file reads, reviewers with a pre-read answered
  79% of the questions, against 61% with no video and 83% with the usual reviewer's video, and looked at fewer scenes
  (3.7 against 8.8) (CHANGELOG 0.22.0).

Bad:
- No effort saving was measured on the small fixtures: with the whole repo to read, no video did as well as either,
  because the test diffs fit in one `git diff`. Six reviews per arm is a direction, not a measurement (CHANGELOG 0.22.0).
- More validate rules specific to one audience, and the plan page words its depths differently for it.

## Alternatives considered

- A `noCode` switch orthogonal to audience, with a plan page toggle: two settings for one intent (nocode brief v2).
- Triggers "just the ideas" or "concepts only": they clash with quick mode's "just a diagram" (nocode brief v2, 3).
- Coverage through `from` alone: it put the burden on narration; the reading order is the deliverable.
