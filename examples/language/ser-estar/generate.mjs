// Writes storyboard.json beside this file, then runs every example sentence through the decision tree the video draws
// and checks it picks the verb the sentence uses. Run: node examples/language/ser-estar/generate.mjs
//
// The rules follow the Real Academia Española:
//   Where someone or something is takes estar ("El jefe está en la oficina"), and estar means "hallarse en un
//   determinado lugar, tiempo, situación o circunstancia": Nueva gramática §37.8, and the Diccionario panhispánico de
//   dudas, "estar": https://www.rae.es/dpd/estar
//   Where an event takes place takes ser, which alternates with "tener lugar": "La conferencia es en el Aula Magna"
//   (Nueva gramática §37.8f, §37.8g):
//   https://www.rae.es/gramática/sintaxis/el-atributo-en-las-oraciones-copulativas-con-ser-y-estar-ii-polémicas-relativas-a-los-atributos-locativos
// rae.es refuses automated fetches, so these were read from the pages' search excerpts on 2026-10-18. The adjectives
// that change meaning (aburrido, listo, rico) are standard textbook grammar and were not checked against the RAE.
// A native speaker should read the sentences before this is quoted.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const FORMS = { ser: { '3s': 'es', '3p': 'son' }, estar: { '3s': 'está', '3p': 'están' } };
const TONE = { ser: 'good', estar: 'bad' };

/** The tree the graph scene draws: is it where something is? Then an event takes ser and anything else estar. If not,
 * a state right now takes estar, and what something is takes ser. */
const decide = ({ where = false, event = false, now = false }) =>
  where ? (event ? 'ser' : 'estar') : now ? 'estar' : 'ser';

// Each sentence: its words around the verb, the verb, the person, what it says, and its English.
const S = (before, verb, person, after, facts, en) => ({ before, verb, person, after, facts, en });
const pairs = [
  {
    topic: 'Ana',
    a: S('Ana', 'ser', '3s', 'alta.', {}, 'Ana is tall.'),
    b: S('Ana', 'estar', '3s', 'cansada.', { now: true }, 'Ana is tired.'),
  },
  {
    topic: 'The soup',
    a: S('La sopa', 'ser', '3s', 'de tomate.', {}, 'It is tomato soup.'),
    b: S('La sopa', 'estar', '3s', 'fría.', { now: true }, 'The soup is cold.'),
  },
  {
    topic: 'Madrid',
    a: S('Madrid', 'ser', '3s', 'enorme.', {}, 'Madrid is huge.'),
    b: S('Madrid', 'estar', '3s', 'en España.', { where: true }, 'Madrid is in Spain.'),
  },
  {
    topic: 'Today',
    a: S('Hoy', 'ser', '3s', 'lunes.', {}, 'Today is Monday.'),
    b: S('Hoy', 'estar', '3s', 'nublado.', { now: true }, 'It is cloudy today.'),
  },
];
const party = S('La fiesta', 'ser', '3s', 'en mi casa.', { where: true, event: true }, 'The party is at my house.');
const keys = S('Las llaves', 'estar', '3p', 'en mi casa.', { where: true }, 'The keys are at my house.');
const talk = S(
  'La conferencia',
  'ser',
  '3s',
  'en el Aula Magna.',
  { where: true, event: true },
  'The talk is in the main hall.',
);

for (const s of [...pairs.flatMap((p) => [p.a, p.b]), party, keys, talk]) {
  assert.equal(
    decide(s.facts),
    s.verb,
    `the tree picks ${s.verb} for "${s.before} ${FORMS[s.verb][s.person]} ${s.after}"`,
  );
}
assert.deepEqual(
  pairs.map((p) => [p.a.verb, p.b.verb]),
  pairs.map(() => ['ser', 'estar']),
  'ser on the left, estar on the right',
);

const form = (s) => FORMS[s.verb][s.person];
const spanish = (s) => `${s.before} ${form(s)} ${s.after}`;

// The same adjective with each verb, and what it means.
const shifts = [
  { word: 'aburrido', ser: 'boring', estar: 'bored' },
  { word: 'listo', ser: 'clever', estar: 'ready' },
  { word: 'rico', ser: 'rich', estar: 'tasty' },
];

const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const text = (x, y, size, body, extra = '') =>
  `<text x="${x}" y="${y}" font-size="${size}" text-anchor="middle"${extra}>${body}</text>`;
const verb = (s, id = '') => `<tspan${id ? ` id="${id}"` : ''} class="fill-${TONE[s.verb]}">${form(s)}</tspan>`;

