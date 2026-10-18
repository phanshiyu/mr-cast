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

const assert = (ok, msg) => { if (!ok) throw new Error(msg); };
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
const offset = (r) => -3 * GM / (2 * r * c * c) - phi0;
const net = offset(a);
near(-3 * GM / (2 * a * c * c), -2.5046e-10, 0.00005e-10, 'Ashby eq. 35, orbit term');
near(-net, -4.4647e-10, 0.00005e-10, 'Ashby eq. 35, net offset');

// The two halves the story tells: weaker gravity (the clock gains) and speed (it loses). The ground's spin is a
// speed too, so it moves from the geoid potential into the speed half. The halves add up to the net exactly.
const spin = (omega * aEq) ** 2 / (2 * c * c);
const gravityPart = -phi0 - spin - GM / (a * c * c);
const speedPart = -GM / (2 * a * c * c) + spin;
near(gravityPart + speedPart, net, 1e-24, 'the halves add up');
const perDay = (f) => f * day * us; // microseconds a day
const gain = perDay(gravityPart), loss = -perDay(speedPart), total = perDay(net);
near(gain, 45.7, 0.05, 'gravity gain, µs a day');
near(loss, 7.1, 0.05, 'speed loss, µs a day');
near(total, 38.6, 0.05, 'net gain, µs a day');
const r1 = (x) => Math.round(x * 10) / 10;
assert(r1(gain) - r1(loss) === r1(total), 'the rounded figures add up on screen');

// What it costs: light covers c × 38.6 µs in a day, and the error adds up day after day.
const kmDay = total / us * c / 1000;
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
const period = 2 * Math.PI * Math.sqrt(a ** 3 / GM) / 3600;
near(period, 11.97, 0.01, 'period, hours');
const signalMs = height * 1000 / c * 1000;
assert(Math.round(signalMs) === 67, 'signal time straight down');

// The plot: µs a day gained by a clock on a circular orbit of radius x thousand km, against the ground.
const A = -phi0 * day * us, B = 3 * GM / (2 * c * c) * day * us / 1e6;
const fx = (x) => A - B / x;
near(fx(a / 1e6), total, 1e-9, 'plot formula matches');
const cross = B / A; // thousand km
near(cross * 1000, 9545, 1, 'Ashby: the effects cancel at 9545 km');
const iss = (rMean + 420_000) / 1e6, geo = 42.164; // geostationary radius 42,164 km
near(fx(iss), -24.4, 0.1, 'a station clock loses');
near(fx(geo), 46.6, 0.1, 'a geostationary clock gains');

const fmt = (x, d = 1) => x.toFixed(d);
const N = (n) => Math.round(n).toLocaleString('en-US');

const scenes = [];

scenes.push({
  type: 'text',
  chapter: 'The question',
  narration: 'Here is a question that sounds too simple. Put a perfect clock on a satellite, and another on the ground. Do they keep the same time?',
  kicker: 'Why GPS needs relativity',
  question: 'Does a clock in orbit keep the same time as one on the ground?',
  note: 'Most people say yes. A good clock is a good clock.',
  steps: [
    { set: { note: 'They don’t. And if nobody fixed it, GPS would stop working within a day.' }, say: 'Most people say yes. They don’t, and if nobody fixed it, your map would be useless within a day.' },
  ],
});

