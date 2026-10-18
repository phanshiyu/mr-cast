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

const scenes = [];

scenes.push({
  type: 'text',
  chapter: 'What it is',
  narration: 'It works on my machine. Docker is how you stop saying that.',
  kicker: 'Docker',
  headline: '“It works on my machine.”',
  note: 'first shown at PyCon, 15 March 2013',
  hidden: ['note'],
  steps: [
    {
      set: { headline: 'Your app, plus everything it needs, in one box' },
      show: ['note'],
      focus: 'headline',
      say: 'It packs your app and everything it needs into one box, which runs the same on any computer.',
    },
  ],
});

scenes.push({
  type: 'compare',
  chapter: 'Not a VM',
  title: 'Two ways to keep apps apart',
  sides: [{ title: 'Virtual machine' }, { title: 'Container' }],
  narration: "So it's a virtual machine? No.",
  rows: [
    { label: 'Kernel', cells: ['Its own', "Shares the host's"], verdict: [null, 'good'] },
    { label: 'Inside', cells: ['A whole operating system', 'One process and its files'], verdict: [null, 'good'] },
    { label: 'Ten apps', cells: ['Ten operating systems', 'Ten processes, one kernel'], verdict: ['bad', 'good'] },
  ],
  steps: [
    {
      focus: [0, 1],
      say: "A virtual machine runs a whole operating system, kernel and all. A container is one walled off process that shares the host's kernel.",
    },
    { focus: 2, say: 'So many more of them fit on one machine.' },
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
  type: 'layers',
  chapter: 'Layers',
  title: 'The image, one layer per step',
  narration: 'That build makes an image: read only layers, one for each step, stacked on the base.',
  layers: [
    { id: 'code', label: 'COPY . .', caption: 'your code', tone: 'warn' },
    { id: 'deps', label: 'RUN npm install', caption: 'node_modules' },
    { id: 'pkg', label: 'COPY package*.json', caption: 'the package list' },
    { id: 'dir', label: 'WORKDIR /app', caption: 'a folder' },
    { id: 'base', label: 'FROM node:22-alpine', caption: 'Linux files and Node', tone: 'accent' },
  ],
  steps: [
    { focus: 'code', say: 'Change your code, and only the top layer is built again. The rest come from the cache.' },
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
  type: 'text',
  chapter: 'Recap',
  narration:
    'The Dockerfile is the recipe. The image is what it builds. A container is that image, running, the same on every machine.',
  headline: 'Three words',
  items: [
    '**Dockerfile**: the recipe, one layer per step',
    '**Image**: a read-only template built from it',
    '**Container**: a running copy of an image',
  ],
});

const storyboard = { title: 'Docker in 100 seconds', subtitle: 'Containers, images and layers, fast', scenes };
fs.writeFileSync(here('storyboard.json'), `${JSON.stringify(storyboard, null, 2)}\n`);
fs.writeFileSync(here('hunks.json'), `${JSON.stringify(hunks, null, 2)}\n`);
fs.writeFileSync(here('meta.json'), `${JSON.stringify({ mode: 'explain' })}\n`);
