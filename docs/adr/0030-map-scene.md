# 30. A map scene on a bundled Natural Earth outline

- Status: Accepted; amended by [0033](0033-one-trace-camera-and-ink-across-scenes.md) and [0035](0035-bounds-from-the-0.28-review.md)
- Date: 2026-10-18

## Context

The 0.28 research ([docs/research/youtube-devices.md](../research/youtube-devices.md)) found two devices that explainer
channels lean on and mr-cast could not draw: a map whose countries fill as the narration names them (D7), and routes
that grow across a map from origin to destination (D8). The `svg` scene can tint paths, but the model has to write the
coastlines by hand, which it cannot do accurately for real countries, and nothing draws a line on from one end. The
user picked "map scene" (P6) from that research.

## Decision

A new `map` scene draws a real world map from a bundled outline, with places, routes, lines and regions on it.

- **The outline.** Natural Earth 5.1.2's admin-0 countries, public domain, in two files that
  `scripts/world-data.mjs` writes from the release's GeoJSON: 1:110m as published (177 countries, 82 KB) and 1:50m
  simplified with Douglas-Peucker at 0.02° (242 countries, 329 KB). Each country keeps its code, its names and its
  label point; rings are rounded to 0.01° and delta-encoded. A country is named by `ISO_A3`, else `ISO_A3_EH`, else Natural Earth's `ADM0_A3` (KOS, SOL, CYN,
  KAS, IOA, ATC). The scene draws 1:50m when any view zooms past four times the world or it names a country 1:110m
  lacks, and 1:110m otherwise, so a world map stays light and a zoom stays sharp. Nothing is fetched at runtime.
- **Projection.** `d3-geo` 3.1.1, pinned, already in the lockfile through Mermaid, and used only inside
  `shared/map.mjs`. `equal-earth` is the default because a tinted country's area reads true; `natural-earth` and
  `mercator` are the others. Long edges are cut into 1° pieces when the outline is read, since Natural Earth draws an
  edge straight in latitude and longitude and d3-geo as a great circle, which bows a long parallel such as the 49th.
- **The camera.** The projection is fitted once so the world fills the stage, and a view (`"world"`, refs, or a
  `box`) becomes a zoom and an offset on it, so the country paths are computed once and a step's move is a transform.
  Moves follow van Wijk and Nuij's smooth zoom, as d3's `interpolateZoom` does, over the step's lead, the same time
  every scene has to settle a step. A view narrower than 0.5° is widened, and one of a single point frames 8°.
- **Steps.** The scene joins `shared/state-steps.mjs` as a stepped scene: `show`, `hide`, `tint`, `set` (a label) and
  `callout` work as elsewhere. `trace` is new: it shows a route or line and draws it on from its first stop, from when
  the view settles until the step's words end, or until its `when` words, read with ink's cue timing. A traced item is
  undrawn before its first trace. A step that only moves the view lights what it frames, or the whole map.
- **Checks.** `validate` fails on an unknown country with a suggestion, a point out of range with the `[lng, lat]` swap
  named, a bad route stop, an id named like a country, and a `when` the say lacks. Using the code the scene draws
  from, it warns on overlapping labels, labels off the stage, a lit item off screen, and a too-narrow view.

## Alternatives considered

- **TopoJSON from `world-atlas`.** Its 1:110m file is a little larger, and it names countries by ISO numeric code, so a
  second table would map them to alpha-3, and decoding needs `topojson-client`. Shared arcs save little when every
  country is drawn as its own path.
- **1:110m only.** 82 KB in all, but a zoom on a region shows straight-edged coasts and drops small countries such as
  Singapore and Malta. 1:50m at full detail is 547 KB; simplified to 0.02° it keeps the shapes at 329 KB.
- **Countries in SVG markup on the `svg` scene.** Reuses a scene, but the model would paste thousands of points into a
  storyboard and still lack great circles, label placement and checks on geography.
- **A per-step `camera` on every scene (P1)** is being built separately. The map's `view` frames geography (boxes,
  countries) rather than scene items, so it is its own field; it uses the same timing, so the two read alike.

## Consequences

- A storyboard can fill countries by name, draw a border on along its parallel, zoom from a continent to a town, and
  fly a great circle, as `examples/primitives/map` does with the 49th parallel and Singapore to London.
- The package grows by about 410 KB of outline and `d3-geo` (about 120 KB, already installed). The player loads both
  outlines with the scene code.
- Natural Earth's 1:50m is coarse inside about half a degree. Point Roberts is part of Canada's polygon there, so the
  demo draws it as a region from Natural Earth's 1:10m polygon; a scene that needs town-level detail does the same.
- Natural Earth draws de facto boundaries, and its choices (Kosovo, Somaliland, Northern Cyprus) come with
  the outline. The scene reference names the non-ISO codes.