// Scenes 0 and 5: the two verbs side by side, and the four rules written under them at the end.
const two =
  '<svg viewBox="0 0 1200 640">' +
  text(600, 70, 52, '¿Es o está?') +
  '<line x1="600" y1="120" x2="600" y2="620" stroke="var(--muted)" stroke-width="3"/>' +
  `<g id="left">${text(300, 200, 72, 'es', ' class="fill-good"')}${text(300, 250, 28, 'from ser', ' fill="var(--muted)"')}${text(300, 310, 30, 'what something is')}</g>` +
  `<g id="right">${text(900, 200, 72, 'está', ' class="fill-bad"')}${text(900, 250, 28, 'from estar', ' fill="var(--muted)"')}${text(900, 310, 30, 'where it is, and how it is right now')}</g>` +
  `<g id="r0">${text(300, 420, 28, 'what it is, what it is like,')}${text(300, 458, 28, 'days and times')}</g>` +
  `<g id="r1">${text(300, 560, 28, 'where an event happens')}</g>` +
  `<g id="r2">${text(900, 420, 28, 'where a thing or a person is')}</g>` +
  `<g id="r3">${text(900, 560, 28, 'how it is right now')}</g>` +
  '</svg>';

// Scene 1: each subject with both verbs, ser on the left and estar on the right.
const pairY = (k) => 150 + k * 122;
const sentence = (s, id, x, y) =>
  `<g id="${id}">${text(x, y, 36, `${esc(s.before)} ${verb(s)} ${esc(s.after)}`)}${text(x, y + 38, 24, esc(s.en), ' fill="var(--muted)"')}</g>`;
const pairsSvg =
  '<svg viewBox="0 0 1200 640">' +
  text(300, 60, 32, 'es · ser', ' class="fill-good"') +
  text(900, 60, 32, 'está · estar', ' class="fill-bad"') +
  '<line x1="600" y1="30" x2="600" y2="620" stroke="var(--muted)" stroke-width="3"/>' +
  pairs.map((p, k) => sentence(p.a, `a${k}`, 300, pairY(k)) + sentence(p.b, `b${k}`, 900, pairY(k))).join('') +
  '</svg>';

// Scene 2: the decision as two questions.
const diamond = (id, x, y, label) =>
  `<g id="${id}"><polygon points="${x},${y - 50} ${x + 150},${y} ${x},${y + 50} ${x - 150},${y}" stroke-width="3"/>${text(x, y + 9, 26, label)}</g>`;
const edge = (id, x1, y1, x2, y2, label) =>
  `<g id="${id}"><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--text)" stroke-width="3"/>${label ? text((x1 + x2) / 2 + (x2 < x1 ? -30 : 30), (y1 + y2) / 2, 24, label, ' fill="var(--muted)"') : ''}</g>`;
const leaf = (id, x, verbWord, what, tone) =>
  `<g id="${id}"><rect x="${x - 135}" y="510" width="270" height="96" rx="14" class="tone-${tone}" stroke-width="3"/>${text(x, 550, 32, verbWord)}${text(x, 586, 24, what)}</g>`;
const tree =
  '<svg viewBox="0 0 1200 640">' +
  edge('e-start', 600, 70, 600, 140) +
  edge('e-where-event', 500, 212, 330, 290, 'yes') +
  edge('e-where-now', 700, 212, 870, 290, 'no') +
  edge('e-event-ser', 260, 380, 160, 510, 'yes') +
  edge('e-event-estar', 340, 380, 440, 510, 'no') +
  edge('e-now-estar', 860, 380, 760, 510, 'yes') +
  edge('e-now-ser', 940, 380, 1040, 510, 'no') +
  `<g id="start"><rect x="390" y="10" width="420" height="60" rx="12" stroke-width="3"/>${text(600, 50, 28, 'A sentence with “is”', ' id="case"')}</g>` +
  diamond('where', 600, 190, 'Says where?') +
  diamond('event', 300, 330, 'An event?') +
  diamond('now', 900, 330, 'Right now?') +
  leaf('ser-event', 150, 'es', 'where it happens', TONE.ser) +
  leaf('estar-place', 450, 'está', 'where it is', TONE.estar) +
  leaf('estar-now', 750, 'está', 'a state', TONE.estar) +
  leaf('ser-is', 1050, 'es', 'what it is', TONE.ser) +
  '</svg>';

// Scene 3: each sentence is one <text>, its verb and the words after it tspans the pen can circle and write beside.
const MID = 800;
const line = (s, id, y) =>
  `<text id="${id}" x="${MID}" y="${y}" font-size="60" text-anchor="middle">${esc(s.before)} ${verb(s, `${id}-verb`)} <tspan id="${id}-after">${esc(s.after)}</tspan></text>` +
  `<text id="${id}-en" x="${MID}" y="${y + 68}" font-size="32" text-anchor="middle" fill="var(--muted)">${esc(s.en)}</text>`;
