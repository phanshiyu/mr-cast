# 28. A step camera on every scene, and move, trace, morph and flow on svg

- Status: Accepted; amended by [0033](0033-one-trace-camera-and-ink-across-scenes.md) and [0034](0034-fixes-from-the-worked-examples.md)
- Date: 2026-10-18

## Context

The 0.28 research ([docs/research/youtube-devices.md](../research/youtube-devices.md), P1 and P2) compared what
explainer channels show with what mr-cast draws. What it lacked most was motion: no scene could zoom into a detail or
pan with the action, outside `terminal` and `sequence`, which scroll themselves; and no shape could slide, turn, draw
itself on or change into another. Those devices carry 3Blue1Brown's camera, Kurzgesagt's zoom, TED-Ed's morphs and a
proof by rearrangement. The user picked "camera + svg motion".

## Decision

**The camera is a step field, on every scene whose steps take refs, and on code.** A step's `camera` is `"all"`, a ref,
a list of refs, or `{ "on": refs, "zoom": z }`, and it stays until a later step's camera. The refs are the ones `focus`
and ink take, resolved by the same function (`stepRefKeys` in `shared/ink.mjs`). One walk, `cameraShots` in
`shared/camera.mjs`, gives each state's shot and its problems; one function, `frameShot`, frames a shot on the boxes a
scene gives its pen at that step. The scene and `validate` both use them, so they see the same view.

- **The renderer is SceneShell.** Each scene hands SceneShell the same `targets(k)` it hands its pen, and SceneShell
  transforms the content box. Ink and pen marks are inside it, so they ride with the content. A scene with no camera
  step draws exactly as before: the wrapper is not rendered (107 stills of the primitives, Dijkstra and binary search
  compare pixel for pixel with main). Code's pen targets live below SceneShell, so its body wraps itself in the same
  `Camera`.
- **The view.** Without `zoom` it fits the refs' union box with a margin of 15% of its larger side (at least 48 px),
  enlarged at most 6 times; `zoom` runs from 1 to 40. The zoom is never below 1 and the view never shows past the
  content box, so a camera can only enlarge the scene. The view tweens with the step's state changes
  (`stepMove`), its zoom changing evenly in scale and its centre moving so the shown part grows about one still point.
  Each state frames its shot on that state's boxes, so the camera follows refs a step moves. The view fades out over
  the 32 px the svg scene already bleeds.
- **Checks.** `validate` fails on a ref that names nothing, a zoom outside 1 to 40, an empty list, `"all"` in a list,
  an unknown field and a camera on `flow`. It warns when a shot leaves a lit ref out of view, on the scene types whose
  boxes are known without rendering; er, files, layers and timeline joined those, their boxes moved into
  `src/utils/sceneTargets.ts`. The readable-size check accounts for the zoom: since the zoom is never below 1, no
  scene's text gets smaller, and on svg each text is measured at the zoom of every state it is shown and in view, so
  detail text passes when it shows only while the camera is close. A state step that only moves the camera needs no
  `focus`, and a camera step is never "nothing moves".

**Motion is three svg step fields and a class**, kept in the svg scene's state (`shared/state-steps.mjs`) beside
`set`, `show` and `tint`, and drawn by the scene from the parsed tree, never from markup.

- **`move`** maps ids to a transform of `translate`, `rotate` and `scale`, which goes outside the element's own and
  lasts until a later move. Tweens follow CSS: function by function when the lists match (a missing list counts as the
  same functions doing nothing), so `rotate(a cx cy)` turns about its pivot; else through a decomposed slide, turn and
  scale. The value is parsed into numbers and written back, so nothing from the storyboard reaches the DOM as text.
- **`trace`** draws lines on from their start, by `pathLength` dashes, or through a mask when the line has dashes of its
  own. It starts at its `when` cue (the ink cue, `cueFrame`) or as the step settles, at about 40 px a frame.
- **`morph`** gives a path another path's shape. Both `d`s are turned into cubic outlines (lines, quadratics and arcs
  converted, `Z` closed by a straight curve) and the one with fewer curves is split at its longest until they pair;
  a closed outline starts where the two lie closest. `validate` fails only when the outline counts differ.
- **`class="flow"`** is the one class the sanitizer adds to the tone classes: marching dashes over a faint copy, as a
  graph edge.
- The moved and morphed geometry feeds `svgGeometry`, so ink, the camera and `validate` see shapes where they are.

## Alternatives considered

- **A camera only on svg**, cheaper, but big graphs, tables and arrays could not zoom, and following a moving pointer
  is the main use outside drawings. **A scene-to-scene zoom transition** zooms between scenes but not within one.
- **Each scene moving its own camera**, as terminal and sequence do. Seventeen implementations; the content-box
  transform needs only each scene's pen boxes, which it already had.
- **A camera that may zoom out below 1.** It would shrink text below what the fit check passed; pulling back is
  `"all"`.
- **Morph requiring matching commands** (the research's first option). It forces the model to hand-match two `d`s;
  normalizing to cubics costs one file and makes any two single-outline shapes morph.
- **SMIL or CSS animation in the markup.** The sanitizer cuts `animate` and `style`, and Remotion renders frame by frame,
  so motion must be a function of the frame.

## Consequences

- Any stepped scene can zoom on a detail and pull back, and follow what a step moves; an svg can prove by rearrangement,
  swing a gauge, draw a route and morph shapes. `examples/primitives/camera` and `examples/primitives/motion` are demos.
- Sequence, terminal, code and text boxes depend on timing or are measured as they render, so `validate` does not check
  their crops; the shot still works on them. Chart and compare boxes were not moved either.
- A zoomed scene's strokes and ink grow with it, as a whiteboard under a camera would.
- Nothing is superseded.