// Scene 1: the Earth and a ring of satellites, drawn to scale.
const W = 1600, H = 900, cx = 800, cy = 450;
const re = 84, ro = Math.round(re * a / rMean); // px
assert(ro === 350, 'orbit drawn to scale');
const sats = [-52, -18, 18, 52]; // degrees from straight up, all above the receiver's horizon
const rx = cx, ry = cy - re; // the receiver, on top of the Earth
for (const d of sats) assert(ro * Math.cos(d * Math.PI / 180) > re, `satellite at ${d}° is above the horizon`);
const satAt = (d) => [cx + ro * Math.sin(d * Math.PI / 180), cy - ro * Math.cos(d * Math.PI / 180)];
const satShape = (id, [x, y]) => `<g id="${id}"><rect x="${x - 48}" y="${y - 10}" width="32" height="20" class="tone-accent"/><rect x="${x + 16}" y="${y - 10}" width="32" height="20" class="tone-accent"/><rect x="${x - 15}" y="${y - 15}" width="30" height="30" rx="5" fill="var(--warn)" stroke="none"/></g>`;
const orbitSvg = `<svg viewBox="${cx - ro - 60} ${cy - ro - 50} ${2 * ro + 520} ${2 * ro + 100}">`
  + `<circle id="orbit" cx="${cx}" cy="${cy}" r="${ro}" fill="none" stroke="var(--border)" stroke-width="3" stroke-dasharray="10 12"/>`
  + `<g id="earth"><circle cx="${cx}" cy="${cy}" r="${re}" fill="var(--accent)" stroke="none" opacity="0.6"/><path d="M${cx - 52} ${cy - 30} q30 -26 60 -6 q20 18 -6 34 q-26 12 -40 34 q-20 -30 -14 -62 Z" fill="var(--good)" stroke="none" opacity="0.7"/><path d="M${cx + 20} ${cy + 18} q30 -10 44 14 q-10 30 -40 30 q-14 -20 -4 -44 Z" fill="var(--good)" stroke="none" opacity="0.7"/></g>`
  + `<circle id="you" cx="${rx}" cy="${ry}" r="6" fill="var(--bad)" stroke="none"/><text id="you-label" x="${rx}" y="${ry - 12}" text-anchor="middle" font-size="16">you</text>`
  + `<text id="earth-label" x="${cx}" y="${cy + re + 28}" text-anchor="middle" font-size="30" fill="var(--muted)">Earth</text>`
  + `<g id="signals" class="flow" stroke="var(--warn)" stroke-width="3">${sats.map((d) => { const [x, y] = satAt(d); return `<line x1="${x.toFixed(1)}" y1="${(y + 12).toFixed(1)}" x2="${rx}" y2="${ry - 4}"/>`; }).join('')}</g>`
  + sats.map((d, i) => satShape(`sat${i}`, satAt(d))).join('')
  + `<text id="height" x="${cx + ro + 40}" y="${cy - 30}" font-size="36">${N(Math.round(height / 100) * 100)} km up</text>`
  + ` <text id="speed" x="${cx + ro + 40}" y="${cy + 20}" font-size="32" fill="var(--muted)">${fmt(v / 1000, 2)} km a second</text>`
  + `<text id="lap" x="${cx + ro + 40}" y="${cy + 66}" font-size="32" fill="var(--muted)">once round in 11 h 58 min</text>`
  + `</svg>`;
assert(Math.round(period * 60) === 718, 'once round in 11 h 58 min');
scenes.push({
  type: 'svg',
  chapter: 'The satellites',
  title: 'A ring of clocks, 20,200 km up',
  narration: 'Start with your phone, sitting on the ground.',
  svg: orbitSvg,
  labels: { you: 'phone', orbit: 'ring', sat0: 'satellite', signals: 'signal', earth: 'Earth' },
  hidden: ['you-label', 'orbit', 'sat0', 'sat1', 'sat2', 'sat3', 'signals', 'height', 'speed', 'lap'],
  steps: [
    { camera: { on: 'you', zoom: 5 }, show: ['you-label'], focus: 'you', say: 'Your phone has no idea where it is. It has to be told.' },
    { camera: 'all', hide: ['you-label'], show: ['orbit', 'sat0', 'sat1', 'sat2', 'sat3', 'height'], focus: ['orbit', 'height'], say: 'Twenty thousand kilometres up, a ring of satellites circles the planet. The drawing is to scale.' },
    { move: { sat1: `rotate(360 ${cx} ${cy})` }, show: ['speed', 'lap'], focus: ['sat1', 'speed', 'lap'], say: 'Each one moves at almost four kilometres a second, and goes all the way round in just under twelve hours.' },
    { show: ['signals'], focus: ['sat0', 'sat1', 'sat2', 'sat3', 'signals', 'you'], callout: `the signal takes ${Math.round(signalMs)} ms to arrive`, say: 'Every satellite carries an atomic clock, and keeps sending out the time. The signal takes about a fifteenth of a second to reach you.' },
  ],
});

