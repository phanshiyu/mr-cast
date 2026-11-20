// Writes storyboard.json, hunks.json and meta.json beside this file. Run: node examples/geography/49th-parallel/generate.mjs
//
// Facts, checked 2026-10-18:
// - Treaty of 1818, Article II: the line runs from "the most northwestern point of the Lake of the Woods" along "the
//   49th parallel of north latitude" to the "Stony Mountains", the Rockies. Britain ceded the land south of it,
//   including part of the Red River Colony; the US ceded the part of the Louisiana Purchase north of it. Article III
//   left the Oregon Country west of the mountains under joint control for ten years
//   (https://en.wikipedia.org/wiki/Treaty_of_1818, https://www.thecanadianencyclopedia.ca/article/convention-of-1818).
// - The Oregon Country lay "north of 42° N latitude, south of 54°40′ N latitude, and west of the Rocky Mountains"; 42° N
//   from the Adams-Onis Treaty of 1819, 54°40′ N from Russia's treaties of 1824 and 1825
//   (https://en.wikipedia.org/wiki/Oregon_Country).
// - The Oregon Treaty, signed 15 June 1846, set the line at the 49th parallel to the coast, and Britain kept all of
//   Vancouver Island. "All Oregon" expansionists wanted the region up to 54°40′ N; the war with Mexico, begun in April
//   1846, drew US attention away and helped produce the compromise (https://en.wikipedia.org/wiki/Oregon_Treaty,
//   https://www.oregonencyclopedia.org/articles/oregon-treaty/).
// - Point Roberts, Washington: 12.65 km², 1,191 people at the 2020 census, "reached from the rest of the United States
//   by traveling 25 mi (40 km) through Canada" (https://en.wikipedia.org/wiki/Point_Roberts,_Washington).
// - Places: the Lake of the Woods' Northwest Angle about 49.38° N 95.15° W; the Continental Divide crosses 49° N at about
//   114.07° W; Blaine, Washington, where the line meets the shore of Boundary Bay, at about 122.75° W. The Oregon
//   Country outline below and the drive out of Point Roberts are sketches by hand, not surveyed lines.
// The Point Roberts outline is Natural Earth 5.1.2's 1:10m polygon for it, with its north edge on 49° N.
import fs from 'node:fs';

const here = (name) => new URL(name, import.meta.url);
const assert = (ok, msg) => {
  if (!ok) throw new Error(msg);
};

