// Writes storyboard.json beside this file. Every number the video shows or says is computed here and checked.
// Run: node examples/science/gps-relativity/generate.mjs
//
// Primary source: Neil Ashby, "Relativity in the Global Positioning System", Living Reviews in Relativity 6 (2003) 1,
// doi:10.12942/lrr-2003-1, section 5 ("Relativistic Effects on Satellite Clocks"). Its eq. 35 gives the net fractional
// frequency offset of an orbiting clock as +2.5046e-10 - 6.9693e-10 = -4.4647e-10 ("the standard clock in orbit is
// beating too fast"), eq. 36 the factory frequency 10.229 999 995 43 MHz in place of 10.23 MHz, the same section the
// radius 9545 km where the two effects cancel, and eqs. 39 and 40 the eccentricity term, "about 23 ns" at e = 0.01.
// Constants: GM and the Earth's rotation rate from WGS-84; the geoid potential Phi0/c^2 = -6.96927e-10 from Ashby
// section 3; the GPS semi-major axis 26,561.75 km from Ashby, "Relativity and the Global Positioning System", Physics
// Today 55(5), 2002. The space station's height (about 420 km) is a round figure from NASA's station pages.
import fs from 'node:fs';

const assert = (ok, msg) => {
  if (!ok) throw new Error(msg);
};
const near = (a, b, tol, msg) => assert(Math.abs(a - b) <= tol, `${msg}: ${a} is not ${b} ± ${tol}`);

const c = 299_792_458; // m/s, exact
const GM = 3.986004418e14; // m^3/s^2, WGS-84
const omega = 7.2921151467e-5; // rad/s, WGS-84
const aEq = 6_378_137; // m, WGS-84 equatorial radius
const rMean = 6_371_000; // m, mean radius, for the drawing and the plot's left edge
const phi0 = -6.96927e-10; // Phi0 / c^2 on the geoid, Ashby section 3; it includes the ground's own spin
const a = 26_561_750; // m, GPS semi-major axis
const day = 86_400; // s
const us = 1e6;

// Ashby eq. 34 for a circular orbit: an orbiting clock against one on the geoid, as a fraction.
const offset = (r) => (-3 * GM) / (2 * r * c * c) - phi0;
const net = offset(a);
near((-3 * GM) / (2 * a * c * c), -2.5046e-10, 0.00005e-10, 'Ashby eq. 35, orbit term');
near(-net, -4.4647e-10, 0.00005e-10, 'Ashby eq. 35, net offset');

// The two halves the story tells: weaker gravity (the clock gains) and speed (it loses). The ground's spin is a
// speed too, so it moves from the geoid potential into the speed half. The halves add up to the net exactly.
const spin = (omega * aEq) ** 2 / (2 * c * c);
const gravityPart = -phi0 - spin - GM / (a * c * c);
const speedPart = -GM / (2 * a * c * c) + spin;
near(gravityPart + speedPart, net, 1e-24, 'the halves add up');
const perDay = (f) => f * day * us; // microseconds a day
const gain = perDay(gravityPart),
  loss = -perDay(speedPart),
  total = perDay(net);
near(gain, 45.7, 0.05, 'gravity gain, µs a day');
near(loss, 7.1, 0.05, 'speed loss, µs a day');
near(total, 38.6, 0.05, 'net gain, µs a day');
const r1 = (x) => Math.round(x * 10) / 10;
assert(r1(gain) - r1(loss) === r1(total), 'the rounded figures add up on screen');

// What it costs: light covers c × 38.6 µs in a day, and the error adds up day after day.
const kmDay = ((total / us) * c) / 1000;
near(kmDay, 11.6, 0.05, 'km of light a day');
const kmWeek = 7 * kmDay;
assert(Math.round(kmWeek) === 81, 'a week');
const mPerUs = c / us;
assert(Math.round(mPerUs) === 300, 'light in a microsecond');

// The fix, Ashby eq. 36.
const f0 = 10.23e6;
const factory = f0 * (1 + -4.4647e-10);
near(factory, 10_229_999.99543, 0.000005, 'factory frequency');

