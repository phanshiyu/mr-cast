# 33. One trace across svg, plot and map; the camera on the new scenes; ink that follows its parts

- Status: Accepted
- Date: 2026-10-18

## Context

ADRs 0028 to 0032 were built on four branches from the same base. Each was right alone, and three things went wrong when
they met:

- **Three traces.** svg (0028) took `{ "id", "when" }` entries and kept them in the step state; plot (0029) took ids
  through a model hook of its own; map (0030) took `{ "ref", "when" }`, checked them twice, in `shared/state-steps.mjs`
  and in `bin/lib/validate-map.mjs`, and read the steps again to draw. Each also changed `changesState` and
  `changedRefs` its own way, and the merged code exported two different `TRACEABLE` lists.
- **The camera reached the new scenes by accident.** `CAMERA_TYPES` is the ink scenes, so plot, map and image took
  `camera` in `validate`, but their components drew no camera, chart kinds other than a column chart had none, and
  `validate` had no chart boxes to check a shot against. A map has its own camera, `view`.
- **Ink stayed behind.** Ink is placed on its step's boxes and stays there. With charts that sort, plot points that move
  with a parameter, svg moves and map views, a circle round a part was left where the part had been.

## Decision

- **One trace.** A model names its trace in one descriptor: what it takes, what its `when` means, and how a ref resolves
  to a key or a problem. `walkStates` applies it for every scene: it records `state.traces` by key with the cue, shows the
  line, and reports bad entries in one wording. An entry is an id, or `{ "ref": id, "when": words }`, `ref` as map had it,
  so svg's `{ "id": ... }` became `{ "ref": ... }` before release. A plot's entries are ids, because a plot plays a traced
  step's changes across its words and its step's `when` starts them. The cue keeps each scene's meaning: on svg the words
  a line starts drawing on, on a map the words a route arrives on. The plot and map scenes draw from `state.traces`;
  the plot's model hook and the map's second check are gone.
- **A map's camera is its view.** `camera` on a map step is refused with a pointer to `view`. The view zooms the
  projection and redraws labels at their size; a SceneShell camera would scale the labels and strokes with the content,
  and two cameras on one scene would fight.
- **The camera on plot, chart and image.** Their components hand SceneShell the boxes they hand their pen. Every chart
  kind's boxes move to `src/utils/chartTargets.ts`, which the components and `validate` share, so a camera that crops a
  lit bar is reported. A picture with `kenBurns` already pans and zooms, so a step camera on it is refused. The
  readable-size check needs nothing new for these scenes, since a camera only enlarges; for a picture, the soft-picture
  warning counts the closest a pan, zoom or camera brings it.
- **Ink follows its parts.** Each ink item that names refs follows the centre of their boxes at each later step, eased
  in as the step settles, the same ease the scenes move by. Items on a point, and scenes that scroll their content
  (`shift`), keep their place.

## Alternatives considered

- **Accept `camera` on a map as a second zoom.** It composes, but labels would grow with it and the `view` and the
  camera would each need the other's state to frame a ref.
- **Treat `camera` on a map as an alias of `view`.** One concept with two names; the refusal says which to write.
- **Keep svg's `id` key and accept both.** Unreleased, so there was nothing to keep compatible.
- **Ink that follows by re-planning each step.** It would re-place items clear of the new layout, but ink would jump
  as the obstacles change; translating by the parts' movement keeps the hand-drawn mark as drawn.

## Consequences

- One storyboard can trace an svg line, a plot curve and a map route, zoom a plot and a chart race, and fly a map view,
  and `validate` reads all of them through the same state walk.
- Storyboards that existed in 0.27 draw as before: the end-of-scene stills of all 212 scenes of the examples and demos
  on main compare pixel for pixel with main.
- A plot step that traces moves its points across its words, but ink on them eases over the step's first half second,
  so it arrives early; a cue on ink can wait for it.
- Amends 0028 (trace entries take `ref`; the camera is not on the map), 0029 (no model step hook) and 0030 (trace
  checked once).