// Scene 2: distance from time, and what a late clock does to it. Circles in a plane, not to scale.
const rcv = [800, 560];
const S = [[560, 420], [820, 300], [1060, 430]];
const dist = S.map(([x, y]) => Math.hypot(x - rcv[0], y - rcv[1]));
const late = 56; // px, the drawn size of the error, much bigger than to scale
const circle = (id, [x, y], r, extra) => `<circle id="${id}" cx="${x}" cy="${y}" r="${r.toFixed(1)}" fill="none" ${extra}/>`;
const fixSvg = `<svg viewBox="200 0 1200 ${H}">`
  + S.map((p, i) => circle(`ring${i}`, p, dist[i], 'stroke="var(--accent)" stroke-width="4"')).join('')
  + circle('late', S[1], dist[1] + late, 'stroke="var(--bad)" stroke-width="4" stroke-dasharray="14 10"')
  + S.map(([x, y], i) => `<g id="s${i}"><circle cx="${x}" cy="${y}" r="16" fill="var(--warn)" stroke="none"/><text x="${x}" y="${y - 28}" text-anchor="middle" font-size="30">satellite ${i + 1}</text></g>`).join('')
  + `<g id="here"><circle cx="${rcv[0]}" cy="${rcv[1]}" r="12" fill="var(--bad)" stroke="none"/><text x="${rcv[0]}" y="${rcv[1] + 52}" text-anchor="middle" font-size="30">you are here</text></g>`
  + `<text id="miss" x="${rcv[0]}" y="${rcv[1] + 240}" text-anchor="middle" font-size="30" fill="var(--bad)">one clock 1 µs late: 300 m out</text>`
  + `</svg>`;
scenes.push({
  type: 'svg',
  chapter: 'Time is distance',
  title: 'How a phone finds itself',
  narration: 'Your phone compares the time in each signal with when it arrived. The gap, times the speed of light, is how far away that satellite is.',
  svg: fixSvg,
  labels: { ring0: 'first circle', ring1: 'second circle', ring2: 'third circle', here: 'one point', late: 'late clock', miss: 'three hundred metres' },
  hidden: ['ring0', 'ring1', 'ring2', 'late', 'here', 'miss'],
  steps: [
    { trace: [{ ref: 'ring0', when: 'somewhere' }], focus: ['s0', 'ring0'], say: 'One distance puts you somewhere on a circle around the first satellite.' },
    { trace: ['ring1', 'ring2'], focus: ['ring1', 'ring2'], say: 'A second and a third circle cross at just one point.' },
    { show: ['here'], focus: 'here', callout: 'a fourth satellite fixes your phone’s own clock', say: 'That point is you. Out in three dimensions, a fourth satellite also corrects the cheap clock in your phone.' },
    { trace: ['late'], show: ['miss'], tint: { ring1: 'dim' }, focus: ['late', 'miss'], callout: `light: ${Math.round(mPerUs)} m every microsecond`, say: 'Now make one satellite’s clock a millionth of a second late. Light goes three hundred metres in that time, so that circle lands three hundred metres off, and the crossing point moves.' },
  ],
});

