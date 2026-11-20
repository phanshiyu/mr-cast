// Writes storyboard.json, hunks.json and meta.json beside this file. Softmax numbers are computed here. Token splits
// are read from facts.json, made with js-tiktoken 1.0.12: getEncoding('r50k_base') (the GPT-2 and GPT-3 tokenizer),
// then each text's encode() ids decoded one at a time. Run: node examples/explain/gpt/generate.mjs
import fs from 'node:fs';

const facts = JSON.parse(fs.readFileSync(new URL('./facts.json', import.meta.url), 'utf8'));
const f1 = (n) => n.toFixed(1);
const softmax = (z, T = 1) => {
  const e = z.map((v) => Math.exp(v / T));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / s);
};
const pct = (p) => (p < 0.0001 ? '<0.01%' : `${(p * 100).toFixed(p < 0.01 ? 2 : 1)}%`);
const num = (v) => v.toFixed(1).replace('-', '−');
const comma = (n) => n.toLocaleString('en-US');
const svg = (w, h, body) => `<svg viewBox="0 0 ${w} ${h}">${body}</svg>`;
const text = (x, y, s, size, extra = '') => `<text x="${f1(x)}" y="${f1(y)}" font-size="${size}" ${extra}>${s}</text>`;
const marker = (id, colour) =>
  `<marker id="${id}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="${colour}" stroke="none"/></marker>`;
const head = `<defs>${marker('head', 'var(--text)')}${marker('head-muted', 'var(--muted)')}</defs>`;

// ---------- scenes 0 and 1: the prompt as token cells, and the chance of each next token as a bar ----------
// next-token chances for the prompt: made-up numbers, for the shape of the idea
const next = [
  ['creature', 42],
  ['wizard', 18],
  ['king', 12],
  ['dragon', 8],
  ['girl', 5],
  ['every other token', 15],
];
if (next.reduce((s, [, p]) => s + p, 0) !== 100) throw new Error('next-token chances');
const barId = (name) => `bar-${name.split(' ')[0]}`;

function nextPicture(prompt) {
  const cell = (i) => [20 + (i % 8) * 146, 24 + Math.floor(i / 8) * 76];
  const word = (i, t) => {
    const [x, y] = cell(i);
    // the space a token starts with is a tspan, so ink can circle it
    const label = t.startsWith(' ') ? `<tspan id="sp${i}">·</tspan>${t.slice(1)}` : t;
    return text(x + 70, y + 39, label, 24, 'text-anchor="middle" font-family="mono"');
  };
  const box = (i, extra = '') => {
    const [x, y] = cell(i);
    return `<rect id="c${i}" x="${x}" y="${y}" width="140" height="58" rx="10" stroke-width="3"${extra}/>`;
  };
  const words = prompt.map((t, i) => word(i, t)).join('');
  const cells = prompt.map((_, i) => box(i)).join('');
  const bar = ([name, p], k) => {
    const y = 214 + k * 68;
    const w = p * 18;
    return `<g id="${barId(name)}">${text(300, y + 34, name, 26, 'text-anchor="end"')}<rect x="320" y="${y}" width="${w}" height="48" rx="6" stroke-width="3"/>${text(320 + w + 14, y + 34, `${p}%`, 24)}</g>`;
  };
  return svg(
    1200,
    640,
    `<g id="cells">${cells}</g><g id="words">${words}</g>
<g id="tok-pick">${box(14)}${word(14, ' creature')}</g>
<g id="tok-next">${box(15)}${word(15, '?')}</g>
${next.map(bar).join('')}`,
  );
}

