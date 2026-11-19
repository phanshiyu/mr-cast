# 47. Pictures that carry across scenes, headlines that make a point, and colours that mean one thing

- Status: Accepted
- Date: 2026-11-19

## Context

A seven-minute explainer of a JVM bug, drawn by hand on a dark board, was easy to follow where our videos ask more of
the viewer. Watching it frame by frame, the differences were not in the drawing quality:

- **No cuts.** It never cuts to a new picture. One bar of byte-sized cells is drawn once and comes back in nearly every
  section: as the input, as the 64 lanes of one instruction, as the overflow, and as the check after the patch. The
  viewer learns to read it once, and each section only recolours or extends it.
- **Headlines that say the point.** "Rejected, but already written", "Your CPU decides". The headline stays while the
  picture builds under it, so a viewer who drifts off can catch up from it alone.
- **Two colours, each with one meaning.** Green is normal, orange is the problem, everywhere.
- **Labels on their words.** Each label ("1 byte", "1 past the end") is written as the voice says it.
- **Honest sketches.** Diagrams that are not real data say "illustrative".
- **It ends on the opening picture, fixed.**

mr-cast already writes ink on cue words (`when`), traces lines on cue and moves svg elements across a sentence. What
it lacks: every scene draws its own picture and fades through black into the next, titles are often a topic ("The
ripple"), and a video's colours carry no stated meaning.

## Decision

- **Pictures.** A storyboard may name drawings in `pictures`, `{ "bar": "<svg ...>" }`, and an svg scene may draw one
  with `"picture": "bar"` instead of its own `svg`. Pictures are expanded where storyboards enter (`upgradeScenes`), so
  `validate`, the player and the engine see an ordinary svg scene that remembers its `picture`.
- **A picture carries across scenes.** When an svg scene draws the same picture as the scene before it, the picture
  does not fade or slide between them; only the headline changes. The drawing keeps its place: every scene of the run
  lays it out in the box of the run's tallest header. The later scene starts as the earlier one ended: what was shown
  stays shown and what was tinted stays tinted, unless the scene sets its own `hidden` or `tint`. Ink is not carried:
  it fades as its scene ends. Moves, morphs and set text start from the drawing as written, and `validate` warns when
  that makes the picture jump.
- **Headlines that make a point.** `validate` warns about a scene `title` under three words, which is a topic, not a
  point. The skill asks for the scene's point in a short sentence.
- **Colours that mean one thing.** A storyboard may say what its tones mean, `"tones": { "good": "bytes that fit",
  "bad": "bytes past the end" }`. With it, `validate` warns about a tint or an svg tone class in any other tone.
- **Show on the words.** An svg step's `show` takes `{ "ref": id, "when": words }` as `trace` does: the element fades
  in when the voice says the words.
- **Illustrative.** `"illustrative": true` on a scene writes a small "illustrative" at the stage's bottom right.
- The skill gains a short section on making a video easy to follow, with these and with ending on the opening picture.

## Consequences

- An explanation can keep one picture on screen across several scenes, which is what makes the reference easy to
  follow, without a new scene type: a picture is an svg drawing, and everything an svg step does works on it.
- Storyboards without `pictures`, `tones` or `illustrative` draw exactly as before. Scenes with titles under three words
  get a warning, including some in our examples; the warning is a nudge, not an error.
- Carrying state is limited to shown and tinted elements, the two things the reference changes between sections.
  Carrying moves and text would need a scene-level start for each, which nothing needs yet.

## Alternatives considered

- **A new look (a chalkboard, a hand-lettered font, a visible pencil).** It copies the surface of the reference, not
  what makes it easy to follow, and every scene type would need restyling.
- **A crossfade between every pair of scenes.** It softens the cut but still swaps the picture, which is what the
  viewer has to re-read.
- **A legend drawn on screen for `tones`.** The reference has none; the meanings are said once and then used the same
  way. The field is for `validate` and for the author.