scenes.push({
  type: 'chart',
  chapter: 'Two effects',
  title: 'What one day does to an orbiting clock',
  kind: 'bar',
  horizontal: true,
  unit: 'µs',
  narration: 'So the satellite clocks must agree with the ground to within billionths of a second. And Einstein says they can’t, for two reasons that pull opposite ways.',
  labels: ['gains: weaker gravity', 'loses: its speed', 'net: ahead each day'],
  series: [{ name: 'microseconds a day', values: [0, 0, 0] }],
  steps: [
    { set: { 'microseconds a day@gains: weaker gravity': r1(gain) }, say: `Clocks run faster where gravity is weaker. Twenty thousand kilometres up, that makes the satellite clock gain about forty six microseconds a day.` },
    { set: { 'microseconds a day@loses: its speed': r1(loss) }, say: 'Moving clocks run slower. At almost four kilometres a second, that costs it about seven microseconds a day.' },
    { set: { 'microseconds a day@net: ahead each day': r1(total) }, say: `Gravity wins. Together, the clock in orbit runs ahead by ${fmt(total)} microseconds every day.` },
  ],
});

scenes.push({
  type: 'plot',
  chapter: 'It depends on height',
  title: 'Time gained each day, by orbit',
  narration: 'Which effect wins depends on how high the orbit is. These axes show how much a clock gains each day against the ground, for an orbit of any size.',
  x: { from: 0, to: 45, ticks: 10, label: 'distance from Earth’s centre, thousand km' },
  y: { from: -40, to: 60, ticks: 20, label: 'µs a day', grid: true },
  params: { r: iss },
  functions: [{ id: 'gain', y: `${A.toFixed(4)} - ${B.toFixed(4)} / x`, from: rMean / 1e6, to: 45, tone: 'accent', hidden: true }],
  points: [
    { id: 'iss', at: [r1(iss * 10) / 10, r1(fx(iss))], label: `space station, ${fmt(fx(iss))}`, side: 'right', tone: 'bad', hidden: true },
    { id: 'cross', at: [r1(cross * 10) / 10, 0], label: `${N(cross * 1000)} km: they cancel`, side: 'above', hidden: true },
    { id: 'gps', at: [a / 1e6, r1(total)], label: `GPS, +${fmt(total)}`, side: 'below', tone: 'warn', hidden: true },
    { id: 'geo', at: [geo, r1(fx(geo))], label: `geostationary, +${fmt(fx(geo))}`, side: 'below', hidden: true },
    { id: 'clock', at: ['r', `${A.toFixed(4)} - ${B.toFixed(4)} / r`], guides: true, tone: 'accent', hidden: true },
  ],
  steps: [
    { trace: ['gain'], focus: 'gain', say: 'Close to the Earth the curve is below zero. Low orbits are fast, so speed wins and the clock falls behind.' },
    { show: ['iss', 'clock'], focus: ['iss', 'clock'], say: `A clock on the space station loses about ${Math.round(-fx(iss))} microseconds a day.` },
    { set: { r: cross }, show: ['cross'], focus: ['cross', 'clock'], say: 'At about nine and a half thousand kilometres from the centre, the two effects cancel exactly.' },
    { set: { r: a / 1e6 }, show: ['gps'], focus: ['gps', 'clock'], say: 'GPS orbits much higher, so gravity wins, by thirty eight point six.' },
    { set: { r: geo }, show: ['geo'], focus: ['geo', 'clock'], say: 'Further out the curve flattens, as both effects fade.' },
  ],
});

scenes.push({
  type: 'text',
  chapter: 'The cost',
  narration: 'Thirty eight microseconds sounds like nothing.',
  kicker: 'Uncorrected, every day',
  number: `${fmt(total)} µs`,
  note: 'gained by each satellite clock',
  steps: [
    { set: { number: `${fmt(kmDay)} km`, note: 'how far light goes in that time' }, say: `But light goes ${fmt(kmDay)} kilometres in that time. Every distance your phone measures would grow wrong by that much each day.` },
    { set: { number: `${Math.round(kmWeek)} km`, note: 'after one week' }, say: `After a week, it is ${Math.round(kmWeek)} kilometres. The map would put you in the next town, then the next country.` },
  ],
});

