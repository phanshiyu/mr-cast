# Review mode

The user asked for your opinion of the branch as well as the walkthrough. While you walk through the change, flag anything that looks clearly wrong. The video still explains the change first. Your flags are drawn apart from the explanation, so the explanation stays trustworthy even where your judgment is wrong.

## What to flag

Flag what a reviewer would read and say "wait, that's wrong". This is not a deep audit. Look for:

- An obvious bug: a wrong condition, an off-by-one, a wrong variable or key, a value in the wrong unit.
- A missing `await`, or a missing error path where a call can fail.
- A security slip, such as a secret written to a log, unchecked input, or a check that can be skipped.
- A risky path that no test covers, when it is easy to get wrong.
- A broken API: a renamed export or a changed signature that callers in the diff still use.
- A confusing name, or a typo in a message a user sees.

Leave out style preferences, design choices the change makes on purpose, and code the diff does not touch.

Each flag gets a severity:

- `bug` is wrong today. Name the input that breaks it.
- `risk` breaks under some input or later, or leaks something.
- `nit` is small but worth a fix, such as a confusing name.

## Check every flag

A flag that turns out wrong costs the viewer's trust in the whole video. Before you add one:

1. Read the code around the line: the caller, the function it calls, the type or the data it uses. Confirm the code does what you think.
2. Find the input that breaks it. When that is cheap, prove it: run the tests, or a few lines of script against the real code, from a scratch directory you delete afterwards.
3. Drop it if you are not sure. A clean review is a good result.

## Write the findings

List them in the storyboard's `findings`, worst first. Each one has:

- `id`, a short name such as `"order-before-payment"`.
- `severity`, `bug`, `risk` or `nit`.
- `file` and `line`, a new-file line or `"a-b"` range of a few lines from the hunk index, on a line the diff shows. For a problem in removed code, point at the nearest new-file line of its hunk.
- `claim`, what looks wrong in one short line, such as "the order is saved before the payment is checked".
- `evidence`, one short line on what the code does and the input that breaks it, such as "`createOrder` runs before `chargeCard`, so a declined card leaves an unpaid order". It goes into `review.md`, not on screen.

When nothing looks wrong, write `"findings": []`. The last scene's narration then says that you looked for problems and found none.

## Show each flag where the walkthrough reaches it

Each flag belongs in the code scene that shows its line. Walk that scene in `steps`, and give the step whose lines hold the flagged line `"flag": "<id>"`. The step then draws a pen circle in the severity's colour around its lines, or around its `token`, with the claim as a handwritten note under the severity. Give the step a `note` of up to 40 characters when the claim is longer. Set `mark` to draw another shape, such as `underline`.

Say the flag in that step's `say`, as your opinion, in plain spoken words: "I think this order is a bug. The order is saved before the payment is checked, so a declined card still leaves an order behind." Use words such as "I think", "looks" or "worth checking". Say what goes wrong for a person, not the code's names: "a failed payment still leaves an order behind", not "createOrder persists before chargeCard". The exact names stay on screen in the pen note and the recap. The rest of the scene still explains the code as it is.

When no code scene shows the flagged line, add one, or add a step to the scene that shows its hunk.

## Recap at the end

With one or more findings, end the video with one scene `{ "type": "review", "narration": "..." }`, after the tests and their code. It lists every finding, worst first, with its severity, file and line, and claim, under "Claude's review" and "My opinion, checked against the code". Its narration recaps them in a sentence or two, such as "To recap, I flagged one bug and one nit. Fix the unpaid orders first." Keep it short, since each flag was already explained. It takes no steps.

With no findings, leave the review scene out.

## Check it

`{{MR_CAST}}/bin/mr-cast validate <flags>` checks that each finding's file and line are in the diff, that its severity is one of the three, and that it has evidence. It checks that each `flag` names a finding and sits on a step whose lines hold that finding's line. It warns when a finding is flagged on no step, and when a flagged step's words do not sound like an opinion. It then writes `review.md` and prints its path.
