// Writes storyboard.json, hunks.json and meta.json beside this file. Run: node examples/architecture/youtube/generate.mjs
import fs from 'node:fs';

const fmt = (n) => n.toLocaleString('en-US');

// Facts the scenes state, computed here so the words and the drawings agree.
const hoursPerDay = 500 * 60 * 24; // 720,000
const FILE = 4_000_000_000; // 4 GB
const CHUNK = 8_000_000; // 8 MB
const chunks = FILE / CHUNK; // 500
const mb = (b) => fmt(b / 1_000_000);
const ladder = [
  { name: '1080p', res: '1920x1080', bps: 5_000_000 },
  { name: '720p', res: '1280x720', bps: 2_800_000 },
  { name: '480p', res: '854x480', bps: 1_400_000 },
  { name: '360p', res: '640x360', bps: 800_000 },
];
const tunnelBps = 1_600_000;
const load = (bps) => ((bps * 4) / tunnelBps).toFixed(1); // seconds to fetch 4 s of video in the tunnel
if (load(1_400_000) !== '3.5' || load(5_000_000) !== '12.5') throw new Error('tunnel arithmetic changed');

// Scene 1: the three constraints and the two planes.

// Drawing helpers: every scene is a drawing on the board, 1200 by 640.
const VB = '0 0 1200 640';
const heads = `<defs><marker id="head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="var(--muted)" stroke="none"/></marker></defs>`;
const txt = (x, y, s, size = 26, extra = '') => `<text x="${x}" y="${y}" font-size="${size}"${extra}>${s}</text>`;
const mid = (x, y, s, size = 26, extra = '') => txt(x, y, s, size, ` text-anchor="middle"${extra}`);
const muted = ' fill="var(--muted)"';
const arrow = (id, x1, y1, x2, y2, extra = '') =>
  `<line${id ? ` id="${id}"` : ''} x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--muted)" stroke-width="3" marker-end="url(#head)"${extra}/>`;
// A box with a name and an optional caption under it.
const box = (id, x, y, w, h, name, caption = '') =>
  `<g id="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" stroke-width="3"/>${mid(x + w / 2, y + (caption ? h / 2 - 4 : h / 2 + 10), name, 28)}${caption ? mid(x + w / 2, y + h / 2 + 30, caption, 22, muted) : ''}</g>`;

// Scene 0: how much arrives.
const intake = `<svg viewBox="${VB}">
<g id="screen"><rect x="420" y="40" width="360" height="220" rx="18" stroke-width="3"/><path d="M570,105 L650,150 L570,195 Z" stroke-width="3"/></g>
<text id="number" x="600" y="420" text-anchor="middle" font-size="110">500 hours</text>
<text id="note" x="600" y="500" text-anchor="middle" font-size="36"${muted}>of video, every minute</text>
</svg>`;

// Scenes 1 and 9: the three constraints, and the line between the two planes.
const card = (id, x, title, line) =>
  `<g id="${id}"><rect x="${x}" y="20" width="360" height="120" rx="14" stroke-width="3"/>${mid(x + 180, 68, title, 30)}${mid(x + 180, 110, line, 22, muted)}</g>`;
const chip = (id, x, y, label) =>
  `<g id="${id}"><rect x="${x}" y="${y}" width="440" height="56" rx="12" stroke-width="2"/>${mid(x + 220, y + 37, label, 24)}</g>`;
const planes = `<svg viewBox="${VB}">${heads}
${card('ingest', 20, 'Ingestion', 'any format, codec and size')}
${card('storage', 420, 'Storage', 'petabytes a day, hot and cold')}
${card('streaming', 820, 'Streaming', 'a 3G phone to a 4K TV, no stalls')}
<line id="divider" x1="600" y1="190" x2="600" y2="630" stroke="var(--text)" stroke-width="4" stroke-dasharray="14 10"/>
<g id="control">${mid(300, 230, 'Control plane', 32)}${mid(300, 268, 'small web requests', 22, muted)}
${chip('c-titles', 80, 300, 'titles and descriptions')}${chip('c-search', 80, 376, 'search')}${chip('c-views', 80, 452, 'likes, comments, view counts')}${chip('c-accounts', 80, 528, 'accounts and channels')}</g>
<g id="data">${mid(900, 230, 'Data plane', 32)}${mid(900, 268, 'huge files on the move', 22, muted)}
${chip('d-raw', 680, 300, 'raw uploads')}${chip('d-transcode', 680, 376, 'transcoding')}${chip('d-chunks', 680, 452, 'stored video chunks')}${chip('d-cdn', 680, 528, 'CDN delivery')}</g>
</svg>`;

