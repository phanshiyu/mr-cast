import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addedTestNames, groupNames, testNames } from '../shared/test-names.mjs';

const added = (...texts) => texts.map((text) => ({ type: 'add', text }));

test('a describe group is not a test, and its name is kept apart', () => {
  const lines = added(
    "describe('retryDelayMs', () => {",
    "  it('starts at the base delay', () => {",
    "  test.each([1, 2])('doubles %i', (n) => {",
    "  it.skip('is capped', () => {",
    "  it.todo('jitters')",
    "context('nextAttemptAt', () => {",
  );
  assert.deepEqual(testNames(lines), ['starts at the base delay', 'doubles %i', 'is capped', 'jitters']);
  assert.deepEqual(groupNames(lines), ['retryDelayMs', 'nextAttemptAt']);
});

test('each language counts its own tests and none of its groups', () => {
  assert.deepEqual(testNames(added('class TestLimiter:', '    def test_refuses(self):')), ['test_refuses']);
  assert.deepEqual(groupNames(added('class TestLimiter:', '    def test_refuses(self):')), ['TestLimiter']);
  assert.deepEqual(testNames(added('func TestLimit(t *testing.T) {')), ['TestLimit']);
  assert.deepEqual(testNames(added('#[test]', 'fn refuses_the_21st() {')), ['refuses_the_21st']);
  assert.deepEqual(testNames(added('#[tokio::test]', 'async fn waits() {')), ['waits']);
  assert.deepEqual(testNames(added('RSpec.describe Limiter do', "  context 'when full' do", "    it 'refuses' do")), [
    'refuses',
  ]);
  assert.deepEqual(groupNames(added('RSpec.describe Limiter do', "  context 'when full' do")), [
    'Limiter',
    'when full',
  ]);
  assert.deepEqual(testNames(added("  test 'counts' do")), ['counts']);
  assert.deepEqual(testNames(added('    @Test', '    public void refuses() {')), ['refuses']);
  assert.deepEqual(testNames(added('@Test', 'fun `refuses the twenty-first`() {')), ['refuses the twenty-first']);
  assert.deepEqual(testNames(added('    void helper() {')), []);
});

test('the footer count and the map count agree: groups of a spec file are not added tests', () => {
  const hunks = {
    h1: {
      file: 'src/a.spec.ts',
      lines: added(
        "describe('a', () => {",
        "  it('one', () => {",
        "  it('two', () => {",
        "describe('b', () => {",
        "  it('three', () => {",
      ),
    },
  };
  assert.deepEqual(addedTestNames(hunks), ['one', 'two', 'three']);
});
