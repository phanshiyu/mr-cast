# The plan page

An optional page where the user picks, for each topic of the video, how much time it gets and how it is shown. Use it when the user asks to pick the topics, or to see a plan before the video.

## plan.json

Write `plan.json` in the run's directory, beside `hunks.json`:

```json
{
  "topics": [
    {
      "id": "rate-limiter",
      "title": "Rate limiter: twenty orders a minute",
      "summary": "Counts each visitor's order requests per minute and refuses the twenty-first.",
      "files": ["src/api/rate-limit.ts", "src/api/server.ts"],
      "depth": "deep",
      "views": ["calls", "data", "compare"],
      "why": "The limit is a check that runs before the order is saved.",
      "seconds": { "brief": 45, "deep": 120 }
    }
  ]
}
```

- `id` is a slug of lowercase letters, digits and dashes. Scenes name it in their `topic`.
- `depth` is your suggestion: `skip`, `brief` or `deep`. The page shows each as a choice.
- `views` lists 1 to 3 views, your suggestion first. The page shows the label, never the key. A pre-read (`--audience preread`) rejects a topic that offers `code`.
- `seconds` is how long the topic takes at each depth. The page adds them up to show the length of the video.

{{PLAN_VIEWS}}

## Run it

Start the page as a background command:

```bash
{{MR_CAST}}/bin/mr-cast plan <flags>
```

It checks `plan.json` first and prints each error; fix them and run it again. Then it prints `mr-cast plan: <url>` and opens the browser. The page reloads by itself when `plan.json` changes. Each pick the user makes is saved into `plan.json` as the topic's `choice`, `{ "depth": "deep", "view": "compare" }`. A topic without `choice` keeps its `depth` and the first of its `views`. Stop the command when the user is done, and read `plan.json`.

## In the storyboard

Give each scene of a topic `"topic": "<id>"`, and record the picks the storyboard was written from in its `plan`, such as `{ "rate-limiter": { "depth": "deep", "view": "compare" } }`. `validate` then reports a topic whose scenes do not draw its pick, and a pick the user changed since. With a `plan.json`, the player has a Plan tab where the user can change the picks later; `validate` names each topic whose pick changed.