// Scene 2: the upload, the services it passes, and the file in 8 MB pieces.
const pieces = [
  ['0', '0–8 MB'],
  ['1', '8–16 MB'],
  ['2', '16–24 MB'],
  ['…', ''],
  [String(chunks - 1), `${mb(FILE - CHUNK)}–${mb(FILE)} MB`],
];
const upload = `<svg viewBox="${VB}">${heads}
${box('creator', 20, 60, 240, 120, 'Creator', 'video.mov, 4 GB')}${arrow('', 268, 120, 318, 120)}
${box('gateway', 326, 60, 250, 120, 'API gateway', 'load balancer')}${arrow('', 584, 120, 634, 120)}
${box('ingest', 642, 60, 260, 120, 'Ingestion', 'resumable upload')}${arrow('', 910, 120, 950, 120)}
${box('blob', 958, 60, 222, 120, 'Blob storage', 'temporary')}
<g id="event">${arrow('', 772, 188, 772, 268)}${txt(786, 236, 'event', 22, muted)}</g>
${box('kafka', 642, 276, 260, 110, 'Kafka topic', 'video_uploaded')}
<g id="file">${pieces
  .map(
    ([n, bytes], i) =>
      `<g id="p${i}"><rect x="${30 + i * 230}" y="470" width="214" height="80" rx="8" stroke-width="3"${n === '…' ? ' stroke-dasharray="8 8"' : ''}/>${mid(122 + i * 230, 522, n === '…' ? '…' : `piece ${n}`, 26)}${mid(122 + i * 230, 588, bytes, 22, muted)}</g>`,
  )
  .join('')}</g>
</svg>`;

// Scene 3: one worker, four sizes, each cut into 4-second chunks, and the manifest that lists them.
const rungY = (i) => 60 + i * 140;
const rung = (r, i) => {
  const y = rungY(i);
  const id = `r${r.name.replace('p', '')}`;
  return `<line id="w-${id}" x1="250" y1="320" x2="330" y2="${y + 45}" stroke="var(--muted)" stroke-width="3"/>${box(id, 336, y, 240, 90, r.name, `H.264, ${r.bps / 1e6} Mbit/s`)}`;
};
const cells = (i) =>
  [0, 1, 2, 3, 4]
    .map((k) => `<rect x="${620 + k * 62}" y="${rungY(i) + 20}" width="56" height="50" rx="4" stroke-width="2"/>`)
    .join('');
const transcode = `<svg viewBox="${VB}">${heads}
${box('worker', 20, 260, 230, 120, 'Worker', 'runs a task graph')}
<g id="branches">${ladder.map(rung).join('')}</g>
<g id="cut">${ladder.map((_, i) => cells(i)).join('')}${mid(774, 44, '4 s chunks: seg_0.ts, seg_1.ts, …', 22, muted)}</g>
<g id="manifest">${arrow('', 940, 320, 990, 320)}<path d="M1000,220 H1140 L1180,260 V420 H1000 Z" stroke-width="3"/>${mid(1090, 312, 'master', 26)}${mid(1090, 344, '.m3u8', 26)}${mid(1090, 456, 'lists every version', 22, muted)}</g>
</svg>`;

// Scene 5: four chunks on a clock, the tunnel, and how long each size would take to load in it.
const sx = (t) => 80 + t * 66;
const chunk = (k, label) =>
  `<g id="chunk${k}"><rect x="${sx(4 * k) + 3}" y="380" width="${4 * 66 - 6}" height="90" rx="8" stroke-width="3"/>${mid(sx(4 * k + 2), 435, label, 26)}</g>`;
