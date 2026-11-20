// Writes storyboard.json, hunks.json and meta.json beside this file. Run: node examples/architecture/react/generate.mjs
import fs from 'node:fs';

const FRAME_MS = +(1000 / 60).toFixed(1); // 16.7
const diffSteps = (1000 ** 3).toLocaleString('en-US'); // 1,000,000,000

// Scene 1: a browser window with its DOM tree, and one DOM node opened up.
const box = (id, x, y, w, label, extra = '') =>
  `<g id="${id}"><rect x="${x}" y="${y}" width="${w}" height="44" rx="8" ${extra}/><text x="${x + w / 2}" y="${y + 30}" text-anchor="middle" font-size="22" font-family="mono">${label}</text></g>`;
const lis = [0, 1, 2, 3, 4].map((i) => box(`li${i}`, 70 + i * 132, 470, 112, '&lt;li&gt;')).join('');
const liLines = [0, 1, 2, 3, 4].map((i) => `<line x1="400" y1="414" x2="${126 + i * 132}" y2="470"/>`).join('');
const dom = `<svg viewBox="0 0 1200 640">
<rect id="window" x="30" y="30" width="720" height="580" rx="16" stroke-width="3"/>
<line x1="30" y1="80" x2="750" y2="80" stroke="var(--border)" stroke-width="2"/>
<text x="390" y="63" text-anchor="middle" font-size="20" fill="var(--muted)">the page’s DOM tree</text>
<g id="reflow"><rect x="44" y="94" width="692" height="502" rx="10" class="tone-bad" stroke-width="3"/><text x="390" y="590" text-anchor="middle" font-size="24" class="tone-bad">Layout reflow and repaint</text></g>
<g stroke="var(--muted)" stroke-width="3"><line x1="390" y1="164" x2="390" y2="230"/><line x1="390" y1="274" x2="390" y2="370"/>${liLines}</g>
${box('body', 320, 120, 140, '&lt;body&gt;')}
${box('div', 320, 230, 140, '&lt;div&gt;')}
${box('ul', 300, 370, 180, '&lt;ul id=list&gt;')}
${lis}
<g id="code"><rect x="60" y="300" width="230" height="40" rx="8" class="tone-bad"/><text x="175" y="327" text-anchor="middle" font-size="18" font-family="mono">innerHTML = …</text></g>
<g id="node"><rect x="790" y="94" width="380" height="502" rx="16" stroke-width="3"/><text x="980" y="140" text-anchor="middle" font-size="26">One &lt;li&gt;, inside the browser</text>
<text x="820" y="200" font-size="22">• hundreds of properties</text>
<text x="820" y="250" font-size="22">• a style with hundreds of values</text>
<text x="820" y="300" font-size="22">• its event listeners</text>
<text x="820" y="350" font-size="22">• a layout box: x, y, width, height</text>
<text x="820" y="400" font-size="22">• links to parent and children</text>
<text x="820" y="450" font-size="22">• a place in the paint layers</text>
<text x="980" y="540" text-anchor="middle" font-size="22" fill="var(--muted)">heavy, and slow to change</text></g>
</svg>`;

// Scene 8: four fibers and their child, sibling and return links.
const node = (id, x, y, label) =>
  `<g id="${id}"><rect x="${x}" y="${y}" width="220" height="80" rx="14" stroke-width="3"/><text x="${x + 110}" y="${y + 50}" text-anchor="middle" font-size="28">${label}</text></g>`;
const wip = (id, x, y, x2, y2) =>
  `<g id="${id}"><rect x="${x}" y="${y}" width="200" height="40" rx="20" fill="var(--surface)" stroke="var(--accent)" stroke-width="3"/><text x="${x + 100}" y="${y + 27}" text-anchor="middle" font-size="20" font-family="mono" fill="var(--text)">workInProgress</text><line x1="${x2 > x ? x + 200 : x}" y1="${y + 20}" x2="${x2}" y2="${y2}" stroke="var(--accent)" stroke-width="4" marker-end="url(#head-accent)"/></g>`;