// The orbit: height, speed, period and how long the signal takes to come down.
const height = (a - aEq) / 1000;
assert(Math.round(height / 100) * 100 === 20_200, 'height about 20,200 km');
const v = Math.sqrt(GM / a);
near(v / 1000, 3.87, 0.005, 'orbital speed, km/s');
const period = (2 * Math.PI * Math.sqrt(a ** 3 / GM)) / 3600;
near(period, 11.97, 0.01, 'period, hours');
const signalMs = ((height * 1000) / c) * 1000;
assert(Math.round(signalMs) === 67, 'signal time straight down');

// The plot: µs a day gained by a clock on a circular orbit of radius x thousand km, against the ground.
const A = -phi0 * day * us,
  B = (((3 * GM) / (2 * c * c)) * day * us) / 1e6;
const fx = (x) => A - B / x;
near(fx(a / 1e6), total, 1e-9, 'plot formula matches');
const cross = B / A; // thousand km
near(cross * 1000, 9545, 1, 'Ashby: the effects cancel at 9545 km');
const iss = (rMean + 420_000) / 1e6,
  geo = 42.164; // geostationary radius 42,164 km
near(fx(iss), -24.4, 0.1, 'a station clock loses');
near(fx(geo), 46.6, 0.1, 'a geostationary clock gains');

const fmt = (x, d = 1) => x.toFixed(d);
const N = (n) => Math.round(n).toLocaleString('en-US');

const scenes = [];

// ---------- the orbit picture: the Earth and a ring of satellites, drawn to scale ----------
const W = 1600,
  H = 900,
  cx = 800,
  cy = 450;
const re = 84,
  ro = Math.round((re * a) / rMean); // px
assert(ro === 350, 'orbit drawn to scale');
const sats = [-52, -18, 18, 52]; // degrees from straight up, all above the receiver's horizon
const rx = cx,
  ry = cy - re; // the receiver, on top of the Earth
for (const d of sats) assert(ro * Math.cos((d * Math.PI) / 180) > re, `satellite at ${d}° is above the horizon`);
const satAt = (d) => [cx + ro * Math.sin((d * Math.PI) / 180), cy - ro * Math.cos((d * Math.PI) / 180)];
const satShape = (id, [x, y]) =>
  `<g id="${id}"><rect x="${x - 50}" y="${y - 10}" width="32" height="20" stroke-width="3"/><rect x="${x + 18}" y="${y - 10}" width="32" height="20" stroke-width="3"/><rect x="${x - 16}" y="${y - 16}" width="32" height="32" rx="5" stroke-width="3"/></g>`;
const MHz = ((m) => `${m.slice(0, 6)} ${m.slice(6, 9)} ${m.slice(9, 12)} ${m.slice(12)}`)((factory / 1e6).toFixed(11));
assert(MHz === '10.229 999 995 43', 'factory frequency as written');
const PX = cx + ro + 50; // the panel on the right
const US = 8; // px per microsecond in the panel's bars
const panelBar = (id, y, from, to, label, value, extra = '') =>
  `<g id="${id}"><text x="${PX}" y="${y}" font-size="30">${label}</text><rect x="${PX + from * US}" y="${y + 18}" width="${(to - from) * US}" height="54" rx="6" stroke-width="3" ${extra}/><text x="${PX + 10 + from * US}" y="${y + 56}" font-size="28">${value}</text></g>`;
