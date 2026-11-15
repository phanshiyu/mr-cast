// Reads `pnpm audit --json` and `npm audit --json` output as one list of advisories, so a pull request's audit can be
// compared with the base branch's (docs/adr/0040-advisories-do-not-block-their-fix.md).

const RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };

/** The advisories at or above `minimum`, each with a key that names the advisory and the package it hits. */
export function readAudit(text, minimum = 'moderate') {
  let report;
  try {
    report = JSON.parse(text);
  } catch {
    throw new Error('The audit printed no JSON, so it did not run (a registry or network error?)');
  }
  if (report.error)
    throw new Error(`The audit failed: ${report.error.summary ?? report.error.message ?? report.error}`);
  const found = new Map();
  const add = (id, name, severity, title) => {
    if ((RANK[severity] ?? 0) < RANK[minimum]) return;
    found.set(`${id} ${name}`, { id, name, severity, title });
  };
  if (report.advisories) {
    for (const advisory of Object.values(report.advisories)) {
      add(advisory.github_advisory_id ?? advisory.id, advisory.module_name, advisory.severity, advisory.title);
    }
  } else if (report.vulnerabilities) {
    for (const vulnerability of Object.values(report.vulnerabilities)) {
      for (const via of vulnerability.via ?? []) {
        if (typeof via !== 'object') continue;
        const id = via.url?.split('/').pop() ?? via.source;
        add(id, via.name, via.severity, via.title);
      }
    }
  } else if (!report.metadata) {
    throw new Error('The audit output has no advisories or vulnerabilities field');
  }
  return found;
}

/** The advisories in `head` that `base` does not have. With no base, all of them. */
export function newAdvisories(head, base = new Map()) {
  return [...head].filter(([key]) => !base.has(key)).map(([, advisory]) => advisory);
}