const fiber = `<svg viewBox="0 0 1200 640">
<defs><marker id="head-accent" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="var(--accent)" stroke="none"/></marker><marker id="head-muted" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="var(--muted)" stroke="none"/></marker></defs>
<g id="child1"><line x1="560" y1="160" x2="380" y2="294" stroke="var(--text)" stroke-width="4" marker-end="url(#head-muted)"/><text x="490" y="250" font-size="22" font-family="mono">child</text></g>
<g id="ret1"><path d="M290,300 Q290,130 484,122" stroke="var(--muted)" stroke-width="3" stroke-dasharray="10 8" fill="none" marker-end="url(#head-muted)"/><text x="250" y="200" text-anchor="end" font-size="22" font-family="mono" fill="var(--muted)">return</text></g>
<g id="ret2"><path d="M910,300 Q910,130 716,122" stroke="var(--muted)" stroke-width="3" stroke-dasharray="10 8" fill="none" marker-end="url(#head-muted)"/><text x="950" y="200" font-size="22" font-family="mono" fill="var(--muted)">return</text></g>
<g id="sib"><line x1="450" y1="340" x2="744" y2="340" stroke="var(--text)" stroke-width="4" marker-end="url(#head-muted)"/><text x="597" y="326" text-anchor="middle" font-size="22" font-family="mono">sibling</text></g>
<g id="child2"><line x1="820" y1="380" x2="820" y2="514" stroke="var(--text)" stroke-width="4" marker-end="url(#head-muted)"/><text x="806" y="455" text-anchor="end" font-size="22" font-family="mono">child</text></g>
<g id="ret3"><line x1="910" y1="520" x2="910" y2="386" stroke="var(--muted)" stroke-width="3" stroke-dasharray="10 8" marker-end="url(#head-muted)"/><text x="924" y="455" font-size="22" font-family="mono" fill="var(--muted)">return</text></g>
${node('app', 490, 80, 'App')}
${node('header', 230, 300, 'Header')}
${node('main', 750, 300, 'Main')}
${node('card', 750, 520, 'Card')}
${wip('wip-app', 110, 40, 486, 100)}
${wip('wip-header', 20, 420, 300, 384)}
${wip('wip-main', 990, 236, 960, 296)}
${wip('wip-card', 990, 540, 974, 560)}
</svg>`;


// Scenes 2 and 3: the JSX you write, the call it becomes, and the object the call returns.
const mono = (x, y, lines, extra = '') =>
  lines.map((l, i) => `<text x="${x}" y="${y + i * 34}" font-size="24" font-family="mono"${extra}>${l}</text>`).join('');
const arrow = (id, x1, y1, x2, y2, extra = '') =>
  `<g id="${id}"><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--text)" stroke-width="4" marker-end="url(#head)"/>${extra}</g>`;
const head = `<defs><marker id="head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="var(--text)" stroke="none"/></marker></defs>`;
const jsx = `<svg viewBox="0 0 1200 640">${head}
<g id="you"><rect x="30" y="40" width="470" height="260" rx="14" stroke-width="3"/><text x="265" y="30" text-anchor="middle" font-size="24" fill="var(--muted)">you write</text>
${mono(60, 100, ['&lt;button', '  className="primary"', '  onClick={handleClick}&gt;', '  Click Me', '&lt;/button&gt;'])}</g>
${arrow('compile', 510, 170, 680, 170, '<text x="595" y="150" text-anchor="middle" font-size="22" fill="var(--muted)">compiler</text>')}
<g id="call"><rect x="690" y="40" width="480" height="260" rx="14" stroke-width="3"/><text x="930" y="30" text-anchor="middle" font-size="24" fill="var(--muted)">it becomes</text>
${mono(720, 100, ['<tspan id="fn">jsx</tspan>("button", {', '  className: "primary",', '  onClick: handleClick,', '  children: "Click Me",', '})'])}</g>
${arrow('returns', 930, 310, 760, 400, '<text x="880" y="375" font-size="22" fill="var(--muted)">returns</text>')}
<g id="element"><rect x="330" y="400" width="430" height="220" rx="14" stroke-width="3"/><text x="545" y="440" text-anchor="middle" font-size="26">a React element</text>
<g id="eltype">${mono(360, 490, ['type: "button"'])}</g><g id="elprops">${mono(360, 530, ['props: { className,', '         onClick, children }'])}</g></g>
</svg>`;

