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
- **Warnings the agent sees as it writes.** Guidance in the skill is easy to skip; a warning from `validate`, which
  the skill's hook runs on every write, is not. `validate` warns, from the storyboard alone, about a scene `title`
  under three words (a topic, not a point), a step of a stepped scene that changes nothing on screen, a narration
  or `say` over 24 words (about eight seconds of a still picture, the longest the reference holds), an explanation
  of five scenes or more with no picture, a video that does not end on the picture it started on, and colours with
  no stated meaning.
- **Colours that mean one thing.** A storyboard may say what its tones mean, `"tones": { "good": "bytes that fit",
  "bad": "bytes past the end" }`. With it, `validate` warns about a tint or an svg tone class in any other tone.
- **Parts arrive as they are said.** A part an svg step shows draws on like a pen stroke (its lines from their start,
  its fill with them, a text fading in) over two thirds of a second, and a part the step shows or tints that its
  `say` names (by its `labels` entry, its own text or its id) changes when the voice says those words, not as the
  step starts.
- **Illustrative.** `"illustrative": true` on a scene writes a small "illustrative" at the stage's bottom right.
- **Pacing.** Measured on both reference videos and on our renders of the same topic: the reference speaks about 4.6
  syllables a second for 75% of the time, with a short breath between sentences and 2.5 s only between sections;
  we spoke 5.4 syllables a second for 58% of the time, with no breath between a clip's sentences and 1.7 s of
  silence between steps. The voice now reads at 0.8 of the model's speed with 0.2 s between sentences, its lead
  silence trimmed, and a step's tail and lead are 0.2 and 0.3 s. Clips voiced before are voiced again.
- The skill gains a short section on making a video easy to follow, with these and with ending on the opening picture.

## Consequences

- An explanation can keep one picture on screen across several scenes, which is what makes the reference easy to
  follow, without a new scene type: a picture is an svg drawing, and everything an svg step does works on it.
- Storyboards without `pictures`, `tones` or `illustrative` draw as before, except that a part a step shows now
  draws on rather than fades in, and every video is paced as above and so is shorter. The new warnings fire on some
  of our examples; they are nudges, not errors.
- The svg scene's glow had an effectively endless filter region, which made a frame with a lit shape take seconds
  to rasterize; it is now the drawing's own area.
- Carrying state is limited to shown and tinted elements, the two things the reference changes between sections.
  Carrying moves and text would need a scene-level start for each, which nothing needs yet.

## Alternatives considered

- **A new look (a chalkboard, a hand-lettered font, a visible pencil).** It copies the surface of the reference, not
  what makes it easy to follow, and every scene type would need restyling.
- **A crossfade between every pair of scenes.** It softens the cut but still swaps the picture, which is what the
  viewer has to re-read.
- **A legend drawn on screen for `tones`.** The reference has none; the meanings are said once and then used the same
  way. The field is for `validate` and for the author.
