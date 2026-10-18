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
const pct = (p) => `${(p * 100).toFixed(p < 0.01 ? 2 : 1)}%`;
const num = (v) => v.toFixed(1).replace('-', '−');
const svg = (w, h, body) => `<svg viewBox="0 0 ${w} ${h}">${body}</svg>`;
const text = (x, y, s, size, extra = '') => `<text x="${f1(x)}" y="${f1(y)}" font-size="${size}" ${extra}>${s}</text>`;

// ---------- word vectors as points on a plane (a flat picture, not real coordinates) ----------
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
  const dot = (id, cls) =>
    `<g id="w-${id}" class="${cls}"><circle cx="${P[id][0]}" cy="${P[id][1]}" r="9"/>${text(P[id][0], P[id][1] - 20, id, 24, 'text-anchor="middle"')}</g>`;
  const trim = (a, b, r) => {
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const l = Math.hypot(dx, dy);
    return [a[0] + (dx / l) * r, a[1] + (dy / l) * r];
  };
  const arrow = (id, a, b, tone, dash = '') => {
    const s0 = trim(P[a], P[b], 14),
      s1 = trim(P[b], P[a], 16);
    return `<line id="${id}" x1="${f1(s0[0])}" y1="${f1(s0[1])}" x2="${f1(s1[0])}" y2="${f1(s1[1])}" stroke="var(--${tone})" stroke-width="4" marker-end="url(#head-${tone})"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
  };
  const marker = (tone) =>
    `<marker id="head-${tone}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--${tone})"/></marker>`;
  const body = [
    `<defs>${marker('accent')}${marker('good')}${marker('warn')}</defs>`,
    `<g stroke="var(--border)" stroke-width="2"><line x1="40" y1="590" x2="1180" y2="590"/><line x1="40" y1="590" x2="40" y2="30"/></g>`,
    `<g id="tall" class="tone-neutral">${['tower', 'skyscraper', 'spire', 'lighthouse'].map((w) => dot(w, 'tone-neutral')).join('')}</g>`,
    `<g id="royal">${['man', 'woman', 'king', 'queen'].map((w) => dot(w, 'tone-accent')).join('')}</g>`,
    `<g id="food">${['Japan', 'Germany', 'sushi', 'bratwurst'].map((w) => dot(w, 'tone-good')).join('')}</g>`,
    `<g id="plurals">${['cat', 'cats', 'dog', 'dogs'].map((w) => dot(w, 'tone-warn')).join('')}</g>`,
    `<g id="gender">${arrow('a-mw', 'man', 'woman', 'accent')}${arrow('a-kq', 'king', 'queen', 'accent', '10 7')}</g>`,
    `<g id="country">${arrow('a-jg', 'Japan', 'Germany', 'good')}${arrow('a-sb', 'sushi', 'bratwurst', 'good', '10 7')}</g>`,
    `<g id="plural">${arrow('a-cc', 'cat', 'cats', 'warn')}${arrow('a-dd', 'dog', 'dogs', 'warn', '10 7')}</g>`,
    text(1180, 30, 'a flat sketch of a 12,288-number space', 22, 'text-anchor="end" fill="var(--muted)"'),
  ].join('');
  return svg(1200, 610, body);
}

function build() {
  // one prompt, tokenized by GPT-3's tokenizer: 14 tokens
  const prompt = facts.prompt;
  const show = (t) => t.replace(/^ /, '·');
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

  const scenes = [
    {
      type: 'chart',
      kind: 'bar',
      chapter: 'One job',
      title: 'What comes next?',
      narration:
        'A GPT does one job. You give it some text, and it guesses what comes next. Here the text is: Once upon a time, in a land of math, there lived a.',
      unit: '%',
      labels: next.map((n) => n[0]),
      series: [{ name: 'chance', values: next.map((n) => n[1]) }],
      steps: [
        {
          focus: 'creature',
          say: "It doesn't give one answer. It gives a chance for every possible next piece of text. Creature gets forty two percent.",
        },
        {
          focus: ['wizard', 'king'],
          say: 'Wizard and king get less. These numbers are made up, but the shape is the real thing.',
        },
        { focus: 'every other token', say: 'Every other piece of text it knows shares what is left.' },
      ],
    },
    {
      type: 'array',
      chapter: 'One job',
      title: 'One piece at a time',
      narration: "The model doesn't see words. It sees pieces called tokens. This sentence is fourteen of them.",
      arrays: [
        { name: 'a', label: 'tokens 1 to 7', values: prompt.slice(0, 7).map(show) },
        { name: 'b', label: 'tokens 8 to 16', values: [...prompt.slice(7).map(show), '', ''] },
      ],
      indexes: false,
      callout: '`·` marks a space at the start of a token',
      steps: [
        {
          focus: ['array:a', 'b[0-6]'],
          say: 'Most common words are one token each, and the space in front of a word rides along with it.',
        },
        {
          set: { 'b[7]': show(' creature') },
          tint: { 'b[7]': 'good' },
          callout: 'pick one by its chance: `·creature`',
          say: 'The model picks one next token by its chance, say creature, and adds it to the end.',
        },
        {
          set: { 'b[8]': '?' },
          tint: { 'b[8]': 'warn' },
          callout: 'run again on all 15 tokens',
          say: "Then it runs again on the longer text to guess the token after that. Over and over, token after token. That's how a whole story comes out.",
        },
      ],
    },
    {
      type: 'flow',
      chapter: 'Inside the model',
      title: 'From text to chances',
      narration: 'Here is the whole trip from text to chances, in six stops.',
      steps: [
        {
          actor: 'Tokenizer',
          action: 'cuts text into tokens',
          payload: `"tokenization" → ${facts.tokens.tokenization.join(' | ')}`,
          icon: 'scissors',
          say: 'First the text is cut into tokens. A rare word gets split into smaller pieces.',
        },
        {
          actor: 'Embedding',
          action: 'looks up a list of numbers per token',
          payload: 'king → [0.12, −0.83, 0.40, …]',
          icon: 'table',
          say: 'Each token is swapped for a long list of numbers that stands for its meaning. The model looks it up in a big table.',
        },
        {
          actor: 'Attention',
          action: 'lets tokens share meaning',
          payload: 'machine learning model ≠ fashion model',
          icon: 'arrow-left-right',
          tone: 'accent',
          say: 'Then the tokens talk to each other. The word model means something different after machine learning than after fashion.',
        },
        {
          actor: 'MLP',
          action: 'works on each token on its own',
          payload: 'every token, in parallel',
          icon: 'cpu',
          tone: 'accent',
          say: "Next, each token's numbers go through the same set of questions, all at once. These two stops take turns, again and again.",
        },
        {
          actor: 'Unembedding',
          action: 'scores every token it knows',
          payload: '50,257 scores',
          icon: 'list-ordered',
          say: "At the end, the last token's numbers are turned into a score for every token the model knows.",
        },
        {
          actor: 'Softmax',
          action: 'turns scores into chances',
          payload: 'creature 42%, wizard 18%, …',
          icon: 'percent',
          tone: 'good',
          say: 'And one last step turns those scores into chances that add up to one hundred percent.',
        },
      ],
    },
    {
      type: 'compare',
      chapter: 'Inside the model',
      title: 'Written rules or learned numbers',
      narration:
        "A normal program follows rules a person wrote. A model like this has almost no hand written rules. It's mostly numbers that were tuned.",
      sides: [{ title: 'A program you write' }, { title: 'A trained model' }],
      rows: [
        {
          label: 'Who decides what it does',
          cells: ['A programmer writes rules', 'Training tunes numbers, called weights'],
        },
        {
          label: 'A tiny example',
          cells: [
            { code: 'if (word === "king")\n  return "queen";', lang: 'js' },
            { code: 'y = m * x + b\n// m and b are learned', lang: 'js' },
          ],
        },
        { label: 'How big', cells: ['Rules you can read', '175 billion weights in GPT-3'] },
        { label: 'What changes each run', cells: ['The input', 'Only your text: the weights stay fixed'] },
        { label: 'The work inside', cells: ['Branches and loops', 'Weights times your text, as big grids of numbers'] },
      ],
      steps: [
        {
          focus: 0,
          say: 'In a program, a person writes the rules. In a model, training nudges numbers called weights until the guesses get good.',
        },
        { focus: 1, say: 'Think of a line, y equals m x plus b. Training finds good values for m and b.' },
        { focus: 2, say: 'Now scale that up. GPT-3 has a hundred and seventy five billion of those numbers.' },
        { focus: 3, say: 'Once training is done, the weights stay fixed. Only your text changes from run to run.' },
        {
          focus: 4,
          say: "And almost all the work is multiplying grids of weights by your text's numbers. Graphics chips are very good at that.",
        },
      ],
    },
    {
      type: 'svg',
      chapter: 'Meaning as a place',
      title: 'Words as points',
      narration:
        "Each token's list of numbers is a point in a huge space. GPT-3 uses 12,288 numbers per token. Here is a flat sketch of the idea.",
      svg: wordPlot(),
      labels: {
        tall: 'tall buildings',
        royal: 'man woman king queen',
        food: 'sushi bratwurst Japan Germany',
        plurals: 'plural',
        gender: 'direction',
        country: 'direction',
        plural: 'direction',
      },
      hidden: ['gender', 'country', 'plural'],
      steps: [
        {
          focus: ['tall'],
          say: 'Words with close meanings end up close together. Near tower you find skyscraper, spire and lighthouse.',
        },
        {
          show: ['gender'],
          focus: ['gender', 'royal'],
          callout: 'king + (woman − man) ≈ queen',
          say: 'Directions mean something too. The step from man to woman is about the same as the step from king to queen.',
        },
        {
          show: ['country'],
          focus: ['country', 'food'],
          callout: 'sushi + (Germany − Japan) ≈ bratwurst',
          say: 'Take sushi, add the step from Japan to Germany, and you land near bratwurst.',
        },
        {
          show: ['plural'],
          focus: ['plural', 'plurals'],
          callout: 'a · b is big when a and b point the same way',
          say: "There's even a direction for plural. Multiply two lists number by number and add it all up, and the total tells you how much they point the same way.",
        },
      ],
    },
    {
      type: 'table',
      chapter: 'Meaning as a place',
      title: 'Context soaks in',
      narration:
        "At first, a token's numbers only mean the word itself. As they pass through the layers, they soak up the text around them. Take the word king in a play by Shakespeare.",
      columns: ['Where', 'What the numbers for "king" hold'],
      rows: [
        { cells: ['Before layer 1', 'the word king'] },
        { cells: ['A few layers in', 'a king of Scotland'], hidden: true },
        { cells: ['Deeper', 'a king of Scotland who took the throne by murder'], hidden: true },
        { cells: ['After layer 96', 'all that, plus: in old, poetic English'], hidden: true },
      ],
      steps: [
        { focus: 0, say: 'Before the first layer, king just means king.' },
        { show: [1], say: 'A few layers in, it has picked up that this king rules Scotland.' },
        { show: [2], say: 'Deeper still, it holds the story: he got the crown by murder.' },
        {
          show: [3],
          callout: 'GPT-3: 96 layers',
          say: "By the last of GPT-3's ninety six layers, it even knows the style is old poetry. This is a rough picture, not what the numbers literally say.",
        },
      ],
    },
    {
      type: 'table',
      chapter: 'Meaning as a place',
      title: 'GPT-3 by the numbers',
      narration: "Here are a few of GPT-3's real sizes.",
      columns: ['What', 'Size'],
      rows: [
        { cells: ['Numbers per token', '12,288'] },
        { cells: ['Tokens it can see at once', '2,048'] },
        { cells: ['Tokens it knows', '50,257'] },
        { cells: ['Weights in the lookup table', '617,558,016'] },
        { cells: ['Weights in all', 'about 175 billion'] },
      ],
      steps: [
        { focus: 0, say: 'Every token is a list of twelve thousand two hundred and eighty eight numbers.' },
        {
          focus: 1,
          callout: '2,048 × 12,288 = 25,165,824 numbers',
          say: 'It can look at two thousand and forty eight tokens at once. Anything earlier falls out of view.',
        },
        {
          focus: [2, 3],
          callout: '50,257 × 12,288 = 617,558,016',
          say: 'The lookup table has one row for each of the fifty thousand two hundred and fifty seven tokens it knows. That alone is over six hundred million weights.',
        },
        { focus: 4, say: 'All in, about a hundred and seventy five billion.' },
      ],
    },
    {
      type: 'table',
      chapter: 'Scores to chances',
      title: 'Softmax on six scores',
      narration:
        "Say the text is: Harry Potter's least favourite teacher, Professor. The model scores every possible next token. Here are six of those scores, and we'll pretend they're all there is.",
      columns: ['Next token', 'Score z', 'e^z', 'Chance'],
      rows: cands.map((c) => ({ cells: [`\`${show(c[0])}\``, num(c[1]), '', ''] })),
      steps: [
        { focus: 'col:Score z', say: 'Scores can be any size, even below zero. Banana gets minus three.' },
        {
          set: Object.fromEntries(cands.map((_, k) => [`e^z@${k}`, e[k].toFixed(2)])),
          callout: `e^4.2 = ${e[0].toFixed(2)}, e^−3 = ${e[5].toFixed(2)}`,
          say: 'Raise e to each score. Now every number is above zero, and big scores pull far ahead.',
        },
        {
          set: Object.fromEntries(cands.map((_, k) => [`Chance@${k}`, pct(p1[k])])),
          callout: `${e[0].toFixed(2)} ÷ ${sum.toFixed(2)} = ${pct(p1[0])}`,
          say: `Divide each by the total, ${sum.toFixed(2)}. Now they add up to one hundred percent. Snape gets ${Math.round(p1[0] * 100)} percent.`,
        },
        {
          focus: 1,
          tint: { 1: 'warn' },
          say: 'Notice the second row is only the start of Umbridge. The model picks one token at a time, so the rest of her name would come on the next turns.',
        },
      ],
    },
    {
      type: 'chart',
      kind: 'bar',
      chapter: 'Scores to chances',
      title: 'Temperature',
      narration:
        "There's a dial called temperature. Each score is divided by it before softmax. Here are the same six scores at three settings.",
      unit: '%',
      labels: cands.map((c) => show(c[0])),
      series: temps.map((T, k) => ({ name: `T = ${T}`, values: pT[k].map((p) => +(p * 100).toFixed(1)) })),
      steps: [
        {
          focus: 'series:T = 0.2',
          say: `Turn it down near zero, and the top token takes almost everything. Snape gets ${Math.round(pT[0][0] * 100)} percent. The text is safe and repetitive.`,
        },
        {
          focus: 'series:T = 1',
          say: 'At one, you get the plain softmax from before. Writing is fluent and still varied.',
        },
        {
          focus: 'series:T = 2',
          say: `Turn it up to two, and the chances flatten out. Snape drops to ${Math.round(pT[2][0] * 100)} percent. Push it much higher, and odd picks like banana start to get chosen, and the text turns to nonsense.`,
        },
      ],
    },
    {
      type: 'graph',
      chapter: 'The whole map',
      title: 'Everything in one picture',
      narration: 'Here is the whole map once more.',
      layout: 'TB',
      nodes: [
        { id: 'tok', label: 'Tokens', shape: 'step', caption: 'text cut into pieces' },
        { id: 'emb', label: 'Embedding', shape: 'step', caption: 'a list of numbers each' },
        { id: 'att', label: 'Attention', shape: 'step', caption: 'tokens share meaning', group: '96 layers' },
        { id: 'mlp', label: 'MLP', shape: 'step', caption: 'each token alone', group: '96 layers' },
        { id: 'unemb', label: 'Scores to chances', shape: 'step', caption: '50,257 scores, then a pick' },
      ],
      edges: [
        { from: 'tok', to: 'emb' },
        { from: 'emb', to: 'att' },
        { from: 'att', to: 'mlp' },
        { from: 'mlp', to: 'unemb' },
        { from: 'unemb', to: 'tok', label: 'add the pick, run again', style: 'dashed', hidden: true },
      ],
      steps: [
        { focus: ['tok', 'emb'], say: 'Text becomes tokens, and each token becomes a list of numbers.' },
        {
          focus: ['group:96 layers', 'att', 'mlp'],
          say: 'Attention and the MLP take turns, ninety six times in GPT-3.',
        },
        {
          focus: 'unemb',
          say: 'Then the last list becomes scores, the scores become chances, and one token gets picked.',
        },
        { show: ['unemb->tok'], focus: ['unemb->tok'], say: 'The pick joins the text, and it all runs again.' },
        {
          tint: { tok: 'dim', emb: 'dim', mlp: 'dim', unemb: 'dim', att: 'accent' },
          focus: 'att',
          callout: 'next: queries, keys, values and many heads',
          say: 'The part that does the most clever work is attention. How tokens ask each other questions is a story for another video.',
        },
      ],
    },
  ];
  return {
    title: 'How a GPT picks the next word',
    subtitle: 'From text to tokens to chances, one token at a time',
    scenes,
  };
}

const story = build();
fs.writeFileSync(new URL('./storyboard.json', import.meta.url), JSON.stringify(story, null, 2) + '\n');
fs.writeFileSync(new URL('./hunks.json', import.meta.url), '{}\n');
fs.writeFileSync(new URL('./meta.json', import.meta.url), '{ "mode": "explain" }\n');
