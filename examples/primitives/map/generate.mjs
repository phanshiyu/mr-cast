// Writes storyboard.json, hunks.json and meta.json beside this file. Run: node examples/primitives/map/generate.mjs
//
// Facts, checked 2026-10-18:
// - The Treaty of 1818, Article II: the line runs "from the most northwestern point of the Lake of the Woods" along the
//   49th parallel to the "Stony Mountains" (the Rockies); Article III left the Oregon Country west of them under joint
//   control for ten years (https://en.wikipedia.org/wiki/Treaty_of_1818).
// - The Oregon Treaty, signed 15 June 1846, carried the 49th parallel to "the middle of the channel which separates the
//   continent from Vancouver's Island", and Britain kept the whole island (https://en.wikipedia.org/wiki/Oregon_Treaty).
// - Point Roberts, Washington: 48°59′11″N 123°03′25″W, 12.65 km², 1,191 people at the 2020 census, "reached from the
//   rest of the United States by traveling 25 mi (40 km) through Canada" (https://en.wikipedia.org/wiki/Point_Roberts,_Washington).
// - The Lake of the Woods' Northwest Angle is about 49.38°N 95.15°W; the Continental Divide crosses 49°N at about
//   114.07°W, by Waterton and Glacier parks.
// - Singapore Changi (1.3644°N 103.9915°E) to London Heathrow (51.4700°N 0.4543°W): the great circle is 10,881 km on a
//   sphere of radius 6,371 km (d3-geo's geoDistance), and passes over the Bay of Bengal, India, Pakistan, Central Asia,
//   the Caspian, Russia, Ukraine, Belarus, Poland and Germany (geoContains on the bundled 1:50m outline).
// The Point Roberts outline is Natural Earth 5.1.2's 1:10m polygon for it, with its north edge on 49°N, where the treaty
// puts it; the 1:50m outline the scene draws leaves the peninsula's tip in Canada.
import fs from 'node:fs';

const here = (name) => new URL(name, import.meta.url);

const border = {
  type: 'map',
  chapter: 'One straight line',
  title: 'The 49th parallel',
  narration: 'Most of the border between the United States and Canada is one line of latitude.',
  view: {
    box: [
      [38, -128],
      [58, -82],
    ],
  },
  tint: { USA: 'accent', CAN: 'warn' },
  places: [
    { id: 'woods', at: [49.38, -95.15], label: 'Lake of the Woods', side: 'right', hidden: true },
    { id: 'divide', at: [49, -114.07], label: 'Rockies', side: 'below', hidden: true },
    { id: 'us-name', at: 'USA', label: 'United States' },
    { id: 'ca-name', at: [54, -106], dot: false, label: 'Canada' },
    { id: 'roberts', at: [48.955, -123.062], dot: false, label: 'Point Roberts', hidden: true },
  ],
  lines: [
    { id: 'line-1818', lat: 49, from: -95.15, to: -114.07, label: '49° N, 1818', tone: 'good' },
    { id: 'line-1846', lat: 49, from: -114.07, to: -123.3, label: '1846', tone: 'good' },
  ],
  regions: [
    {
      id: 'tip',
      outline: [
        [49, -123.0905],
        [49, -123.0353],
        [48.9844, -123.0453],
        [48.9722, -123.0885],
        [48.988, -123.0893],
      ],
      tone: 'warn',
      hidden: true,
    },
  ],
  steps: [
    {
      show: ['woods', 'divide'],
      trace: [{ ref: 'line-1818', when: 'Rocky Mountains' }],
      say: 'In 1818 the two countries drew it along the forty ninth parallel, from the Lake of the Woods to the Rocky Mountains.',
    },
    {
      trace: ['line-1846'],
      say: 'West of the mountains the land stayed open to both until 1846, when the Oregon Treaty carried the line on to the coast.',
    },
    {
      view: {
        box: [
          [48.86, -123.32],
          [49.1, -122.8],
        ],
      },
      show: ['tip', 'roberts'],
      focus: ['tip', 'line-1846', 'roberts'],
      say: 'Right at the end, the straight line cuts the tip off a Canadian peninsula.',
    },
    {
      tint: { tip: 'accent' },
      focus: ['tip', 'roberts'],
      callout: '12.65 km², 1,191 people',
      say: 'That tip, Point Roberts, is American soil, reached by land only through forty kilometres of the country around it.',
    },
  ],
};

const flight = {
  type: 'map',
  chapter: 'A great circle',
  title: 'Singapore to London',
  narration: 'On a flat map, a flight from Singapore to London looks as if it should run straight across.',
  projection: 'natural-earth',
  places: [
    { id: 'sin', at: [1.3644, 103.9915], label: 'Singapore', side: 'right' },
    { id: 'lhr', at: [51.47, -0.4543], label: 'London', side: 'left' },
  ],
  routes: [{ id: 'sin-lhr', stops: ['sin', 'lhr'], label: '10,881 km' }],
  steps: [
    {
      trace: [{ ref: 'sin-lhr', when: 'into Europe' }],
      say: 'The shortest path on the globe curves north instead, over the Bay of Bengal, India and Central Asia, and on into Europe.',
    },
    {
      view: ['sin', 'lhr', 'sin-lhr'],
      focus: 'sin-lhr',
      callout: 'great circle: 10,881 km',
      say: 'That great circle is about ten thousand nine hundred kilometres.',
    },
  ],
};

const storyboard = {
  title: 'Maps',
  subtitle: 'Countries, borders and routes on a real world map',
  scenes: [flight, border],
};
fs.writeFileSync(here('storyboard.json'), `${JSON.stringify(storyboard, null, 2)}\n`);
fs.writeFileSync(here('hunks.json'), '{}\n');
fs.writeFileSync(here('meta.json'), `${JSON.stringify({ mode: 'explain' })}\n`);