const orbitSvg =
  `<svg viewBox="${cx - ro - 60} ${cy - ro - 50} ${2 * ro + 560} ${2 * ro + 100}">` +
  `<circle id="orbit" cx="${cx}" cy="${cy}" r="${ro}" fill="none" stroke="var(--muted)" stroke-width="3" stroke-dasharray="10 12"/>` +
  `<g id="earth"><circle cx="${cx}" cy="${cy}" r="${re}" fill="none" stroke="var(--text)" stroke-width="4"/><path d="M${cx - 52} ${cy - 30} q30 -26 60 -6 q20 18 -6 34 q-26 12 -40 34 q-20 -30 -14 -62 Z" fill="none" stroke="var(--muted)" stroke-width="3"/><path d="M${cx + 20} ${cy + 18} q30 -10 44 14 q-10 30 -40 30 q-14 -20 -4 -44 Z" fill="none" stroke="var(--muted)" stroke-width="3"/></g>` +
  `<circle id="you" cx="${rx}" cy="${ry}" r="9" fill="var(--text)" stroke="none"/><text id="you-label" x="${rx}" y="${ry - 18}" text-anchor="middle" font-size="26">you</text>` +
  `<text id="earth-label" x="${cx}" y="${cy + re + 36}" text-anchor="middle" font-size="30" fill="var(--muted)">Earth</text>` +
  `<g id="signals" class="flow" stroke="var(--muted)" stroke-width="3">${sats
    .map((d) => {
      const [x, y] = satAt(d);
      return `<line x1="${x.toFixed(1)}" y1="${(y + 18).toFixed(1)}" x2="${rx}" y2="${ry - 10}"/>`;
    })
    .join('')}</g>` +
  sats.map((d, i) => satShape(`sat${i}`, satAt(d))).join('') +
  `<text id="height" x="${PX}" y="${cy - 30}" font-size="36">${N(Math.round(height / 100) * 100)} km up</text>` +
  `<text id="speed" x="${PX}" y="${cy + 20}" font-size="32" fill="var(--muted)">${fmt(v / 1000, 2)} km a second</text>` +
  `<text id="lap" x="${PX}" y="${cy + 66}" font-size="32" fill="var(--muted)">once round in 11 h 58 min</text>` +
  panelBar('gravity', 170, 0, r1(gain), 'weaker gravity: gains', `+${fmt(gain)} µs`) +
  panelBar('speedLoss', 340, r1(total), r1(gain), 'its speed: loses', '', 'class="tone-bad"') +
  `<text id="lossValue" x="${PX + r1(total) * US - 12}" y="${340 + 56}" text-anchor="end" font-size="28" class="tone-bad">−${fmt(loss)} µs</text>` +
  panelBar('net', 510, 0, r1(total), 'net: ahead each day', `+${fmt(total)} µs`, 'class="tone-bad"') +
  `<g id="tuned"><text x="${PX}" y="${cy - 30}" font-size="30" class="tone-good">each clock tuned to</text><text x="${PX}" y="${cy + 14}" font-size="30" font-family="mono" class="tone-good">${MHz} MHz</text></g>` +
  `</svg>`;
assert(Math.round(period * 60) === 718, 'once round in 11 h 58 min');
const panel = ['gravity', 'speedLoss', 'lossValue', 'net', 'tuned'];

scenes.push({
  type: 'svg',
  chapter: 'The question',
  title: 'Do two perfect clocks agree?',
  picture: 'orbit',
  hidden: ['orbit', 'sat0', 'sat2', 'sat3', 'signals', 'height', 'speed', 'lap', 'sat1', ...panel],
  labels: { sat1: 'satellite', you: 'ground', 'you-label': 'ground' },
  narration: 'Here is a question that sounds too simple.',
  steps: [
    {
      show: ['sat1'],
      camera: { on: ['earth', 'sat1'] },
      focus: ['sat1', 'you'],
      say: 'Put a perfect clock on a satellite, and another on the ground. Do they keep the same time?',
      draw: [
        { write: 'clock', near: 'sat1', side: 'right', when: 'perfect clock' },
        { write: 'same time?', near: 'earth', side: 'left', when: 'same time' },
      ],
    },
    {
      focus: ['sat1'],
      say: 'Most people say yes. They don’t, and if nobody fixed it, your map would be useless within a day.',
      draw: [{ write: 'they don’t', near: 'sat1', side: 'left', tone: 'bad', when: 'They don’t' }],
    },
  ],
});

scenes.push({
  type: 'svg',
  chapter: 'The satellites',
  title: 'A ring of clocks, 20,200 km up',
  picture: 'orbit',
  narration: 'Start with your phone, sitting on the ground.',
  labels: { you: 'phone', orbit: 'ring', sat0: 'satellite', signals: 'signal', earth: 'Earth' },
  hidden: ['orbit', 'sat0', 'sat2', 'sat3', 'signals', 'height', 'speed', 'lap', ...panel],
  steps: [
    {
      camera: { on: 'you', zoom: 4 },
      focus: 'you',
      say: 'Your phone has no idea where it is. It has to be told.',
    },
    {
      camera: 'all',
      show: ['orbit', 'sat0', 'sat2', 'sat3', 'height'],
      focus: ['orbit', 'height'],
      say: 'Twenty thousand kilometres up, a ring of satellites circles the planet. The drawing is to scale.',
    },
    {
      move: { sat1: { to: `rotate(360 ${cx} ${cy})`, when: 'goes all the way round' } },
      show: ['speed', 'lap'],
      focus: ['sat1', 'speed', 'lap'],
      say: 'Each one moves at almost four kilometres a second, and goes all the way round in just under twelve hours.',
    },
    {
      show: ['signals'],
      focus: ['sat0', 'sat1', 'sat2', 'sat3', 'signals', 'you'],
      say: 'Every satellite carries an atomic clock, and keeps sending out the time.',
    },
    {
      focus: ['signals'],
      say: 'The signal takes about a fifteenth of a second to reach you.',
      draw: [{ write: `${Math.round(signalMs)} ms down`, near: 'signals', side: 'left', when: 'fifteenth' }],
    },
  ],
});

