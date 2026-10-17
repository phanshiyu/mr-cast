# 4. A plan page of topics, with guarded writes and an explicit record of what was built

- Status: Accepted
- Date: 2026-10-17

## Context

Before 0.21.0 a Focus question asked which areas to go deeper on. The user had no view of what the video would cover
until it was made. A picker in the browser needs a local server that accepts writes, which any web page the user visits
could also try to reach.

## Decision

- After the questions, Claude cuts the change into 4 to 8 topics named by what they do, writes `plan.json`, and
  `mr-cast plan` serves a page. Each topic offers Skip, Brief and Deep, and two or three views in plain words from a fixed
  vocabulary in `shared/views.mjs`, such as "Who calls whom, in order" or "Before vs after", with Claude's suggestion
  preselected. The page replaces the Focus question (CHANGELOG 0.21.0; README, The plan).
- Writes are guarded. The server listens on 127.0.0.1 only and refuses a request whose Host is not its own address. Each
  write needs a random per-server token from the URL mr-cast opened. It accepts only a `choice` for a known topic with a
  depth and view that topic offers, refuses oversized bodies (413), and replaces `plan.json` by renaming a complete file
  into place. Without the token the page is read-only (CHANGELOG 0.21.0; bin/lib/server.mjs).
- The storyboard's top-level `plan` map records the pick each topic was written from. `plan-built.json` is stamped from
  that map only, so the page marks "Changed, not in the video yet" exactly where the current pick differs (review021
  round 2 brief; CHANGELOG 0.21.0).

## Consequences

Good:
- The user picks coverage before any writing time is spent, and "update the video" rewrites only the changed topics.
- Another site cannot change the plan: it cannot read the token, and a DNS-rebinding request carries the wrong Host.
- A write the disk refuses returns an error instead of stopping the server (0.21.0).

Bad:
- One more step in a full video. Claude skips the page for "just make it" and for changes of two topics or fewer (README).
- Claude must keep the `plan` map in step with the scenes; `validate` warns when it does not.

## Alternatives considered

- Infer depth from step counts. Built first, then dropped in review round 2: it miscounted `focusLinesAfter`, summed
  across scenes, and simple style forces steps, so a correct brief rebuild never got stamped and the badge stuck.
- Stamp the current `plan.json` on any error-free validate. It marked picks the storyboard never received (review 1, M3).
- Keep the Focus question: no length estimate, no per-topic view choice.
