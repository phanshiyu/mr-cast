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
const card = (id, x, title, line) =>
  `<g id="${id}"><rect x="${x}" y="20" width="360" height="120" rx="14" class="tone-warn" stroke-width="3"/><text x="${x + 180}" y="68" text-anchor="middle" font-size="30">${title}</text><text x="${x + 180}" y="110" text-anchor="middle" font-size="22" fill="var(--muted)">${line}</text></g>`;
const chip = (x, y, label) =>
  `<rect x="${x}" y="${y}" width="440" height="56" rx="12"/><text x="${x + 220}" y="${y + 37}" text-anchor="middle" font-size="24">${label}</text>`;
const planes = `<svg viewBox="0 0 1200 640">
${card('ingest', 20, 'Ingestion', 'any format, codec and size')}
${card('storage', 420, 'Storage', 'petabytes a day, hot and cold')}
${card('streaming', 820, 'Streaming', 'a 3G phone to a 4K TV, no stalls')}
<line id="divider" x1="600" y1="190" x2="600" y2="630" stroke="var(--text)" stroke-width="4" stroke-dasharray="14 10"/>
<g id="control"><text x="300" y="230" text-anchor="middle" font-size="32" class="tone-accent">Control plane</text><text x="300" y="268" text-anchor="middle" font-size="22" fill="var(--muted)">small web requests</text>
${chip(80, 300, 'titles and descriptions')}${chip(80, 376, 'search')}${chip(80, 452, 'likes, comments, view counts')}${chip(80, 528, 'accounts and channels')}</g>
<g id="data"><text x="900" y="230" text-anchor="middle" font-size="32" class="tone-good">Data plane</text><text x="900" y="268" text-anchor="middle" font-size="22" fill="var(--muted)">huge files on the move</text>
${chip(680, 300, 'raw uploads')}${chip(680, 376, 'transcoding')}${chip(680, 452, 'stored video chunks')}${chip(680, 528, 'CDN delivery')}</g>
</svg>`;