// ---------- the fix picture: distance from time, and what a late clock does to it ----------
// Circles in a plane, not to scale.
const rcv = [800, 560];
const S = [
  [560, 420],
  [820, 300],
  [1060, 430],
];
const dist = S.map(([x, y]) => Math.hypot(x - rcv[0], y - rcv[1]));
const late = 56; // px, the drawn size of the error, much bigger than to scale
const circle = (id, [x, y], r, extra) =>
  `<circle id="${id}" cx="${x}" cy="${y}" r="${r.toFixed(1)}" fill="none" ${extra}/>`;
const fixSvg =
  `<svg viewBox="200 0 1200 ${H}">` +
  S.map((p, i) => circle(`ring${i}`, p, dist[i], 'stroke="var(--text)" stroke-width="4"')).join('') +
  circle('late', S[1], dist[1] + late, 'class="stroke-bad" stroke-width="4" stroke-dasharray="14 10"') +
  circle('dayRing', S[1], dist[1] + 150, 'class="stroke-bad" stroke-width="4" stroke-dasharray="14 10"') +
  circle('weekRing', S[1], dist[1] + 290, 'class="stroke-bad" stroke-width="4" stroke-dasharray="14 10"') +
  S.map(
    ([x, y], i) =>
      `<g id="s${i}"><circle cx="${x}" cy="${y}" r="16" fill="var(--text)" stroke="none"/><text x="${x}" y="${y - 28}" text-anchor="middle" font-size="30">satellite ${i + 1}</text></g>`,
  ).join('') +
  `<g id="here"><circle cx="${rcv[0]}" cy="${rcv[1]}" r="14" class="tone-good"/><text x="${rcv[0]}" y="${rcv[1] + 52}" text-anchor="middle" font-size="30" class="tone-good">you are here</text></g>` +
  `<text id="miss" x="${rcv[0]}" y="${rcv[1] + 240}" text-anchor="middle" font-size="32" class="tone-bad">one clock 1 µs late: 300 m out</text>` +
  `</svg>`;
scenes.push({
  type: 'svg',
  chapter: 'Time is distance',
  title: 'How a phone finds itself',
  picture: 'fix',
  narration: 'Your phone compares the time in each signal with when it arrived.',
  labels: {
    ring0: 'first circle',
    ring1: 'second circle',
    ring2: 'third circle',
    here: 'one point',
    late: 'late clock',
    miss: 'three hundred metres',
  },
  hidden: ['ring0', 'ring1', 'ring2', 'late', 'dayRing', 'weekRing', 'here', 'miss'],
  steps: [
    {
      trace: [{ ref: 'ring0', when: 'somewhere' }],
      focus: ['s0', 'ring0'],
      say: 'The gap, times the speed of light, is how far away that satellite is. That puts you somewhere on a circle around it.',
    },
    {
      trace: ['ring1', 'ring2'],
      focus: ['ring1', 'ring2'],
      say: 'A second and a third circle cross at just one point.',
    },
    {
      show: ['here'],
      focus: 'here',
      say: 'That point is you. Out in three dimensions, a fourth satellite also corrects the cheap clock in your phone.',
    },
    {
      trace: ['late'],
      tint: { ring1: 'dim' },
      focus: ['late', 's1'],
      say: 'Now make one satellite’s clock a millionth of a second late.',
    },
    {
      show: ['miss'],
      focus: ['miss', 'late'],
      say: 'Light goes three hundred metres in that time, so that circle lands three hundred metres off, and the crossing point moves.',
      draw: [{ write: `light: ${Math.round(mPerUs)} m a µs`, near: 's1', side: 'right', when: 'Light goes' }],
    },
  ],
});