// ---------- scenes 2 and 9: the trip from text to chances, six stops down the board ----------
const stops = [
  ['s-tok', 'Tokenizer', 'cuts text into tokens', `"tokenization" → ${facts.tokens.tokenization.join(' | ')}`],
  ['s-emb', 'Embedding', 'looks up a list of numbers per token', 'king → [0.12, −0.83, 0.40, …]'],
  ['s-att', 'Attention', 'lets tokens share meaning', 'machine learning model ≠ fashion model'],
  ['s-mlp', 'MLP', 'works on each token on its own', 'every token, in parallel'],
  ['s-unemb', 'Unembedding', 'scores every token it knows', '50,257 scores'],
  ['s-soft', 'Softmax', 'turns scores into chances', 'creature 42%, wizard 18%, …'],
];
const stopY = (k) => 20 + k * 102;
function tripPicture() {
  const stop = ([id, name, action, payload], k) => {
    const y = stopY(k);
    const link = k
      ? `<line x1="210" y1="${y - 38}" x2="210" y2="${y - 4}" stroke="var(--text)" stroke-width="3" marker-end="url(#head)"/>`
      : '';
    return `<g id="${id}">${link}<rect x="90" y="${y}" width="240" height="64" rx="12" stroke-width="3"/>${text(210, y + 42, name, 28, 'text-anchor="middle"')}${text(370, y + 26, action, 24)}${text(370, y + 58, payload, 22, 'font-family="mono" fill="var(--muted)"')}</g>`;
  };
  const [ya, ym] = [stopY(2) + 32, stopY(3) + 32];
  return svg(
    1200,
    640,
    `${head}${stops.map(stop).join('')}
<path id="loop" d="M90,${ym} C30,${ym} 30,${ya} 86,${ya}" fill="none" stroke="var(--text)" stroke-width="3" marker-end="url(#head)"/>
<path id="again" d="M210,${stopY(5) + 64} V630 H1170 V6 H210 V${stopY(0) - 4}" fill="none" stroke="var(--text)" stroke-width="3" stroke-dasharray="12 8" marker-end="url(#head)"/>`,
  );
}

// ---------- scene 3: rules a person writes, against numbers training tunes ----------
function rulesPicture() {
  const pts = [
    [680, 360],
    [740, 300],
    [790, 330],
    [850, 260],
    [900, 280],
    [960, 210],
    [1010, 230],
    [1070, 160],
    [1120, 175],
  ];
  const grid = [];
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++)
      grid.push(`<rect x="${700 + c * 40}" y="${470 + r * 34}" width="40" height="34" stroke-width="2"/>`);
  const col = (x) =>
    [0, 1, 2, 3].map((r) => `<rect x="${x}" y="${470 + r * 34}" width="40" height="34" stroke-width="2"/>`).join('');
  return svg(
    1200,
    640,
    `${text(300, 50, 'a program you write', 30, 'text-anchor="middle"')}${text(900, 50, 'a trained model', 30, 'text-anchor="middle"')}
<line x1="600" y1="20" x2="600" y2="620" stroke="var(--border)" stroke-width="2"/>
<g id="code">${text(60, 150, 'if (word === "king")', 26, 'font-family="mono"')}${text(92, 192, 'return "queen";', 26, 'font-family="mono"')}</g>
<g id="dots">${pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="7" fill="var(--text)"/>`).join('')}</g>
<line id="fit" x1="650" y1="380" x2="1150" y2="140" stroke="var(--text)" stroke-width="4"/>
${text(660, 150, 'y = m·x + b', 26, 'id="eq" font-family="mono"')}
${text(60, 300, 'rules you can read', 26, 'id="sizeL"')}${text(640, 420, '175 billion weights in GPT-3', 26, 'id="sizeR"')}
${text(60, 370, 'each run, the input changes', 26, 'id="runL"')}
<g id="loopsL">${text(60, 520, 'branches and loops', 26)}</g>
<g id="grid">${grid.join('')}${text(880, 552, '×', 34, 'text-anchor="middle"')}${col(920)}${text(1000, 552, '=', 34, 'text-anchor="middle"')}${col(1040)}
${text(780, 630, 'weights', 22, 'text-anchor="middle" fill="var(--muted)"')}${text(940, 630, 'text', 22, 'text-anchor="middle" fill="var(--muted)"')}</g>`,
  );
}

// ---------- scene 4: word vectors as points on a plane (a flat picture, not real coordinates) ----------
function wordPlot() {
  const P = {
    tower: [190, 130],
    skyscraper: [110, 200],
    spire: [290, 90],
    lighthouse: [280, 215],
    man: [470, 330],
    woman: [610, 250],
    king: [520, 470],
    queen: [660, 390],
    Japan: [860, 110],
    Germany: [1050, 160],
    sushi: [870, 290],
    bratwurst: [1060, 340],
    cat: [140, 420],
    cats: [260, 470],
    dog: [120, 500],
    dogs: [240, 550],
  };
  const dot = (id) =>
    `<g id="w-${id}"><circle cx="${P[id][0]}" cy="${P[id][1]}" r="9" fill="var(--text)"/>${text(P[id][0], P[id][1] - 20, id, 24, 'text-anchor="middle"')}</g>`;
  const trim = (a, b, r) => {
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const l = Math.hypot(dx, dy);
    return [a[0] + (dx / l) * r, a[1] + (dy / l) * r];
  };
  const arrow = (id, a, b, dash = '') => {
    const s0 = trim(P[a], P[b], 14),
      s1 = trim(P[b], P[a], 16);
    return `<line id="${id}" x1="${f1(s0[0])}" y1="${f1(s0[1])}" x2="${f1(s1[0])}" y2="${f1(s1[1])}" stroke="var(--text)" stroke-width="4" marker-end="url(#head)"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
  };
  const body = [
    head,
    `<g stroke="var(--border)" stroke-width="2"><line x1="40" y1="590" x2="1180" y2="590"/><line x1="40" y1="590" x2="40" y2="30"/></g>`,
    `<g id="tall">${['tower', 'skyscraper', 'spire', 'lighthouse'].map(dot).join('')}</g>`,
    `<g id="royal">${['man', 'woman', 'king', 'queen'].map(dot).join('')}</g>`,
    `<g id="food">${['Japan', 'Germany', 'sushi', 'bratwurst'].map(dot).join('')}</g>`,
    `<g id="plurals">${['cat', 'cats', 'dog', 'dogs'].map(dot).join('')}</g>`,
    `<g id="gender">${arrow('a-mw', 'man', 'woman')}${arrow('a-kq', 'king', 'queen', '10 7')}</g>`,
    `<g id="country">${arrow('a-jg', 'Japan', 'Germany')}${arrow('a-sb', 'sushi', 'bratwurst', '10 7')}</g>`,
    `<g id="plural">${arrow('a-cc', 'cat', 'cats')}${arrow('a-dd', 'dog', 'dogs', '10 7')}</g>`,
    text(1180, 625, 'a flat sketch of a 12,288-number space', 22, 'text-anchor="end" fill="var(--muted)"'),
  ].join('');
  return svg(1200, 640, body);
}

