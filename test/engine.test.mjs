import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { locateEngine, parseProgress } from '../bin/lib/engine.mjs';
import { sceneSegments, spokenTexts } from '../shared/timing.mjs';
import { narrationKey } from '../shared/voice.mjs';

const ROOT = '/pkg';
const files =
  (...present) =>
  (p) =>
    present.includes(p);
const engineAt = (dir) => path.join(ROOT, 'engine', dir, 'mr-cast-engine');

test('MR_CAST_ENGINE comes first, and must exist', () => {
  const exists = files('/opt/engine', engineAt('bin/darwin-arm64'));
  const env = { MR_CAST_ENGINE: '/opt/engine' };
  assert.deepEqual(locateEngine({ env, root: ROOT, platform: 'darwin', arch: 'arm64', exists }), {
    path: '/opt/engine',
    build: false,
  });
  assert.throws(
    () => locateEngine({ env: { MR_CAST_ENGINE: '/nope' }, root: ROOT, exists }),
    /MR_CAST_ENGINE=\/nope does not exist/,
  );
});

test("the package's binary for this platform comes before a checkout's build", () => {
  const exists = files(
    engineAt('bin/linux-x64'),
    path.join(ROOT, '.git'),
    path.join(ROOT, 'engine/Cargo.toml'),
    engineAt('target/release'),
  );
  const found = locateEngine({ env: {}, root: ROOT, platform: 'linux', arch: 'x64', exists, hasCargo: () => true });
  assert.deepEqual(found, { path: engineAt('bin/linux-x64'), build: false });
  const win = locateEngine({
    env: {},
    root: ROOT,
    platform: 'win32',
    arch: 'x64',
    exists: files(path.join(ROOT, 'engine/bin/win32-x64/mr-cast-engine.exe')),
  });
  assert.equal(win.path, path.join(ROOT, 'engine/bin/win32-x64/mr-cast-engine.exe'));
});

test('a checkout builds its engine with cargo when it is missing or older than its sources', () => {
  const checkout = [path.join(ROOT, '.git'), path.join(ROOT, 'engine/Cargo.toml')];
  const opts = { env: {}, root: ROOT, platform: 'darwin', arch: 'arm64' };
  const built = engineAt('target/release');
  assert.deepEqual(locateEngine({ ...opts, exists: files(...checkout), hasCargo: () => true }), {
    path: built,
    build: true,
  });
  const fresh = { ...opts, exists: files(...checkout, built), hasCargo: () => true };
  assert.equal(locateEngine({ ...fresh, sourcesNewer: () => false }).build, false);
  assert.equal(locateEngine({ ...fresh, sourcesNewer: () => true }).build, true);
  // Without cargo, a binary already built is used as it is; none at all is an error that says what to install.
  assert.deepEqual(locateEngine({ ...opts, exists: files(...checkout, built), hasCargo: () => false }), {
    path: built,
    build: false,
  });
  assert.throws(() => locateEngine({ ...opts, exists: files(...checkout), hasCargo: () => false }), /rustup\.rs/);
});

test('an install without a binary for its platform says so', () => {
  assert.throws(
    () => locateEngine({ env: {}, root: ROOT, platform: 'freebsd', arch: 'x64', exists: files() }),
    /no render engine for freebsd-x64/,
  );
});

test("the engine's progress lines become fractions; other lines are not progress", () => {
  assert.equal(parseProgress('progress 64/128'), 0.5);
  assert.equal(parseProgress('progress 0/0'), 0);
  assert.equal(parseProgress('12948 frames in 18 s'), null);
});

/** A mono 16-bit WAV of `seconds` of a 440 Hz tone after `silence` seconds of nothing. */
function toneWav(file, rate, silence, seconds) {
  const n = Math.round((silence + seconds) * rate);
  const buf = Buffer.alloc(44 + 2 * n);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + 2 * n, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(2 * n, 40);
  for (let i = Math.round(silence * rate); i < n; i++)
    buf.writeInt16LE(Math.round(16000 * Math.sin((2 * Math.PI * 440 * i) / rate)), 44 + 2 * i);
  fs.writeFileSync(file, buf);
}

/** The engine, when this machine has one built or a cargo to build it; the render test needs it. */
function engine() {
  try {
    const found = locateEngine();
    return found.build ? null : found.path;
  } catch {
    return null;
  }
}

test('a voiced render plays each clip from its frame', { skip: !engine() && 'no engine built' }, () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-cast-engine-'));
  try {
    const scene = (text) => ({ type: 'text', narration: text, headline: 'H', items: ['a'] });
    const scenes = [scene('One two three four.'), scene('Five six.')];
    const voiceover = { voice: 'kitten:luna', speed: 1, pauses: 1, clips: {} };
    fs.mkdirSync(path.join(work, 'audio'));
    for (const [i, s] of scenes.entries()) {
      toneWav(path.join(work, `audio/${i}0000000.wav`), 24000, 0, 1.5);
      voiceover.clips[narrationKey(spokenTexts(s)[0], voiceover.voice)] = {
        src: `audio/${i}0000000.wav`,
        seconds: 1.5,
      };
    }
    const segments = scenes.map((s) => sceneSegments(s, voiceover));
    assert.ok(segments.every((s) => s[0].clip));
    const props = path.join(work, 'props.json');
    fs.writeFileSync(props, JSON.stringify({ storyboard: { title: 'T', scenes }, hunks: {}, voiceover }));
    const out = path.join(work, 'v.mp4');
    execFileSync(engine(), ['render', '--props', props, '--out', out, '--media-dir', work], { stdio: 'ignore' });
    // The engine reads its MP4 back and decodes the voice-over as it plays: 48 kHz mono.
    const raw = path.join(work, 'voice.raw');
    const probe = JSON.parse(execFileSync(engine(), ['probe', '--in', out, '--pcm', raw], { encoding: 'utf8' }));
    assert.deepEqual(
      probe.tracks.map((t) => t.codec),
      ['avc1', 'mp4a', 'text'],
    );
    assert.deepEqual(
      probe.chapters.map((c) => c.start),
      [0],
    );
    const pcm = fs.readFileSync(raw);
    const samples = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2);
    const onsets = [];
    for (let i = 0; i < samples.length; i++)
      if (Math.abs(samples[i]) > 2000 && (onsets.length === 0 || i - onsets.at(-1).end > 4800))
        onsets.push({ start: i, end: i });
      else if (Math.abs(samples[i]) > 2000) onsets.at(-1).end = i;
    const second = segments[0].at(-1).from + segments[0].at(-1).durationInFrames;
    const expected = [segments[0][0].voiceFrom, second + segments[1][0].voiceFrom].map((f) => (f / 30) * 48000);
    assert.equal(onsets.length, 2);
    // AAC smears an onset by a few milliseconds; a frame is 1600 samples.
    for (const [k, e] of expected.entries())
      assert.ok(Math.abs(onsets[k].start - e) < 400, `${onsets[k].start} vs ${e}`);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
});