// Scenes 4 and 10: two trees side by side, and the root pointer that picks one.
const treeAt = (s, x0, extra = '') => {
  const n = (id, x, y, w, label) =>
    `<g id="${id}${s}"><rect x="${x0 + x}" y="${y}" width="${w}" height="60" rx="12" stroke-width="3"/><text x="${x0 + x + w / 2}" y="${y + 39}" text-anchor="middle" font-size="24">${label}</text></g>`;
  const e = (x1, y1, x2, y2, id = '') =>
    `<line${id ? ` id="${id}"` : ''} x1="${x0 + x1}" y1="${y1}" x2="${x0 + x2}" y2="${y2}" stroke="var(--muted)" stroke-width="3"/>`;
  return `<g id="tree${s}">${e(250, 240, 120, 320)}${e(250, 240, 380, 320)}${e(380, 380, 260, 460)}${e(380, 380, 380, 460)}${extra}
${n('app', 180, 180, 140, 'App')}${n('header', 50, 320, 140, 'Header')}${n('main', 310, 320, 140, 'Main')}${n('card1', 140, 460, 120, 'Card 1')}${n('card2', 300, 460, 120, 'Card 2')}</g>`;
};
const card3 = `<g id="card3B"><line x1="${640 + 380}" y1="380" x2="${640 + 500}" y2="460" stroke="var(--muted)" stroke-width="3"/><rect x="${640 + 440}" y="460" width="120" height="60" rx="12" stroke-width="3"/><text x="${640 + 500}" y="499" text-anchor="middle" font-size="24">Card 3</text></g>`;
const trees = `<svg viewBox="0 0 1200 640">${head}
${treeAt('A', 0)}${treeAt('B', 600)}${card3}
<g id="namesDiff"><text x="250" y="580" text-anchor="middle" font-size="26" fill="var(--muted)">last render</text><text x="850" y="580" text-anchor="middle" font-size="26" fill="var(--muted)">this render</text></g>
<g id="namesBuf"><text x="250" y="580" text-anchor="middle" font-size="26" fill="var(--muted)">tree A: on screen</text><text x="850" y="580" text-anchor="middle" font-size="26" fill="var(--muted)">tree B: being built</text></g>
<g id="root"><rect x="490" y="40" width="220" height="60" rx="12" stroke-width="3"/><text x="600" y="79" text-anchor="middle" font-size="24" font-family="mono">root.current</text></g>
${arrow('ptrA', 490, 90, 360, 180)}${arrow('ptrB', 710, 90, 840, 180)}
</svg>`;

// Scene 5: the two rules, each drawn as a small before and after.
const tag = (id, x, y, w, label) =>
  `<g id="${id}"><rect x="${x}" y="${y}" width="${w}" height="56" rx="12" stroke-width="3"/><text x="${x + w / 2}" y="${y + 37}" text-anchor="middle" font-size="24" font-family="mono">${label}</text></g>`;
