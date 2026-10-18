// What one reviewer agent did, from its JSONL transcript: tool calls, files it opened, tokens, wall time,
// and whether it looked at the walkthrough packet before the code.
// Usage: node transcript.mjs <transcript.jsonl> <repo-dir> [packet-dir]   (JSON to stdout)
import fs from 'node:fs';
import path from 'node:path';

const [file, repo, packet] = process.argv.slice(2);
const entries = fs
  .readFileSync(file, 'utf8')
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l));
const seen = new Set();
const calls = [];
let input = 0,
  output = 0,
  cacheRead = 0,
  cacheWrite = 0,
  peakContext = 0,
  resultChars = 0;
const models = new Set();
const times = entries
  .map((e) => e.timestamp)
  .filter(Boolean)
  .map((t) => Date.parse(t));
for (const e of entries) {
  if (e.type === 'user' && Array.isArray(e.message?.content)) {
    for (const c of e.message.content) {
      if (c.type !== 'tool_result') continue;
      const parts = typeof c.content === 'string' ? [{ type: 'text', text: c.content }] : (c.content ?? []);
      for (const part of parts) if (part.type === 'text') resultChars += part.text.length;
    }
  }
  if (e.type !== 'assistant' || !e.message) continue;
  const id = e.message.id ?? e.uuid;
  if (!seen.has(id) && e.message.usage) {
    seen.add(id);
    const u = e.message.usage;
    input += u.input_tokens ?? 0;
    output += u.output_tokens ?? 0;
    cacheRead += u.cache_read_input_tokens ?? 0;
    cacheWrite += u.cache_creation_input_tokens ?? 0;
    peakContext = Math.max(
      peakContext,
      (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
    );
  }
  if (e.message.model) models.add(e.message.model);
  for (const c of e.message.content ?? []) if (c.type === 'tool_use' && c.name !== 'SubagentHandback') calls.push(c);
}

const repoFiles = new Set();
const packetFiles = new Set();
let firstRepoCall = null,
  firstPacketCall = null,
  diffCalls = 0;
const repoAbs = path.resolve(repo);
const packetAbs = packet ? path.resolve(packet) : null;
const pathLike = /[\w@~.\/-]+\.(?:ts|tsx|js|mjs|py|sql|md|json|png|sh)\b/g;
const tracked = (p) => {
  if (path.isAbsolute(p)) {
    if (packetAbs && p.startsWith(packetAbs + path.sep)) return ['packet', path.relative(packetAbs, p)];
    if (p.startsWith(repoAbs + path.sep) && fs.existsSync(p)) return ['repo', path.relative(repoAbs, p)];
    return null;
  }
  if (packetAbs && /^(scene-\d+\.png|packet\.md|reading\.md)$/.test(path.basename(p)))
    return ['packet', path.basename(p)];
  if (fs.existsSync(path.join(repoAbs, p))) return ['repo', path.normalize(p)];
  return null;
};
calls.forEach((c, i) => {
  const inp = c.input ?? {};
  const texts = [inp.file_path, inp.path, inp.command, inp.pattern && inp.path].filter((x) => typeof x === 'string');
  let touchedRepo = false,
    touchedPacket = false;
  for (const t of texts) {
    for (const m of t.match(pathLike) ?? []) {
      const hit = tracked(m);
      if (hit?.[0] === 'repo') {
        repoFiles.add(hit[1]);
        touchedRepo = true;
      }
      if (hit?.[0] === 'packet') {
        packetFiles.add(hit[1]);
        touchedPacket = true;
      }
    }
    if (t.includes(repoAbs)) touchedRepo = true;
    if (packetAbs && t.includes(packetAbs)) touchedPacket = true;
  }
  if (typeof inp.command === 'string' && /\bgit\b[^|;&]*\b(diff|show|log -p)\b/.test(inp.command)) {
    diffCalls++;
    touchedRepo = true;
  }
  if (touchedRepo && firstRepoCall === null) firstRepoCall = i;
  if (touchedPacket && firstPacketCall === null) firstPacketCall = i;
});

const byTool = {};
for (const c of calls) byTool[c.name] = (byTool[c.name] ?? 0) + 1;
console.log(
  JSON.stringify({
    toolCalls: calls.length,
    byTool,
    repoFilesOpened: [...repoFiles].sort(),
    diffCalls,
    packetFilesOpened: [...packetFiles].sort(),
    scenesViewed: [...packetFiles].filter((f) => f.endsWith('.png')).length,
    readingMdRead: packetFiles.has('reading.md'),
    firstPacketCall,
    firstRepoCall,
    tokens: { input, output, cacheRead, cacheWrite, total: input + output + cacheRead + cacheWrite, peakContext },
    toolResultChars: resultChars,
    wallSeconds: times.length ? Math.round((Math.max(...times) - Math.min(...times)) / 1000) : null,
    models: [...models],
  }),
);
