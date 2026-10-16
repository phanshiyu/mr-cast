# Review mode

A storyboard with `findings` is a reviewed walkthrough: besides explaining the branch, it flags what looks clearly wrong. A code step with `"flag": "<id>"` circles its line in the finding's severity colour (`bug` red, `risk` orange, `nit` blue) with the severity and a handwritten note. A `review` scene at the end recaps every finding worst first, under "Claude's review" and "My opinion, checked against the code". `validate` checks the findings and writes `review.md` into the run's directory, and `render --out` writes a copy beside the MP4. A storyboard without `findings` renders exactly as before.

## Sub-features

- `review-validate` checks each finding: its `file` is a changed file, every `line` is a new-file line of that file's diff hunks, `severity` is `bug`, `risk` or `nit`, and `claim` and `evidence` are set. A `flag` must name a finding, sit on a code step with `lines` in the finding's file, and those lines must hold the finding's line. With findings there must be one `review` scene, and with `"findings": []` none. It warns about a finding no step flags, a flagged step whose `say` has no opinion word ("I think", "looks", "worth"), a recap before the last code or tests scene, and more than 8 findings.
- `review-flag` draws a flagged step's pen mark in the severity colour, a circle unless the step sets `mark`, with the note `<severity>: <note>`, the note defaulting to the plain claim. A claim over 40 characters needs the step's own `note`.
- `review-recap` draws the `review` scene: a row per finding with a severity pill, `file:line` and the claim, fitted like every text, and fails `validate` when a claim does not fit.
- `review-md` writes `review.md` on every valid command, and deletes one it wrote when the storyboard has no `findings`. `validate` prints `wrote <path>` before its verdict, which ends `· review: 1 bug, 1 risk, 1 nit`. `outline` adds `review: ...` and lists each code scene's flags.

## How to get to it (user POV)

- Ask the skill for a video "with your review", or answer yes to its Review question. The skill reads `references/review.md` and writes `findings`.
- Run `mr-cast validate`, `still`, `render` or `play` on a storyboard with `findings`.

## Driving it with verify.sh

Preconditions: the baseline in `README.md`. The example has its own repository.

- **The example validates and writes review.md.** Run `bash $REPO/scripts/review-demo.sh $RUN/work/accounts`, then `$V mrc $RUN review-extract --cwd $RUN/work/accounts -- extract` and `cp $REPO/examples/review/storyboard.json $RUN/work/accounts/.mr-cast/feature-password-reset/`. `$V mrc $RUN review-validate --cwd $RUN/work/accounts -- validate` exits 0, prints `wrote .mr-cast/feature-password-reset/review.md`, and ends `review: 1 bug, 1 risk, 1 nit`. `cat` the file: three `file:line` bullets under Bugs, Risks and Nits, each with its evidence.
- **The planted bug is real.** In `$RUN/work/accounts`, redeem one token twice with a scratch script against `src/reset.js`: the second redeem succeeds.
- **The flags and the recap draw.** `$V mrc $RUN review-stills --cwd $RUN/work/accounts -- still --out $EV/stills` and open `scene-10-review.png`: three rows, BUG, RISK, NIT, with their `file:line` and claim. A flag on a step before the last clears before the scene's settled frame, so prove the inline marks from a render: `render --out $EV/video/review.mp4`, then `node $REPO/.claude/skills/verify/scripts/sync-check.mjs $RUN/work/accounts/.mr-cast/feature-password-reset $EV/video/review.mp4 $EV/sync` and open the `step-K-say.png` frames of the flagged steps: a circle in red, orange or blue, and a note starting `bug:`, `risk:` or `nit:`.
- **validate rejects a bad finding.** Edit a copy of the storyboard: set a finding's `line` to 40, its `severity` to `blocker` and its `evidence` to `""`. `validate` exits 1 with `findings[0].line: src/reset.js line 40 is not in the diff`, `findings[0].severity: must be one of bug, risk, nit` and `findings[0].evidence: required`.
- **Review off is unchanged.** A storyboard without `findings` must draw byte-identical stills to the release before. Take `still` of `examples/demo`, `examples/gallery` and `examples/people` with this checkout and with the previous release's checkout, and `cmp` each pair of PNGs.

## Gotchas

- The skill must not show the example's answers to an agent under test: `references/review.md` uses an orders and payments example, not the password reset.
- `review.md` is written by every command that loads a valid storyboard, not only `validate`, and removed by one whose storyboard has no findings. A failing `validate` leaves it as it was. mr-cast replaces or removes only a `review.md` that starts `# Review: `; any other file of that name is kept, with a warning when there are findings to save.
- A flagged step counts as a marked step for timing (the pen lead) and for the 2-marks-a-scene warning.
