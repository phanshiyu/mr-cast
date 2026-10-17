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
<circle cx="62" cy="55" r="8" fill="var(--bad)" stroke="none"/><circle cx="88" cy="55" r="8" fill="var(--warn)" stroke="none"/><circle cx="114" cy="55" r="8" fill="var(--good)" stroke="none"/>
<text x="390" y="63" text-anchor="middle" font-size="20" fill="var(--muted)">the page’s DOM tree</text>
<g id="reflow"><rect x="44" y="94" width="692" height="502" rx="10" class="tone-bad" stroke-width="3"/><text x="390" y="590" text-anchor="middle" font-size="24" class="tone-bad">Layout reflow and repaint</text></g>
<g stroke="var(--muted)" stroke-width="3"><line x1="390" y1="164" x2="390" y2="230"/><line x1="390" y1="274" x2="390" y2="370"/>${liLines}</g>
${box('body', 320, 120, 140, '&lt;body&gt;')}
${box('div', 320, 230, 140, '&lt;div&gt;')}
${box('ul', 300, 370, 180, '&lt;ul id=list&gt;')}
${lis}
<g id="code"><rect x="60" y="300" width="230" height="40" rx="8" class="tone-warn"/><text x="175" y="327" text-anchor="middle" font-size="18" font-family="mono">innerHTML = …</text></g>
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