const R = 6371;
const rad = (d) => (d * Math.PI) / 180;
const alongParallel = (lat, west, east) => R * Math.cos(rad(lat)) * rad(east - west);
const haversine = ([la1, lo1], [la2, lo2]) => {
  const h =
    Math.sin(rad(la2 - la1) / 2) ** 2 + Math.cos(rad(la1)) * Math.cos(rad(la2)) * Math.sin(rad(lo2 - lo1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

const WOODS = -95.15,
  DIVIDE = -114.07,
  BLAINE = -122.75,
  STRAIT = -123.32;
const straight = alongParallel(49, BLAINE, WOODS);
assert(Math.round(straight) === 2013 && Math.round(straight / 100) * 100 === 2000, `straight part ${straight}`);
const km1818 = alongParallel(49, DIVIDE, WOODS);
assert(Math.round(km1818 / 10) * 10 === 1380, `1818 part ${km1818}`);

const N = (n) => n.toLocaleString('en-US');
const claimLat = 54 + 40 / 60;
assert(claimLat.toFixed(3) === '54.667', 'fifty four forty');

const scenes = [];

// Scene 0: a straight line that runs through mountains and across a river without bending.
const opening = `<svg viewBox="0 0 1200 640">
<g id="peaks"><polyline points="230,420 300,250 350,330 410,190 480,340 540,260 610,420" fill="none" stroke="var(--text)" stroke-width="4"/><polyline points="380,232 410,190 440,250" fill="none" stroke="var(--muted)" stroke-width="3"/></g>
<path id="river" d="M860,90 C780,170 940,230 850,320 C770,400 930,470 860,580" fill="none" stroke="var(--muted)" stroke-width="6"/>
${'<text x="690" y="190" text-anchor="middle" font-size="28" fill="var(--muted)">Canada</text>'}
${'<text x="690" y="480" text-anchor="middle" font-size="28" fill="var(--muted)">United States</text>'}
<line id="line49" x1="40" y1="330" x2="1160" y2="330" class="stroke-good" stroke-width="5"/>
<text id="lat" x="60" y="310" font-size="28" class="fill-good">49° N</text>
</svg>`;
scenes.push({
  type: 'svg',
  chapter: 'A straight line',
  title: 'A border drawn with a ruler',
  narration:
    'For about two thousand kilometres, the border between the United States and Canada is a dead straight line.',
  svg: opening,
  hidden: ['line49', 'lat'],
  labels: { line49: 'border', lat: 'forty ninth parallel', peaks: 'mountains', river: 'rivers' },
  steps: [
    {
      show: ['lat'],
      trace: [{ ref: 'line49', when: 'forty ninth' }],
      focus: ['line49', 'lat'],
      say: 'It follows the forty ninth parallel, one line of latitude.',
      draw: [
        { brace: 'line49', note: `about ${N(Math.round(straight / 100) * 100)} km`, side: 'below', when: 'one line' },
      ],
    },
    {
      focus: ['peaks', 'river'],
      say: 'It ignores rivers and mountains.',
      draw: [
        { circle: 'river', when: 'rivers' },
        { circle: 'peaks', when: 'mountains' },
      ],
    },
    {
      focus: 'line49',
      say: 'So why there?',
      draw: [{ write: 'why here?', near: 'lat', side: 'above', when: 'why' }],
    },
  ],
});

// The coast, drawn from the outline the map scene uses (Natural Earth 5.1.2 admin-0 countries at 1:50m, bundled in
// engine/core/data). Only the shore is drawn: an edge the US and Canada share is their land border, which the scenes
// draw themselves, one treaty at a time.
const world = JSON.parse(fs.readFileSync(here('../../../engine/core/data/world-50m.json'), 'utf8'));
const rings = world.countries
  .filter(([code]) => code === 'USA' || code === 'CAN')
  .flatMap(([, , , polygons]) =>
    polygons.flat().map((r) => {
      const out = [];
      for (let i = 0, x = 0, y = 0; i < r.length; i += 2) out.push([(x += r[i]), (y += r[i + 1])]);
      return out; // [lng, lat] in hundredths of a degree
    }),
  );
const edgeKey = (p, q) => (p[0] < q[0] || (p[0] === q[0] && p[1] < q[1]) ? `${p}|${q}` : `${q}|${p}`);
const edgeCount = new Map();
for (const r of rings)
  r.forEach((p, i) => {
    const k = edgeKey(p, r[(i + 1) % r.length]);
    edgeCount.set(k, (edgeCount.get(k) ?? 0) + 1);
  });

/** A projection of a [[south, west], [north, east]] box onto the 1200 x 640 board: parallels stay straight and level. */
function frame([[s, w], [n, e]]) {
  const c = Math.cos(rad((s + n) / 2));
  const k = Math.min(1200 / ((e - w) * c), 640 / (n - s));
  const [ox, oy] = [(1200 - (e - w) * c * k) / 2, (640 - (n - s) * k) / 2];
  const at = (lat, lng) => [ox + (lng - w) * c * k, oy + (n - lat) * k];
  const xy = (lat, lng) => at(lat, lng).map((v) => +v.toFixed(1));
  // the shore inside the box, as polylines, with points closer than minPx dropped
  const coast = (minPx) => {
    const inside = ([x, y]) => x > -40 && x < 1240 && y > -40 && y < 680;
    const lines = [];
    for (const r of rings) {
      let cur = [];
      const flush = () => {
        if (cur.length > 1) lines.push(cur);
        cur = [];
      };
      r.forEach((p, i) => {
        const q = r[(i + 1) % r.length];
        const [a, b] = [at(p[1] / 100, p[0] / 100), at(q[1] / 100, q[0] / 100)];
        if (edgeCount.get(edgeKey(p, q)) > 1 || !(inside(a) || inside(b))) return flush();
        if (!cur.length) cur.push(a);
        const last = cur.at(-1);
        if (Math.hypot(b[0] - last[0], b[1] - last[1]) >= minPx || i === r.length - 1) cur.push(b);
      });
      flush();
    }
    return lines.map((l) => `M${l.map(([x, y]) => `${x.toFixed(0)},${y.toFixed(0)}`).join(' L')}`).join(' ');
  };
  return { xy, coast };
}
const pts = (f, list) => list.map(([lat, lng]) => f.xy(lat, lng).join(',')).join(' ');
const label = (f, id, [lat, lng], text, { dx = 0, dy = 0, anchor = 'middle', size = 26, extra = '' } = {}) => {
  const [x, y] = f.xy(lat, lng);
  return `<text id="${id}" x="${(x + dx).toFixed(0)}" y="${(y + dy).toFixed(0)}" font-size="${size}" text-anchor="${anchor}"${extra}>${text}</text>`;
};
const dot = (f, id, [lat, lng], text, opts) => {
  const [x, y] = f.xy(lat, lng);
  return `<g id="${id}"><circle cx="${x}" cy="${y}" r="7" fill="var(--text)"/>${label(f, `${id}-name`, [lat, lng], text, opts)}</g>`;
};
const parallel = (f, id, lat, from, to, cls, extra = '') => {
  const [[x1, y1], [x2, y2]] = [f.xy(lat, from), f.xy(lat, to)];
  return `<line id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="${cls}" stroke-width="5"${extra}/>`;
};

// The Oregon Country: 42° N to 54°40′ N, the Pacific to the Continental Divide, sketched.
const oregon = [
  [42, -124.3],
  [42, -109.5],
  [44.5, -110.5],
  [46, -112.6],
  [47.5, -112.8],
  [49, DIVIDE],
  [51.4, -116.3],
  [52.9, -118.4],
  [claimLat, -120.5],
  [claimLat, -130.6],
  [52, -128.4],
  [50.5, -128.4],
  [48.4, -124.7],
  [46.25, -124.05],
];
const strait = [
  [49, STRAIT],
  [48.77, -123.22],
  [48.42, -123.2],
  [48.29, -123.7],
  [48.49, -124.73],
];

// Scenes 1 to 3: the west of the continent, where the line grows treaty by treaty.
const W = frame([
  [39, -138],
  [59, -84],
]);
const west = `<svg viewBox="0 0 1200 640">
<path id="coast" d="${W.coast(3)}" fill="none" stroke="var(--muted)" stroke-width="2"/>
<polygon id="oregon" points="${pts(W, oregon)}" class="tone-bad" stroke-width="3"/>
${label(W, 'oregon-name', [45.5, -119], 'Oregon Country', { extra: ' class="fill-bad"' })}
${label(W, 'us-name', [41, -97], 'United States', { size: 30, extra: ' fill="var(--muted)"' })}
${label(W, 'br-name', [56, -100], 'British land', { size: 30, extra: ' fill="var(--muted)"' })}
${parallel(W, 'line-1818', 49, WOODS, DIVIDE, 'stroke-good')}
${label(W, 'lat-1818', [49, -104.6], '49° N', { dy: -16, extra: ' class="fill-good"' })}
${parallel(W, 'claim', claimLat, -130.6, -120.5, 'stroke-bad')}
${label(W, 'claim-name', [claimLat, -120.5], '54°40′ N', { dx: 14, dy: 9, anchor: 'start', extra: ' class="fill-bad"' })}
${parallel(W, 'line-1846', 49, DIVIDE, STRAIT, 'stroke-good')}
<polyline id="water" points="${pts(W, strait)}" fill="none" class="stroke-good" stroke-width="5"/>
${label(W, 'vi', [50.3, -127.8], 'Vancouver Island', { anchor: 'end', size: 24 })}
${dot(W, 'woods', [49.38, WOODS], 'Lake of the Woods', { dx: 14, dy: 8, anchor: 'start', size: 24 })}
${dot(W, 'divide', [49, DIVIDE], 'Rockies', { dy: 36, size: 24 })}
</svg>`;

scenes.push({
  type: 'svg',
  chapter: '1818',
  title: 'A straight line across the plains',
  picture: 'west',
  narration:
    'In 1818 the United States and Britain, which still ran what is now Canada, needed a border across the plains.',
  hidden: [
    'oregon',
    'oregon-name',
    'line-1818',
    'lat-1818',
    'claim',
    'claim-name',
    'line-1846',
    'water',
    'vi',
    'divide',
  ],
  labels: {
    divide: 'Rocky Mountains',
    woods: 'Lake of the Woods',
    'line-1818': 'forty ninth parallel',
    'us-name': 'side',
    'br-name': 'side',
  },
  steps: [
    {
      show: ['divide', 'lat-1818'],
      trace: [{ ref: 'line-1818', when: 'to the Rocky Mountains' }],
      focus: ['line-1818', 'woods', 'divide'],
      say: 'They picked the forty ninth parallel, from the Lake of the Woods to the Rocky Mountains.',
    },
    {
      focus: ['line-1818', 'us-name', 'br-name'],
      draw: [
        {
          write: `about ${N(Math.round(km1818 / 10) * 10)} km`,
          near: 'line-1818',
          side: 'below',
          when: 'easy to agree',
        },
      ],
      say: 'A straight line was easy to agree on. Each side gave up the scraps of land on the wrong side of it.',
    },
  ],
});

scenes.push({
  type: 'svg',
  chapter: 'Oregon',
  title: 'West of the Rockies, a shared land',
  picture: 'west',
  narration:
    'West of the mountains, nobody could agree. So the two countries shared that land, which they called the Oregon Country.',
  labels: { oregon: 'Oregon Country', claim: 'fifty four forty', 'claim-name': 'all of it' },
  illustrative: true,
  steps: [
    {
      show: ['oregon', 'oregon-name'],
      focus: ['oregon', 'oregon-name'],
      say: 'For almost thirty years, British fur traders and American settlers both moved in.',
    },
    {
      show: ['claim-name'],
      trace: [{ ref: 'claim', when: 'fifty four forty' }],
      focus: ['claim', 'claim-name', 'oregon'],
      say: 'Some Americans wanted all of it, right up to Russian Alaska, at fifty four forty.',
    },
    {
      focus: 'claim',
      say: 'But in 1846 the United States went to war with Mexico, and it did not want a second war with Britain.',
      draw: [{ cross: 'claim', when: 'second war' }],
    },
  ],
});

scenes.push({
  type: 'svg',
  chapter: '1846',
  title: 'The same line, on to the Pacific',
  picture: 'west',
  narration: 'So they split the difference.',
  labels: { 'line-1846': 'same straight line', water: 'through the water', vi: 'Vancouver Island' },
  steps: [
    {
      hide: ['claim', 'claim-name'],
      tint: { oregon: 'dim', 'oregon-name': 'dim' },
      trace: [{ ref: 'line-1846', when: 'to the sea' }],
      focus: 'line-1846',
      say: 'The Oregon Treaty of 1846 carried the same straight line west, over the mountains, all the way to the sea.',
    },
    {
      show: ['vi'],
      trace: [{ ref: 'water', when: 'stayed British' }],
      focus: ['water', 'vi'],
      camera: { on: ['water', 'vi'], zoom: 2.5 },
      say: 'At the coast it swings south through the water, so the whole of Vancouver Island stayed British.',
    },
  ],
});

// Scene 4: Point Roberts, close up.
const drive = [
  [48.985, -123.07],
  [49.03, -123.065],
  [49.07, -123.0],
  [49.06, -122.9],
  [49.0, BLAINE],
];
const driveKm = drive.slice(1).reduce((km, p, i) => km + haversine(drive[i], p), 0);
assert(driveKm > 25 && driveKm < 40, `drive sketch ${driveKm}`);
const tip = [
  [49, -123.0905],
  [49, -123.0353],
  [48.9844, -123.0453],
  [48.9722, -123.0885],
  [48.988, -123.0893],
];
const L = frame([
  [48.86, -123.36],
  [49.14, -122.56],
]);
const local = `<svg viewBox="0 0 1200 640">
<path id="shore" d="${L.coast(1)}" fill="none" stroke="var(--muted)" stroke-width="2"/>
${parallel(L, 'line', 49, -122.56, -123.36, 'stroke-good')}
${label(L, 'lat', [49, -122.66], '49° N', { dy: -16, extra: ' class="fill-good"' })}
<polygon id="tip" points="${pts(L, tip)}" class="tone-bad" stroke-width="3"/>
${label(L, 'roberts', [48.955, -123.062], 'Point Roberts', { dy: 30 })}
<polyline id="drive" points="${pts(L, drive)}" fill="none" stroke="var(--text)" stroke-width="4" stroke-dasharray="12 8"/>
${dot(L, 'blaine', [49.0, BLAINE], 'Blaine, WA', { dx: 14, dy: 36, anchor: 'start', size: 24 })}
</svg>`;
scenes.push({
  type: 'svg',
  chapter: 'Point Roberts',
  title: 'A tip the line cut off',
  narration: 'But a straight line drawn on a map does not care what it cuts.',
  svg: local,
  hidden: ['tip', 'roberts', 'drive', 'blaine'],
  labels: {
    tip: 'tip',
    line: 'slices',
    roberts: 'Point Roberts',
    drive: 'through Canada',
    blaine: 'rest of their country',
  },
  steps: [
    {
      show: ['tip', 'roberts'],
      focus: ['tip', 'line', 'roberts'],
      say: 'Near the coast it slices the tip off a Canadian peninsula. That tip, Point Roberts, is in the United States.',
    },
    {
      focus: ['tip', 'roberts'],
      draw: [{ write: '12.65 km², 1,191 people', near: 'roberts', side: 'below', when: 'twelve square' }],
      say: 'About twelve square kilometres, and some twelve hundred people.',
    },
    {
      show: ['blaine'],
      trace: [{ ref: 'drive', when: 'through Canada' }],
      focus: ['drive', 'tip', 'blaine'],
      say: 'To drive home to the rest of their country, they cross the border twice, and about forty kilometres through Canada.',
      draw: [{ write: 'about 40 km by road', near: 'drive', side: 'above', when: 'forty kilometres' }],
    },
  ],
});

const storyboard = {
  title: 'The 49th parallel',
  subtitle: 'Why the US and Canada share a straight line',
  tones: { good: 'the border along 49° N', bad: 'land the line left in question' },
  pictures: { west },
  scenes,
};
fs.writeFileSync(here('storyboard.json'), `${JSON.stringify(storyboard, null, 2)}\n`);
fs.writeFileSync(here('hunks.json'), '{}\n');
fs.writeFileSync(here('meta.json'), `${JSON.stringify({ mode: 'explain' })}\n`);
