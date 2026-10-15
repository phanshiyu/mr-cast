// Which changed files are tests, shared by the validator's coverage check and quality/metrics.mjs.

/** Matched against the repo-relative path with forward slashes. */
const TEST_FILE_PATTERNS = [
  /(^|\/)(tests?|__tests__|spec|specs)\//, // test directories in most ecosystems
  /\.(test|spec)\.[^/]+$/, // JS and TS: foo.test.ts, foo.spec.js
  /_test\.(go|py|rb|exs?|dart|cc|cpp|c)$/, // Go, Python, Elixir, Dart, C++
  /(^|\/)test_[^/]+\.py$/, // pytest
  /_spec\.rb$/, // RSpec
  /(Test|Tests|IT)\.(java|kt|scala|groovy)$/, // JUnit
  /Tests?\.(cs|fs|vb|swift)$/, // .NET, XCTest
  /Spec\.(scala|groovy|kt|swift)$/, // ScalaTest, Spock, Kotest, Quick
];

export function isTestFile(file) {
  return TEST_FILE_PATTERNS.some((re) => re.test(file));
}
