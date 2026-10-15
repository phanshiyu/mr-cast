// Prints a fixture's questions (no answers) as a numbered list for the reviewer prompt.
// Usage: node questions.mjs <fixture>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const name = process.argv[2];
const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'keys', `${name}.json`);
if (!name || !fs.existsSync(file)) {
  console.error('usage: node questions.mjs <fixture>');
  process.exit(1);
}
for (const q of JSON.parse(fs.readFileSync(file, 'utf8')).questions) console.log(`${q.id}. ${q.question}`);