const trap =
  '<svg viewBox="0 0 1600 760">' +
  `<g id="party">${line(party, 's1', 140)}</g>` +
  `<g id="keys">${line(keys, 's2', 330)}</g>` +
  `<g id="talk">${line(talk, 's3', 560)}<text id="source" x="800" y="690" font-size="30" text-anchor="middle" fill="var(--muted)">Example from the Real Academia Española, Nueva gramática §37.8f</text></g>` +
  '</svg>';

// Scene 4: one adjective, a meaning with each verb.
const shiftY = (k) => 170 + k * 170;
const shiftsSvg =
  '<svg viewBox="0 0 1200 640">' +
  text(300, 60, 32, 'with es', ' class="fill-good"') +
  text(900, 60, 32, 'with está', ' class="fill-bad"') +
  '<line x1="600" y1="30" x2="600" y2="620" stroke="var(--muted)" stroke-width="3"/>' +
  shifts
    .map(
      (w, k) =>
        `<g id="es${k}">${text(300, shiftY(k), 40, `<tspan class="fill-good">es</tspan> ${w.word}`)}${text(300, shiftY(k) + 50, 32, w.ser, ' fill="var(--muted)"')}</g>` +
        `<g id="esta${k}">${text(900, shiftY(k), 40, `<tspan class="fill-bad">está</tspan> ${w.word}`)}${text(900, shiftY(k) + 50, 32, `<tspan id="m${k}">${w.estar}</tspan>`, ' fill="var(--muted)"')}</g>`,
    )
    .join('') +
  '</svg>';

const pairSteps = [
  [
    `${spanish(pairs[0].a)} Ana is tall. That is what she is like.`,
    `${spanish(pairs[0].b)} Ana is tired. That is how she is right now.`,
  ],
  ['The soup is tomato soup. That is what it is.', 'But it is cold right now, so, está.'],
  ['Madrid is huge, with es.', 'But where Madrid is, in Spain, takes está. Even though it is never going to move.'],
  ['Today is Monday takes es: days and times are what something is.', 'But the weather right now takes está.'],
];

