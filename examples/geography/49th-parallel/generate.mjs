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
const assert = (ok, msg) => { if (!ok) throw new Error(msg); };

const R = 6371;
const rad = (d) => (d * Math.PI) / 180;
const alongParallel = (lat, west, east) => R * Math.cos(rad(lat)) * rad(east - west);
const haversine = ([la1, lo1], [la2, lo2]) => {
  const h = Math.sin(rad(la2 - la1) / 2) ** 2 + Math.cos(rad(la1)) * Math.cos(rad(la2)) * Math.sin(rad(lo2 - lo1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

const WOODS = -95.15, DIVIDE = -114.07, BLAINE = -122.75, STRAIT = -123.32;
const straight = alongParallel(49, BLAINE, WOODS);
assert(Math.round(straight) === 2013 && Math.round(straight / 100) * 100 === 2000, `straight part ${straight}`);
const km1818 = alongParallel(49, DIVIDE, WOODS);
assert(Math.round(km1818 / 10) * 10 === 1380, `1818 part ${km1818}`);

const N = (n) => n.toLocaleString('en-US');
const claimLat = 54 + 40 / 60;
assert(claimLat.toFixed(3) === '54.667', 'fifty four forty');

const scenes = [];

scenes.push({
  type: 'text',
  chapter: 'A straight line',
  narration: 'For about two thousand kilometres, the border between the United States and Canada is a dead straight line.',
  kicker: 'The US and Canada border',
  number: `${N(Math.round(straight / 100) * 100)} km`,
  note: 'along one line of latitude, 49° N',
  hidden: ['note'],
  steps: [
    { show: ['note'], say: 'It follows the forty ninth parallel. It ignores rivers and mountains. So why there?' },
  ],
});

const usName = { id: 'us-name', at: [40, -100], dot: false, label: 'United States' };
const brName = { id: 'br-name', at: [55, -100], dot: false, label: 'British land' };
const woods = { id: 'woods', at: [49.38, WOODS], label: 'Lake of the Woods', side: 'right' };
const divide = { id: 'divide', at: [49, DIVIDE], label: 'Rockies', side: 'below' };
const line1818 = { id: 'line-1818', lat: 49, from: WOODS, to: DIVIDE, label: '49° N', tone: 'good' };

scenes.push({
  type: 'map',
  chapter: '1818',
  title: 'The first stretch',
  narration: 'In 1818 the United States and Britain, which still ran what is now Canada, needed a border across the plains.',
  view: { box: [[36, -130], [60, -80]] },
  tint: { USA: 'accent', CAN: 'warn' },
  places: [usName, brName, woods, { ...divide, hidden: true }],
  lines: [line1818],
  steps: [
    {
      show: ['divide'],
      trace: [{ ref: 'line-1818', when: 'to the Rocky Mountains' }],
      focus: ['line-1818', 'woods', 'divide'],
      say: 'They picked the forty ninth parallel, from the Lake of the Woods to the Rocky Mountains.',
    },
    {
      focus: ['line-1818', 'us-name', 'br-name'],
      callout: `about ${N(Math.round(km1818 / 10) * 10)} km`,
      say: 'A straight line was easy to agree on. Each side gave up the scraps of land on the wrong side of it.',
    },
  ],
});

// The Oregon Country: 42° N to 54°40′ N, the Pacific to the Continental Divide, sketched.
const oregon = [
  [42, -124.3], [42, -109.5], [44.5, -110.5], [46, -112.6], [47.5, -112.8], [49, DIVIDE], [51.4, -116.3],
  [52.9, -118.4], [claimLat, -120.5], [claimLat, -130.6], [52, -128.4], [50.5, -128.4], [48.4, -124.7], [46.25, -124.05],
];
scenes.push({
  type: 'map',
  chapter: 'Oregon',
  title: 'The land west of the Rockies',
  narration: 'West of the mountains, nobody could agree. So the two countries shared that land, which they called the Oregon Country.',
  view: { box: [[38, -136], [60, -100]] },
  tint: { USA: 'accent', CAN: 'neutral' },
  places: [usName, { ...brName, at: [57, -108] }],
  lines: [line1818, { id: 'claim', lat: claimLat, from: -130.6, to: -120.5, label: '54°40′ N', tone: 'bad', hidden: true }],
  regions: [{ id: 'oregon', outline: oregon, label: 'Oregon Country', tone: 'warn' }],
  steps: [
    {
      focus: 'oregon',
      say: 'For almost thirty years, British fur traders and American settlers both moved in.',
    },
    {
      trace: [{ ref: 'claim', when: 'fifty four forty' }],
      focus: ['claim', 'oregon'],
      say: 'Some Americans wanted all of it, right up to Russian Alaska, at fifty four forty.',
    },
    {
      focus: 'claim',
      say: 'But in 1846 the United States went to war with Mexico, and it did not want a second war with Britain.',
      draw: [{ cross: 'claim', when: 'second war' }],
    },
  ],
});

const strait = [[49, STRAIT], [48.77, -123.22], [48.42, -123.2], [48.29, -123.7], [48.49, -124.73]];
scenes.push({
  type: 'map',
  chapter: '1846',
  title: 'On to the Pacific',
  narration: 'So they split the difference.',
  view: { box: [[45.5, -131], [53, -112]] },
  places: [
    divide,
    { id: 'vi', at: [49.75, -125.9], dot: false, label: 'Vancouver Island', hidden: true },
  ],
  lines: [line1818, { id: 'line-1846', lat: 49, from: DIVIDE, to: STRAIT, label: '1846', tone: 'good' }],
  routes: [{ id: 'water', stops: strait, tone: 'good', hidden: true }],
  steps: [
    {
      trace: [{ ref: 'line-1846', when: 'to the sea' }],
      focus: 'line-1846',
      say: 'The Oregon Treaty of 1846 carried the same straight line west, over the mountains, all the way to the sea.',
    },
    {
      show: ['vi'],
      trace: [{ ref: 'water', when: 'stayed British' }],
      focus: ['water', 'vi'],
      say: 'At the coast it swings south through the water, so the whole of Vancouver Island stayed British.',
    },
  ],
});

const drive = [[48.985, -123.07], [49.03, -123.065], [49.07, -123.0], [49.06, -122.9], [49.0, BLAINE]];
const driveKm = drive.slice(1).reduce((km, p, i) => km + haversine(drive[i], p), 0);
assert(driveKm > 25 && driveKm < 40, `drive sketch ${driveKm}`);
scenes.push({
  type: 'map',
  chapter: 'Point Roberts',
  title: 'The leftover tip',
  narration: 'But a straight line drawn on a map does not care what it cuts.',
  view: { box: [[48.75, -123.6], [49.25, -122.6]] },
  places: [
    { id: 'roberts', at: [48.955, -123.062], dot: false, label: 'Point Roberts', hidden: true },
    { id: 'blaine', at: [49.0, BLAINE], label: 'Blaine, WA', side: 'right', hidden: true },
  ],
  lines: [{ id: 'line', lat: 49, from: -122.6, to: STRAIT, label: '49° N', tone: 'good' }],
  regions: [{
    id: 'tip',
    outline: [[49, -123.0905], [49, -123.0353], [48.9844, -123.0453], [48.9722, -123.0885], [48.988, -123.0893]],
    tone: 'warn',
    hidden: true,
  }],
  routes: [{ id: 'drive', stops: drive, label: 'about 40 km by road', hidden: true }],
  steps: [
    {
      view: { box: [[48.86, -123.32], [49.1, -122.8]] },
      show: ['tip', 'roberts'],
      focus: ['tip', 'line', 'roberts'],
      say: 'Near the coast it slices the tip off a Canadian peninsula. That tip, Point Roberts, is in the United States.',
    },
    {
      tint: { tip: 'accent' },
      focus: ['tip', 'roberts'],
      callout: '12.65 km², 1,191 people',
      say: 'About twelve square kilometres, and some twelve hundred people.',
    },
    {
      view: { box: [[48.85, -123.3], [49.15, -122.55]] },
      show: ['blaine'],
      trace: [{ ref: 'drive', when: 'through Canada' }],
      focus: ['drive', 'tip', 'blaine'],
      say: 'To drive home to the rest of their country, they cross the border twice, and about forty kilometres through Canada.',
    },
  ],
});

const storyboard = { title: 'The 49th parallel', subtitle: 'Why the US and Canada share a straight line', scenes };
fs.writeFileSync(here('storyboard.json'), `${JSON.stringify(storyboard, null, 2)}\n`);
fs.writeFileSync(here('hunks.json'), '{}\n');
fs.writeFileSync(here('meta.json'), `${JSON.stringify({ mode: 'explain' })}\n`);
