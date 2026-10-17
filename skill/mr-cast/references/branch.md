# The branch

The video walks a reviewer through the current branch's diff.

## Start the run

```bash
{{MR_CAST}}/bin/mr-cast extract [base] <flags>
```

- Pass a base branch when the user names one. Otherwise mr-cast picks origin's default branch, then `main` or `master`.
- Add `--working` when the changes are uncommitted, or when `status` showed changed files and nothing ahead of the base.
- For a PR or MR number that isn't checked out, check it out first with `gh pr checkout <n>` or `glab mr checkout <n>`.
- `<flags>` are the flags from step 2: `--audience`, and `--pace` or `--no-voice`.

It prints the run's directory, `.mr-cast/<branch-slug>/`, then a hunk index: each file, its hunk ids (`h1`, `h2`, ...), and the changed lines with their line numbers. Full hunks go to `hunks.json` in that directory. Don't read that file. Read the source files instead when a change needs more context to explain. Running `extract` again on the same branch refreshes the diff and keeps the storyboard and the snippets.

When unchanged code is needed to understand the change, such as the function that calls the changed one, a type it uses, or the config a value comes from, add those lines as a snippet.

```bash
{{MR_CAST}}/bin/mr-cast snippet src/db/client.ts:1-5
```

A snippet gets an id (`s1`, `s2`, ...) and its lines keep the file's own numbers. Show it in a `code` scene like a hunk. Snippets do not count toward coverage, and a later `extract` keeps them. Add only code you will show.

## What the video must cover

The viewer is a reviewer who has not read the diff. They should understand the change, judge whether it is correct, and know what to check, without reading the code themselves. The article already says all of this; the video shows it.

Resolve every `validate` warning about coverage, scene order, diagrams and tests, since each marks a gap a reviewer would notice. A substantial hunk may be skipped because the diagrams cover it only in the team's overview. A topic chosen `brief` may skip its other hunks with the reason "the viewer chose a brief look at this topic"; a pre-read has no such exception.

- The `intent` scene's narration says what problem the change solves, through the article's running example, and the approach. Its bullets are the article's review concerns: at most three, one short line each, concrete enough to act on ("a crash after claiming leaves the delivery stuck forever"), not a list of features. State the `risk` honestly: `high` means data migrations, auth, money, or public API breaks.
- When the change touches more than two files, add a `files` scene right after the intent. Leave out `files` and it lists every changed file from the diff. Give the files the narration names a short `notes` entry each.
- Follow the intent with a `graph` of the components the change touches, then the diagrams of the change itself. For a schema change, draw the `er` from the migration or model files, and show the migration hunk in a `code` scene later.
- Show every substantive hunk in a `code` scene, in the article's order. Skip only formatting, renames, generated files and boilerplate, each in `skipped` with a short reason.
- End with a `tests` scene after the code it tests: each relevant case with its name as written in code, the behaviour it proves in plain words, its `status` (`existing` for an unchanged test that covers the changed code) and its `hunkId`. List in `gaps` the important behaviours no test covers, such as error paths, limits, concurrency and a failing dependency. With no tests, `cases: []` and the untested behaviours in `gaps`. Then `code` scenes on the key test hunks, on the inputs and assertions, not the setup.
- Even a small change needs an intent, a diagram, its code and its tests.

The shipped example `{{MR_CAST}}/examples/demo/storyboard.json` shows the shape of a reviewer's video, and `{{MR_CAST}}/examples/review/storyboard.json` one with review on; copy their shape, not their content.

In a pre-read (`--audience preread`) there are no code scenes, as [audience-preread.md](audience-preread.md) says. Draw each substantive hunk in a diagram that cites it in `from`, or leave it to the reading order: the `reading` scene takes the code scenes' place in the coverage check. A `brief` or `skip` topic changes only the video, and its hunks still go in the reading order.

In the team's overview, list the substantive hunks you do not show in `skipped` with the reason "covered by the diagrams in this overview". Show no test code, and list test hunks in `skipped` with the reason "the tests scene covers them".
