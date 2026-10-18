# map

A real world map: countries by code, places at a latitude and longitude, great-circle routes, parallels and meridians, and shaded regions, with steps that move the view, trace routes on, and light, colour, show and hide.

## Example

```json
{
  "type": "map",
  "chapter": "Where it flies",
  "title": "Singapore to London",
  "narration": "On a flat map, the flight from Singapore to London looks as if it should run straight across.",
  "projection": "natural-earth",
  "places": [
    { "id": "sin", "at": [1.3644, 103.9915], "label": "Singapore" },
    { "id": "lhr", "at": [51.47, -0.4543], "label": "London", "side": "left" }
  ],
  "routes": [{ "id": "sin-lhr", "stops": ["sin", "lhr"], "label": "10,881 km" }],
  "steps": [
    {
      "trace": [{ "ref": "sin-lhr", "when": "into Europe" }],
      "say": "The shortest path on the globe curves north instead, over the Bay of Bengal and Central Asia, and on into Europe."
    },
    {
      "view": ["sin", "lhr", "sin-lhr"],
      "focus": ["sin-lhr", "IND"],
      "tint": { "IND": "accent" },
      "callout": "great circle: 10,881 km",
      "say": "It crosses the whole of India on the way."
    }
  ]
}
```

## Schema and validate notes

The outline is Natural Earth's public-domain admin-0 countries, bundled at 1:110m and 1:50m; the scene draws 1:50m when a view zooms in past about four times the whole world, or when it names a country only 1:50m has (Singapore, Malta and the like). Every country is drawn. A ref is a country by its ISO 3166-1 alpha-3 code (`"CAN"`) or its name (`"Canada"`), the `id` of a place, route, line or region, or `"map"` for all of it. A few places without an ISO code use Natural Earth's: `KOS` Kosovo, `SOL` Somaliland, `CYN` Northern Cyprus.

Points are `[lat, lng]` in degrees, north and east positive. A place's `at` is a point, or a country, which puts its label on the country's label point with no dot. A route's `stops` are place ids or points, and each leg follows the great circle. A line is a parallel (`lat`) or a meridian (`lng`), whole or `from` one longitude (or latitude) `to` another, drawn in that order. A region is an `outline` of corners or a list of `countries`, shaded in its tone (accent by default). Labels are plain text at 26 px.

`view` is `"world"` (the default), a list of refs to fit round, or `{ "box": [[south, west], [north, east]] }`. A step's `view` eases the camera there at the step's start, out and back in when the move is long. `projection` is `equal-earth` (the default), `natural-earth` or `mercator`; `meridian` sets the map's centre longitude, which otherwise follows the views. A step's `trace` draws routes and lines on from their first stop, from when its view settles until its words end, or until the words in `when`; a traced item is undrawn before its first trace. `show`, `hide`, `tint` (a tone, `"dim"` or `"clear"`), `set` (a new label by id) and `callout` work as on the other stepped scenes. A step with no `focus` lights what it changes, what its view frames, or the whole map. A lit route lights its stops; a step that lights something dims the rest of the map.

`{{MR_CAST}}/bin/mr-cast validate` fails on a country it does not know (suggesting the code), a point outside -90 to 90 and -180 to 180 (naming a `[lng, lat]` swap), a route stop that is no place, two stops in a row at one place, an id taken twice or named like a country, a line with both or neither of `lat` and `lng`, and a `when` the step's `say` lacks. It warns when two labels overlap or one runs off the stage at a step's view, when a step lights something its view leaves off screen, and when a view is narrower than 0.5°, the finest the outline has detail for. `{{MR_CAST}}/bin/mr-cast still` shows each step's view.

`{{MR_CAST}}/bin/mr-cast schema map` prints its fields. A whole demo: `{{MR_CAST}}/examples/primitives/map/storyboard.json` (the 49th parallel ending on Point Roberts, and a great circle).
