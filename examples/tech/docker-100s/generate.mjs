// Writes storyboard.json, hunks.json and meta.json beside this file. Run: node examples/tech/docker-100s/generate.mjs
//
// Facts, checked 2026-10-18 against Docker's own pages:
// - "A container is simply an isolated process with all of the files it needs to run", and many containers "all share
//   the same kernel"; "a VM is an entire operating system with its own kernel, hardware drivers, programs, and
//   applications" (https://docs.docker.com/get-started/docker-concepts/the-basics/what-is-a-container/).
// - "An image is a read-only template with instructions for creating a Docker container"; "A container is a runnable
//   instance of an image"; "Each instruction in a Dockerfile creates a layer in the image. When you change the
//   Dockerfile and rebuild the image, only those layers which have changed are rebuilt"
//   (https://docs.docker.com/get-started/docker-overview/).
// - Layers "once created, are immutable" and can be "reused between images"
//   (https://docs.docker.com/get-started/docker-concepts/building-images/understanding-image-layers/).
// - "March 15, 2013, Solomon Hykes, the founder of Docker, first demoed Docker publicly to the world at PyCon"
//   (https://www.docker.com/blog/docker-nine-years-young/).
// - `docker run -d -p 8080:80 ...` prints "the full container ID", and `docker ps` shows the port as
//   `0.0.0.0:8080->80/tcp` (the what-is-a-container page above). This example maps 8080 to the app's port 3000.
import fs from 'node:fs';
import { createHash } from 'node:crypto';

const here = (name) => new URL(name, import.meta.url);
const assert = (ok, msg) => {
  if (!ok) throw new Error(msg);
};

const dockerfile = [
  'FROM node:22-alpine',
  'WORKDIR /app',
  'COPY package*.json ./',
  'RUN npm install',
  'COPY . .',
  'CMD ["node", "server.js"]',
];

// BuildKit numbers the instructions that build the filesystem: FROM, WORKDIR, COPY and RUN. CMD only records what to
// start, so it gets no step of its own.
const built = dockerfile.filter((l) => /^(FROM|WORKDIR|COPY|RUN)\b/.test(l));
assert(built.length === 5, 'five build steps');
const buildLog = built.map(
  (l, i) => ` => [${i + 1}/${built.length}] ${l.replace(/^FROM /, 'FROM docker.io/library/')}`,
);

// A container ID is 64 hex characters; this one is a fixed hash so every run prints the same.
const id = createHash('sha256').update('my-app, example container').digest('hex');
assert(id.length === 64, 'container id length');

const source = (key, file, language, lines) => ({
  id: key,
  file,
  oldFile: null,
  status: 'source',
  language,
  header: '',
  startLine: 1,
  oldStartLine: 1,
  endLine: lines.length,
  additions: 0,
  deletions: 0,
  beforeCode: lines.join('\n'),
  afterCode: lines.join('\n'),
  lines: lines.map((text, i) => ({ type: 'context', oldLine: i + 1, newLine: i + 1, text })),
});
const hunks = { s1: source('s1', 'Dockerfile', 'docker', dockerfile) };

// ---------- the machines picture: your app, what it needs, and the box that carries both ----------
const T = (x, y, t, extra = '') => `<text x="${x}" y="${y}" font-size="24" ${extra}>${t}</text>`;
const machine = (id, x, name) =>
  `<g id="${id}"><rect x="${x}" y="200" width="400" height="360" rx="18" stroke-width="4"/>${T(x + 200, 600, name, 'text-anchor="middle" font-size="28" fill="var(--muted)"')}</g>`;
const app = (x) =>
  `<rect x="${x + 50}" y="250" width="300" height="64" rx="10" stroke-width="3"/>${T(x + 200, 291, 'server.js', 'text-anchor="middle" font-family="mono"')}`;
const needs = (x) =>
  ['Node 22', 'node_modules', 'Linux files'].map((t, i) => T(x + 70, 370 + i * 44, t, 'font-family="mono"')).join('');
const boxAt = (id, x, edgeId) =>
  `<g id="${id}"><rect${edgeId ? ` id="${edgeId}"` : ''} x="${x + 24}" y="226" width="352" height="306" rx="12" fill="none" stroke="var(--text)" stroke-width="4" stroke-dasharray="14 8"/>${app(x)}${needs(x)}</g>`;
