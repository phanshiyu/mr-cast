# 1. A local CLI and a Claude Code skill, rendered with Remotion and voiced with Kokoro

- Status: Accepted; the voice superseded by 0023 (Kitten TTS by default, Kokoro as an option)
- Date: 2026-10-15

## Context

mr-cast turns a branch's diff, or an explanation Claude just gave, into a narrated, animated video (README). Someone has to
write what the video says and shows, and something has to draw and voice it. The writer is the agent already in the
conversation, which has the diff and the explanation. The drawing and the voice need no model at all once the content is
written.

## Decision

- mr-cast is an npm package with a CLI (`mr-cast`) that the user installs globally. `mr-cast install-skill` installs the
  Claude Code skills (`mr-cast`, `mr-cast-primitives`, `mr-cast-prune`, `mr-cast-upgrade`), and the skill calls the CLI
  by its installed path (README, Install).
- The agent writes a storyboard; the CLI checks it, plays it in a browser player served on 127.0.0.1, or renders an MP4
  with Remotion (README, Commands and Development).
- The narration is spoken by Kokoro, a small text-to-speech model that runs offline on the CPU. The model (about 90 MB)
  and each voice (about 0.5 MB) are downloaded once into `~/.cache/mr-cast/models` (README, Voice).
- There is no hosted service: no cloud voice, no remote render, no account. The only server is the local player.

## Consequences

Good:
- The diff, the code and the narration never leave the machine. The voice works offline after the first download, and a
  failed model load falls back to a silent video instead of an error (README, Voice).
- The same storyboard drives the browser player and the MP4, so stills, play and render agree.
- Since 0.16.0 the voice wrapper is part of mr-cast instead of `kokoro-js`, which held back security fixes, and only the
  voice in use is downloaded instead of all 54 (27 MB) (CHANGELOG 0.16.0).

Bad:
- A first render downloads Chrome Headless Shell (about 580 MB) and the first voice-over the Kokoro model (README).
- Kokoro mispronounces shorthand, so mr-cast rewrites "e.g.", "5s", "200 ms" and versions into words before voicing
  (CHANGELOG 0.18.0).
- Remotion is free for individuals and companies of up to 3 employees; larger companies need a Remotion company license
  to render with mr-cast (README, License).
- Needs Node 22.12 or newer on macOS or Linux (CHANGELOG 0.16.0).

## Alternatives considered

- A cloud text-to-speech API: better voices, but needs a key and network, and sends the narration off the machine.
- A hosted render service: no local install cost, but the diff would leave the machine.
- A standalone tool with its own model calls: it would duplicate the agent that already has the context.