// Scene 6: the fix. Two clock faces whose hands sweep; the satellite's would run ahead without the offset.
const face = (id, x, label) => `<g id="${id}-face"><circle cx="${x}" cy="400" r="190" fill="var(--surface)" stroke="var(--border)" stroke-width="5"/>${Array.from({ length: 12 }, (_, i) => { const t = i * Math.PI / 6; return `<line x1="${(x + 168 * Math.sin(t)).toFixed(1)}" y1="${(400 - 168 * Math.cos(t)).toFixed(1)}" x2="${(x + 182 * Math.sin(t)).toFixed(1)}" y2="${(400 - 182 * Math.cos(t)).toFixed(1)}" stroke="var(--muted)" stroke-width="5"/>`; }).join('')}<text x="${x}" y="660" text-anchor="middle" font-size="34">${label}</text></g>`
  + `<g id="${id}-hand"><line x1="${x}" y1="400" x2="${x}" y2="250" stroke="var(--${id === 'sat' ? 'warn' : 'accent'})" stroke-width="10" stroke-linecap="round"/><circle cx="${x}" cy="400" r="12" fill="var(--text)" stroke="none"/></g>`;
const clocksSvg = `<svg viewBox="0 0 ${W} 800">${face('ground', 420, 'clock on the ground')}${face('sat', 1180, 'clock in orbit')}`
  + `<text id="freq" x="1180" y="720" text-anchor="middle" font-size="30" font-family="mono" fill="var(--muted)">ticks 10.23 MHz</text>`
  + `<text id="ahead" x="1180" y="160" text-anchor="middle" font-size="28" fill="var(--bad)">ahead (drawn much bigger)</text>`
  + `</svg>`;
scenes.push({
  type: 'svg',
  chapter: 'The fix',
  title: 'Set it slow before launch',
  narration: 'So the engineers do something strange. They make the satellite clocks wrong on purpose.',
  svg: clocksSvg,
  labels: { 'sat-hand': 'satellite clock', 'ground-hand': 'ground clock', freq: 'frequency', ahead: 'ahead' },
  hidden: ['ahead'],
  steps: [
    { move: { 'ground-hand': 'rotate(360 420 400)', 'sat-hand': 'rotate(400 1180 400)' }, show: ['ahead'], focus: ['sat-hand', 'ground-hand', 'ahead'], say: 'Tuned like the ground clock, the satellite clock creeps ahead, a little more every day.' },
    { move: { 'ground-hand': '', 'sat-hand': '' }, hide: ['ahead'], set: { freq: 'tuned to 10.229 999 995 43 MHz' }, focus: 'freq', say: 'So before launch, it is tuned a hair slow: four parts in ten billion.' },
    { move: { 'ground-hand': 'rotate(360 420 400)', 'sat-hand': 'rotate(360 1180 400)' }, set: { freq: 'seen from the ground: 10.23 MHz' }, focus: ['sat-hand', 'ground-hand', 'freq'], say: 'Up in orbit, relativity speeds it up by exactly that much, and seen from the ground it ticks in step.' },
    { callout: 'receivers add the rest: up to 23 ns', focus: 'sat-face', say: 'Orbits are not perfect circles, so your phone adds one last small correction, up to about twenty three billionths of a second. Relativity is not just a theory here. It is in your pocket.' },
  ],
});

fs.writeFileSync(new URL('./storyboard.json', import.meta.url), JSON.stringify({ title: 'Why GPS needs relativity', subtitle: 'Clocks in orbit gain 38.6 microseconds a day, and how GPS cancels it', scenes }, null, 2) + '\n');
console.log({ gain: fmt(gain, 2), loss: fmt(loss, 2), total: fmt(total, 3), kmDay: fmt(kmDay, 2), factory: factory.toFixed(5), cross: fmt(cross * 1000, 0), iss: fmt(fx(iss), 2), geo: fmt(fx(geo), 2), signalMs: fmt(signalMs, 1), height: fmt(height, 0) });