const layerIcon = Array.from(
  { length: 5 },
  (_, i) => `<rect x="520" y="${470 - i * 34}" width="160" height="28" rx="5" stroke-width="3"/>`,
).join('');
const machines = `<svg viewBox="0 0 1200 640">
${machine('mine', 40, 'my machine')}
${machine('yours', 760, 'your machine')}
${boxAt('box', 40, 'edge')}
<g id="bare"><g id="bareApp">${app(760)}</g>${T(830, 400, 'no Node here', 'font-size="26" class="tone-bad"')}</g>
<text id="pycon" x="600" y="60" text-anchor="middle" font-size="26" fill="var(--muted)">first shown at PyCon, 15 March 2013</text>
<g id="recipe"><rect x="520" y="30" width="160" height="150" rx="8" stroke-width="3"/>${['FROM', 'COPY', 'RUN', 'CMD'].map((t, i) => T(540, 66 + i * 30, t, 'font-size="22" font-family="mono"')).join('')}${T(600, 200, 'Dockerfile', 'text-anchor="middle" font-size="24"')}</g>
<g id="image">${layerIcon}${T(600, 530, 'image', 'text-anchor="middle" font-size="24"')}</g>
<line id="builds" x1="600" y1="212" x2="600" y2="318" stroke="var(--text)" stroke-width="3" marker-end="url(#head)"/>
<g id="runs"><line x1="510" y1="400" x2="450" y2="400" stroke="var(--text)" stroke-width="3" marker-end="url(#head)"/><line x1="690" y1="400" x2="750" y2="400" stroke="var(--text)" stroke-width="3" marker-end="url(#head)"/></g>
${boxAt('box2', 760)}
<defs><marker id="head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="var(--text)" stroke="none"/></marker></defs>
</svg>`;

// ---------- a VM against a container: what each one stacks on the hardware ----------
const slab = (id, x, y, w, h, label, extra = '') =>
  `<g${id ? ` id="${id}"` : ''}><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" stroke-width="3" ${extra}/>${T(x + w / 2, y + h / 2 + 8, label, 'text-anchor="middle"')}</g>`;
const vmSvg = `<svg viewBox="0 0 1200 640">
<text x="300" y="50" text-anchor="middle" font-size="32">virtual machines</text>
<text x="900" y="50" text-anchor="middle" font-size="32">containers</text>
<line x1="600" y1="30" x2="600" y2="620" stroke="var(--muted)" stroke-width="2"/>
${slab('', 30, 560, 540, 56, 'hardware')}${slab('', 30, 494, 540, 56, 'host kernel')}${slab('', 30, 428, 540, 56, 'hypervisor')}
<g id="vms">${[0, 1, 2].map((i) => `${slab(`os${i}`, 30 + i * 184, 228, 172, 190, 'OS + kernel')}${slab('', 30 + i * 184, 150, 172, 66, 'app')}`).join('')}</g>
${slab('', 630, 560, 540, 56, 'hardware')}${slab('kernel', 630, 494, 540, 56, 'one shared kernel')}${slab('', 630, 428, 540, 56, 'Docker')}
<g id="cts">${[0, 1, 2].map((i) => slab(`ct${i}`, 630 + i * 110, 300, 100, 116, 'app')).join('')}</g>
<g id="more">${[3, 4].map((i) => slab(`ct${i}`, 630 + i * 110, 300, 100, 116, 'app')).join('')}</g>
</svg>`;

// ---------- the image: one read-only layer per build step, on the base ----------
const layers = [
  { id: 'base', label: 'FROM node:22-alpine', caption: 'Linux files and Node' },
  { id: 'dir', label: 'WORKDIR /app', caption: 'a folder' },
  { id: 'pkg', label: 'COPY package*.json', caption: 'the package list' },
  { id: 'deps', label: 'RUN npm install', caption: 'node_modules' },
  { id: 'code', label: 'COPY . .', caption: 'your code' },
];
assert(layers.length === built.length, 'one layer per build step');
const layersSvg = `<svg viewBox="0 0 1200 640">
${layers
  .map(
    (l, i) =>
      `<g id="${l.id}"><rect x="140" y="${520 - i * 100}" width="520" height="84" rx="10" stroke-width="3"/>${T(170, 570 - i * 100, l.label, 'font-size="28" font-family="mono"')}${T(700, 570 - i * 100, l.caption, 'font-size="28" fill="var(--muted)"')}</g>`,
  )
  .join('\n')}
</svg>`;

const scenes = [];

scenes.push({
  type: 'svg',
  chapter: 'What it is',
  title: '“It works on my machine”',
  picture: 'machines',
  hidden: ['yours', 'bare', 'edge', 'pycon', 'recipe', 'image', 'builds', 'runs', 'box2'],
  labels: { mine: 'my machine', box: 'everything it needs', edge: 'one box', yours: 'any computer' },
  narration: 'It works on my machine. Docker is how you stop saying that.',
  steps: [
    {
      show: ['yours', 'bare'],
      focus: ['yours', 'bare'],
      say: 'Your app runs here, but on the next computer something it needs is missing.',
      draw: [{ cross: 'bareApp', tone: 'bad', when: 'missing' }],
    },
    {
      hide: ['bare'],
      show: ['edge'],
      focus: ['box', 'edge'],
      erase: true,
      say: 'Docker packs your app and everything it needs into one box.',
    },
    {
      move: { box: 'translate(720 0)' },
      focus: ['box', 'yours'],
      say: 'And that box runs the same on any computer.',
    },
    {
      show: ['pycon'],
      focus: ['pycon'],
      say: 'It was first shown at PyCon, in March 2013.',
    },
  ],
});

