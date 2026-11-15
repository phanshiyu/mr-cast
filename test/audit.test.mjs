import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newAdvisories, readAudit } from '../scripts/lib/audit.mjs';

const pnpmAudit = (...advisories) =>
  JSON.stringify({
    advisories: Object.fromEntries(
      advisories.map(([id, name, severity]) => [
        id,
        { id, github_advisory_id: `GHSA-${id}`, module_name: name, severity, title: `${name} flaw` },
      ]),
    ),
    metadata: {},
  });

const npmAudit = (...vulnerabilities) =>
  JSON.stringify({
    vulnerabilities: Object.fromEntries(
      vulnerabilities.map(([id, name, severity]) => [
        name,
        {
          name,
          via: [
            { source: id, name, severity, title: `${name} flaw`, url: `https://github.com/advisories/GHSA-${id}` },
            'other',
          ],
        },
      ]),
    ),
    metadata: {},
  });

test('a pull request that adds no advisory passes, however many main already has', () => {
  const base = readAudit(pnpmAudit([1, 'zod', 'high'], [2, 'fast-uri', 'moderate']));
  const head = readAudit(pnpmAudit([1, 'zod', 'high'], [2, 'fast-uri', 'moderate']));
  assert.deepEqual(newAdvisories(head, base), []);
});

test('the pull request that fixes an advisory passes', () => {
  const base = readAudit(pnpmAudit([1, 'zod', 'high']));
  assert.deepEqual(newAdvisories(readAudit(pnpmAudit()), base), []);
});

test('a pull request that makes a package newly vulnerable is stopped', () => {
  const base = readAudit(pnpmAudit([1, 'zod', 'high']));
  const head = readAudit(pnpmAudit([1, 'zod', 'high'], [3, 'left-pad', 'critical']));
  assert.deepEqual(
    newAdvisories(head, base).map((a) => a.name),
    ['left-pad'],
  );
});

test('a second advisory on a package that was already vulnerable counts as new', () => {
  const base = readAudit(pnpmAudit([1, 'zod', 'high']));
  const head = readAudit(pnpmAudit([1, 'zod', 'high'], [4, 'zod', 'moderate']));
  assert.equal(newAdvisories(head, base).length, 1);
});

test('low severity advisories do not count', () => {
  assert.equal(readAudit(pnpmAudit([5, 'tiny', 'low'])).size, 0);
});

test('npm audit output reads the same way as pnpm audit output', () => {
  const base = readAudit(npmAudit([1, 'zod', 'high']));
  const head = readAudit(npmAudit([1, 'zod', 'high'], [6, 'semver', 'moderate']));
  assert.deepEqual(
    newAdvisories(head, base).map((a) => a.name),
    ['semver'],
  );
  assert.equal(newAdvisories(head).length, 2);
});

test('an audit that did not run is an error, never a clean tree', () => {
  assert.throws(() => readAudit('ERR_PNPM_AUDIT_BAD_RESPONSE'), /no JSON/);
  assert.throws(() => readAudit(JSON.stringify({ error: { summary: 'getaddrinfo ENOTFOUND' } })), /ENOTFOUND/);
  assert.throws(() => readAudit('{}'), /no advisories/);
});
