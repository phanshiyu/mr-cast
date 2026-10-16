# An explanation

The video retells an explanation you gave in this conversation, such as how a subsystem works, why a bug happens, or how a design fits together. It is not a new investigation. Open files again only to get exact line numbers for the code you show.

## Start the run

```bash
{{MR_CAST}}/bin/mr-cast init --title "How the rate limiter works" <flags>
```

- Give a short title for what you explained. The run's directory is `.mr-cast/<title-slug>/` in the git repository, or in the current directory outside one. `init` prints it.
- `<flags>` are the flags from step 2: `--audience`, and `--pace` or `--no-voice`.
- Running `init` again with the same title reopens the run and keeps its storyboard and snippets. Add `--reset` to start it over. A different title starts a new run.

Run `init` and `snippet` from the directory your explanation is about, usually the repository root, because snippet paths are relative to it.

## Add the code worth showing

List the files and functions your explanation relied on. For each piece of code a viewer should see, add a snippet of the real lines.

```bash
{{MR_CAST}}/bin/mr-cast snippet src/limiter.ts:12-40 src/server.ts:5-18
```

- Each snippet is one `file:start-end` argument, or `file start-end`, of at most 80 lines. Add the part the explanation needs, such as one function, rather than a whole file.
- The output gives each snippet an id (`s1`, `s2`, ...) and prints its lines with the file's own line numbers. Use those numbers in `focusLinesAfter` or `steps`.
- Adding the same file and range again keeps its id and rereads the lines.
- Add only code you will show in a `code` scene. Code you mention without showing needs no snippet.

## What the video must cover

Every code scene's `hunkId` is a snippet id. Leave out `risk` on the intent scene and leave out `skipped`, since there is no change to review. Resolve the `validate` warnings about scene order, diagram count, and focus.

- Plan first: the key points of your explanation, the behaviors behind them ("when X happens, Y happens"), and the code that carries each one.
- The `intent` scene's summary states the idea in one sentence. Its bullets are the key points of the explanation, at most four, one short line each. For a bug, they are the symptom, the cause, and the fix or the way to avoid it.
- Use a `files` scene when where the code lives helps the viewer, such as a feature spread over several modules. List each file as `{ "path": "src/limiter.ts" }` in `files`, since an explanation has no diff to list. Give each a short `notes` entry, and put the scene before the code.
- Add a `tests` scene only when tests are part of the explanation, such as a bug that no test caught. List each case's name as written in code and what it proves, and put the important untested behaviors in `gaps`.
- The narration is the explanation itself, spoken. Cover every point a viewer needs, and cut only what is genuinely trivial.