// ---------- two effects, back on the orbit ----------
scenes.push({
  type: 'svg',
  chapter: 'Two effects',
  title: 'Gravity gains more than speed loses',
  picture: 'orbit',
  hidden: ['height', 'speed', 'lap', ...panel],
  labels: { gravity: 'gravity', speedLoss: 'moving clocks', lossValue: 'seven microseconds', net: 'together' },
  narration: 'So the satellite clocks must agree with the ground to within billionths of a second.',
  steps: [
    {
      focus: ['sat0', 'sat1', 'sat2', 'sat3'],
      say: 'And Einstein says they can’t, for two reasons that pull opposite ways.',
    },
    {
      show: ['gravity'],
      focus: ['gravity'],
      say: 'Clocks run faster where gravity is weaker. Twenty thousand kilometres up, that makes the satellite clock gain about forty six microseconds a day.',
    },
    {
      show: ['speedLoss', 'lossValue'],
      focus: ['speedLoss', 'lossValue'],
      say: 'Moving clocks run slower. At almost four kilometres a second, that costs it about seven microseconds a day.',
    },
    {
      show: ['net'],
      focus: ['net', 'gravity'],
      say: `Gravity wins. Together, the clock in orbit runs ahead by ${fmt(total)} microseconds every day.`,
    },
  ],
});

// ---------- the curve: microseconds a day gained by a clock on a circular orbit of radius x thousand km ----------
const gx = (x) => 130 + x * 21.5; // 0..45 thousand km → 130..1097.5
const gy = (y) => 50 + (60 - y) * 5.4; // -40..60 µs → 590..50
const curvePts = [];
for (let i = 0; i <= 120; i++) {
  const x = rMean / 1e6 + ((45 - rMean / 1e6) * i) / 120;
  curvePts.push(`${gx(x).toFixed(1)} ${gy(fx(x)).toFixed(1)}`);
}
const pt = (id, x, y, label, lx, ly, anchor, cls = '') =>
  `<g id="${id}"><circle cx="${gx(x).toFixed(1)}" cy="${gy(y).toFixed(1)}" r="10" ${cls || 'fill="var(--text)"'}/><text x="${(gx(x) + lx).toFixed(1)}" y="${(gy(y) + ly).toFixed(1)}" text-anchor="${anchor}" font-size="26" ${cls}>${label}</text></g>`;
const curveSvg = `<svg viewBox="0 0 1200 640">
<rect id="inside" x="${gx(0)}" y="${gy(60)}" width="${(gx(rMean / 1e6) - gx(0)).toFixed(1)}" height="${gy(-40) - gy(60)}" fill="none" stroke="var(--muted)" stroke-width="2" stroke-dasharray="6 8"/>
<text x="${((gx(0) + gx(rMean / 1e6)) / 2).toFixed(1)}" y="${gy(-30)}" text-anchor="middle" font-size="22" fill="var(--muted)">Earth</text>
<line x1="${gx(0)}" y1="${gy(-40)}" x2="${gx(0)}" y2="${gy(60)}" stroke="var(--text)" stroke-width="3"/>
<line x1="${gx(0)}" y1="${gy(0)}" x2="${gx(45)}" y2="${gy(0)}" stroke="var(--text)" stroke-width="3"/>
${[-40, -20, 20, 40, 60].map((y) => `<text x="${gx(0) - 12}" y="${gy(y) + 8}" text-anchor="end" font-size="22" fill="var(--muted)">${y > 0 ? '+' : y < 0 ? '−' : ''}${Math.abs(y)}</text>`).join('')}
<text x="${gx(0) - 12}" y="${gy(0) + 8}" text-anchor="end" font-size="22" fill="var(--muted)">0</text>
${[10, 20, 30, 40].map((x) => `<text x="${gx(x)}" y="${gy(-40) + 30}" text-anchor="middle" font-size="22" fill="var(--muted)">${x}</text>`).join('')}
<text x="${gx(45)}" y="${gy(0) - 14}" text-anchor="end" font-size="22" fill="var(--muted)">thousand km from the centre</text>
<text x="${gx(rMean / 1e6) + 14}" y="${gy(60) + 22}" font-size="22" fill="var(--muted)">µs gained a day</text>
<path id="gain" d="M${curvePts.join(' L')}" fill="none" stroke="var(--text)" stroke-width="4"/>
${pt('iss', iss, fx(iss), `space station, −${fmt(-fx(iss))}`, 18, 8, 'start', 'class="tone-bad"')}
${pt('cross', cross, 0, `${N(cross * 1000)} km: they cancel`, 18, 40, 'start', 'class="tone-good"')}
${pt('gps', a / 1e6, total, `GPS, +${fmt(total)}`, 0, 46, 'middle', 'class="tone-bad"')}
${pt('geo', geo, fx(geo), `geostationary, +${fmt(fx(geo))}`, 0, -22, 'end', 'class="tone-bad"')}
</svg>`;
scenes.push({
  type: 'svg',
  chapter: 'It depends on height',
  title: 'Higher orbits gain, low ones lose',
  svg: curveSvg,
  narration: 'Which effect wins depends on how high the orbit is.',
  labels: { gain: 'curve', iss: 'space station', cross: 'cancel', gps: 'GPS', geo: 'further out' },
  hidden: ['gain', 'iss', 'cross', 'gps', 'geo'],
  steps: [
    {
      trace: ['gain'],
      focus: 'gain',
      say: 'Here is how much a clock gains each day against the ground, for an orbit of any size.',
    },
    {
      show: ['iss'],
      focus: ['iss'],
      say: `Close to the Earth, low orbits are fast, so speed wins. A clock on the space station loses about ${Math.round(-fx(iss))} microseconds a day.`,
    },
    {
      show: ['cross'],
      focus: ['cross'],
      say: 'At about nine and a half thousand kilometres from the centre, the two effects cancel exactly.',
    },
    {
      show: ['gps'],
      focus: ['gps'],
      say: 'GPS orbits much higher, so gravity wins, by thirty eight point six.',
    },
    {
      show: ['geo'],
      focus: ['geo', 'gain'],
      say: 'Further out the curve flattens, as both effects fade.',
    },
  ],
});

