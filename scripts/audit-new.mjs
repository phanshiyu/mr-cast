// Lists the advisories a dependency tree has that another does not, and exits 1 when there are any.
//   node scripts/audit-new.mjs <head audit.json> [<base audit.json>]
// The files are the output of `pnpm audit --json` or `npm audit --json`. Without a base, every advisory counts, which
// is the check of main itself. Exits 2 when an audit did not run, so a registry error never reads as a clean tree.
import { readFileSync } from 'node:fs';
import { newAdvisories, readAudit } from './lib/audit.mjs';

const [headFile, baseFile] = process.argv.slice(2);
if (!headFile) {
  console.error('usage: node scripts/audit-new.mjs <head audit.json> [<base audit.json>]');
  process.exit(2);
}

try {
  const head = readAudit(readFileSync(headFile, 'utf8'));
  const base = baseFile ? readAudit(readFileSync(baseFile, 'utf8')) : undefined;
  const found = newAdvisories(head, base);
  const scope = base ? 'not on the base branch' : 'moderate or worse';
  if (!found.length) {
    console.log(`No advisories ${scope}. ${head.size} moderate or worse in the tree.`);
  } else {
    console.log(`${found.length} advisories ${scope}:`);
    for (const { id, name, severity, title } of found) console.log(`- ${severity}: ${name}, ${title} (${id})`);
    for (const { id, name, severity, title } of found) {
      console.log(`::error title=${severity} advisory in ${name}::${title} (${id})`);
    }
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`::error title=The audit did not run::${error.message}`);
  process.exitCode = 2;
}