const tunnel = `<svg viewBox="${VB}">
<g id="wifi">${txt(sx(0), 60, `Wi-Fi: 18 Mbit/s`, 26)}</g>
<g id="tunnelband"><rect x="${sx(7)}" y="80" width="${sx(16) - sx(7)}" height="410" class="tone-bad" stroke-width="3"/>${txt(sx(7) + 14, 60, `tunnel: ${tunnelBps / 1e6} Mbit/s`, 26, ' class="tone-bad"')}</g>
<g id="load1080"><rect x="${sx(8)}" y="150" width="${1190 - sx(8)}" height="60" rx="6" stroke-width="3" stroke-dasharray="10 8" class="tone-bad"/>${txt(sx(8) + 16, 190, `1080p chunk: ${load(5_000_000)} s to load`, 24)}</g>
<g id="load480"><rect x="${sx(8)}" y="250" width="${sx(8 + +load(1_400_000)) - sx(8)}" height="60" rx="6" stroke-width="3" class="tone-good"/>${txt(sx(8 + +load(1_400_000)) + 14, 290, `480p: ${load(1_400_000)} s`, 24)}</g>
${chunk(0, 'chunk 1 · 1080p')}${chunk(1, 'chunk 2 · 1080p')}${chunk(2, 'chunk 3 · 480p')}${chunk(3, 'chunk 4 · 480p')}
<line x1="${sx(0)}" y1="520" x2="${sx(16)}" y2="520" stroke="var(--text)" stroke-width="3"/>
${[0, 4, 8, 12, 16].map((t) => `<line x1="${sx(t)}" y1="510" x2="${sx(t)}" y2="530" stroke="var(--text)" stroke-width="3"/>${mid(sx(t), 566, `${t} s`, 24, muted)}`).join('')}
</svg>`;

// Scene 6: a world map with the origin and four edge locations.
const W = 1200;
const H = 560;
const px = (lon) => +(((lon + 180) / 360) * W).toFixed(1);
const py = (lat) => +(((75 - lat) / 135) * H).toFixed(1);
const poly = (pts) => pts.map(([lon, lat]) => `${px(lon)},${py(lat)}`).join(' ');
const land = {
  na: [
    [-165, 65],
    [-140, 70],
    [-95, 72],
    [-80, 63],
    [-60, 55],
    [-55, 48],
    [-70, 42],
    [-81, 30],
    [-81, 25],
    [-97, 26],
    [-97, 20],
    [-87, 15],
    [-80, 8],
    [-92, 15],
    [-105, 22],
    [-117, 32],
    [-124, 40],
    [-125, 49],
    [-135, 58],
    [-150, 60],
    [-165, 62],
  ],
  sa: [
    [-80, 8],
    [-60, 10],
    [-50, 0],
    [-35, -7],
    [-40, -22],
    [-58, -38],
    [-65, -55],
    [-73, -50],
    [-71, -30],
    [-80, -5],
  ],
  eu: [
    [-10, 36],
    [-9, 43],
    [-1, 46],
    [-5, 48],
    [2, 51],
    [8, 54],
    [9, 57],
    [5, 58],
    [5, 62],
    [14, 68],
    [24, 71],
    [30, 70],
    [29, 62],
    [22, 60],
    [18, 56],
    [12, 54],
    [21, 55],
    [29, 59],
    [42, 62],
    [45, 45],
    [38, 41],
    [28, 41],
    [23, 37],
    [20, 40],
    [16, 38],
    [12, 44],
    [8, 44],
    [3, 42],
    [-1, 37],
  ],
  uk: [
    [-5, 50],
    [1, 51],
    [0, 53],
    [-3, 56],
    [-5, 58],
    [-6, 55],
    [-3, 53],
  ],
  af: [
    [-17, 15],
    [-10, 30],
    [0, 36],
    [10, 37],
    [32, 31],
    [43, 12],
    [51, 12],
    [40, -15],
    [35, -25],
    [20, -35],
    [12, -17],
    [9, 4],
    [-8, 5],
  ],
  as: [
    [45, 45],
    [45, 62],
    [60, 70],
    [100, 77],
    [140, 72],
    [180, 68],
    [170, 60],
    [160, 55],
    [142, 46],
    [135, 35],
    [122, 30],
    [120, 22],
    [108, 20],
    [105, 10],
    [100, 14],
    [98, 8],
    [100, 2],
    [104, 1],
    [98, 16],
    [92, 22],
    [80, 15],
    [77, 8],
    [72, 20],
    [60, 25],
    [50, 30],
    [35, 30],
    [36, 36],
  ],
  au: [
    [114, -22],
    [122, -18],
    [131, -12],
    [137, -12],
    [142, -11],
    [146, -19],
    [153, -28],
    [150, -37],
    [140, -38],
    [132, -32],
    [115, -34],
  ],
  jp: [
    [130, 31],
    [135, 34],
    [140, 36],
    [142, 40],
    [141, 45],
    [144, 43],
    [140, 40],
    [139, 35],
    [133, 33],
  ],
};
const city = {
  origin: { lon: -95.9, lat: 41.3 },
  ny: { lon: -74.0, lat: 40.7, name: 'New York' },
  fra: { lon: 8.7, lat: 50.1, name: 'Frankfurt' },
  sin: { lon: 103.8, lat: 1.35, name: 'Singapore' },
  tyo: { lon: 139.7, lat: 35.7, name: 'Tokyo' },
};
const at = (c) => [px(c.lon), py(c.lat)];
const [ox, oy] = at(city.origin);
const arc = (id, c, lift) => {
  const [x, y] = at(c);
  const mx = (ox + x) / 2;
  const my = Math.min(oy, y) - lift;
  return `<path id="${id}" d="M${ox},${oy} Q${mx.toFixed(1)},${my.toFixed(1)} ${x},${y}" fill="none" stroke="var(--muted)" stroke-width="3" stroke-dasharray="10 8"/>`;
};
const edge = (id, c, dx, dy, anchor = 'start') => {
  const [x, y] = at(c);
  return `<g id="${id}"><circle cx="${x}" cy="${y}" r="13" stroke-width="3"/><text x="${x + dx}" y="${y + dy}" text-anchor="${anchor}" font-size="24">${c.name}</text></g>`;
};
const viewer = (id, c, ddx, ddy) => {
  const [x, y] = at(c);
  return `<g id="${id}"><line x1="${x}" y1="${y}" x2="${x + ddx}" y2="${y + ddy}" stroke="var(--good)" stroke-width="3"/><circle cx="${x + ddx}" cy="${y + ddy}" r="9" class="tone-good" stroke-width="3"/></g>`;
};
const map = `<svg viewBox="0 0 ${W} ${H}">
<g id="land" fill="none" stroke="var(--muted)" stroke-width="2">${Object.values(land)
  .map((p) => `<polygon points="${poly(p)}"/>`)
  .join('')}</g>
${arc('to-ny', city.ny, 30)}${arc('to-fra', city.fra, 90)}${arc('to-tyo', city.tyo, 150)}${arc('to-sin', city.sin, 110)}
<g id="origin"><rect x="${ox - 18}" y="${oy - 18}" width="36" height="36" rx="6" stroke-width="3"/><text x="${ox}" y="${oy + 48}" text-anchor="middle" font-size="24">Origin</text><text x="${ox}" y="${oy + 76}" text-anchor="middle" font-size="22" fill="var(--muted)">every video</text></g>
${edge('ny', city.ny, 18, 36)}${edge('fra', city.fra, 20, -16)}${edge('sin', city.sin, 20, 34)}${edge('tyo', city.tyo, -20, 44, 'end')}
${viewer('v-tyo', city.tyo, 34, -40)}${viewer('v-sin', city.sin, -36, 34)}${viewer('v-fra', city.fra, 36, 34)}
<path id="miss" d="M${ox},${oy} Q${((ox + px(city.fra.lon)) / 2).toFixed(1)},${(py(city.fra.lat) - 90).toFixed(1)} ${px(city.fra.lon)},${py(city.fra.lat)}" fill="none" stroke="var(--bad)" stroke-width="5"/>
</svg>`;

