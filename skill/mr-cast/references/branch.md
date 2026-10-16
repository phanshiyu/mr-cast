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

The viewer is a reviewer who has not read the diff. They should understand the change, judge whether it is correct, and know what to check, without reading the code themselves.

Resolve these `validate` warnings, because each one marks a gap a reviewer would notice:

- A hunk is not shown or tests are not walked through. Add a code scene for the hunk, link it from a `tests` scene case, or add a `skipped` entry with a reason.
- The scenes are out of top-down order, a diagram comes after code, a change to several files has no diagram, or many code scenes rest on too few diagrams. Move or add scenes as the warning says.
- The storyboard has no `tests` scene.

Write the storyboard this way:

- Plan first: the problem this change solves, shown as one concrete case with real values, and the approach in one sentence. Then the one to three things a reviewer must check (risks, questionable choices, missing cases), the key behaviors ("when X happens, Y happens"), what else the change could break (callers, data, public API), and which tests prove each behavior. Follow [Teach the change](../SKILL.md#teach-the-change).
- The `intent` scene's narration says what problem the change solves, through the concrete case, and the approach it takes. Its bullets are the review concerns from your plan: at most three, one short line each, concrete enough to act on ("a crash after claiming leaves the delivery stuck forever"), not a list of features. State the `risk` honestly. `high` means data migrations, auth, money, or public API breaks.
- When the change touches more than two files, add a `files` scene right after the intent. Leave out `files` and it lists every changed file from the diff as a tree, with line counts and tests marked. Give the files the narration names a short `notes` entry each, under 60 characters. To name the files one at a time, give the scene `steps`, each a `focus` path and the words to `say`.
- Follow the intent with a `graph` scene of the components the change touches, then diagram the change itself. For a schema change, read the migration or model files for the `er` scene, and show the migration hunk in a `code` scene later.
- Show every substantive hunk in a `code` scene. Order the code scenes by importance, the main behavior first, and keep related hunks together, never in file order. Skip only formatting, renames, generated files, and boilerplate, and record each skipped hunk in `skipped` with a short reason.
- Always end with the tests, since they are how the reviewer judges whether the code is correct. Name the test that proves the concrete case when there is one. Add a `tests` scene after the code it tests. List every relevant test case with its name as written in code, the behavior it proves in plain words, and its `status`. Use `existing` for an unchanged test that covers the changed code. Set each case's `hunkId` to the hunk that holds its code.
- In the same `tests` scene, list in `gaps` the important behaviors this change introduces that no test covers, such as error paths, limits, concurrency, and a failing dependency. Leave `gaps` empty only when every key behavior has a test.
- After the `tests` scene, add `code` scenes on the key test hunks. Focus on the inputs that set up each case and the assertions that check it, not on setup boilerplate.
- When the change has no tests, still add a `tests` scene, with `cases: []` and the untested behaviors in `gaps`. The video then says plainly that the change ships without tests.
- Even a small change needs an overview, a diagram, its code, and its tests. A large one can run several minutes. List each deliberate omission in `skipped` with its reason.

In overview mode, list the substantive hunks you do not show in `skipped` with the reason "covered by the diagrams in this overview". Show no test code, and list test hunks in `skipped` with the reason "the tests scene covers them".
