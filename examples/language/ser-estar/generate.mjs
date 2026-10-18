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
const TONE = { ser: 'accent', estar: 'warn' };

/** The tree the graph scene draws: is it where something is? Then an event takes ser and anything else estar. If not,
 * a state right now takes estar, and what something is takes ser. */
const decide = ({ where = false, event = false, now = false }) => (where ? (event ? 'ser' : 'estar') : now ? 'estar' : 'ser');

// Each sentence: its words around the verb, the verb, the person, what it says, and its English.
const S = (before, verb, person, after, facts, en) => ({ before, verb, person, after, facts, en });
const pairs = [
  { topic: 'Ana', a: S('Ana', 'ser', '3s', 'alta.', {}, 'Ana is tall.'), b: S('Ana', 'estar', '3s', 'cansada.', { now: true }, 'Ana is tired.') },
  { topic: 'The soup', a: S('La sopa', 'ser', '3s', 'de tomate.', {}, 'It is tomato soup.'), b: S('La sopa', 'estar', '3s', 'fría.', { now: true }, 'The soup is cold.') },
  { topic: 'Madrid', a: S('Madrid', 'ser', '3s', 'enorme.', {}, 'Madrid is huge.'), b: S('Madrid', 'estar', '3s', 'en España.', { where: true }, 'Madrid is in Spain.') },
  { topic: 'Today', a: S('Hoy', 'ser', '3s', 'lunes.', {}, 'Today is Monday.'), b: S('Hoy', 'estar', '3s', 'nublado.', { now: true }, 'It is cloudy today.') },
];
const party = S('La fiesta', 'ser', '3s', 'en mi casa.', { where: true, event: true }, 'The party is at my house.');
const keys = S('Las llaves', 'estar', '3p', 'en mi casa.', { where: true }, 'The keys are at my house.');
const talk = S('La conferencia', 'ser', '3s', 'en el Aula Magna.', { where: true, event: true }, 'The talk is in the main hall.');

for (const s of [...pairs.flatMap((p) => [p.a, p.b]), party, keys, talk]) {
  assert.equal(decide(s.facts), s.verb, `the tree picks ${s.verb} for "${s.before} ${FORMS[s.verb][s.person]} ${s.after}"`);
}
assert.deepEqual(pairs.map((p) => [p.a.verb, p.b.verb]), pairs.map(() => ['ser', 'estar']), 'ser on the left, estar on the right');

const form = (s) => FORMS[s.verb][s.person];
const marked = (s) => `${s.before} [**${form(s)}**]{${TONE[s.verb]}} ${s.after}`;
const spanish = (s) => `${s.before} ${form(s)} ${s.after}`;

// The same adjective with each verb, and what it means.
const shifts = [
  { word: 'aburrido', ser: 'boring', estar: 'bored' },
  { word: 'listo', ser: 'clever', estar: 'ready' },
  { word: 'rico', ser: 'rich', estar: 'tasty' },
];

// The svg scene: each sentence is three <text> pieces, so the pen can circle the verb (ink on a <tspan> id draws
// nothing). The verbs line up on the centre line, so only the verb's own width is estimated, at 0.56 em a letter.
const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const MID = 800;
const line = (s, id, y) => {
  const size = 60;
  const half = Math.round((form(s).length * 0.56 * size) / 2) + Math.round(size * 0.25);
  return (
    `<text id="${id}" x="${MID - half}" y="${y}" font-size="${size}" text-anchor="end">${esc(s.before)}</text>` +
    `<text id="${id}-verb" x="${MID}" y="${y}" font-size="${size}" text-anchor="middle" class="fill-${TONE[s.verb]}">${form(s)}</text>` +
    `<text id="${id}-after" x="${MID + half}" y="${y}" font-size="${size}">${esc(s.after)}</text>` +
    `<text id="${id}-en" x="${MID}" y="${y + 68}" font-size="30" text-anchor="middle" fill="var(--muted)">${esc(s.en)}</text>`
  );
};
const svg =
  '<svg viewBox="0 0 1600 760">' +
  `<g id="party">${line(party, 's1', 140)}</g>` +
  `<g id="keys">${line(keys, 's2', 330)}</g>` +
  `<g id="talk">${line(talk, 's3', 560)}<text id="source" x="800" y="690" font-size="26" text-anchor="middle" fill="var(--faint)">Example from the Real Academia Española, Nueva gramática §37.8f</text></g>` +
  '</svg>';