const rules = `<svg viewBox="0 0 1200 640">${head}
<g id="rule1"><text x="280" y="50" text-anchor="middle" font-size="28">a different type</text>
${tag('oldDiv', 40, 120, 200, '&lt;div&gt;')}${tag('oldCounter', 40, 260, 200, 'Counter')}<line x1="140" y1="176" x2="140" y2="260" stroke="var(--muted)" stroke-width="3"/>
${tag('newSpan', 320, 120, 200, '&lt;span&gt;')}${tag('newCounter', 320, 260, 200, 'Counter')}<line x1="420" y1="176" x2="420" y2="260" stroke="var(--muted)" stroke-width="3"/>
<text x="140" y="370" text-anchor="middle" font-size="22" fill="var(--muted)">last render</text><text x="420" y="370" text-anchor="middle" font-size="22" fill="var(--muted)">this render</text></g>
<line x1="600" y1="40" x2="600" y2="600" stroke="var(--border)" stroke-width="2"/>
<g id="rule2"><text x="900" y="50" text-anchor="middle" font-size="28">keys in a list</text>
${tag('ann1', 660, 180, 200, 'key="ann"')}${tag('bob1', 660, 260, 200, 'key="bob"')}
${tag('cat', 940, 100, 200, 'key="cat"')}${tag('ann2', 940, 180, 200, 'key="ann"')}${tag('bob2', 940, 260, 200, 'key="bob"')}
<text x="760" y="370" text-anchor="middle" font-size="22" fill="var(--muted)">last render</text><text x="1040" y="370" text-anchor="middle" font-size="22" fill="var(--muted)">this render</text></g>
</svg>`;

// Scenes 6 and 7: the old call stack on the left, and what it costs in time on the right.
const ms = (t) => 560 + t * 15; // 0 to 40 ms across 560 to 1160
const frame = (id, y, label) =>
  `<g id="${id}"><rect x="40" y="${y}" width="400" height="64" rx="10" stroke-width="3"/><text x="240" y="${y + 41}" text-anchor="middle" font-size="24" font-family="mono">${label}</text></g>`;
const due = (id, t) =>
  `<g id="${id}"><line x1="${ms(t)}" y1="230" x2="${ms(t)}" y2="400" stroke="var(--text)" stroke-width="3" stroke-dasharray="8 6"/><text x="${ms(t)}" y="220" text-anchor="middle" font-size="22">frame due</text><text x="${ms(t)}" y="430" text-anchor="middle" font-size="22" class="tone-bad">missed</text></g>`;
const stack = `<svg viewBox="0 0 1200 640">${head}
<text x="240" y="600" text-anchor="middle" font-size="24" fill="var(--muted)">the call stack</text>
${frame('fApp', 500, 'render(App)')}${frame('fDash', 420, 'render(Dashboard)')}${frame('fSide', 340, 'render(Sidebar)')}${frame('fNav', 260, 'render(NavList)')}
<g id="click"><rect x="100" y="110" width="280" height="64" rx="10" class="tone-bad" stroke-width="3"/><text x="240" y="151" text-anchor="middle" font-size="24">a click: waiting</text></g>
<g id="axis"><line x1="${ms(0)}" y1="400" x2="${ms(40)}" y2="400" stroke="var(--text)" stroke-width="3"/>${[0, 10, 20, 30, 40].map((t) => `<text x="${ms(t)}" y="470" text-anchor="middle" font-size="22" fill="var(--muted)">${t} ms</text>`).join('')}</g>
<g id="oneFrame"><rect x="${ms(0)}" y="260" width="${ms(FRAME_MS) - ms(0)}" height="50" rx="8" stroke-width="3"/><text x="${(ms(0) + ms(FRAME_MS)) / 2}" y="294" text-anchor="middle" font-size="22">${FRAME_MS} ms</text></g>
<g id="renderBar"><rect x="${ms(0)}" y="330" width="${ms(40) - ms(0)}" height="50" rx="8" class="tone-bad" stroke-width="3"/><text x="${ms(20)}" y="364" text-anchor="middle" font-size="22">render: cannot stop</text></g>
<g id="clickT"><line x1="${ms(5)}" y1="120" x2="${ms(5)}" y2="326" stroke="var(--text)" stroke-width="3" marker-end="url(#head)"/><text x="${ms(5)}" y="110" text-anchor="middle" font-size="22">click at 5 ms</text></g>
${due('due1', FRAME_MS)}${due('due2', 2 * FRAME_MS)}
<g id="handled"><text x="${ms(40)}" y="520" text-anchor="end" font-size="24" class="tone-good">click handled at 40 ms</text></g>
</svg>`;