scenes.push({
  type: 'svg',
  chapter: 'Not a VM',
  title: 'A VM carries a whole OS',
  svg: vmSvg,
  hidden: ['more'],
  labels: {
    vms: 'virtual machine',
    os0: 'operating system',
    kernel: 'host’s kernel',
    cts: 'container',
    more: 'many more',
  },
  narration: "So it's a virtual machine? No.",
  steps: [
    {
      tint: { os0: 'bad', os1: 'bad', os2: 'bad' },
      focus: ['vms', 'os0'],
      say: 'A virtual machine runs a whole operating system, kernel and all.',
    },
    {
      tint: { kernel: 'good' },
      focus: ['cts', 'kernel'],
      say: "A container is one walled off process that shares the host's kernel.",
    },
    {
      show: ['more'],
      focus: ['more'],
      say: 'So many more of them fit on one machine.',
      draw: [
        { write: '10 apps = 10 OSes', near: 'vms', side: 'above', tone: 'bad', when: 'many more' },
        { write: '10 apps = 1 kernel', near: 'more', side: 'above', tone: 'good', when: 'fit' },
      ],
    },
  ],
});

scenes.push({
  type: 'code',
  chapter: 'The Dockerfile',
  hunkId: 's1',
  typing: true,
  outputTitle: 'zsh',
  narration: 'You describe the box in a Dockerfile.',
  steps: [
    { lines: 1, say: 'Start from a small image that has Node.' },
    { lines: '2-5', say: 'Install your packages, then copy in your code.' },
    {
      lines: 6,
      say: 'Say what to run, then build it.',
      output: ['$ docker build -t my-app .', ...buildLog, ' => naming to docker.io/library/[my-app]{good}'].join('\n'),
      outputWhen: 'build it',
    },
  ],
});

scenes.push({
  type: 'svg',
  chapter: 'Layers',
  title: 'Change code, rebuild one layer',
  svg: layersSvg,
  hidden: ['dir', 'pkg', 'deps', 'code'],
  labels: { base: 'base', code: 'top layer', dir: 'layers', deps: 'cache' },
  narration: 'That build makes an image: read only layers, one for each step.',
  steps: [
    {
      show: ['dir', 'pkg', 'deps', 'code'],
      focus: ['dir', 'pkg', 'deps', 'code', 'base'],
      say: 'Each one is stacked on the base.',
    },
    {
      tint: { code: 'bad' },
      focus: ['code'],
      say: 'Change your code, and only the top layer is built again.',
      draw: [{ write: 'built again', near: 'code', side: 'above', tone: 'bad', when: 'built again' }],
    },
    {
      tint: { base: 'good', dir: 'good', pkg: 'good', deps: 'good' },
      focus: ['base', 'dir', 'pkg', 'deps'],
      say: 'The rest come from the cache.',
      draw: [{ brace: ['base', 'deps'], note: 'from the cache', side: 'left', tone: 'good', when: 'cache' }],
    },
  ],
});

scenes.push({
  type: 'terminal',
  chapter: 'Run it',
  title: 'An image becomes a container',
  window: 'zsh: ~/my-app',
  narration: 'Run the image, and you get a container.',
  entries: [
    { command: 'docker run -d -p 8080:3000 my-app', output: id, exit: 0 },
    { command: 'docker ps --format "{{.Image}}  {{.Ports}}"', output: 'my-app  0.0.0.0:8080->3000/tcp', exit: 0 },
    { command: 'curl localhost:8080', output: '[hello from a container]{good}', exit: 0 },
  ],
  steps: [
    { focus: '0-2', say: 'It starts in the background, port eighty eighty reaches the app inside, and it answers.' },
  ],
});

scenes.push({
  type: 'svg',
  chapter: 'Recap',
  title: 'Recipe, image, container',
  picture: 'machines',
  hidden: ['bare', 'pycon', 'recipe', 'image', 'builds', 'runs', 'box2'],
  labels: { recipe: 'recipe', image: 'image', box: 'container', box2: 'every machine', runs: 'running' },
  narration: 'Three words to keep.',
  steps: [
    { show: ['recipe'], focus: ['recipe'], say: 'The Dockerfile is the recipe, one layer per step.' },
    {
      show: ['builds', 'image'],
      focus: ['image', 'builds'],
      say: 'The image is what it builds: a read only template.',
    },
    {
      show: ['runs', 'box2'],
      focus: ['image', 'box', 'box2', 'runs'],
      say: 'A container is that image, running, the same on every machine.',
    },
  ],
});

const storyboard = {
  title: 'Docker in 100 seconds',
  subtitle: 'Containers, images and layers, fast',
  tones: { good: 'shared or reused', bad: 'duplicated, rebuilt or missing' },
  pictures: { machines },
  scenes,
};
fs.writeFileSync(here('storyboard.json'), `${JSON.stringify(storyboard, null, 2)}\n`);
fs.writeFileSync(here('hunks.json'), `${JSON.stringify(hunks, null, 2)}\n`);
fs.writeFileSync(here('meta.json'), `${JSON.stringify({ mode: 'explain' })}\n`);
