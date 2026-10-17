# Walkthrough quality harness

Measures which storyboard guidance lets a reviewer who only watches the walkthrough answer the
questions a real reviewer needs answered, from a short video. Nothing here runs agents. It prepares
inputs, collects outputs, and computes numbers. You launch the agents.

Nothing under `quality/` ships in the npm package (`package.json` "files" does not list it).

Since 0.25 (ADR 0019) the skill has no article stage, so the article arm of the 0.24 eval is gone: there is no
`mr-cast article`, no reader test and no `article.md`. A writer's run is the storyboard alone. The `familiar` arm below
is the plain video; `--audience familiar` is still accepted and means the same as no flag.

## Layout

- `fixtures/<name>.sh <dir>` builds a git repo with `main` and a feature branch. Four shapes:
  `rate-limit` (calls `scripts/demo.sh`), `invoice-status` (Python migration plus state machine),
  `pagination-fix` (small TS bug fix), `webhook-retries` (12 files, about 470 lines).
- `keys/<name>.json` holds 5 questions per fixture with `answer` and `must_mention`. Never copy keys into a repo or a packet.
- `variant.sh`, `prepare.sh`, `collect.sh`, `metrics.mjs`, `grade.mjs`, `packet.mjs`, `questions.mjs`, `node.sh` are the tooling.

Pick a workdir path without loaded words (no "eval", "test", "judge", and so on): the writer can see it.

## One run, end to end

1. Variant. Build a skill variant from a SKILL.md template (placeholders `{{MR_CAST}}`, `{{PLAN_VIEWS}}`, and
   `{{STORYBOARD_TYPES}}`, which a template from before 0.24 carries and install fills with `mr-cast schema all`):

       quality/variant.sh skill/mr-cast/SKILL.md /path/to/variants/current
       quality/variant.sh /path/to/other/SKILL.md /path/to/variants/other

   This runs `mr-cast install-skill` with `CLAUDE_CONFIG_DIR=<out>` and `MR_CAST_SKILL_TEMPLATE=<source>`,
   so `~/.claude` is untouched. The result is `<out>/skills/mr-cast/SKILL.md`, beside the references.

2. Prepare. One workdir per variant:

       quality/prepare.sh /path/to/runs/current /path/to/variants/current

   Creates `<workdir>/<fixture>/repo` (fixture repo, feature branch checked out),
   `<workdir>/<fixture>/notes/mr-cast/` (the variant skill and its references), and
   `<workdir>/<fixture>/bin/mr-cast`, a shim from `shim.sh`. The skill copy calls the shim, which sets
   `XDG_CONFIG_HOME=<workdir>/<fixture>/config` and `MR_CAST_NO_UPDATE_CHECK=1` and refuses to run against the real
   `~/.config`, so a writer cannot overwrite the user's remembered choices.

3. Writers. One fresh agent per fixture, cwd `<workdir>/<fixture>/repo`, with the writer prompt below.
   The skill copy already calls the shim; still give each writer's shell `export XDG_CONFIG_HOME=<workdir>/<fixture>/config`
   for any other tool it runs. Run them in parallel. They write `storyboard.json` in the run `extract` starts, `repo/.mr-cast/<branch>/`.