// Scene 9: what each phase does, as two handwritten lists.
const item = (id, x, y, text) => `<text id="${id}" x="${x}" y="${y}" font-size="26">${text}</text>`;
const phases = `<svg viewBox="0 0 1200 640">
<g id="render"><rect x="30" y="40" width="550" height="560" rx="16" stroke-width="3"/><text x="305" y="100" text-anchor="middle" font-size="34">render</text></g>
<g id="commit"><rect x="620" y="40" width="550" height="560" rx="16" stroke-width="3"/><text x="895" y="100" text-anchor="middle" font-size="34">commit</text></g>
${item('r1', 70, 190, 'calls your components')}${item('r2', 70, 300, 'can pause or start over')}${item('r3', 70, 410, 'never touches the page')}
${item('c1', 660, 190, 'changes the real page')}${item('c2', 660, 300, 'runs start to finish')}${item('c3', 660, 410, 'all changes land at once')}${item('c4', 660, 520, 'then refs, useLayoutEffect')}
</svg>`;

// Scene 11: one update from setState to pixels.
const stage = (id, i, name, what) => {
  const x = 20 + i * 236;
  const link = i ? `<line x1="${x - 40}" y1="250" x2="${x - 6}" y2="250" stroke="var(--text)" stroke-width="4" marker-end="url(#head)"/>` : '';
  return `<g id="${id}">${link}<rect x="${x}" y="200" width="196" height="100" rx="14" stroke-width="3"/><text x="${x + 98}" y="258" text-anchor="middle" font-size="24">${name}</text>${what.map((w, j) => `<text x="${x + 98}" y="${360 + j * 34}" text-anchor="middle" font-size="22" fill="var(--muted)">${w}</text>`).join('')}</g>`;
};
const path = `<svg viewBox="0 0 1200 640">${head}
${stage('code', 0, 'your code', ['setCount(', 'count + 1)'])}${stage('scheduler', 1, 'scheduler', ['a click first,', 'a fetch can wait'])}${stage('reconciler', 2, 'reconciler', ['render:', 'can pause'])}${stage('reactDom', 3, 'react-dom', ['commit:', 'all at once'])}${stage('browser', 4, 'browser', ['paints the', 'next frame'])}
</svg>`;