// Scene 7: the video API, its database, and the search index written out as words and video numbers.
const index = [
  ['cat', ['#12', '#87']],
  ['piano', ['#40', '#87']],
  ['lesson', ['#40']],
];
const meta = `<svg viewBox="${VB}">${heads}
${box('api', 20, 250, 260, 120, 'Video API', 'web requests')}
${arrow('to-db', 288, 290, 520, 150)}${txt(420, 262, 'titles, channels, times', 22, muted)}
${box('db', 530, 60, 340, 130, 'Distributed SQL', 'Spanner or CockroachDB')}
${arrow('to-search', 288, 330, 520, 450)}${txt(400, 356, 'words to videos', 22, muted)}
<g id="search"><rect x="530" y="330" width="640" height="290" rx="14" stroke-width="3"/>${mid(850, 372, 'Search index', 28)}
${index
  .map(
    ([w, vids], i) =>
      `<text id="w-${w}" x="580" y="${440 + i * 60}" font-size="28">${w}</text>${vids.map((v, k) => `<text id="${w}-${v.slice(1)}" x="${740 + k * 120}" y="${440 + i * 60}" font-size="28" font-family="mono">${v}</text>`).join('')}`,
  )
  .join('')}</g>
</svg>`;

// Scene 8: a viral video's views, written one at a time, then counted in memory first.
const views = `<svg viewBox="${VB}">${heads}
<text id="sql" x="600" y="50" text-anchor="middle" font-size="24" font-family="mono">UPDATE videos SET views = views + 1</text>
<text id="rate" x="600" y="90" text-anchor="middle" font-size="24"${muted}>× 100,000 a second</text>
${box('viewers', 20, 250, 220, 130, 'Viewers', '100,000 a second')}
<g id="direct">${arrow('', 248, 315, 922, 315)}${txt(280, 300, '+1 each', 24, muted)}</g>
<g id="queue">${[0, 1, 2, 3, 4, 5].map((k) => `<rect x="${600 + k * 52}" y="290" width="44" height="50" rx="6" stroke-width="2"/>${mid(622 + k * 52, 324, '+1', 22)}`).join('')}</g>
${box('row', 930, 250, 250, 130, 'Video #87', 'views column')}
<g id="to-redis">${arrow('', 150, 388, 300, 470)}${txt(110, 450, '+1 in memory', 22, muted)}</g>
${box('redis', 310, 450, 240, 120, 'Redis', 'counts in memory')}
<g id="to-check">${arrow('', 558, 510, 632, 510)}${mid(595, 492, 'batch', 22, muted)}</g>
${box('check', 640, 450, 240, 120, 'Bot check', 'drops fake views')}
<g id="to-row">${arrow('', 888, 470, 1010, 390)}${txt(960, 470, 'one write', 22, muted)}${txt(960, 498, 'a second', 22, muted)}</g>
</svg>`;