// ---------- the cost, back on the fix picture ----------
scenes.push({
  type: 'svg',
  chapter: 'The cost',
  title: 'Eleven kilometres off, every day',
  picture: 'fix',
  illustrative: true,
  narration: `Thirty eight microseconds sounds like nothing.`,
  labels: { dayRing: 'each day', weekRing: 'a week', here: 'next town' },
  hidden: ['late', 'dayRing', 'weekRing', 'miss'],
  steps: [
    {
      show: ['dayRing'],
      tint: { ring1: 'dim' },
      focus: ['dayRing'],
      say: `But light goes ${fmt(kmDay)} kilometres in that time. Every distance your phone measures would grow wrong by that much each day.`,
      draw: [{ write: `1 day: ${fmt(kmDay)} km off`, near: 'dayRing', side: 'below', tone: 'bad', when: 'each day' }],
    },
    {
      show: ['weekRing'],
      focus: ['weekRing', 'here'],
      say: `After a week, it is ${Math.round(kmWeek)} kilometres. The map would put you in the next town, then the next country.`,
      draw: [
        {
          write: `1 week: ${Math.round(kmWeek)} km`,
          near: 'weekRing',
          side: 'left',
          tone: 'bad',
          when: 'After a week',
        },
      ],
    },
  ],
});

// ---------- the fix: two clock faces whose hands sweep ----------
const face = (id, x, label) =>
  `<g id="${id}-face"><circle cx="${x}" cy="400" r="190" fill="none" stroke="var(--text)" stroke-width="5"/>${Array.from(
    { length: 12 },
    (_, i) => {
      const t = (i * Math.PI) / 6;
      return `<line x1="${(x + 168 * Math.sin(t)).toFixed(1)}" y1="${(400 - 168 * Math.cos(t)).toFixed(1)}" x2="${(x + 182 * Math.sin(t)).toFixed(1)}" y2="${(400 - 182 * Math.cos(t)).toFixed(1)}" stroke="var(--muted)" stroke-width="5"/>`;
    },
  ).join('')}<text x="${x}" y="660" text-anchor="middle" font-size="34">${label}</text></g>` +
  `<g id="${id}-hand"><line x1="${x}" y1="400" x2="${x}" y2="250" stroke="var(--text)" stroke-width="10" stroke-linecap="round"/><circle cx="${x}" cy="400" r="12" fill="var(--text)" stroke="none"/></g>`;