const storyboard = {
  title: 'How React works under the hood',
  subtitle: 'From JSX to objects, the Fiber tree, and the two phases of an update',
  scenes: [
    {
      type: 'svg',
      chapter: 'Touching the DOM',
      title: 'Why touching the page is slow',
      narration: 'Every web page is a tree of elements the browser keeps in memory, called the DOM. Changing it by hand is where apps get slow.',
      svg: dom,
      labels: {
        code: 'inner HTML',
        ul: 'the list',
        reflow: 'reflow',
        node: 'one list item',
        window: 'the whole page',
        li0: 'list item',
      },
      hidden: ['reflow', 'node'],
      steps: [
        {
          focus: ['code', 'ul'],
          tint: { ul: 'warn' },
          say: 'Say our code finds the list and replaces its inner HTML.',
        },
        {
          show: ['reflow'],
          focus: 'reflow',
          say: 'The browser now has to work out every size and position again, then repaint. That is called a reflow.',
        },
        {
          show: ['node'],
          focus: 'node',
          say: 'And each element is not a small thing. Inside the browser, one list item carries hundreds of properties, styles and listeners.',
        },
        {
          focus: ['li0', 'li1', 'li2', 'li3', 'li4'],
          callout: '50 changes, each followed by a read = 50 reflows',
          say: 'Change fifty list items in a loop, and read a size after each one, and the browser redoes the layout fifty times. Everything stutters.',
        },
        {
          focus: 'window',
          callout: '`UI = f(state)`',
          say: 'React’s idea: you describe what the page should look like for your data, and React makes the fewest changes to get there.',
        },
      ],
    },
    {
      type: 'compare',
      chapter: 'JSX is a function call',
      title: 'JSX turns into JavaScript',
      narration: 'This looks like HTML, but it is not. Before your code runs, a compiler such as Babel or SWC rewrites it.',
      sides: [
        { title: 'You write', tone: 'neutral' },
        { title: 'The compiler writes', tone: 'accent' },
      ],
      rows: [
        {
          cells: [
            { code: '<button\n  className="primary"\n  onClick={handleClick}>\n  Click Me\n</button>', lang: 'jsx' },
            { code: 'jsx("button", {\n  className: "primary",\n  onClick: handleClick,\n  children: "Click Me",\n})', lang: 'js' },
          ],
        },
        { label: 'What it is', cells: ['Looks like HTML', 'A plain function call'] },
      ],
      steps: [
        { focus: 0, say: 'The tag becomes a call to a function named jsx. The tag name, the props and the text all become arguments.' },
        { focus: 1, say: 'So JSX is only a nicer way to write a function call.' },
      ],
    },
    {
      type: 'memory',
      chapter: 'Just an object',
      title: 'What the call returns',
      narration: 'And that call does not draw a button. It returns a plain object that describes one.',
      frames: [{ name: 'App', vars: { element: { ref: 'el' } } }],
      objects: [
        { id: 'el', type: 'React element', fields: { type: '"button"', props: { ref: 'props' }, key: 'null' } },
        { id: 'props', type: 'props', fields: { className: '"primary"', onClick: { ref: 'fn' }, children: '"Click Me"' } },
        { id: 'fn', type: 'function', fields: { name: 'handleClick' } },
      ],
      steps: [
        { focus: ['App.element', 'el'], say: 'The component gets back an object, a React element.' },
        { focus: ['el.type', 'props'], say: 'It says the type is a button, and holds the props: the class, the click handler and the text.' },
        {
          focus: 'el',
          callout: 'Nothing on screen yet: **just a description**',
          say: 'It is just a description, a few bytes in memory. Making thousands of these is cheap, unlike touching the page.',
        },
      ],
    },
    {
      type: 'graph',
      chapter: 'Comparing trees',
      title: 'Last render and this render',
      layout: 'TB',
      narration: 'Each time your data changes, React builds a fresh tree of these objects and compares it with the last one.',
      nodes: [
        { id: 'rootA', label: 'Root', shape: 'step', group: 'Last render' },
        { id: 'headerA', label: 'Header', shape: 'step', group: 'Last render' },
        { id: 'mainA', label: 'Main', shape: 'step', group: 'Last render' },
        { id: 'card1A', label: 'Card 1', shape: 'step', group: 'Last render' },
        { id: 'card2A', label: 'Card 2', shape: 'step', group: 'Last render' },
        { id: 'rootB', label: 'Root', shape: 'step', group: 'This render' },
        { id: 'headerB', label: 'Header', shape: 'step', group: 'This render' },
        { id: 'mainB', label: 'Main', shape: 'step', group: 'This render' },
        { id: 'card1B', label: 'Card 1', shape: 'step', group: 'This render' },
        { id: 'card2B', label: 'Card 2', caption: 'new text colour', shape: 'step', group: 'This render' },
        { id: 'card3B', label: 'Card 3', caption: 'added', shape: 'step', group: 'This render', hidden: true },
      ],
      edges: [
        { from: 'rootA', to: 'headerA', direction: 'none' },
        { from: 'rootA', to: 'mainA', direction: 'none' },
        { from: 'mainA', to: 'card1A', direction: 'none' },
        { from: 'mainA', to: 'card2A', direction: 'none' },
        { from: 'rootB', to: 'headerB', direction: 'none' },
        { from: 'rootB', to: 'mainB', direction: 'none' },
        { from: 'mainB', to: 'card1B', direction: 'none' },
        { from: 'mainB', to: 'card2B', direction: 'none' },
        { from: 'mainB', to: 'card3B', direction: 'none', hidden: true },
      ],
      steps: [
        { focus: 'card2B', tint: { card2B: 'warn' }, say: 'This time Card 2 has a new text colour.' },
        { show: ['card3B', 'mainB->card3B'], tint: { card3B: 'good' }, say: 'And there is a new Card 3.' },
        {
          focus: ['group:Last render', 'group:This render'],
          callout: 'Any two trees: about n³ steps. [1,000 nodes → ' + diffSteps + ']{bad}',
          say: 'Finding the smallest set of changes between any two trees takes about n cubed steps. For a thousand elements, that is a billion.',
        },
        {
          focus: ['card2B', 'card3B'],
          callout: 'React’s two rules: about n steps. [1,000 nodes → about 1,000]{good}',
          say: 'So React cheats, with two simple rules, and gets it down to about one step per element.',
        },
      ],
    },
    {
      type: 'compare',
      chapter: 'Two rules',
      title: 'The two shortcuts',
      narration: 'Here are the two rules.',
      sides: [
        { title: 'Last render', tone: 'neutral' },
        { title: 'This render', tone: 'accent' },
      ],
      rows: [
        {
          label: 'Different type',
          cells: [
            { code: '<div>\n  <Counter />\n</div>', lang: 'jsx' },
            { code: '<span>\n  <Counter />\n</span>', lang: 'jsx' },
          ],
        },
        {
          label: 'Keys in a list',
          cells: [
            { code: '<li key="ann">Ann</li>\n<li key="bob">Bob</li>', lang: 'jsx' },
            { code: '<li key="cat">Cat</li>\n<li key="ann">Ann</li>\n<li key="bob">Bob</li>', lang: 'jsx' },
          ],
        },
      ],
      steps: [
        {
          focus: 0,
          say: 'Rule one: if a div became a span, React does not look inside. It throws the old part away and builds the new one, and the counter starts over.',
        },
        {
          focus: 1,
          say: 'Rule two: in a list, keys say which item is which. Cat is new at the top, so React adds one item instead of rewriting all three.',
        },
      ],
    },
    {
      type: 'memory',
      chapter: 'The old way',
      title: 'Before React 16: one long call stack',
      narration: 'Before React 16, React walked the tree with plain function calls, each one calling the next.',
      frames: [
        { name: 'render(App)', vars: { depth: 1 } },
        { name: 'render(Dashboard)', vars: { depth: 2 }, hidden: true },
        { name: 'render(Sidebar)', vars: { depth: 3 }, hidden: true },
        { name: 'render(NavList)', vars: { depth: 4 }, hidden: true },
      ],
      objects: [{ id: 'click', type: 'click event', fields: { status: 'waiting' }, hidden: true }],
      steps: [
        { show: ['frame:render(Dashboard)'], say: 'Rendering App calls render on Dashboard.' },
        { show: ['frame:render(Sidebar)'], say: 'Which calls Sidebar.' },
        { show: ['frame:render(NavList)'], say: 'Which calls NavList. Each call waits for the one below it.' },
        {
          show: ['click'],
          focus: ['click', 'frame:render(NavList)'],
          callout: 'The stack cannot stop halfway',
          say: 'Now the user clicks. But the page’s one thread is busy, and these calls cannot pause. The click has to wait until every one returns.',
        },
      ],
    },
    {
      type: 'timeline',
      chapter: 'Dropped frames',
      title: 'A 40 ms render on the main thread',
      unit: 'ms',
      narration: 'Here is what that costs. The screen wants a new frame sixty times a second.',
      events: [
        { at: 0, label: 'Big update starts' },
        { at: 5, label: 'User clicks', detail: 'has to wait', tone: 'warn' },
        { at: FRAME_MS, label: 'Frame due', detail: 'missed', tone: 'bad' },
        { at: +(2 * (1000 / 60)).toFixed(1), label: 'Frame due', detail: 'missed', tone: 'bad' },
        { at: 40, label: 'Render ends', detail: 'click handled at last', tone: 'good' },
      ],
      spans: [
        { from: 0, to: FRAME_MS, label: `one frame, ${FRAME_MS} ms`, tone: 'neutral' },
        { from: 0, to: 40, label: 'render, cannot stop', tone: 'bad' },
      ],
      steps: [
        { focus: [0, `span:one frame, ${FRAME_MS} ms`], say: 'That gives each frame about sixteen point seven milliseconds.' },
        { focus: [1, 'span:render, cannot stop'], say: 'This update takes forty milliseconds, and the click lands five milliseconds in.' },
        { focus: '2-3', say: 'Two frames go by with nothing new drawn. The page freezes.' },
        { focus: 4, say: 'Only at forty milliseconds does the click get its turn. Typing feels sticky.' },
      ],
    },
    {
      type: 'svg',
      chapter: 'Fiber',
      title: 'Fiber: a call stack React controls',
      narration:
        'React 16 rewrote this as Fiber. Each component gets a small object, a fiber, with three links: its first child, its next sibling, and its parent, called return.',
      svg: fiber,
      labels: { 'wip-app': 'work in progress', child1: 'child link', sib: 'sibling link', child2: 'child link', ret3: 'return link', ret2: 'return link' },
      hidden: ['wip-header', 'wip-main', 'wip-card'],
      steps: [
        { focus: ['wip-app', 'app'], say: 'A loop holds one pointer, work in progress. It starts at App.' },
        {
          hide: ['wip-app'],
          show: ['wip-header'],
          focus: ['child1', 'header', 'wip-header'],
          callout: 'follow `child`',
          say: 'It does App’s work, then follows the child link down to Header.',
        },
        {
          hide: ['wip-header'],
          show: ['wip-main'],
          focus: ['sib', 'main', 'wip-main'],
          callout: 'no child, so follow `sibling`',
          say: 'Header has no child, so it follows the sibling link across to Main.',
        },
        {
          tint: { main: 'warn' },
          focus: ['main', 'wip-main'],
          callout: '[out of time: pause here]{warn}',
          say: 'Now say a click comes in. The loop just stops. The pointer remembers where it was, and the browser handles the click.',
        },
        {
          tint: { main: 'clear' },
          hide: ['wip-main'],
          show: ['wip-card'],
          focus: ['child2', 'card', 'wip-card'],
          callout: 'resume: follow `child`',
          say: 'Then it picks up right where it left off, down to Card.',
        },
        {
          hide: ['wip-card'],
          show: ['wip-main'],
          focus: ['ret3', 'main', 'wip-main'],
          callout: 'no child, no sibling: follow `return`',
          say: 'Card has no child and no sibling, so it climbs back up the return link to Main.',
        },
        {
          hide: ['wip-main'],
          show: ['wip-app'],
          focus: ['ret2', 'app', 'wip-app'],
          callout: 'back at the top: done',
          say: 'Main has no sibling either, so up again to App. Back at the top, the walk is done.',
        },
      ],
    },
    {
      type: 'compare',
      chapter: 'Render and commit',
      title: 'Two phases of every update',
      narration: 'Every update now happens in two phases.',
      sides: [
        { title: 'Render phase', tone: 'accent' },
        { title: 'Commit phase', tone: 'good' },
      ],
      rows: [
        { label: 'What it does', cells: ['Calls your components, works out what changed', 'Applies those changes to the real page'] },
        { label: 'Can it stop?', cells: ['Yes: pause, throw away, start over', 'No: runs start to finish'] },
        { label: 'The page', cells: ['Never touched', 'All changes land at once'] },
        { label: 'Then runs', cells: ['Nothing', 'Updates refs, runs `useLayoutEffect`'] },
      ],
      steps: [
        { focus: 0, say: 'The render phase calls your components and works out what changed. The commit phase applies it.' },
        { focus: 1, say: 'Render can pause, give up, or start again. Commit never stops once it begins.' },
        { focus: 2, say: 'Render never touches the page. Commit changes it all in one go.' },
        { focus: 3, say: 'And straight after, commit updates refs and runs layout effects.' },
      ],
    },
    {
      type: 'memory',
      chapter: 'Two trees',
      title: 'Double buffering: one pointer swap',
      narration: 'React keeps two trees: the one on screen, and the one it is building.',
      frames: [{ name: 'root', vars: { current: { ref: 'onscreen' } } }],
      objects: [
        { id: 'onscreen', type: 'tree A', fields: { count: 1, onScreen: 'yes', alternate: 'null' } },
        { id: 'building', type: 'tree B', fields: { count: 2, onScreen: 'no', alternate: { ref: 'onscreen' } }, hidden: true },
      ],
      steps: [
        { focus: ['root.current', 'onscreen'], say: 'The root’s current pointer marks tree A, the one the user sees, where the count is one.' },
        {
          show: ['building'],
          set: { 'onscreen.alternate': { ref: 'building' } },
          focus: 'building',
          say: 'In the background, render builds tree B, with the count at two. The user sees none of it.',
        },
        {
          set: { 'root.current': { ref: 'building' }, 'building.onScreen': 'yes', 'onscreen.onScreen': 'no' },
          focus: ['root.current', 'building'],
          callout: '`root.current = workInProgress`',
          say: 'When it is done, commit applies the changes and swaps one pointer. The new tree is now current.',
        },
        {
          focus: 'onscreen',
          callout: 'No half-drawn page, ever',
          say: 'So the user never sees a half finished page. Tree A is kept, to build the next update in.',
        },
      ],
    },
    {
      type: 'flow',
      chapter: 'The whole path',
      title: 'From setState to pixels',
      narration: 'Let’s follow one update from start to finish.',
      steps: [
        { actor: 'Your code', action: 'calls setState', payload: 'setCount(count + 1)', icon: 'code', say: 'Your code calls set state.' },
        {
          actor: 'Scheduler',
          action: 'picks what matters most',
          payload: 'a click: urgent\na background fetch: can wait',
          icon: 'list-ordered',
          say: 'The scheduler decides how urgent it is. A click beats a background fetch.',
        },
        {
          actor: 'Reconciler',
          action: 'builds the work-in-progress tree',
          payload: 'render phase: can pause',
          icon: 'git-compare',
          tone: 'accent',
          say: 'The reconciler builds the new fiber tree and finds what changed. This is render, and it can pause.',
        },
        {
          actor: 'react-dom',
          action: 'changes the page',
          payload: 'commit phase: all at once',
          icon: 'monitor',
          tone: 'good',
          say: 'React DOM applies the changes in one go. This is commit.',
        },
        { actor: 'Browser', action: 'paints the pixels', payload: 'next frame', icon: 'paintbrush', say: 'And the browser paints the new frame.' },
      ],
    },
  ],
};

fs.writeFileSync(new URL('./storyboard.json', import.meta.url), JSON.stringify(storyboard, null, 2) + '\n');
fs.writeFileSync(new URL('./hunks.json', import.meta.url), '{}\n');
fs.writeFileSync(new URL('./meta.json', import.meta.url), JSON.stringify({ mode: 'explain' }, null, 2) + '\n');