// ---------- scene 5: the token "king" rising through the layers, picking up meaning ----------
const RISE = [0, -180, -330, -520];
function layersPicture() {
  const lines = [560, 500, 440, 380, 320, 260, 200, 140]
    .map((y) => `<line x1="80" y1="${y}" x2="460" y2="${y}" stroke="var(--muted)" stroke-width="3"/>`)
    .join('');
  const note = (id, y, s) => text(560, y, s, 26, `id="${id}"`);
  return svg(
    1200,
    640,
    `${lines}${text(480, 568, 'layer 1', 22, 'fill="var(--muted)"')}${text(480, 148, 'layer 96', 22, 'fill="var(--muted)"')}
<g id="king"><rect x="200" y="584" width="140" height="48" rx="10" stroke-width="3"/>${text(270, 617, 'king', 26, 'text-anchor="middle" font-family="mono"')}</g>
${note('t0', 617, 'the word king')}${note('t1', 437, '+ a king of Scotland')}${note('t2', 287, '+ took the throne by murder')}${note('t3', 97, '+ old, poetic English')}`,
  );
}

// ---------- scene 6: the lookup table, the window, and the total ----------
const DIM = 12288;
const CTX = 2048;
const VOCAB = 50257;
function sizesPicture() {
  const cells = Array.from(
    { length: 22 },
    (_, i) => `<rect x="${260 + i * 40}" y="490" width="40" height="50" stroke-width="2"/>`,
  ).join('');
  return svg(
    1200,
    640,
    `<g id="dim">${text(700, 60, `${comma(DIM)} numbers per token`, 26, 'text-anchor="middle"')}<line x1="260" y1="76" x2="1140" y2="76" stroke="var(--muted)" stroke-width="3"/></g>
<g id="row"><rect x="260" y="150" width="880" height="44" rx="4" stroke-width="3"/>${text(280, 181, 'king', 24, 'font-family="mono"')}</g>
<g id="table"><rect x="260" y="96" width="880" height="350" rx="6" stroke-width="3"/>${text(130, 260, comma(VOCAB), 28, 'text-anchor="middle"')}${text(130, 296, 'tokens', 24, 'text-anchor="middle" fill="var(--muted)"')}
${text(700, 330, `${comma(VOCAB * DIM)} weights`, 30, 'text-anchor="middle"')}</g>
<g id="window">${cells}${text(130, 512, comma(CTX), 28, 'text-anchor="middle"')}${text(130, 546, 'at once', 24, 'text-anchor="middle" fill="var(--muted)"')}</g>
${text(700, 610, 'about 175,000,000,000 weights in all', 28, 'id="total" text-anchor="middle"')}`,
  );
}

