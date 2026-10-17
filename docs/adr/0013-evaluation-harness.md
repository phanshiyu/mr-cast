# 13. Evaluate skill changes with blind graded reviewers, in isolated config

- Status: Accepted
- Date: 2026-10-15

## Context

Storyboard guidance is a guess until something measures it. The harness measures whether a reviewer who only watches the
video can answer the questions a real reviewer needs answered. It runs no agents itself; it prepares inputs, collects
outputs and computes numbers, and the agents are Sonnet writers and reviewers (quality/README.md; commit fe2ffb4).

## Decision

- Fixtures build four git repos (`rate-limit`, `invoice-status`, `pagination-fix`, `webhook-retries`). `keys/<name>.json`
  holds 5 questions per fixture with `answer` and `must_mention`, never copied into a repo or packet.
- A fresh writer agent per fixture writes a storyboard with a skill variant. `collect.sh` validates it and renders one
  still per scene. A reviewer agent answers the questions from the stills and narration alone. A grader scores each answer
  1, 0.5 or 0 against the key. Paths avoid loaded words such as "eval" or "judge", since the writer can see them.
- Every mr-cast run uses temporary `XDG_CONFIG_HOME`, `XDG_CACHE_HOME` and `CLAUDE_CONFIG_DIR`. `quality/shim.sh`
  sets them and refuses to run against the real `~/.config`, because eval writers overwrote the user's
  `last-choices.json` (commit b7eb8e1; the 0.23 briefs count two such incidents).
- `quality/effort/` measures what a video saves a reviewer who then reads the code: one seeded bug per fixture in
  `bugs.json`, arms `familiar`, `preread` and `none`, a video-only quiz, a full review with a bug hunt, and a review on a
  budget of one `git diff --stat` and two file reads (commit 8ae9c70).

## Consequences

Good:
- A variant 10% shorter, with 25% fewer scenes and 27% less highlighted code, scored 34.5/40 against 35.5/40, within
  noise, and was promoted (commit fe2ffb4).
- The pre-read result (ADR 8) came from the effort harness.

Bad:
- The instrument has a ceiling. Ease (1 to 5) does not discriminate: it was 4.0 in every arm of the first comparison
  (decisions.tsv, the untracked decision log in the main checkout).
- The eval rewarded omission until coverage questions were added (skills.md, "Our own evidence").
- The fixtures are small enough to fit in one `git diff`, so a reviewer with the repo needs no video (CHANGELOG 0.22.0).
- Samples are small: six reviews per arm in 0.22.0.

## Alternatives considered

- Rate clarity by asking agents or humans: ratings did not predict usefulness (planning.md, item 28, Hase and Bansal).
- Run writers with the user's own config: it corrupted the user's remembered choices.
