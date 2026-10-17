// Prints the final report an agent handed back, from its JSONL transcript.
// Usage: node handback.mjs <transcript.jsonl>
import fs from 'node:fs';

const entries = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n').map((l) => JSON.parse(l));
let message = null;
for (const e of entries) {
  if (e.type !== 'assistant') continue;
  for (const c of e.message?.content ?? []) if (c.type === 'tool_use' && c.name === 'SubagentHandback') message = c.input?.message ?? null;
}
if (message === null) { console.error('no hand-back in transcript'); process.exit(1); }
process.stdout.write(`${message}\n`);