const scenes = [
  {
    type: 'text',
    chapter: 'Two verbs',
    narration: 'In English, "is" is just "is". In Spanish you have to choose between two verbs, and learners pick the wrong one all the time.',
    kicker: 'Spanish has two verbs for “is”',
    // A `question` lead draws a big question mark that lands on the right side's note, so the marks are typed.
    headline: '¿Es o está?',
    sides: [
      { label: 'ser', term: 'es', note: 'what something **is**', tone: TONE.ser },
      { label: 'estar', term: 'está', note: 'where it is, and how it is **right now**', tone: TONE.estar },
    ],
    hidden: ['left', 'right'],
    steps: [
      { show: ['left'], say: 'Es comes from the verb ser. It says what something is, and what it is like.' },
      { show: ['right'], say: 'Está comes from estar. It says where something is, and how it is right now.' },
    ],
  },
  {
    type: 'compare',
    chapter: 'Side by side',
    title: 'The same subject, both verbs',
    sides: [{ title: 'es · ser', tone: TONE.ser }, { title: 'está · estar', tone: TONE.estar }],
    narration: 'Listen to the same subject with each verb.',
    rows: pairs.map((p) => ({ label: p.topic, cells: [`${marked(p.a)} · ${p.a.en}`, `${marked(p.b)} · ${p.b.en}`] })),
    steps: [
      { focus: 0, say: `${spanish(pairs[0].a)} Ana is tall. That is what she is like. ${spanish(pairs[0].b)} Ana is tired. That is how she is right now.` },
      { focus: 1, say: 'The soup is tomato soup. That is what it is. But it is cold right now, so, está.' },
      { focus: 2, say: 'Madrid is huge, with es. But where Madrid is, in Spain, takes está. Even though it is never going to move.', draw: [{ box: '2@está · estar', when: 'never going to move' }] },
      { focus: 3, say: 'Today is Monday takes es: days and times are what something is. But the weather right now takes está.' },
    ],
  },
  {
    type: 'graph',
    chapter: 'The decision',
    title: 'Which verb?',
    narration: 'So here is the whole decision, as two questions.',
    nodes: [
      { id: 'start', label: 'A sentence with “is”', shape: 'step', caption: 'which verb?' },
      { id: 'where', label: 'Says where?', shape: 'decision' },
      { id: 'event', label: 'An event?', shape: 'decision' },
      { id: 'now', label: 'How it is right now?', shape: 'decision' },
      { id: 'ser-event', label: 'es · where it happens', shape: 'terminal', tone: TONE.ser },
      { id: 'estar-place', label: 'está · where it is', shape: 'terminal', tone: TONE.estar },
      { id: 'estar-now', label: 'está · a state', shape: 'terminal', tone: TONE.estar },
      { id: 'ser-is', label: 'es · what it is', shape: 'terminal', tone: TONE.ser },
    ],
    edges: [
      { from: 'start', to: 'where' },
      { from: 'where', to: 'event', label: 'yes' },
      { from: 'where', to: 'now', label: 'no' },
      { from: 'event', to: 'ser-event', label: 'yes' },
      { from: 'event', to: 'estar-place', label: 'no' },
      { from: 'now', to: 'estar-now', label: 'yes' },
      { from: 'now', to: 'ser-is', label: 'no' },
    ],
    steps: [
      { focus: ['start', 'where', 'where->now', 'now', 'now->ser-is', 'ser-is'], callout: marked(pairs[0].a), say: 'Ana is tall. It does not say where, and it is not a passing state. So, es.' },
      { focus: ['now', 'now->estar-now', 'estar-now'], callout: marked(pairs[0].b), say: 'Ana is tired. That is how she is right now. Está.' },
      { focus: ['where', 'where->event', 'event', 'event->estar-place', 'estar-place'], callout: marked(pairs[2].b), say: 'Madrid is in Spain. It says where, and Madrid is a place, not an event. Está.' },
      { focus: ['event', 'event->ser-event', 'ser-event'], callout: marked(party), say: 'But this last branch is the one that trips everybody up.' },
    ],
  },
  {
    type: 'svg',
    chapter: 'The trap',
    title: 'Where a party is',
    narration: 'Here is the trap. Both of these sentences say where something is.',
    svg,
    labels: { party: 'the party', keys: 'the keys', talk: 'the talk' },
    hidden: ['talk'],
    steps: [
      { focus: 'keys', say: 'The keys are at my house. Keys are things, and where a thing is takes estar. Están.', draw: [{ circle: 's2-verb', when: 'Están' }, { write: 'a thing: where it is', near: 's2-after', side: 'right', when: 'where a thing' }] },
      { focus: 'party', say: 'The party is at my house. A party is not a thing sitting somewhere. It is an event, so where it happens takes ser. Es.', draw: [{ circle: 's1-verb', when: 'Es.' }, { write: 'an event: where it happens', near: 's1-after', side: 'right', when: 'where it happens' }] },
      { show: ['talk'], focus: 'talk', camera: 'talk', say: 'The Royal Spanish Academy gives this example. The talk is in the main hall. It means the talk takes place there, so it is es.', draw: [{ circle: 's3-verb', when: 'takes place' }] },
      { camera: 'all', focus: ['s1-verb', 's3-verb'], say: 'So if you could swap in "takes place", use es.' },
    ],
  },
  {
    type: 'compare',
    chapter: 'Same word',
    title: 'One adjective, two meanings',
    sides: [{ title: 'with es', tone: TONE.ser }, { title: 'with está', tone: TONE.estar }],
    narration: 'And sometimes the verb changes what the word means.',
    rows: shifts.map((s) => ({ label: s.word, cells: [`[**es**]{${TONE.ser}} ${s.word} · ${s.ser}`, `[**está**]{${TONE.estar}} ${s.word} · ${s.estar}`] })),
    steps: [
      { focus: 0, say: `Es aburrido means he is ${shifts[0].ser}. Está aburrido means he is ${shifts[0].estar}. Not the same thing at all.` },
      { focus: 1, say: `Es listo, he is ${shifts[1].ser}. Está listo, he is ${shifts[1].estar}.` },
      { focus: 2, say: `And es rico is ${shifts[2].ser}. But say the food está rica, and you mean it is ${shifts[2].estar}.`, draw: [{ underline: '2@with está', when: 'it is tasty' }] },
    ],
  },
  {
    type: 'text',
    chapter: 'Recap',
    narration: 'So, four things to keep in your head.',
    kicker: '¿Es o está?',
    headline: 'Ask two questions',
    items: [
      '[**es**]{accent}: what it is, what it is like, days and times',
      '[**es**]{accent}: where an event happens',
      '[**está**]{warn}: where a thing or a person is',
      '[**está**]{warn}: how it is right now',
    ],
    hidden: ['0-3'],
    steps: [
      { show: [0], say: 'Es for what something is, what it is like, and days and times.', draw: [{ tick: 0 }] },
      { show: [1], say: 'Es for where an event happens.', draw: [{ tick: 1 }] },
      { show: [2], say: 'Está for where a thing or a person is.', draw: [{ tick: 2 }] },
      { show: [3], say: 'And está for how it is right now. That covers almost every sentence you will meet.', draw: [{ tick: 3 }] },
    ],
  },
];

fs.writeFileSync(
  new URL('./storyboard.json', import.meta.url),
  JSON.stringify({ title: 'Ser or estar', subtitle: 'Two Spanish verbs for “is”, and the two questions that pick one', scenes }, null, 2) + '\n',
);
