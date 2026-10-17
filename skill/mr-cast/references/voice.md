# How the voice talks

Every narration and `say`, in every audience, is one person explaining the article to another out loud. The listener hears each sentence once, cannot rewind, and may not be looking at the code. Write what you would say to a colleague at their desk.

- **Plain words.** Say what the code does for the user in everyday words. Name the job, not the mechanism: "counts how many requests each visitor sent this minute", not "increments a Redis counter keyed by IP".
- **Code names stay on screen.** Never read out an identifier, file path, symbol, operator or status code as written. Say what it is: "the create order function", "the orders table", "too many requests". Say a number such as "four twenty-nine" only when the number itself matters. The screen shows the exact name.
- **Name the subject.** Open every scene and every step by naming what it is about, such as "The rate limiter counts ...". When in doubt, name it again. Say what the lines do, not "this line" or "here".
- **Keep your promises.** When you say "two questions" or "three parts", name each one in order: "The first question is ...". Give a stand-in word its meaning once: "each visitor, meaning each IP address".
- **One idea per sentence.** Short sentences in the active voice, under about 25 words, with no stacked clauses.
- **Explain a term once.** The first time a technical term is needed, explain it in a few words, as in "Redis, a shared in-memory store". Otherwise replace it with plain words.
- **Say why.** Say why each change matters, such as what breaks, what the user sees, or what risk it removes, not only what changed.
- **Say something new.** Each scene adds to what the viewer heard before. A diagram of the parts, the order of calls and the data at each step tell three different things, so do not retell the same path in each.
- Say behavior outright, with real values: "after twenty requests in a minute, the limiter refuses the request". When a scene explains a behavior without showing its code, name the file and function it lives in, in words.

Before and after, from the demo:

| Before | After |
| --- | --- |
| "The limiter buckets each IP into a one-minute window, increments a Redis counter, and sets the expiry only on the first hit." | "The rate limiter counts each visitor's requests in the current minute. The count starts again at zero every new minute." |
| "Past twenty requests it answers 429 with a Retry-After header." | "Past twenty requests, the limiter answers with a too many requests error, and says when to try again." |
| "They now look up each SKU in parallel, and empty orders are rejected up front." | "Now the orders service asks the pricing module for each item's real price. An order with no items is refused before anything is saved." |
| "The server mounts the limiter on the orders route." | "The API puts the rate limiter in front of the orders route, the address clients send new orders to." |

`validate` checks the spoken text, such as code read aloud and a scene that opens on a bare pronoun, and each warning says what to say instead. The voice already reads "e.g.", "5s", "200 ms", an arrow and "v0.14" as words, so write those however you like.

Write 15 to 50 words per scene, and at most 35 over a `graph` or `sequence` diagram, where the viewer learns the names the rest of the video uses. Markup in spoken text is dropped, so style the words on screen instead. Scene length comes from the spoken audio, or from word count without it, so never compute frames or seconds. Let the source set the length. If the user asks for a shorter or longer video, cut or add detail, not coverage. Give each scene a short `chapter` title.