// ---------- scenes 7 and 8: six scores, e to each, and the chances as bars that temperature reshapes ----------
const BAR_X = 600;
const BAR_SCALE = 5; // px per percent
const rowY = (k) => 160 + k * 72;
const barPath = (k, p) => `M${BAR_X},${rowY(k) - 30} H${f1(BAR_X + p * 100 * BAR_SCALE)} V${rowY(k) + 12} H${BAR_X} Z`;
function softmaxPicture(cands, e, sum, p1, temps, pT) {
  const tok = (k, t) =>
    t.startsWith(' ')
      ? text(40, rowY(k), `·<tspan id="tk${k}">${t.slice(1)}</tspan>`, 26, 'font-family="mono"')
      : text(40, rowY(k), t, 26, 'font-family="mono"');
  const rows = cands
    .map(
      ([t, z], k) =>
        `<g id="row${k}">${tok(k, t)}${text(330, rowY(k), num(z), 26, `id="z${k}" text-anchor="end"`)}${text(520, rowY(k), e[k].toFixed(2), 26, `id="e${k}" text-anchor="end"`)}<path id="b${k}" d="${barPath(k, p1[k])}" stroke-width="3"${k === 0 ? ' class="tone-good"' : ''}/>${text(1170, rowY(k), pct(p1[k]), 24, `id="p${k}" text-anchor="end"`)}</g>`,
    )
    .join('');
  const ghosts = temps
    .flatMap((T, j) => (T === 1 ? [] : cands.map((_, k) => `<path id="b${k}-t${j}" d="${barPath(k, pT[j][k])}"/>`)))
    .join('');
  const col = (x, s, a = 'end') => text(x, 96, s, 24, `text-anchor="${a}" fill="var(--muted)"`);
  return svg(
    1200,
    640,
    `${text(40, 40, 'Harry Potter’s least favourite teacher, Professor …', 26, 'fill="var(--muted)"')}
${col(40, 'next token', 'start')}<g id="zh">${col(330, 'score z')}</g><g id="eh">${col(520, 'e^z')}</g><g id="ph">${col(BAR_X, 'chance', 'start')}</g>
${rows}${ghosts}
<g id="total">${text(330, 610, 'total', 26, 'text-anchor="end" fill="var(--muted)"')}${text(520, 610, sum.toFixed(2), 26, 'text-anchor="end"')}</g>
${text(1160, 40, 'T = 1', 28, 'id="temp" text-anchor="end"')}`,
  );
}