const storyboard = {
  title: 'How React works under the hood',
  subtitle: 'From JSX to objects, the Fiber tree, and the two phases of an update',
  look: 'board',
  tones: { good: 'what React changes or keeps', bad: 'what makes the page slow' },
  pictures: { jsx, trees, stack },
  scenes: [
    {
      type: 'svg',
      chapter: 'Touching the DOM',
      title: 'Why touching the page is slow',
      narration:
        'Every web page is a tree of elements the browser keeps in memory, called the DOM.',
      svg: dom,
      labels: { code: 'inner HTML', ul: 'the list', reflow: 'reflow', node: 'one list item', window: 'the whole page', li0: 'list item' },
      hidden: ['reflow', 'node'],
      steps: [
        { focus: ['code', 'ul'], tint: { ul: 'bad' }, say: 'Changing it by hand is slow. Say our code replaces the list’s inner HTML.' },
        { show: ['reflow'], focus: 'reflow', say: 'The browser now has to work out every size and position again, then repaint. That is called a reflow.' },
        { show: ['node'], focus: 'node', say: 'And each element is not a small thing. One list item carries hundreds of properties, styles and listeners.' },
        {
          focus: ['li0', 'li1', 'li2', 'li3', 'li4'],
          draw: [{ brace: ['li0', 'li4'], note: '50 changes = 50 reflows', side: 'below', when: 'fifty times' }],
          say: 'Change fifty list items in a loop, read a size after each, and the browser redoes the layout fifty times.',
        },
        {
          focus: 'window',
          draw: [{ write: 'UI = f(state)', near: 'code', side: 'above', tone: 'good', when: 'describe' }],
          say: 'React’s idea: you describe the page for your data, and React makes the fewest changes to get there.',
        },
      ],
    },
    {
      type: 'svg',
      chapter: 'JSX is a function call',
      title: 'JSX turns into JavaScript',
      picture: 'jsx',
      hidden: ['compile', 'call', 'returns', 'element'],
      narration: 'This looks like HTML, but it is not.',
      steps: [
        { show: ['compile', 'call'], focus: 'call', say: 'Before your code runs, a compiler such as Babel rewrites it into a call.' },
        { focus: 'fn', draw: [{ circle: 'fn', when: 'jsx' }], say: 'The tag becomes a call to a function named jsx, with the props and the text as arguments.' },
        { focus: ['you', 'call'], say: 'So JSX is only a nicer way to write a function call.' },
      ],
    },
    {
      type: 'svg',
      chapter: 'Just an object',
      title: 'What the call returns',
      picture: 'jsx',
      narration: 'And that call does not draw a button.',
      steps: [
        { show: ['returns', 'element'], focus: 'element', say: 'It returns a plain object that describes one: a React element.' },
        { focus: ['eltype', 'elprops'], say: 'It says the type is a button, and holds the props.' },
        {
          focus: 'element',
          draw: [{ write: 'nothing on screen yet', near: 'element', side: 'left', tone: 'good', when: 'description' }],
          say: 'It is just a description, a few bytes in memory. Making thousands is cheap.',
        },
      ],
    },
    {
      type: 'svg',
      chapter: 'Comparing trees',
      title: 'Last render and this render',
      picture: 'trees',
      hidden: ['treeB', 'card3B', 'namesBuf', 'root', 'ptrA', 'ptrB'],
      labels: { treeA: 'last tree', treeB: 'fresh tree' },
      narration: 'Each time your data changes, React builds a fresh tree and compares it with the last one.',
      steps: [
        { show: ['treeB'], focus: ['treeA', 'treeB'], say: 'Here is the last tree, and the fresh one beside it.' },
        { focus: 'card2B', tint: { card2B: 'good' }, say: 'This time Card 2 has a new text colour.' },
        { show: ['card3B'], focus: 'card3B', tint: { card3B: 'good' }, say: 'And there is a new Card 3.' },
        {
          focus: ['treeA', 'treeB'],
          draw: [{ write: `any two trees: n³ steps\n1,000 nodes → ${diffSteps}`, at: [0.02, 0.03], tone: 'bad', when: 'n cubed' }],
          say: 'Finding the fewest changes between any two trees takes about n cubed steps. For a thousand elements, a billion.',
        },
        {
          focus: ['card2B', 'card3B'],
          erase: true,
          draw: [{ write: 'React’s two rules: about n steps', at: [0.02, 0.03], tone: 'good', when: 'two simple rules' }],
          say: 'So React cheats, with two simple rules, and gets it down to about one step per element.',
        },
      ],
    },
    {
      type: 'svg',
      chapter: 'Two rules',
      title: 'The two shortcuts',
      svg: rules,
      hidden: ['rule2'],
      labels: { rule1: 'rule one', rule2: 'rule two', oldDiv: 'div', newSpan: 'span', cat: 'cat' },
      narration: 'Here are the two rules.',
      steps: [
        {
          focus: ['oldDiv', 'newSpan'],
          draw: [{ cross: 'oldDiv', when: 'throws' }, { cross: 'oldCounter' }],
          say: 'Rule one: if a div became a span, React does not look inside. It throws the old part away.',
        },
        { focus: ['newSpan', 'newCounter'], tint: { newSpan: 'good', newCounter: 'good' }, say: 'And it builds the new one, so the counter starts over.' },
        { show: ['rule2'], focus: 'rule2', say: 'Rule two: in a list, keys say which item is which.' },
        {
          focus: 'cat',
          tint: { cat: 'good' },
          draw: [{ arrow: ['ann1', 'ann2'], when: 'adds' }, { arrow: ['bob1', 'bob2'] }],
          say: 'Cat is new at the top, so React adds one item instead of rewriting all three.',
        },
      ],
    },
    {
      type: 'svg',
      chapter: 'The old way',
      title: 'Before React 16: one long call stack',
      picture: 'stack',
      hidden: ['fDash', 'fSide', 'fNav', 'click', 'axis', 'oneFrame', 'renderBar', 'clickT', 'due1', 'due2', 'handled'],
      labels: { fApp: 'App', fDash: 'Dashboard', fSide: 'Sidebar', fNav: 'NavList', click: 'click' },
      narration: 'Before React 16, React walked the tree with plain function calls.',
      steps: [
        { show: ['fDash'], focus: ['fApp', 'fDash'], say: 'Rendering App calls render on Dashboard.' },
        { show: ['fSide'], focus: 'fSide', say: 'Which calls Sidebar.' },
        { show: ['fNav'], focus: 'fNav', say: 'Which calls NavList. Each call waits for the one below it.' },
        { show: ['click'], focus: ['click', 'fNav'], tint: { click: 'bad' }, say: 'Now the user clicks. But the page’s one thread is busy.' },
        {
          focus: ['fApp', 'fDash', 'fSide', 'fNav', 'click'],
          draw: [{ brace: ['fNav', 'fApp'], note: 'cannot stop halfway', side: 'right', tone: 'bad', when: 'cannot pause' }],
          say: 'These calls cannot pause. The click waits until every one returns.',
        },
      ],
    },
    {
      type: 'svg',
      chapter: 'Dropped frames',
      title: 'A 40 ms render on the main thread',
      picture: 'stack',
      narration: 'Here is what that costs.',
      steps: [
        { show: ['axis', 'oneFrame'], focus: 'oneFrame', say: 'The screen wants a new frame sixty times a second, about every sixteen point seven milliseconds.' },
        { show: ['renderBar'], focus: 'renderBar', say: 'This update takes forty milliseconds.' },
        { show: ['clickT'], focus: 'clickT', say: 'And the click lands five milliseconds in.' },
        { show: ['due1', 'due2'], focus: ['due1', 'due2'], say: 'Two frames go by with nothing new drawn. The page freezes.' },
        { show: ['handled'], focus: 'handled', say: 'Only at forty milliseconds does the click get its turn. Typing feels sticky.' },
      ],
    },
    {
      type: 'svg',
      chapter: 'Fiber',
      title: 'Fiber: a call stack React controls',
      narration: 'React 16 rewrote this as Fiber. Each component gets a small object, a fiber, with three links.',
      svg: fiber,
      labels: { 'wip-app': 'work in progress', child1: 'child link', sib: 'sibling link', child2: 'child link', ret3: 'return link', ret2: 'return link', ret1: 'parent' },
      hidden: ['wip-app', 'wip-header', 'wip-main', 'wip-card'],
      steps: [
        { focus: ['child1', 'sib', 'ret1'], say: 'Its first child, its next sibling, and its parent, called return.' },
        { show: ['wip-app'], focus: ['wip-app', 'app'], say: 'A loop holds one pointer, work in progress. It starts at App.' },
        { hide: ['wip-app'], show: ['wip-header'], focus: ['child1', 'header'], say: 'It does App’s work, then follows the child link down to Header.' },
        { hide: ['wip-header'], show: ['wip-main'], focus: ['sib', 'main'], say: 'Header has no child, so it follows the sibling link across to Main.' },
        {
          tint: { main: 'bad' },
          focus: ['main', 'wip-main'],
          draw: [{ write: 'out of time: pause here', near: 'wip-main', side: 'above', tone: 'bad', when: 'stops' }],
          say: 'Now a click comes in. The loop just stops. The pointer remembers where it was.',
        },
        {
          tint: { main: 'clear' },
          erase: true,
          hide: ['wip-main'],
          show: ['wip-card'],
          focus: ['child2', 'card'],
          say: 'Once the click is handled, it picks up right where it left off, down to Card.',
        },
        { hide: ['wip-card'], show: ['wip-main'], focus: ['ret3', 'main'], say: 'Card has no child and no sibling, so it climbs the return link to Main.' },
        { hide: ['wip-main'], show: ['wip-app'], focus: ['ret2', 'app'], say: 'Main has no sibling either, so up again to App. The walk is done.' },
      ],
    },
    {
      type: 'svg',
      chapter: 'Render and commit',
      title: 'Two phases of every update',
      svg: phases,
      hidden: ['r1', 'r2', 'r3', 'c1', 'c2', 'c3', 'c4'],
      labels: { r1: 'calls your components', c1: 'applies them', r2: 'pause', c2: 'never stops', r3: 'never touches', c3: 'in one go', c4: 'refs' },
      narration: 'Every update now happens in two phases.',
      steps: [
        { show: ['r1', 'c1'], focus: ['r1', 'c1'], say: 'Render calls your components and works out what changed. Commit applies them.' },
        { show: ['r2', 'c2'], focus: ['r2', 'c2'], say: 'Render can pause, give up, or start again. Commit never stops once it begins.' },
        { show: ['r3', 'c3'], focus: ['r3', 'c3'], say: 'Render never touches the page. Commit changes it all in one go.' },
        { show: ['c4'], focus: 'c4', say: 'And straight after, commit updates refs and runs layout effects.' },
      ],
    },
    {
      type: 'svg',
      chapter: 'Two trees',
      title: 'Double buffering: one pointer swap',
      picture: 'trees',
      hidden: ['treeB', 'card3B', 'namesDiff', 'ptrB'],
      labels: { root: 'root', ptrA: 'current pointer', treeA: 'tree A', treeB: 'tree B', ptrB: 'pointer' },
      narration: 'React keeps two trees: the one on screen, and the one it is building.',
      steps: [
        { focus: ['root', 'ptrA', 'treeA'], say: 'The root’s current pointer marks tree A, the one the user sees.' },
        { show: ['treeB', 'card3B'], focus: 'treeB', say: 'In the background, render builds tree B. The user sees none of it.' },
        {
          hide: ['ptrA'],
          show: ['ptrB'],
          tint: { treeB: 'good' },
          focus: ['root', 'ptrB', 'treeB'],
          say: 'When it is done, commit swaps one pointer. Tree B is now current.',
        },
        { focus: 'treeA', say: 'So the user never sees a half finished page. Tree A is kept, to build the next update in.' },
      ],
    },
    {
      type: 'svg',
      chapter: 'The whole path',
      title: 'From setState to pixels',
      svg: path,
      hidden: ['scheduler', 'reconciler', 'reactDom', 'browser'],
      labels: { code: 'set state', reactDom: 'react DOM' },
      narration: 'Let’s follow one update from start to finish.',
      steps: [
        { focus: 'code', say: 'Your code calls set state.' },
        { show: ['scheduler'], focus: 'scheduler', say: 'The scheduler decides how urgent it is. A click beats a background fetch.' },
        { show: ['reconciler'], focus: 'reconciler', tint: { reconciler: 'good' }, say: 'The reconciler builds the new tree and finds what changed. This is render, and it can pause.' },
        { show: ['reactDom'], focus: 'reactDom', tint: { reactDom: 'good' }, say: 'React DOM applies the changes in one go. This is commit.' },
        { show: ['browser'], focus: 'browser', say: 'And the browser paints the new frame.' },
      ],
    },
  ],
};

fs.writeFileSync(new URL('./storyboard.json', import.meta.url), JSON.stringify(storyboard, null, 2) + '\n');
fs.writeFileSync(new URL('./hunks.json', import.meta.url), '{}\n');
fs.writeFileSync(new URL('./meta.json', import.meta.url), JSON.stringify({ mode: 'explain' }, null, 2) + '\n');
