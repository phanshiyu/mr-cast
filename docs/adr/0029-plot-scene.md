# 29. A plot scene: numeric axes, parts placed by expressions in parameters, and steps that set and trace

- Status: Accepted; amended by [0033](0033-one-trace-camera-and-ink-across-scenes.md), [0034](0034-fixes-from-the-worked-examples.md) and [0035](0035-bounds-from-the-0.28-review.md)
- Date: 2026-10-18

## Context

The 0.28 research into what YouTube explainers draw (`docs/research/youtube-devices.md`) found that mr-cast has no
coordinate plane. A `chart` plots at most 12 categorical labels, and an `svg` polyline draws a static curve whose
points the model computes by hand. Three of the devices it lists need more: a function plotted on numeric axes (D9),
a curve that traces itself or reshapes as a parameter changes (D10), and points and vectors on a plane (D31 and GPT's
word vectors). Two of its worked ideas depend on them: a square wave built from sine waves (E1) and compound interest
against inflation (E4). The user picked the plot scene, P5 in that document.

## Decision

- **A `plot` scene** with an `x` axis and an optional `y` axis, each with `from`, `to`, `label`, `ticks` (a step, a
  list, or `"pi"`), `log`, `grid`, `prefix` and `suffix`, and `equal` for one unit on both. Without `y` it is a number
  line. Its parts each have an id: `functions` (y in x, or a curve: x and y in t), `series` of data points, `points`,
  `vectors` and `areas` under one line or between two.
- **Numbers are expressions in named parameters.** Any number a part is placed by can be an expression in the
  scene's `params`: arithmetic, `^`, unary minus, `pi`, `e`, the common functions and `sum(k, from, to, term)`.
  `shared/expr.mjs` parses an expression into a tree and evaluates the tree. Nothing reaches eval or Function, a
  name is looked up only among the scene's own parameters (never an object's prototype), and there is no property
  access. A label fills `{expr}` holes from the same parameters.
- **Steps follow ADR 0020's state model.** A parameter is state under `k:name`, and a step's `set` changes it.
  The scene interpolates every parameter between the step's state and the one before it, so a curve reshapes and a
  point moves through the values between. A sum whose upper bound is not whole adds its last term in part, so going
  from 1 to 3 terms grows the curve rather than snapping it. `trace` draws a line on from left to right and shows it
  if it was hidden. A traced step plays its changes across its words, at an even pace, so a point placed by the
  parameter it sets rides the line as it draws; any other step plays them in the half second it settles in. `when`
  starts them at a cue word, as ink's `when` does. `show`, `hide`, `tint`, `focus` and `callout` work as on the other
  stepped scenes, and a parameter's name as a ref lights every part that reads it.
- **One layout for the scene, validate and the ink.** `shared/plot.mjs` computes the axes, where each part draws at a
  set of parameter values, and where each label goes (the first spot on the stage clear of other labels and the axis
  text). The scene draws from it, `validate` draws every state with it, and `sceneTargets` gives ink its boxes.
- **What `validate` reports.** Errors: an expression that does not parse, with its column; a name that is no
  parameter; a parameter named like a function, a constant, x or t; ids that clash; an area between a missing line
  or a curve; a trace on a point; a `when` the step never says; parts other than points and vectors on a number
  line. Warnings, from drawing every state: a line with no value inside its range, a line or a point off the plot,
  labels that overlap each other or the axis text, a label that runs off the stage, and tick labels that overlap.

## Alternatives considered

- **Points only, computed by each example's `generate.mjs`** (the research's fallback). No parser, but no parameter
  to tween: a curve that reshapes would have to be a new series per step, which crossfades rather than moves, and
  `validate` could not say where a line has no value.
- **JavaScript expressions run in a sandbox.** Shorter to build, but a storyboard is model-written input that the
  player runs in the page and `validate` runs in Node; a parser over a whitelisted grammar is the boundary that can
  be read in one file and has nothing to escape from.
- **Tweening the sampled curve instead of the parameter.** It needs no parser either, but a straight blend between
  two curves passes through shapes the function never takes; tweening the parameter shows the real curves between.

## Consequences

- A plot can show a Fourier sum converging term by term, compound growth traced year by year with a marker riding
  the line, a number line, a log axis, a parametric circle with a turning vector, and data beside a model curve.
- The demo, `examples/primitives/plot/`, is written by its `generate.mjs`, which computes every number the scene
  shows or says through the same parser and asserts them against the research's facts.
- Stepped scenes gain two small hooks in `shared/state-steps.mjs`, used only by the plot: a model may resolve its own
  `set` keys, and may handle a step field of its own (`trace`). `trace` counts as a change for every stepped scene,
  which only the plot reads.
- Overlaps between a label and a line are not checked, only label against label and axis text; `mr-cast still`
  shows them. Axis text is drawn over the lines on a halo, so a line crossing a tick never hides it.
