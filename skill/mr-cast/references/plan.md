# Let the user pick the topics

Before you write the article, cut the change into topics and let the user choose, in the browser, how much time each topic gets and how it is shown. Read the diff and the code around it first, as the source's reference says. For an explanation, the topics are the key points of your explanation. Each topic you keep becomes one section of the article, with the topic's id.

## Write plan.json

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
      "why": "The limit is a check that runs before the order is saved, so the order of calls shows it best.",
      "seconds": { "brief": 45, "deep": 120 }
    }
  ]
}
```

- **Topics.** Write 4 to 8 topics. Name each one by what it does, not by its file: "Rate limiter: twenty orders a minute", not "rate-limit.ts". A topic can span several files. Put routine changes, such as renames, formatting or deleted dead code, together in one topic. List the topics in teaching order, the main behaviour first. The opening intent scene, and for the branch the closing tests scene, are always in the video, so they are not topics. The `id` is a short slug, and `summary` says in one line what the topic covers.
- **Depth.** `depth` is your suggestion. `skip` leaves the topic out. `brief` shows the topic's view and the key lines. `deep` shows the view, then the code line by line. Suggest `deep` for the main behaviour and `brief` for the code that supports it. For the short overview, suggest `brief` for most topics. In a pre-read, `brief` is the topic's picture and its key fact, and `deep` adds one more diagram, a `flow`, `array` or `table` that traces the concrete case with the actual limits, keys and order. For someone new to the code, suggest `deep` for every topic that changes logic. When the user had code selected as they asked for the full video, suggest `deep` for the topic whose files hold those lines, whatever the audience, and say so in its `why`.
- **Views.** `views` lists 1 to 3 ways to show the topic, your suggestion first. Offer only views that truly fit the topic, and offer one when two would look almost the same. A choice that changes nothing teaches the user to ignore the choices. `why` says in one line why your suggestion fits. The user reads the label, never the key:

{{PLAN_VIEWS}}

`decisions` is a `graph` drawn as a flowchart. `code` shows only code scenes. In a pre-read, never offer `code`: give every topic views that draw it, and `plan` rejects a topic that offers `code`.
- **Seconds.** `seconds` is about how long the topic takes at each depth, such as 30 to 50 for `brief` and 80 to 150 for `deep`. The page adds them up to show the user the length of the video.

## Open the plan page

Skip the page and use your suggestions when the user said "just make it", "use the defaults" or "no questions", or when the plan has 2 topics or fewer. Still write `plan.json`, so `validate` checks the scenes against it and the player's Plan tab lets the user change the picks later.

Otherwise start the page as a background command:

```bash
{{MR_CAST}}/bin/mr-cast plan <flags>
```

It checks `plan.json` first. Fix every error it prints and run it again. Then it prints `mr-cast plan: <url>` and opens the browser. In the same reply, ask one `AskUserQuestion`, header "Plan", question "I opened the plan in your browser. Make the video from it?":

- "Use my picks from the browser (Recommended)". Description: "Pick depth and view per topic there, then press Enter here."
- "Use your picks". Description: "Skip the browser and use what I suggested."

When the user writes something else with Other, such as "add the migration as its own topic", change `plan.json` to match. The page reloads by itself. Then ask the same question again.

After the answer, stop the `mr-cast plan` command and read `plan.json`. The page saves each pick the user made as the topic's `choice`, `{ "depth": "deep", "view": "compare" }`. A topic without `choice` keeps your suggestion: its `depth` and the first of its `views`. When the user answered "Use your picks", remove every `choice` from `plan.json` first.