function build() {
  // one prompt, tokenized by GPT-3's tokenizer: 14 tokens
  const prompt = facts.prompt;

  // the teacher example: six of the 50,257 scores, treated as if they were all of them
  const scores = [
    [' Snape', 4.2],
    [' Umbridge', 3.4],
    [' Quirrell', 2.9],
    [' Lockhart', 2.1],
    [' McGonagall', 1.6],
    [' banana', -3.0],
  ];
  const cands = scores.map(([name, z]) => [facts.tokens[name][0], z]);
  const z = cands.map((c) => c[1]);
  const e = z.map(Math.exp);
  const sum = e.reduce((a, b) => a + b, 0);
  const p1 = softmax(z, 1);
  const temps = [0.2, 1, 2];
  const pT = temps.map((T) => softmax(z, T));
  const zIds = cands.map((_, k) => `z${k}`);
  const eIds = cands.map((_, k) => `e${k}`);
  const pIds = cands.flatMap((_, k) => [`b${k}`, `p${k}`]);
  const atTemp = (j) => ({
    morph: Object.fromEntries(cands.map((_, k) => [`b${k}`, temps[j] === 1 ? `b${k}` : `b${k}-t${j}`])),
    set: { temp: `T = ${temps[j]}`, ...Object.fromEntries(cands.map((_, k) => [`p${k}`, pct(pT[j][k])])) },
  });
  const ghostIds = temps.flatMap((T, j) => (T === 1 ? [] : cands.map((_, k) => `b${k}-t${j}`)));

  const scenes = [
    {
      type: 'svg',
      chapter: 'One job',
      title: 'It guesses what comes next',
      picture: 'next',
      illustrative: true,
      hidden: ['cells', 'words', 'tok-pick', 'tok-next', ...next.map(([n]) => barId(n))],
      labels: { words: 'once upon a time', 'bar-every': 'every other piece of text' },
      narration: 'A GPT does one job. You give it some text, and it guesses what comes next.',
      steps: [
        {
          show: ['words'],
          focus: 'words',
          say: 'Here the text is: Once upon a time, in a land of math, there lived a.',
        },
        {
          show: ['bar-creature'],
          focus: 'bar-creature',
          say: "It doesn't give one answer. It gives a chance for every possible next piece. Creature gets forty two percent.",
        },
        {
          show: ['bar-wizard', 'bar-king', 'bar-dragon', 'bar-girl'],
          focus: ['bar-wizard', 'bar-king'],
          say: 'Wizard and king get less. These numbers are made up, but the shape is the real thing.',
        },
        { show: ['bar-every'], focus: 'bar-every', say: 'Every other piece of text it knows shares what is left.' },
      ],
    },
    {
      type: 'svg',
      chapter: 'One job',
      title: 'It adds one token at a time',
      picture: 'next',
      labels: { cells: 'tokens', sp1: 'space', 'tok-pick': 'creature', 'tok-next': 'after that' },
      narration: "The model doesn't see words. It sees pieces called tokens.",
      steps: [
        {
          show: ['cells'],
          focus: 'cells',
          say: 'This sentence is fourteen of them.',
          draw: [{ write: '14 tokens', near: 'c13', side: 'right', id: 'n14', when: 'fourteen' }],
        },
        {
          focus: ['c1', 'c2', 'c3', 'sp1'],
          say: 'Most common words are one token each, and the space in front of a word rides along with it.',
          draw: [{ circle: 'sp1', note: 'a space', when: 'the space' }],
        },
        {
          show: ['tok-pick'],
          tint: { 'tok-pick': 'good', 'bar-creature': 'good' },
          focus: 'tok-pick',
          erase: true,
          say: 'The model picks one next token by its chance, say creature, and adds it to the end.',
          draw: [{ arrow: ['bar-creature', 'tok-pick'], when: 'adds it' }],
        },
        {
          show: ['tok-next'],
          focus: 'tok-next',
          say: 'Then it runs again on the longer text to guess the next one. Token after token, a whole story comes out.',
          draw: [{ write: 'run again on all 15 tokens', near: 'tok-next', side: 'below', when: 'runs again' }],
        },
      ],
    },
    {
      type: 'svg',
      chapter: 'Inside the model',
      title: 'Six stops from text to chances',
      picture: 'trip',
      hidden: [...stops.map((s) => s[0]), 'loop', 'again'],
      labels: {
        's-tok': 'cut',
        's-emb': 'list of numbers',
        's-att': 'talk to each other',
        's-mlp': 'same set of questions',
        loop: 'take turns',
        's-unemb': 'score',
        's-soft': 'chances',
      },
      narration: 'Here is the whole trip from text to chances, in six stops.',
      steps: [
        {
          show: ['s-tok'],
          focus: 's-tok',
          say: 'First the text is cut into tokens. A rare word gets split into smaller pieces.',
        },
        {
          show: ['s-emb'],
          focus: 's-emb',
          say: 'Each token is swapped for a long list of numbers that stands for its meaning, looked up in a big table.',
        },
        {
          show: ['s-att'],
          focus: 's-att',
          say: 'Then the tokens talk to each other. Model means something different after machine learning than after fashion.',
        },
        {
          show: ['s-mlp'],
          trace: [{ ref: 'loop', when: 'take turns' }],
          focus: ['s-mlp', 'loop'],
          say: "Next, each token's numbers go through the same set of questions. These two stops take turns, again and again.",
        },
        {
          show: ['s-unemb'],
          focus: 's-unemb',
          say: "At the end, the last token's numbers are turned into a score for every token the model knows.",
        },
        {
          show: ['s-soft'],
          focus: 's-soft',
          say: 'And one last step turns those scores into chances that add up to one hundred percent.',
        },
      ],
    },
    {
      type: 'svg',
      chapter: 'Inside the model',
      title: 'Not written rules, but learned numbers',
      svg: rulesPicture(),
      hidden: ['code', 'dots', 'fit', 'eq', 'sizeL', 'sizeR', 'runL', 'loopsL', 'grid'],
      labels: {
        code: 'rules',
        dots: 'training nudges',
        fit: 'line',
        eq: 'm x plus b',
        sizeR: 'hundred and seventy five billion',
        grid: 'grids',
      },
      narration: 'A normal program follows rules a person wrote. A model like this is mostly numbers that were tuned.',
      steps: [
        {
          show: ['code', 'dots'],
          focus: ['code', 'dots'],
          say: 'In a program, a person writes the rules. In a model, training nudges numbers called weights until the guesses get good.',
        },
        {
          show: ['eq'],
          trace: [{ ref: 'fit', when: 'finds' }],
          focus: ['eq', 'fit'],
          say: 'Think of a line, y equals m x plus b. Training finds good values for m and b.',
          draw: [{ write: 'm and b are learned', near: 'fit', side: 'below', when: 'good values' }],
        },
        {
          show: ['sizeL', 'sizeR'],
          erase: true,
          focus: 'sizeR',
          say: 'Now scale that up. GPT-3 has a hundred and seventy five billion of those numbers.',
        },
        {
          show: ['runL'],
          set: { sizeR: '175 billion weights, fixed once trained' },
          focus: ['sizeR', 'runL'],
          say: 'Once training is done, the weights stay fixed. Only your text changes from run to run.',
        },
        {
          show: ['loopsL', 'grid'],
          focus: 'grid',
          say: "Almost all the work is multiplying grids of weights by your text's numbers. Graphics chips are very good at that.",
        },
      ],
    },
    {
      type: 'svg',
      chapter: 'Meaning as a place',
      title: 'Close meanings sit close together',
      svg: wordPlot(),
      illustrative: true,
      labels: {
        tall: 'tower skyscraper spire lighthouse',
        royal: 'man woman king queen',
        food: 'sushi bratwurst Japan Germany',
        plurals: 'plural',
        gender: 'step',
        country: 'step',
        plural: 'direction',
      },
      hidden: ['gender', 'country', 'plural'],
      narration: "Each token's list of numbers is a point in a huge space. GPT-3 uses 12,288 numbers per token.",
      steps: [
        {
          focus: ['tall'],
          say: 'Words with close meanings end up close together. Near tower you find skyscraper, spire and lighthouse.',
        },
        {
          show: ['gender'],
          focus: ['gender', 'royal'],
          say: 'Directions mean something too. The step from man to woman is about the same as the step from king to queen.',
          draw: [{ write: 'king + (woman − man) ≈ queen', near: 'w-queen', side: 'right', when: 'king to queen' }],
        },
        {
          show: ['country'],
          erase: true,
          focus: ['country', 'food'],
          say: 'Take sushi, add the step from Japan to Germany, and you land near bratwurst.',
          draw: [
            { write: 'sushi + (Germany − Japan)\n≈ bratwurst', near: 'w-bratwurst', side: 'below', when: 'land near' },
          ],
        },
        {
          show: ['plural'],
          focus: ['plural', 'plurals'],
          say: "There's even a direction for plural, from cat to cats.",
        },
        {
          focus: ['a-cc', 'a-dd'],
          erase: true,
          say: 'Multiply two lists number by number and add it all up. The total says how much they point the same way.',
          draw: [
            {
              write: 'a · b is big when a and b\npoint the same way',
              near: 'w-dogs',
              side: 'right',
              when: 'the total',
            },
          ],
        },
      ],
    },
    {
      type: 'svg',
      chapter: 'Meaning as a place',
      title: 'Context soaks into each token',
      svg: layersPicture(),
      illustrative: true,
      hidden: ['t1', 't2', 't3'],
      labels: { king: 'king', t1: 'Scotland', t2: 'murder', t3: 'poetry' },
      narration:
        "At first, a token's numbers only mean the word itself. As they pass through the layers, they soak up the text around them.",
      steps: [
        {
          focus: ['king', 't0'],
          say: 'Take the word king, in a play by Shakespeare. Before the first layer, king just means king.',
        },
        {
          move: { king: { to: `translate(0 ${RISE[1]})` } },
          show: ['t1'],
          focus: ['king', 't1'],
          say: 'A few layers in, it has picked up that this king rules Scotland.',
        },
        {
          move: { king: { to: `translate(0 ${RISE[2]})` } },
          show: ['t2'],
          focus: ['king', 't2'],
          say: 'Deeper still, it holds the story: he got the crown by murder.',
        },
        {
          move: { king: { to: `translate(0 ${RISE[3]})` } },
          show: ['t3'],
          focus: ['king', 't3'],
          say: "By the last of GPT-3's ninety six layers, it even knows the style is old poetry.",
        },
      ],
    },
    {
      type: 'svg',
      chapter: 'Meaning as a place',
      title: 'GPT-3 is big every way you measure it',
      svg: sizesPicture(),
      hidden: ['table', 'window', 'total'],
      labels: {
        dim: 'twelve thousand',
        row: 'token',
        window: 'two thousand and forty eight',
        table: 'lookup table',
        total: 'all in',
      },
      narration: "Here are a few of GPT-3's real sizes.",
      steps: [
        {
          focus: ['dim', 'row'],
          say: 'Every token is a list of twelve thousand two hundred and eighty eight numbers.',
        },
        {
          show: ['window'],
          focus: 'window',
          say: 'It can look at two thousand and forty eight tokens at once. Anything earlier falls out of view.',
          draw: [
            {
              write: `${comma(CTX)} × ${comma(DIM)} = ${comma(CTX * DIM)}`,
              near: 'window',
              side: 'below',
              when: 'at once',
            },
          ],
        },
        {
          show: ['table'],
          focus: 'table',
          erase: true,
          say: 'The lookup table has one row for each of the 50,257 tokens it knows. That alone is over six hundred million weights.',
        },
        { show: ['total'], focus: 'total', say: 'All in, about a hundred and seventy five billion.' },
      ],
    },
    {
      type: 'svg',
      chapter: 'Scores to chances',
      title: 'Softmax turns scores into chances',
      picture: 'softmax',
      hidden: [...zIds, ...eIds, ...pIds, 'zh', 'eh', 'ph', 'total', 'temp', ...ghostIds],
      labels: { zh: 'pretend', z5: 'minus three', eh: 'e', ph: 'hundred percent', b0: 'Snape', tk1: 'Umbridge' },
      narration:
        "Say the text is: Harry Potter's least favourite teacher, Professor. The model scores every possible next token.",
      steps: [
        {
          show: ['zh', ...zIds],
          focus: ['zh', 'z5'],
          say: "Here are six of those scores, and we'll pretend they're all there is. Banana gets minus three.",
        },
        {
          show: ['eh', ...eIds],
          focus: ['eh', ...eIds],
          say: 'Raise e to each score. Now every number is above zero, and big scores pull far ahead.',
          draw: [{ write: `e^4.2 = ${e[0].toFixed(2)}`, near: 'e0', side: 'above', when: 'pull far ahead' }],
        },
        {
          show: ['ph', 'total', ...pIds],
          erase: true,
          focus: ['ph', 'b0'],
          say: `Divide each by the total, ${sum.toFixed(2)}. Now they add up to one hundred percent. Snape gets ${Math.round(p1[0] * 100)} percent.`,
        },
        {
          focus: 'tk1',
          say: 'The second row is only the start of Umbridge. The rest of her name would come on the next turns.',
          draw: [{ underline: 'tk1', note: 'only “Um”: the rest comes next turn', when: 'only the start' }],
        },
      ],
    },
    {
      type: 'svg',
      chapter: 'Scores to chances',
      title: 'Temperature flattens or sharpens the chances',
      picture: 'softmax',
      labels: { temp: 'temperature', b0: 'Snape', row5: 'banana' },
      narration: "There's a dial called temperature. Each score is divided by it before softmax.",
      steps: [
        {
          show: ['temp'],
          ...atTemp(0),
          say: `Turn it down near zero, and the top token takes almost everything. Snape gets ${Math.round(pT[0][0] * 100)} percent. The text is safe and repetitive.`,
        },
        { ...atTemp(1), say: 'At one, you get the plain softmax from before. Writing is fluent and still varied.' },
        {
          ...atTemp(2),
          say: `Turn it up to two, and the chances flatten out. Snape drops to ${Math.round(pT[2][0] * 100)} percent.`,
        },
        {
          tint: { row5: 'bad' },
          focus: 'row5',
          say: 'Push it much higher, and odd picks like banana start to get chosen, and the text turns to nonsense.',
        },
      ],
    },
    {
      type: 'svg',
      chapter: 'The whole map',
      title: 'The whole trip, over and over',
      picture: 'trip',
      hidden: ['again'],
      labels: {
        's-tok': 'text becomes',
        's-emb': 'list of numbers',
        's-att': 'attention',
        's-mlp': 'MLP',
        loop: 'take turns',
        's-soft': 'chances',
        again: 'runs again',
      },
      narration: 'Here is the whole map once more.',
      steps: [
        { focus: ['s-tok', 's-emb'], say: 'Text becomes tokens, and each token becomes a list of numbers.' },
        {
          focus: ['s-att', 's-mlp', 'loop'],
          say: 'Attention and the MLP take turns, ninety six times in GPT-3.',
          draw: [{ write: '× 96', near: 'loop', side: 'left', when: 'ninety six' }],
        },
        {
          focus: ['s-unemb', 's-soft'],
          tint: { 's-soft': 'good' },
          say: 'Then the last list becomes scores, the scores become chances, and one token gets picked.',
        },
        {
          trace: [{ ref: 'again', when: 'joins' }],
          focus: 'again',
          say: 'The pick joins the text, and it all runs again.',
        },
        {
          tint: {
            's-tok': 'dim',
            's-emb': 'dim',
            's-mlp': 'dim',
            's-unemb': 'dim',
            's-soft': 'dim',
            again: 'dim',
            loop: 'dim',
          },
          focus: 's-att',
          say: 'The part that does the most clever work is attention. How tokens ask each other questions is a story for another video.',
          draw: [{ write: 'next: queries, keys, values', near: 's-att', side: 'right', when: 'clever' }],
        },
      ],
    },
  ];
  return {
    title: 'How a GPT picks the next word',
    subtitle: 'From text to tokens to chances, one token at a time',
    tones: { good: 'the token the model picks', bad: 'a pick that makes nonsense' },
    pictures: {
      next: nextPicture(prompt),
      trip: tripPicture(),
      softmax: softmaxPicture(cands, e, sum, p1, temps, pT),
    },
    scenes,
  };
}

const story = build();
fs.writeFileSync(new URL('./storyboard.json', import.meta.url), JSON.stringify(story, null, 2) + '\n');
fs.writeFileSync(new URL('./hunks.json', import.meta.url), '{}\n');
fs.writeFileSync(new URL('./meta.json', import.meta.url), '{ "mode": "explain" }\n');