const storyboard = {
  title: 'Designing YouTube at scale',
  subtitle: 'From a 4 GB upload to a video that plays on any screen',
  tones: { good: 'what reaches the viewer', bad: 'what stalls or breaks' },
  pictures: { planes },
  scenes: [
    {
      type: 'svg',
      chapter: 'The problem',
      title: 'Video arrives faster than anyone can watch',
      svg: intake,
      narration: 'People upload more than five hundred hours of video to YouTube every minute.',
      labels: { number: 'seven hundred and twenty thousand hours' },
      steps: [
        {
          set: { number: `${fmt(hoursPerDay)} hours`, note: 'of video, every day' },
          focus: ['number', 'note'],
          say: 'Over a day, that is seven hundred and twenty thousand hours.',
        },
      ],
    },
    {
      type: 'svg',
      chapter: 'The problem',
      title: 'Two different problems',
      picture: 'planes',
      narration: 'And someone then watches it on a phone in a train, or on a 4K TV at home.',
      labels: {
        ingest: 'formats',
        storage: 'storage',
        streaming: 'play',
        divider: 'line',
        control: 'control plane',
        data: 'data plane',
      },
      hidden: ['divider', 'control', 'data'],
      steps: [
        { focus: 'ingest', say: 'Uploads arrive in every format and size you can imagine.' },
        { focus: 'storage', say: 'They pile up by the petabyte, every day, and old videos still have to be kept.' },
        {
          focus: 'streaming',
          say: 'And every play has to start fast and never stall, on a weak phone signal or on fast fiber.',
        },
        { show: ['divider'], trace: ['divider'], focus: 'divider', say: 'So we draw a line down the middle.' },
        {
          show: ['control'],
          focus: 'control',
          say: 'On one side, the control plane: small web requests, like titles, search and likes.',
        },
        {
          show: ['data'],
          focus: 'data',
          say: 'On the other side, the data plane: moving huge video files. These are two different problems, and they get different machines.',
        },
      ],
    },
    {
      type: 'svg',
      chapter: 'Upload',
      title: 'Uploading in pieces',
      svg: upload,
      narration:
        'A creator uploads a four gigabyte file from their laptop. Sending it as one huge request would be fragile.',
      hidden: ['file', 'event', 'kafka'],
      labels: {
        file: 'pieces',
        ingest: 'ingestion service',
        blob: 'blob storage',
        p2: 'piece two',
        p4: 'last piece',
        kafka: 'Kafka queue',
        creator: 'app',
      },
      steps: [
        {
          show: ['file'],
          focus: ['file', 'creator', 'gateway'],
          say: `So the app cuts the file into ${chunks} pieces of eight megabytes and sends them one after another, through the gateway.`,
          draw: [{ write: `${mb(FILE)} MB ÷ 8 MB = ${chunks} pieces`, at: [0.04, 0.52], when: 'cuts the file' }],
        },
        {
          tint: { p0: 'good', p1: 'good' },
          focus: ['ingest', 'blob', 'p0', 'p1'],
          say: 'The ingestion service writes each piece to blob storage as it arrives.',
        },
        { tint: { p2: 'bad' }, focus: 'p2', say: 'Then the Wi-Fi drops halfway through piece two.' },
        {
          focus: ['p2', 'ingest', 'creator'],
          say: 'When it comes back, the app asks how much arrived. Sixteen megabytes.',
          draw: [{ write: 'HEAD → Upload-Offset: 16000000', near: 'p2', side: 'above', when: 'how much arrived' }],
        },
        {
          tint: { p2: 'good' },
          focus: 'p2',
          say: 'It carries on from there, instead of starting the whole file again.',
        },
        {
          tint: { p4: 'good' },
          show: ['event', 'kafka'],
          erase: true,
          focus: ['kafka', 'event', 'p4'],
          say: 'When the last piece lands, the service drops a message on a Kafka queue: a new video is ready.',
        },
        {
          focus: 'kafka',
          say: 'The upload is done, and processing can start whenever there is room.',
          draw: [{ tick: 'kafka', tone: 'good', when: 'upload is done' }],
        },
      ],
    },
    {
      type: 'svg',
      chapter: 'Transcoding',
      title: 'One file in, many versions out',
      svg: transcode,
      narration:
        'A 4K file is far too big for a phone on a weak signal. So workers make several smaller versions of it.',
      hidden: ['branches', 'cut', 'manifest'],
      labels: {
        worker: 'free worker',
        branches: 'one per size',
        cut: 'short chunks',
        manifest: 'manifest',
        r1080: '1080p',
        r360: '360p',
      },
      steps: [
        { focus: 'worker', say: 'A free worker takes the next job off the queue.' },
        {
          show: ['branches'],
          focus: 'branches',
          say: 'It splits the work into branches, one per size: 1080p, 720p, 480p and 360p. Each one is a smaller file.',
        },
        {
          show: ['cut'],
          focus: 'cut',
          say: 'Every version is then cut into short chunks, four seconds each, so a player can switch between them at any chunk.',
        },
        {
          show: ['manifest'],
          focus: 'manifest',
          say: 'Last, it writes a manifest: a small text file that lists every version and where its chunks are.',
        },
      ],
    },
    {
      type: 'terminal',
      chapter: 'The manifest',
      title: 'What the player reads first',
      window: 'processed/87/',
      narration: 'Here is that manifest. It is an HLS playlist, and the player reads it before anything else.',
      entries: [
        {
          command: 'cat master.m3u8',
          output: [
            '#EXTM3U',
            ...ladder.flatMap((r) => [
              `#EXT-X-STREAM-INF:BANDWIDTH=${r.bps},RESOLUTION=${r.res}`,
              `${r.name}/index.m3u8`,
            ]),
          ].join('\n'),
        },
        {
          command: 'head -7 480p/index.m3u8',
          output: [
            '#EXTM3U',
            '#EXT-X-VERSION:3',
            '#EXT-X-TARGETDURATION:4',
            '#EXTINF:4.000,',
            'seg_0.ts',
            '#EXTINF:4.000,',
            'seg_1.ts',
          ].join('\n'),
        },
      ],
      steps: [
        {
          focus: ['0:1', '0:2'],
          say: 'Each pair of lines is one version: how many bits a second it needs, its size, and where its own list lives.',
        },
        { focus: ['0:5', '0:6'], say: 'The 480p version needs about one point four megabits a second.' },
        { focus: ['1:2', '1:3', '1:4'], say: 'And its own list names the chunks, four seconds each, in order.' },
      ],
    },
    {
      type: 'svg',
      chapter: 'Playback',
      title: 'A phone goes into a tunnel',
      svg: tunnel,
      narration:
        'Now someone watches on a phone. The player, not the server, picks which version to fetch for every chunk.',
      hidden: ['chunk0', 'chunk1', 'chunk2', 'chunk3', 'tunnelband', 'load1080', 'load480'],
      labels: {
        chunk0: 'first chunk',
        chunk1: 'chunk two',
        tunnelband: 'tunnel',
        load1080: '1080p chunk',
        load480: '480p',
        chunk3: 'never stops',
        wifi: 'good Wi-Fi',
      },
      steps: [
        {
          show: ['chunk0'],
          tint: { chunk0: 'good' },
          focus: ['chunk0', 'wifi'],
          say: 'On good Wi-Fi, the player fetches the first chunk in 1080p.',
        },
        {
          show: ['chunk1'],
          tint: { chunk1: 'good' },
          focus: 'chunk1',
          say: 'It times every download. Still fast, so chunk two is 1080p too.',
        },
        {
          show: ['tunnelband'],
          focus: 'tunnelband',
          say: 'Then the train enters a tunnel, and the next download crawls.',
        },
        {
          show: ['load1080'],
          focus: 'load1080',
          say: `At this speed a 1080p chunk would take ${load(5_000_000)} seconds to load, longer than it plays.`,
        },
        {
          show: ['load480', 'chunk2'],
          tint: { chunk2: 'good' },
          focus: ['load480', 'chunk2'],
          say: `So the player looks at the manifest and asks for 480p, which loads in ${load(1_400_000)}.`,
        },
        {
          show: ['chunk3'],
          tint: { chunk3: 'good' },
          focus: 'chunk3',
          say: 'The picture gets softer for a while, but the video never stops to buffer.',
        },
      ],
    },
    {
      type: 'svg',
      chapter: 'CDN',
      title: 'Chunks near the viewer',
      narration:
        'Chunks are plain files that never change, which makes them perfect for a content delivery network, a CDN.',
      svg: map,
      labels: {
        origin: 'origin',
        ny: 'New York',
        fra: 'Frankfurt',
        sin: 'Singapore',
        tyo: 'Tokyo',
        'v-tyo': 'viewer in Tokyo',
        'v-fra': 'viewer in Frankfurt',
        miss: 'fetches it from the origin',
      },
      hidden: ['to-ny', 'to-fra', 'to-tyo', 'to-sin', 'ny', 'fra', 'sin', 'tyo', 'v-tyo', 'v-sin', 'v-fra', 'miss'],
      steps: [
        {
          focus: 'origin',
          say: 'Every video lives at the origin, a big data center, here in the middle of the United States.',
        },
        {
          show: ['ny', 'fra', 'sin', 'tyo'],
          trace: ['to-ny', 'to-fra', 'to-tyo', 'to-sin'],
          focus: ['ny', 'fra', 'sin', 'tyo'],
          say: 'Edge servers sit close to viewers, in cities like New York, Frankfurt, Singapore and Tokyo.',
        },
        {
          show: ['v-tyo', 'v-sin'],
          tint: { tyo: 'good', sin: 'good' },
          focus: ['v-tyo', 'tyo', 'v-sin', 'sin'],
          say: 'A small slice of videos gets most of the views. Their chunks stay on the edge servers.',
          draw: [
            {
              write: 'popular: served from the edge',
              near: 'sin',
              side: 'below',
              tone: 'good',
              when: 'stay on the edge',
            },
          ],
        },
        {
          focus: ['v-tyo', 'tyo'],
          say: 'So a viewer in Tokyo gets them from Tokyo, not across an ocean.',
        },
        {
          show: ['v-fra'],
          tint: { fra: 'bad' },
          erase: true,
          focus: ['v-fra', 'fra'],
          say: 'The long tail of rarely watched videos is not kept everywhere. A viewer in Frankfurt asks for one.',
        },
        {
          trace: ['miss'],
          focus: ['miss', 'origin'],
          say: 'The edge fetches it from the origin, and keeps a copy for a while.',
          draw: [
            { write: 'long tail: from the origin', near: 'origin', side: 'below', tone: 'bad', when: 'fetches it' },
          ],
        },
      ],
    },
    {
      type: 'svg',
      chapter: 'Metadata and search',
      title: 'A database and a search index',
      svg: meta,
      narration: 'The control plane has its own stores. The video itself is never in them, only facts about it.',
      hidden: ['to-search', 'search'],
      labels: {
        db: 'database',
        'to-db': 'titles',
        search: 'index',
        'w-cat': 'cat',
        'w-piano': 'piano',
        'cat-87': 'eighty seven',
      },
      steps: [
        {
          focus: ['to-db', 'db'],
          say: 'Titles, channels and upload times go in a database that spreads across many machines and still keeps them consistent.',
        },
        {
          show: ['to-search', 'search'],
          focus: ['to-search', 'search'],
          say: 'Search works the other way round. An index lists, for every word, the videos that contain it.',
        },
        {
          focus: ['w-cat', 'w-piano'],
          say: 'Search for cat piano, and it looks up both words.',
          draw: [{ underline: 'w-cat', when: 'cat piano' }, { underline: 'w-piano' }],
        },
        {
          tint: { 'cat-87': 'good', 'piano-87': 'good' },
          focus: ['cat-87', 'piano-87'],
          say: 'It keeps the video that is in both lists: number eighty seven.',
          draw: [{ circle: 'cat-87', when: 'both lists' }, { circle: 'piano-87' }],
        },
      ],
    },
    {
      type: 'svg',
      chapter: 'View counts',
      title: 'Counting 100,000 views a second',
      svg: views,
      narration:
        'Counting views sounds easy. Now imagine a video going viral, with a hundred thousand views every second.',
      hidden: ['sql', 'rate', 'queue', 'to-redis', 'redis', 'to-check', 'check', 'to-row'],
      labels: {
        sql: 'update',
        direct: 'adds one',
        queue: 'queue up',
        row: 'row',
        redis: 'Redis',
        check: 'bot check',
        'to-row': 'one single update',
      },
      steps: [
        {
          show: ['sql', 'rate'],
          tint: { row: 'bad' },
          focus: ['viewers', 'direct', 'row', 'sql'],
          say: 'The simple way: every view runs one update that adds one.',
        },
        {
          focus: ['row', 'sql'],
          say: 'But each update locks the row while it writes.',
          draw: [{ circle: 'row', note: 'one row, one lock', when: 'locks the row' }],
        },
        {
          show: ['queue'],
          focus: 'queue',
          say: 'A hundred thousand of them a second just queue up, and the database falls over.',
        },
        {
          hide: ['direct', 'queue'],
          show: ['to-redis', 'redis'],
          tint: { row: 'clear' },
          erase: true,
          focus: ['to-redis', 'redis'],
          say: 'The fix: count in memory first. Each view bumps a counter in Redis, which is very fast.',
        },
        {
          show: ['to-check', 'check', 'to-row'],
          tint: { row: 'good' },
          set: { sql: 'UPDATE videos SET views = views + 97850', rate: 'once a second' },
          focus: ['to-check', 'check', 'to-row', 'row', 'sql', 'rate'],
          say: 'Once a second, a bot check throws out the fake views, and one single update adds what is left to the row.',
        },
      ],
    },
    {
      type: 'svg',
      chapter: 'The whole system',
      title: 'Two planes, each built for its own job',
      picture: 'planes',
      narration: 'Let’s put it all together.',
      tint: { ingest: 'dim', storage: 'dim', streaming: 'dim' },
      labels: {
        'd-raw': 'raw storage',
        'd-transcode': 'transcoders',
        'd-chunks': 'chunks and manifests',
        'd-cdn': 'CDN',
        'c-views': 'views counted',
        'c-titles': 'titles',
        'c-search': 'search index',
        control: 'small stuff',
        data: 'two planes',
      },
      steps: [
        {
          focus: 'd-raw',
          tint: { 'd-raw': 'good' },
          say: 'The creator uploads in pieces through the gateway, into raw storage.',
        },
        {
          focus: ['d-transcode', 'd-chunks'],
          tint: { 'd-transcode': 'good', 'd-chunks': 'good' },
          say: 'An event on the queue wakes the transcoders, which write chunks and manifests.',
        },
        {
          focus: 'd-cdn',
          tint: { 'd-cdn': 'good' },
          say: 'The CDN keeps popular chunks near viewers, and each player picks the version its connection can carry.',
        },
        {
          focus: 'c-views',
          say: 'And beside all that, the small stuff: views counted in memory before they are written.',
        },
        { focus: ['c-titles', 'c-search'], say: 'Titles in a database, and words in a search index.' },
        {
          focus: ['control', 'data'],
          say: 'Two planes, each built for its own job.',
          draw: [
            { brace: ['c-titles', 'c-accounts'], side: 'left', when: 'two planes' },
            { brace: ['d-raw', 'd-cdn'], side: 'right' },
          ],
        },
      ],
    },
  ],
};

fs.writeFileSync(new URL('./storyboard.json', import.meta.url), JSON.stringify(storyboard, null, 2) + '\n');
fs.writeFileSync(new URL('./hunks.json', import.meta.url), '{}\n');
fs.writeFileSync(new URL('./meta.json', import.meta.url), JSON.stringify({ mode: 'explain' }, null, 2) + '\n');