const clocksSvg =
  `<svg viewBox="0 0 ${W} 800">${face('ground', 420, 'clock on the ground')}${face('sat', 1180, 'clock in orbit')}` +
  `<text id="freq" x="1180" y="730" text-anchor="middle" font-size="30" font-family="mono" fill="var(--muted)">ticks 10.23 MHz</text>` +
  `<text id="ahead" x="1180" y="160" text-anchor="middle" font-size="30" class="tone-bad">ahead (drawn much bigger)</text>` +
  `</svg>`;
scenes.push({
  type: 'svg',
  chapter: 'The fix',
  title: 'Set it slow before launch',
  narration: 'So the engineers do something strange. They make the satellite clocks wrong on purpose.',
  svg: clocksSvg,
  labels: { 'sat-hand': 'satellite clock', 'ground-hand': 'ground clock', ahead: 'ahead' },
  hidden: ['ahead'],
  steps: [
    {
      move: { 'ground-hand': { to: 'rotate(360 420 400)' }, 'sat-hand': { to: 'rotate(400 1180 400)' } },
      show: ['ahead'],
      tint: { 'sat-hand': 'bad' },
      focus: ['sat-hand', 'ground-hand', 'ahead'],
      say: 'Tuned like the ground clock, the satellite clock creeps ahead, a little more every day.',
    },
    {
      move: { 'ground-hand': '', 'sat-hand': '' },
      hide: ['ahead'],
      tint: { 'sat-hand': 'clear' },
      set: { freq: `tuned to ${MHz} MHz` },
      focus: 'freq',
      say: 'So before launch, it is tuned a hair slow: four parts in ten billion.',
    },
    {
      move: { 'ground-hand': { to: 'rotate(360 420 400)' }, 'sat-hand': { to: 'rotate(360 1180 400)' } },
      set: { freq: 'seen from the ground: 10.23 MHz' },
      tint: { 'sat-hand': 'good', 'ground-hand': 'good' },
      focus: ['sat-hand', 'ground-hand', 'freq'],
      say: 'Up in orbit, relativity speeds it up by exactly that much, and seen from the ground it ticks in step.',
    },
  ],
});

// ---------- back on the orbit, every clock in step ----------
scenes.push({
  type: 'svg',
  chapter: 'The fix',
  title: 'Every clock in step, and you found',
  picture: 'orbit',
  hidden: ['height', 'speed', 'lap', ...panel],
  labels: { you: 'your phone', signals: 'signals', sat0: 'orbits', tuned: 'slow tuned clock' },
  narration: 'Every satellite in the ring carries the same slow tuned clock.',
  steps: [
    {
      show: ['signals', 'tuned'],
      tint: { sat0: 'good', sat1: 'good', sat2: 'good', sat3: 'good' },
      focus: ['sat0', 'sat1', 'sat2', 'sat3', 'signals', 'tuned'],
      say: 'Seen from the ground, they all tick in step.',
    },
    {
      focus: ['you', 'sat0'],
      say: 'Orbits are not perfect circles, so your phone adds one last small correction, up to about twenty three billionths of a second.',
      draw: [{ write: '+ up to 23 ns', near: 'you', side: 'right', tone: 'good', when: 'one last' }],
    },
    {
      focus: ['you'],
      say: 'Relativity is not just a theory here. It is in your pocket.',
      draw: [{ circle: 'you', tone: 'good', when: 'pocket' }],
    },
  ],
});

fs.writeFileSync(
  new URL('./storyboard.json', import.meta.url),
  JSON.stringify(
    {
      title: 'Why GPS needs relativity',
      subtitle: 'Clocks in orbit gain 38.6 microseconds a day, and how GPS cancels it',
      tones: { good: 'clocks in step with the ground', bad: 'time and distance gone wrong' },
      pictures: { orbit: orbitSvg, fix: fixSvg },
      scenes,
    },
    null,
    2,
  ) + '\n',
);
console.log({
  gain: fmt(gain, 2),
  loss: fmt(loss, 2),
  total: fmt(total, 3),
  kmDay: fmt(kmDay, 2),
  factory: factory.toFixed(5),
  cross: fmt(cross * 1000, 0),
  iss: fmt(fx(iss), 2),
  geo: fmt(fx(geo), 2),
  signalMs: fmt(signalMs, 1),
  height: fmt(height, 0),
});
