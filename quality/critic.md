You are checking a walkthrough video of a branch against the real code. A viewer watched the video only (scene stills and narration) and answered eight questions. You can read the repository; the viewer could not.

Repository: {REPO}
Base branch: {BASE}
Feature branch: {BRANCH}
The video as the viewer saw it: {PACKET_DIR} (packet.md and scene-NN.png)
The viewer's answers: {ANSWERS_MD}

Rules: read only. Do not run any mr-cast command, do not run the project's code or tests, and do not change, create or delete anything except the one output file below. Use git (for example `git diff {BASE}...{BRANCH}`, `git show`, `git log`) and file reads in {REPO}.

Do this:

1. Read the diff, then packet.md and the stills, then the answers.
2. Grade answers u1 to u7 against the real code, one grade each:
   - correct: what the viewer says is true and covers the point of the question.
   - partly: true but thin, or right in part and missing something that matters.
   - wrong: the code contradicts it, or it is mostly guesswork that turns out false.
   - not_shown: the viewer said the video did not cover it.
   Skip u8; it is the viewer's open questions. Give a one-sentence note per answer.
3. contradicted: list each thing the video led the viewer to believe (in its narration, step words or stills) that the code contradicts. Quote or name the claim. Leave the list empty if there are none; do not pad it.
4. missing: list up to 8 things a reviewer most needs that the video never says, most important first. Each item names the file and line (file:line) and says what the reviewer needs to know.
5. questions: for each of the six questions a reviewer brings, say whether the video answers it "well", "weakly" or "not":
   - why: why this change exists.
   - case: one concrete case, before and after.
   - approach: how it works and why this way.
   - parts: the main parts and how they connect.
   - proof: how we know it works (tests, and what is untested).
   - check: where to look first, and what to check there.
6. ease and confident: copy the viewer's two numbers from the answers. Use null if the viewer gave none.

Write {OUT_JSON} as exactly this shape and nothing else in the file:

{"answers":[{"id":"u1","grade":"correct|partly|wrong|not_shown","note":"one short sentence"}, ...one per id, u1 to u7],"contradicted":["a claim the video makes that the code contradicts", ...],"missing":["what a reviewer most needs that the video never says, with file:line", ... up to 8],"questions":{"why":"well|weakly|not","case":"...","approach":"...","parts":"...","proof":"...","check":"..."},"ease":N,"confident":N}

Write only that file. Reply with one line when done.
