# Someone new to this code (`--audience new`)

With `--audience new` in `<flags>`, `validate` checks the simple style. Phrases like "explain like I'm stupid", "ELI5", "simple", "line by line", "for a non-native speaker" or "I'm new to this" answer the audience this way when the user asked for a video. They never start a video by themselves.

The viewer is new to the codebase, reads English as a second language, or both. They want to understand every line. A long video is fine.

Build context first. Read the callers of each function you show, the definitions and types it uses, the tests, and the config a value comes from. Add the key pieces with `{{MR_CAST}}/bin/mr-cast snippet` and show them in `code` scenes before the code they support, as what this code does today. Diagrams still come first, and anchor the names the steps will use. Walk every diagram in `steps`, `graph` included, one or two short sentences each.

Write every `code` scene with `steps`. Walk the lines in order, one line or a small group of up to 3 lines per step. For the branch, put every changed line of the hunk in a step. Spend the time where the code is hard. Put imports in one short step, and fold a closing brace into the step before it. Split a dense line, such as one that builds a key from several values, into two steps. Give the scene a short `narration` that says what the thing is before the steps say what it does, such as "This is the rate limit function. It runs before each request to the orders route."

Write for someone reading subtitles in a second language, on top of [voice.md](voice.md):

- Keep sentences under 18 words.
- Prefer the simplest word: "gets" to "retrieves", "stops" to "short-circuits". Avoid idioms.
- Name what a thing is before what it does. "Redis is a fast store for small values. The limiter keeps its counters there."
- Say the value and its effect. "Max is twenty, so the twenty first request in a minute is refused."
- In each step, say what the line does to the data, not how the syntax reads, unless the syntax is the point.

The shipped example `{{MR_CAST}}/examples/demo-simple/storyboard.json` shows the shape; copy its shape, not its content.