// Scene 6: a world map with the origin and four edge locations.
const W = 1200;
const H = 560;
const px = (lon) => +(((lon + 180) / 360) * W).toFixed(1);
const py = (lat) => +(((75 - lat) / 135) * H).toFixed(1);
const poly = (pts) => pts.map(([lon, lat]) => `${px(lon)},${py(lat)}`).join(' ');
const land = {
  na: [[-165, 65], [-140, 70], [-95, 72], [-80, 63], [-60, 55], [-55, 48], [-70, 42], [-81, 30], [-81, 25], [-97, 26], [-97, 20], [-87, 15], [-80, 8], [-92, 15], [-105, 22], [-117, 32], [-124, 40], [-125, 49], [-135, 58], [-150, 60], [-165, 62]],
  sa: [[-80, 8], [-60, 10], [-50, 0], [-35, -7], [-40, -22], [-58, -38], [-65, -55], [-73, -50], [-71, -30], [-80, -5]],
  eu: [[-10, 36], [-9, 43], [-1, 46], [-5, 48], [2, 51], [8, 54], [9, 57], [5, 58], [5, 62], [14, 68], [24, 71], [30, 70], [29, 62], [22, 60], [18, 56], [12, 54], [21, 55], [29, 59], [42, 62], [45, 45], [38, 41], [28, 41], [23, 37], [20, 40], [16, 38], [12, 44], [8, 44], [3, 42], [-1, 37]],
  uk: [[-5, 50], [1, 51], [0, 53], [-3, 56], [-5, 58], [-6, 55], [-3, 53]],
  af: [[-17, 15], [-10, 30], [0, 36], [10, 37], [32, 31], [43, 12], [51, 12], [40, -15], [35, -25], [20, -35], [12, -17], [9, 4], [-8, 5]],
  as: [[45, 45], [45, 62], [60, 70], [100, 77], [140, 72], [180, 68], [170, 60], [160, 55], [142, 46], [135, 35], [122, 30], [120, 22], [108, 20], [105, 10], [100, 14], [98, 8], [100, 2], [104, 1], [98, 16], [92, 22], [80, 15], [77, 8], [72, 20], [60, 25], [50, 30], [35, 30], [36, 36]],
  au: [[114, -22], [122, -18], [131, -12], [137, -12], [142, -11], [146, -19], [153, -28], [150, -37], [140, -38], [132, -32], [115, -34]],
  jp: [[130, 31], [135, 34], [140, 36], [142, 40], [141, 45], [144, 43], [140, 40], [139, 35], [133, 33]],
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
const arc = (id, c, lift, cls = 'var(--muted)', dash = '10 8') => {
  const [x, y] = at(c);
  const mx = (ox + x) / 2;
  const my = Math.min(oy, y) - lift;
  return `<path id="${id}" d="M${ox},${oy} Q${mx.toFixed(1)},${my.toFixed(1)} ${x},${y}" fill="none" stroke="${cls}" stroke-width="3" stroke-dasharray="${dash}"/>`;
};
const edge = (id, c, dx, dy, anchor = 'start') => {
  const [x, y] = at(c);
  return `<g id="${id}"><circle cx="${x}" cy="${y}" r="13" class="tone-accent" stroke-width="3"/><text x="${x + dx}" y="${y + dy}" text-anchor="${anchor}" font-size="24">${c.name}</text></g>`;
};
const viewer = (id, c, ddx, ddy) => {
  const [x, y] = at(c);
  return `<g id="${id}"><line x1="${x}" y1="${y}" x2="${x + ddx}" y2="${y + ddy}" stroke="var(--good)" stroke-width="3"/><circle cx="${x + ddx}" cy="${y + ddy}" r="9" class="tone-good" stroke-width="3"/></g>`;
};
const map = `<svg viewBox="0 0 ${W} ${H}">
<g id="land" fill="var(--surface)" stroke="var(--border)" stroke-width="2">${Object.values(land)
  .map((p) => `<polygon points="${poly(p)}"/>`)
  .join('')}</g>
${arc('to-ny', city.ny, 30)}${arc('to-fra', city.fra, 90)}${arc('to-tyo', city.tyo, 150)}${arc('to-sin', city.sin, 110)}
<g id="origin"><rect x="${ox - 18}" y="${oy - 18}" width="36" height="36" rx="6" class="tone-warn" stroke-width="3"/><text x="${ox}" y="${oy + 48}" text-anchor="middle" font-size="24">Origin</text><text x="${ox}" y="${oy + 76}" text-anchor="middle" font-size="20" fill="var(--muted)">every video, cold and hot</text></g>
${edge('ny', city.ny, 18, 36)}${edge('fra', city.fra, 20, -16)}${edge('sin', city.sin, 20, 34)}${edge('tyo', city.tyo, -20, 44, 'end')}
${viewer('v-tyo', city.tyo, 34, -40)}${viewer('v-sin', city.sin, -36, 34)}${viewer('v-fra', city.fra, 36, 34)}
<path id="miss" d="M${ox},${oy} Q${((ox + px(city.fra.lon)) / 2).toFixed(1)},${(py(city.fra.lat) - 90).toFixed(1)} ${px(city.fra.lon)},${py(city.fra.lat)}" fill="none" stroke="var(--warn)" stroke-width="5"/>
</svg>`;


// Scene 9: the whole system as four bands, snaking left and right.
const BW = 230;
const BH = 64;
const rows = { upload: 60, processing: 210, delivery: 360, metadata: 510 };
const boxes = {
  creator: [30, rows.upload, 'Creator', 'tone-good'],
  gateway: [320, rows.upload, 'API gateway'],
  upload: [630, rows.upload, 'Chunked upload'],
  raw: [940, rows.upload, 'Raw storage'],
  queue: [940, rows.processing, 'Queue'],
  transcode: [630, rows.processing, 'Transcoder pool'],
  processed: [320, rows.processing, 'Chunks + manifests'],
  cdn: [320, rows.delivery, 'CDN edges'],
  viewer: [630, rows.delivery, 'Viewer', 'tone-good'],
  buffer: [630, rows.metadata, 'View buffer'],
  sql: [320, rows.metadata, 'Distributed SQL'],
  search: [30, rows.metadata, 'Search index'],
};
const boxSvg = Object.entries(boxes)
  .map(
    ([id, [x, y, label, cls]]) =>
      `<g id="n-${id}"><rect x="${x}" y="${y}" width="${BW}" height="${BH}" rx="12" stroke-width="3"${cls ? ` class="${cls}"` : ''}/><text x="${x + BW / 2}" y="${y + 41}" text-anchor="middle" font-size="23">${label}</text></g>`,
  )
  .join('\n');
// An arrow from one box to the next: sideways when they share a row, else straight down.
const link = (id, from, to, label = '', dashed = false) => {
  const [x1, y1] = boxes[from];
  const [x2, y2] = boxes[to];
  let a;
  if (y1 === y2) a = x2 > x1 ? [x1 + BW, y1 + BH / 2, x2 - 6, y2 + BH / 2] : [x1, y1 + BH / 2, x2 + BW + 6, y2 + BH / 2];
  else a = [x1 + BW / 2, y1 + BH, x2 + BW / 2, y2 - 6];
  const [ax, ay, bx, by] = a;
  const text = label ? `<text x="${(ax + bx) / 2 + (y1 === y2 ? 0 : 12)}" y="${(ay + by) / 2 + (y1 === y2 ? -10 : 8)}" text-anchor="${y1 === y2 ? 'middle' : 'start'}" font-size="20" fill="var(--muted)">${label}</text>` : '';
  return `<g id="e-${id}"><line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="var(--muted)" stroke-width="3"${dashed ? ' stroke-dasharray="10 8"' : ''} marker-end="url(#head)"/>${text}</g>`;
};
const band = (id, y, label, cls) => `<text id="band-${id}" x="30" y="${y - 14}" font-size="20" class="${cls}">${label}</text>`;
const topology = `<svg viewBox="0 0 1200 600">
<defs><marker id="head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="var(--muted)" stroke="none"/></marker></defs>
${band('upload', rows.upload, 'UPLOAD', 'tone-good')}${band('processing', rows.processing, 'PROCESSING', 'tone-good')}${band('delivery', rows.delivery, 'DELIVERY', 'tone-good')}${band('metadata', rows.metadata, 'METADATA', 'tone-accent')}
${link('creator', 'creator', 'gateway')}${link('gateway', 'gateway', 'upload')}${link('upload', 'upload', 'raw')}
${link('raw', 'raw', 'queue', 'event')}${link('queue', 'queue', 'transcode')}${link('transcode', 'transcode', 'processed')}
${link('processed', 'processed', 'cdn')}${link('cdn', 'cdn', 'viewer', 'chunks')}
${link('viewer', 'viewer', 'buffer', 'views', true)}${link('buffer', 'buffer', 'sql', '', true)}${link('sql', 'sql', 'search', '', true)}
${boxSvg}
</svg>`;

const storyboard = {
  title: 'Designing YouTube at scale',
  subtitle: 'From a 4 GB upload to a video that plays on any screen',
  scenes: [
    {
      type: 'svg',
      chapter: 'The problem',
      title: 'Two different problems',
      narration: 'People upload more than five hundred hours of video to YouTube every minute. Someone then watches it on a phone in a train, or on a 4K TV at home.',
      svg: planes,
      callout: `500 h/min × 60 × 24 = **${fmt(hoursPerDay)} hours a day**`,
      labels: { ingest: 'formats', storage: 'storage', streaming: 'play', divider: 'line', control: 'control plane', data: 'data plane' },
      hidden: ['divider', 'control', 'data'],
      steps: [
        { focus: 'ingest', say: 'Uploads arrive in every format and size you can imagine.' },
        { focus: 'storage', say: 'They pile up by the petabyte, every day, and old videos still have to be kept.' },
        { focus: 'streaming', say: 'And every play has to start fast and never stall, on a weak phone signal or on fast fiber.' },
        {
          show: ['divider', 'control'],
          focus: ['divider', 'control'],
          say: 'So we draw a line down the middle. On one side, the control plane: small web requests, like titles, search and likes.',
        },
        {
          show: ['data'],
          focus: 'data',
          say: 'On the other side, the data plane: moving huge video files. These are two different problems, and they get different machines.',
        },
      ],
    },
    {
      type: 'graph',
      chapter: 'Upload',
      title: 'Uploading in pieces',
      layout: 'TB',
      narration: 'A creator uploads a four gigabyte file from their laptop. Sending it as one huge request would be fragile.',
      nodes: [
        { id: 'creator', label: 'Creator', icon: 'user', caption: 'video.mov, 4 GB 4K ProRes', tone: 'good' },
        { id: 'gateway', label: 'API gateway', icon: 'network', caption: 'load balancer' },
        { id: 'ingest', label: 'Ingestion service', icon: 'server', caption: 'resumable upload' },
        { id: 'blob', label: 'Blob storage', icon: 'database', caption: 'S3 or GCS, temporary' },
        { id: 'kafka', label: 'Kafka topic', icon: 'list-ordered', caption: 'video_uploaded', hidden: true },
      ],
      edges: [
        { from: 'creator', to: 'gateway', label: '8 MB pieces' },
        { from: 'gateway', to: 'ingest' },
        { from: 'ingest', to: 'blob', label: 'write' },
        { from: 'ingest', to: 'kafka', label: 'event', hidden: true },
      ],
      table: {
        columns: ['Piece', 'Bytes', 'Status'],
        rows: [
          { cells: ['0', '0–8 MB', 'waiting'] },
          { cells: ['1', '8–16 MB', 'waiting'] },
          { cells: ['2', '16–24 MB', 'waiting'] },
          { cells: ['…', '…', '…'] },
          { cells: [String(chunks - 1), `${mb(FILE - CHUNK)}–${mb(FILE)} MB`, 'waiting'] },
        ],
      },
      callout: `${mb(FILE)} MB ÷ 8 MB = **${chunks} pieces**`,
      steps: [
        {
          focus: ['creator', 'creator->gateway', 'gateway'],
          say: `So the app cuts the file into ${chunks} pieces of eight megabytes and sends them one after another, through the gateway.`,
        },
        {
          set: { 'Status@0': 'stored', 'Status@1': 'stored' },
          tint: { 'row:0': 'good', 'row:1': 'good' },
          focus: ['ingest', 'ingest->blob', 'blob', 'row:0', 'row:1'],
          say: 'The ingestion service writes each piece to blob storage as it arrives.',
        },
        {
          set: { 'Status@2': 'cut off' },
          tint: { 'row:2': 'bad' },
          focus: 'row:2',
          say: 'Then the Wi-Fi drops halfway through piece two.',
        },
        {
          set: { 'Status@2': { before: 'cut off', after: 'stored' } },
          tint: { 'row:2': 'good' },
          focus: ['row:2', 'ingest'],
          callout: '`HEAD` → `Upload-Offset: 16000000`',
          say: 'When it comes back, the app asks how much arrived. Sixteen megabytes. It carries on from there, instead of starting the whole file again.',
        },
        {
          set: { [`Status@${chunks - 1}`]: 'stored' },
          tint: { 'row:4': 'good' },
          show: ['kafka', 'ingest->kafka'],
          focus: ['kafka', 'ingest->kafka', 'row:4'],
          callout: 'event: `video_uploaded`',
          say: 'When the last piece lands, the service drops a message on a Kafka queue: a new video is ready. The upload is done, and processing can start whenever there is room.',
        },
      ],
    },
    {
      type: 'graph',
      chapter: 'Transcoding',
      title: 'One file in, many versions out',
      narration: 'A 4K file is far too big for a phone on a weak signal. So workers make several smaller versions of it.',
      nodes: [
        { id: 'queue', label: 'Kafka topic', icon: 'list-ordered', caption: 'video_uploaded' },
        { id: 'worker', label: 'Transcoding worker', icon: 'cpu', caption: 'runs a task graph' },
        { id: 'r1080', label: '1080p', shape: 'step', caption: 'H.264, 5 Mbit/s', hidden: true },
        { id: 'r720', label: '720p', shape: 'step', caption: 'H.264, 2.8 Mbit/s', hidden: true },
        { id: 'r480', label: '480p', shape: 'step', caption: 'H.264, 1.4 Mbit/s', hidden: true },
        { id: 'r360', label: '360p', shape: 'step', caption: 'H.264, 0.8 Mbit/s', hidden: true },
        { id: 'cut', label: 'Cut into 4 s chunks', shape: 'step', caption: 'seg_0.ts, seg_1.ts, …', hidden: true },
        { id: 'manifest', label: 'master.m3u8', icon: 'file-text', caption: 'the manifest', hidden: true },
      ],
      edges: [
        { from: 'queue', to: 'worker', label: 'next job' },
        ...ladder.map((r) => ({ from: 'worker', to: `r${r.name.replace('p', '')}`, hidden: true })),
        ...ladder.map((r) => ({ from: `r${r.name.replace('p', '')}`, to: 'cut', hidden: true })),
        { from: 'cut', to: 'manifest', hidden: true },
      ],
      steps: [
        { focus: ['queue', 'queue->worker', 'worker'], say: 'A free worker takes the next job off the queue.' },
        {
          show: ['r1080', 'r720', 'r480', 'r360', 'worker->r1080', 'worker->r720', 'worker->r480', 'worker->r360'],
          focus: ['r1080', 'r720', 'r480', 'r360'],
          say: 'It splits the work into branches, one per size: 1080p, 720p, 480p and 360p. Each one is a smaller file.',
        },
        {
          show: ['cut', 'r1080->cut', 'r720->cut', 'r480->cut', 'r360->cut'],
          focus: 'cut',
          say: 'Every version is then cut into short chunks, four seconds each, so a player can switch between them at any chunk.',
        },
        {
          show: ['manifest', 'cut->manifest'],
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
          output: ['#EXTM3U', ...ladder.flatMap((r) => [`#EXT-X-STREAM-INF:BANDWIDTH=${r.bps},RESOLUTION=${r.res}`, `${r.name}/index.m3u8`])].join('\n'),
        },
        {
          command: 'head -7 480p/index.m3u8',
          output: ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:4', '#EXTINF:4.000,', 'seg_0.ts', '#EXTINF:4.000,', 'seg_1.ts'].join('\n'),
        },
      ],
      steps: [
        { focus: ['0:1', '0:2'], say: 'Each pair of lines is one version: how many bits a second it needs, its size, and where its own list lives.' },
        { focus: ['0:5', '0:6'], say: 'The 480p version needs about one point four megabits a second.' },
        { focus: ['1:2', '1:3', '1:4'], say: 'And its own list names the chunks, four seconds each, in order.' },
      ],
    },
    {
      type: 'timeline',
      chapter: 'Playback',
      title: 'A phone goes into a tunnel',
      unit: 's',
      narration: 'Now someone watches on a phone. The player, not the server, picks which version to fetch for every chunk.',
      events: [
        { at: 0, label: 'Chunk 1 in 1080p', detail: 'Wi-Fi 5 bars, 18 Mbit/s', tone: 'good' },
        { at: 4, label: 'Chunk 2 in 1080p', detail: 'still fast', tone: 'good' },
        { at: 7, label: 'Tunnel: 1 bar', detail: `speed falls to ${tunnelBps / 1e6} Mbit/s`, tone: 'bad' },
        { at: 8, label: 'Chunk 3 in 480p', detail: `4 s of 480p loads in ${load(1_400_000)} s`, tone: 'warn' },
        { at: 12, label: 'Chunk 4 in 480p', detail: 'no pause', tone: 'warn' },
      ],
      spans: [
        { from: 0, to: 4, label: 'chunk 1', tone: 'good' },
        { from: 4, to: 8, label: 'chunk 2', tone: 'good' },
        { from: 8, to: 12, label: 'chunk 3', tone: 'warn' },
        { from: 12, to: 16, label: 'chunk 4', tone: 'warn' },
      ],
      steps: [
        { focus: [0, 'span:chunk 1'], say: 'On good Wi-Fi, the player fetches the first chunk in 1080p.' },
        { focus: [1, 'span:chunk 2'], say: 'It times every download. Still fast, so chunk two is 1080p too.' },
        { focus: 2, say: 'Then the train enters a tunnel, and the next download crawls.' },
        {
          focus: [3, 'span:chunk 3'],
          say: `At this speed a 1080p chunk would take ${load(5_000_000)} seconds to load, longer than it plays. So the player looks at the manifest and asks for 480p, which loads in ${load(1_400_000)}.`,
        },
        { focus: [4, 'span:chunk 4'], say: 'The picture gets softer for a while, but the video never stops to buffer.' },
      ],
    },
    {
      type: 'svg',
      chapter: 'CDN',
      title: 'Chunks near the viewer',
      narration: 'Chunks are plain files that never change, which makes them perfect for a content delivery network, a CDN.',
      svg: map,
      labels: {
        origin: 'origin',
        ny: 'New York',
        fra: 'Frankfurt',
        sin: 'Singapore',
        tyo: 'Tokyo',
        'v-tyo': 'viewer in Tokyo',
        'v-fra': 'viewer in Frankfurt',
        miss: 'fetch from the origin',
      },
      hidden: ['to-ny', 'to-fra', 'to-tyo', 'to-sin', 'ny', 'fra', 'sin', 'tyo', 'v-tyo', 'v-sin', 'v-fra', 'miss'],
      steps: [
        { focus: 'origin', say: 'Every video lives at the origin, a big data center, here in the middle of the United States.' },
        {
          show: ['to-ny', 'to-fra', 'to-tyo', 'to-sin', 'ny', 'fra', 'sin', 'tyo'],
          focus: ['ny', 'fra', 'sin', 'tyo'],
          say: 'Edge servers sit close to viewers, in cities like New York, Frankfurt, Singapore and Tokyo.',
        },
        {
          show: ['v-tyo', 'v-sin'],
          tint: { tyo: 'good', sin: 'good' },
          focus: ['v-tyo', 'tyo', 'v-sin', 'sin'],
          callout: 'popular videos: served from the edge',
          say: 'A small slice of videos gets most of the views. Their chunks stay on the edge servers, so a viewer in Tokyo gets them from Tokyo, not across an ocean.',
        },
        {
          show: ['v-fra', 'miss'],
          tint: { fra: 'warn' },
          focus: ['v-fra', 'miss', 'origin'],
          callout: 'long tail: the edge fetches from the origin once',
          say: 'The long tail of rarely watched videos is not kept everywhere. When a viewer in Frankfurt asks for one, the edge fetches it from the origin, and keeps a copy for a while.',
        },
      ],
    },
    {
      type: 'graph',
      chapter: 'Metadata and search',
      title: 'A database and a search index',
      narration: 'The control plane has its own stores. The video itself is never in them, only facts about it.',
      nodes: [
        { id: 'api', label: 'Video API', icon: 'server', caption: 'web requests' },
        { id: 'db', label: 'Distributed SQL', icon: 'database', caption: 'Spanner or CockroachDB' },
        { id: 'search', label: 'Search index', icon: 'search', caption: 'Elasticsearch' },
      ],
      edges: [
        { from: 'api', to: 'db', label: 'titles, channels, times' },
        { from: 'api', to: 'search', label: 'words → videos' },
      ],
      table: {
        columns: ['Word', 'Videos'],
        rows: [{ cells: ['cat', '#12, #87'] }, { cells: ['piano', '#40, #87'] }, { cells: ['lesson', '#40'] }],
      },
      steps: [
        { focus: ['api->db', 'db'], say: 'Titles, channels and upload times go in a database that spreads across many machines and still keeps them consistent.' },
        {
          focus: ['api->search', 'search', 'row:cat', 'row:piano', 'row:lesson'],
          say: 'Search works the other way round. An index lists, for every word, the videos that contain it, from their titles, descriptions and transcripts.',
        },
        {
          focus: ['Videos@cat', 'Videos@piano'],
          tint: { 'Videos@cat': 'accent', 'Videos@piano': 'accent' },
          callout: '"cat piano": #12, #87 and #40, #87 → **#87**',
          say: 'Search for cat piano, and it looks up both words and keeps the video that is in both lists: number eighty seven.',
        },
      ],
    },
    {
      type: 'graph',
      chapter: 'View counts',
      title: 'Counting 100,000 views a second',
      narration: 'Counting views sounds easy. Now imagine a video going viral, with a hundred thousand views every second.',
      nodes: [
        { id: 'viewers', label: 'Viewers', icon: 'users', caption: '100,000 views a second', tone: 'good' },
        { id: 'redis', label: 'Redis buffer', icon: 'memory-stick', caption: 'counts in memory', hidden: true },
        { id: 'check', label: 'Bot check', icon: 'shield-check', caption: 'drops fake views', hidden: true },
        { id: 'row', label: 'Video #87’s row', icon: 'database', caption: 'views column' },
      ],
      edges: [
        { from: 'viewers', to: 'row', label: '+1 each' },
        { from: 'viewers', to: 'redis', label: '+1 in memory', hidden: true },
        { from: 'redis', to: 'check', label: 'batch', hidden: true },
        { from: 'check', to: 'row', label: 'one write a second', hidden: true },
      ],
      steps: [
        {
          focus: ['viewers', 'viewers->row', 'row'],
          tint: { row: 'bad' },
          callout: '`UPDATE videos SET views = views + 1` × 100,000 a second',
          say: 'The simple way: every view runs one update that adds one.',
        },
        {
          focus: 'row',
          mark: 'circle',
          note: 'one row, one lock',
          say: 'But each update locks the row while it writes. A hundred thousand of them a second just queue up behind each other, and the database falls over.',
        },
        {
          hide: ['viewers->row'],
          show: ['redis', 'viewers->redis'],
          tint: { row: 'clear' },
          focus: ['viewers->redis', 'redis'],
          callout: '',
          say: 'The fix: count in memory first. Each view bumps a counter in Redis, which is very fast.',
        },
        {
          show: ['check', 'redis->check', 'check->row'],
          tint: { row: 'good' },
          focus: ['redis->check', 'check', 'check->row', 'row'],
          callout: '`UPDATE videos SET views = views + 97850` once a second',
          say: 'Once a second, a bot check throws out the fake views, and one single update adds what is left to the row.',
        },
      ],
    },
    {
      type: 'svg',
      chapter: 'The whole system',
      title: 'From upload to screen',
      narration: 'Let’s put it all together.',
      svg: topology,
      labels: {
        'n-creator': 'creator',
        'n-gateway': 'gateway',
        'n-upload': 'pieces',
        'n-raw': 'raw storage',
        'n-queue': 'queue',
        'n-transcode': 'transcoders',
        'n-processed': 'chunks and manifests',
        'n-cdn': 'CDN',
        'n-viewer': 'player',
        'n-buffer': 'counted in memory',
        'n-sql': 'database',
        'n-search': 'search index',
      },
      steps: [
        {
          focus: ['band-upload', 'n-creator', 'e-creator', 'n-gateway', 'e-gateway', 'n-upload', 'e-upload', 'n-raw'],
          say: 'The creator uploads in pieces through the gateway, into raw storage.',
        },
        {
          focus: ['band-processing', 'e-raw', 'n-queue', 'e-queue', 'n-transcode', 'e-transcode', 'n-processed'],
          say: 'An event on the queue wakes the transcoders, which write chunks and manifests.',
        },
        {
          focus: ['band-delivery', 'e-processed', 'n-cdn', 'e-cdn', 'n-viewer'],
          say: 'The CDN keeps popular chunks near viewers, and each player picks the version its connection can carry.',
        },
        {
          focus: ['band-metadata', 'e-viewer', 'n-buffer', 'e-buffer', 'n-sql', 'e-sql', 'n-search'],
          say: 'And beside all that, the small stuff: views counted in memory before they are written, titles in a database, and words in a search index. Two planes, each built for its own job.',
        },
      ],
    },
  ],
};

fs.writeFileSync(new URL('./storyboard.json', import.meta.url), JSON.stringify(storyboard, null, 2) + '\n');
fs.writeFileSync(new URL('./hunks.json', import.meta.url), '{}\n');
fs.writeFileSync(new URL('./meta.json', import.meta.url), JSON.stringify({ mode: 'explain' }, null, 2) + '\n');