const scenes = [
  {
    type: 'svg',
    chapter: 'Two verbs',
    title: 'Spanish has two verbs for “is”',
    picture: 'two',
    narration:
      'In English, "is" is just "is". In Spanish you have to choose between two verbs, and learners pick the wrong one all the time.',
    hidden: ['left', 'right', 'r0', 'r1', 'r2', 'r3'],
    labels: { left: 'ser', right: 'estar' },
    steps: [
      {
        show: ['left'],
        focus: 'left',
        say: 'Es comes from the verb ser. It says what something is, and what it is like.',
      },
      {
        show: ['right'],
        focus: 'right',
        say: 'Está comes from estar. It says where something is, and how it is right now.',
      },
    ],
  },
  {
    type: 'svg',
    chapter: 'Side by side',
    title: 'The same subject takes both verbs',
    svg: pairsSvg,
    narration: 'Listen to the same subject with each verb.',
    hidden: pairs.flatMap((_, k) => [`a${k}`, `b${k}`]),
    labels: {
      a0: 'Ana es alta',
      b0: 'Ana está cansada',
      a1: 'tomato',
      b1: 'cold',
      a2: 'huge',
      b2: 'in Spain',
      a3: 'Monday',
      b3: 'weather',
    },
    steps: pairSteps.flatMap(([sayA, sayB], k) => [
      { show: [`a${k}`], focus: `a${k}`, say: sayA },
      {
        show: [`b${k}`],
        focus: `b${k}`,
        say: sayB,
        ...(k === 2 ? { draw: [{ box: 'b2', when: 'never going to move' }] } : {}),
      },
    ]),
  },
  {
    type: 'svg',
    chapter: 'The decision',
    title: 'Two questions pick the verb',
    svg: tree,
    narration: 'So here is the whole decision, as two questions.',
    labels: {
      where: 'say where',
      now: 'passing state',
      'estar-now': 'right now',
      'ser-is': 'es',
      'estar-place': 'a place',
      event: 'not an event',
      'ser-event': 'last branch',
    },
    steps: [
      {
        set: { case: spanish(pairs[0].a) },
        focus: ['start', 'where', 'e-where-now', 'now', 'e-now-ser', 'ser-is'],
        say: 'Ana is tall. It does not say where, and it is not a passing state. So, es.',
      },
      {
        set: { case: spanish(pairs[0].b) },
        focus: ['now', 'e-now-estar', 'estar-now'],
        say: 'Ana is tired. That is how she is right now. Está.',
      },
      {
        set: { case: spanish(pairs[2].b) },
        focus: ['where', 'e-where-event', 'event', 'e-event-estar', 'estar-place'],
        say: 'Madrid is in Spain. It says where, and Madrid is a place, not an event. Está.',
      },
      {
        set: { case: spanish(party) },
        focus: ['event', 'e-event-ser', 'ser-event'],
        say: 'But this last branch is the one that trips everybody up.',
        draw: [{ circle: 'ser-event', when: 'trips' }],
      },
    ],
  },
  {
    type: 'svg',
    chapter: 'The trap',
    title: 'Where a party is takes es',
    narration: 'Here is the trap. Both of these sentences say where something is.',
    svg: trap,
    labels: { party: 'the party', keys: 'the keys', talk: 'the talk' },
    hidden: ['talk'],
    steps: [
      {
        focus: 'keys',
        say: 'The keys are at my house. Keys are things, and where a thing is takes estar. Están.',
        draw: [
          { circle: 's2-verb', when: 'Están' },
          { write: 'a thing: where it is', near: 's2-after', side: 'right', when: 'where a thing' },
        ],
      },
      {
        focus: 'party',
        say: 'The party is at my house. A party is not a thing sitting somewhere. It is an event.',
        draw: [{ write: 'an event: where it happens', near: 's1-after', side: 'right', when: 'an event' }],
      },
      {
        focus: 's1-verb',
        say: 'So where it happens takes ser. Es.',
        draw: [{ circle: 's1-verb', when: 'Es.' }],
      },
      {
        show: ['talk'],
        focus: 'talk',
        camera: 'talk',
        say: 'The Royal Spanish Academy gives this example. The talk is in the main hall.',
      },
      {
        focus: 's3-verb',
        say: 'It means the talk takes place there, so it is es.',
        draw: [{ circle: 's3-verb', when: 'takes place' }],
      },
      { camera: 'all', focus: ['s1-verb', 's3-verb'], say: 'So if you could swap in "takes place", use es.' },
    ],
  },
  {
    type: 'svg',
    chapter: 'Same word',
    title: 'The verb can change what a word means',
    svg: shiftsSvg,
    narration: 'And sometimes the verb changes what the word means.',
    hidden: shifts.flatMap((_, k) => [`es${k}`, `esta${k}`]),
    labels: {
      es0: 'es aburrido',
      esta0: 'está aburrido',
      es1: 'es listo',
      esta1: 'está listo',
      es2: 'es rico',
      esta2: 'food',
      m2: 'tasty',
    },
    steps: [
      {
        show: ['es0', 'esta0'],
        focus: ['es0', 'esta0'],
        say: `Es aburrido means he is ${shifts[0].ser}. Está aburrido means he is ${shifts[0].estar}. Not the same thing at all.`,
      },
      {
        show: ['es1', 'esta1'],
        focus: ['es1', 'esta1'],
        say: `Es listo, he is ${shifts[1].ser}. Está listo, he is ${shifts[1].estar}.`,
      },
      {
        show: ['es2', 'esta2'],
        focus: ['es2', 'esta2', 'm2'],
        say: `And es rico is ${shifts[2].ser}. But say the food está rica, and you mean it is ${shifts[2].estar}.`,
        draw: [{ underline: 'm2', when: 'it is tasty' }],
      },
    ],
  },
  {
    type: 'svg',
    chapter: 'Recap',
    title: 'Four things to keep in your head',
    picture: 'two',
    narration: 'So, four things to keep in your head.',
    hidden: ['r0', 'r1', 'r2', 'r3'],
    labels: { r0: 'days and times', r1: 'event happens', r2: 'a thing or a person', r3: 'right now' },
    steps: [
      {
        show: ['r0'],
        focus: 'r0',
        say: 'Es for what something is, what it is like, and days and times.',
        draw: [{ tick: 'r0' }],
      },
      { show: ['r1'], focus: 'r1', say: 'Es for where an event happens.', draw: [{ tick: 'r1' }] },
      { show: ['r2'], focus: 'r2', say: 'Está for where a thing or a person is.', draw: [{ tick: 'r2' }] },
      {
        show: ['r3'],
        focus: 'r3',
        say: 'And está for how it is right now. That covers almost every sentence you will meet.',
        draw: [{ tick: 'r3' }],
      },
    ],
  },
];

fs.writeFileSync(
  new URL('./storyboard.json', import.meta.url),
  JSON.stringify(
    {
      title: 'Ser or estar',
      subtitle: 'Two Spanish verbs for “is”, and the two questions that pick one',
      tones: { good: 'es, the verb ser', bad: 'está, the verb estar' },
      pictures: { two },
      scenes,
    },
    null,
    2,
  ) + '\n',
);