4. Collect:

       quality/collect.sh /path/to/runs/current

   For each repo with a storyboard it runs `mr-cast validate` (result in `<fixture>/validate.status`, output in `validate.txt`),
   renders a still of every scene with `mr-cast still` (a still is its scene's settled end state, so the pace and voice flags do not change it),
   and writes `<fixture>/packet/scene-NN.png` and `packet.md` (chapter, type, narration per scene; no diff, no code text, no skill).
   Fixtures that fail validation get no packet.

5. Reviewers. One fresh agent per packet, cwd `<fixture>/packet`, with the reviewer prompt below.
   Fill `{QUESTIONS}` from `node quality/node.sh quality/questions.mjs <fixture>`. Save the reply as `<fixture>/answers.md`.

6. Graders. One fresh agent per fixture with the grader prompt below. It writes `<fixture>/grades.json`.

7. Numbers:

       quality/node.sh quality/metrics.mjs /path/to/runs/current   # writes metrics.json
       quality/node.sh quality/grade.mjs /path/to/runs/current     # writes grades-summary.json

   Compare variants by running steps 2 to 7 per variant over the same fixtures. Writers are noisy, so repeat
   each fixture a few times per variant and average.

`metrics.mjs` reports per fixture and in total: validation result, scene count and type mix, estimated duration
(shared/timing, no voice), narration words, highlighted code lines (focus refs, or every changed line of the hunk when a code
scene has no focus), the most lines highlighted in one scene, code scene count, hunks covered over hunks total,
the share of changed lines that sit in shown hunks, test hunks shown over test hunks (shared/test-files), and whether the
storyboard has a tests scene with its case and gap counts (`yes 4c/2g`). A hunk linked from a tests scene case counts as shown,
as it does in `validate`.

`grade.mjs` reads `grades.json` files shaped as

    { "answers": [{ "id": "q1", "correct": 1, "note": "..." }], "ease": 4, "confusing_scene": "Scene 05 ..." }

and reports points over questions, accuracy and mean ease per fixture and overall. Missing or broken files are skipped.

## Prompt templates

### (a) Storyboard writer

Run in `<workdir>/<fixture>/repo`. Use the text as is.

    Make a walkthrough video of this branch with mr-cast so the team can review it. Instructions are in ../notes/mr-cast/SKILL.md. Get it validated, and don't stop to ask me about the outline; I'll open the player myself, don't start it.

### (b) Reviewer

Run in `<workdir>/<fixture>/packet`. Give no other path.

    You are reviewing a merge request you have not seen. Your only source is a walkthrough video of it,
    given to you as scene stills (scene-01.png, scene-02.png, ...) and packet.md, which lists each
    scene's chapter, type and narration. Read packet.md and look at every still. Do not open, list or
    search any other file or directory, and do not look for the repository.

    Answer these questions in your own words, from the video alone. Be concise. If the video does not
    cover something a question asks, write "not shown" for that part instead of guessing.

    {QUESTIONS}

    Then give:
    - ease: a whole number from 1 (hard to follow, I had to work for it) to 5 (easy, I understood it on one pass).
    - confusing_scene: the scene number that was most confusing or overloaded, and why in one sentence.

    Format the reply as "q1: ...", "q2: ...", then "ease: N" and "confusing_scene: ...".

### (c) Grader

Run with read access to `<fixture>/answers.md` and `quality/keys/<fixture>.json` and write access to `<fixture>/grades.json`.

    Grade a reviewer's answers against an answer key. Read {ANSWERS_MD} and {KEY_JSON}.
    For each question, compare the reviewer's answer to the key's must_mention facts and answer:
    - 1 if every must_mention fact is present and nothing contradicts the key,
    - 0.5 if some but not all of the facts are present, or the answer is right but vague,
    - 0 if the facts are missing, wrong, or the answer is "not shown".
    Accept different wording for the same fact. Do not reward length. Write {GRADES_JSON} as exactly:
    {"answers":[{"id":"q1","correct":1,"note":"one short sentence"}, ...one per question],
     "ease": <the reviewer's ease number>, "confusing_scene": "<the reviewer's text>"}
    Write only that file.

## Reviewer effort (quality/effort/)

Measures what a walkthrough saves a reviewer who then reads the code, against no video. Arms are audiences
(`familiar`, `preread`) plus `none`.

- `bugs.json` holds one seeded bug per fixture (file, exact find and replace, and a key for graders). Never copy it into a repo or a packet.
- `prepare.sh <dir> <variant> <fixture>` builds a writer's workdir with the bug folded into the commit that last touched the file, and the `quality/shim.sh` shim the skill copy calls. `checkout.sh <dest> <fixture>` builds the same branch for a reviewer.
- `collect.sh <writer-dir> <audience> <packet-dir>` validates and renders stills with the audience flag, and adds `reading.md` to the packet when validate wrote one.
- `prompt.mjs packet|review|budget` prints the reviewer prompts. `packet` is the video-only quiz. `review` adds the checkout and a bug hunt. `budget` allows one `git diff --stat` and two file reads, so a video can only help by pointing.
- `grader.mjs packet|review` prints a grader prompt over anonymised answer files.
- `handback.mjs` and `transcript.mjs` read an agent's JSONL transcript: its final report, and its tool calls, files opened, scenes viewed, tool-result size, peak context, tokens and wall time.
- `harvest.sh` and `report.mjs` gather answers, transcripts and grades into per-arm tables (mean [min-max]).

Run every writer and mr-cast command with temporary `XDG_CONFIG_HOME`, `XDG_CACHE_HOME` and `CLAUDE_CONFIG_DIR`.
