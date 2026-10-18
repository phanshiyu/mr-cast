// The terminal scene's entries, shared by the scene (which draws them) and the CLI (which checks them).

/** A terminal entry's output, one string per line as written. */
export const outputLines = (entry) =>
  typeof entry?.output === 'string' && entry.output !== '' ? entry.output.split('\n') : [];
