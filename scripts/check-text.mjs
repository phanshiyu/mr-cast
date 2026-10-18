#!/usr/bin/env node
// Keeps the rule that a scene never cuts its text. Text is fitted only in layout code that `validate` also
// runs (src/fit/report.ts), and drawn line by line with FitText, so nothing may clip or ellipsize it.
// Runs with `pnpm typecheck`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = (dir) =>
  fs
    .readdirSync(path.join(ROOT, dir), { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory() ? files(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : [],
    );

const RULES = [
  {
    where: /^src\/(components|utils|fit)\//,
    bad: /textOverflow|WebkitLineClamp|-webkit-box|lineClamp/,
    fix: 'fit the text with shared/textfit.mjs in the layout and draw it with FitText; never clip it',
  },
  {
    where: /^src\/(components|utils|fit)\//,
    bad: /…/,
    fix: 'never shorten text with an ellipsis; fit it with shared/textfit.mjs and let validate report what does not fit',
  },
  {
    where: /^src\/components\//,
    bad: /\b(fitText|fitTextAt|fitLines|wrapRuns)\b/,
    fix: 'fit text in a layout function under src/utils that src/fit/report.ts also calls, so validate sees the same fit; components only draw fits',
  },
];

const problems = [];
for (const file of [...files('src')]) {
  const rel = file.split(path.sep).join('/');
  const lines = fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const rule of RULES)
      if (rule.where.test(rel) && rule.bad.test(line)) problems.push(`${rel}:${i + 1}: ${line.trim()}\n  ${rule.fix}`);
  });
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
