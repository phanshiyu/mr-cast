// Checks for the terminal scene, mirroring src/types.ts. Pushes human/LLM-readable strings onto `errors`
// and `warnings`, like the checks in validate.mjs.

export function checkTerminal(s, p, errors, warnings) {
  for (const k of ['title', 'window'])
    if (s[k] !== undefined && typeof s[k] !== 'string') errors.push(`${p}.${k}: must be a string`);
  if (!Array.isArray(s.entries) || s.entries.length === 0)
    return errors.push(`${p}.entries: required non-empty array of { command?, output?, prompt?, exit? }`);
  s.entries.forEach((entry, j) => {
    const q = `${p}.entries[${j}]`;
    if (!entry || typeof entry !== 'object')
      return errors.push(`${q}: must be an object { command?, output?, prompt?, exit? }`);
    if (entry.command === undefined && entry.output === undefined)
      errors.push(`${q}: give a command, an output, or both`);
    else if (entry.command === undefined && entry.output === '')
      errors.push(
        `${q}.output: empty, and the entry has no command, so it draws nothing; give a command or some output, or drop the entry`,
      );
    if (entry.command !== undefined) {
      if (typeof entry.command !== 'string' || !entry.command.trim())
        errors.push(`${q}.command: must be a non-empty string`);
      else if (entry.command.includes('\n')) errors.push(`${q}.command: one line; put each command in its own entry`);
    }
    if (entry.output !== undefined && typeof entry.output !== 'string')
      errors.push(`${q}.output: must be a string, lines separated by "\\n"`);
    if (entry.prompt !== undefined && typeof entry.prompt !== 'string')
      errors.push(`${q}.prompt: must be a string, e.g. "$" or "app=#"`);
    if (entry.exit !== undefined && !Number.isInteger(entry.exit))
      errors.push(`${q}.exit: must be a whole number, 0 for success`);
  });
}
