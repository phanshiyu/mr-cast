# 36. Biome lints and formats, and fallow finds unused code, both in `pnpm check` and CI

- Status: Accepted
- Date: 2026-10-18

## Context

mr-cast had no linter and no formatter. `tsc` checks `src/` and `shared/` (with `noUnusedLocals`), and
`scripts/check-text.mjs` checks text fitting, but the CLI in `bin/`, the scripts, the tests and the example generators
are plain `.mjs` that nothing checked. Nothing found an export no one imports or a file no one loads. The user asked
for a linter, a formatter, and fallow.

The code is about 47,700 lines of `.mjs`, `.ts` and `.tsx`, with 2-space indent, single quotes and semicolons. Lines
run long: 17% are over 100 characters and 9% over 120. The repository uses TypeScript 7 (the native compiler), and
pnpm runs no dependency build scripts (`allowBuilds` in `pnpm-workspace.yaml` denies each one).

Two candidates were run on a copy of the repository, on an M-series Mac with Node 24:

| | ESLint 10.12 + typescript-eslint 8.71 + react-hooks 7.1 + Prettier 3.9.9 | Biome 2.5.15 |
| --- | --- | --- |
| Install | 140 packages, 85 MB with the second TypeScript | 2 packages (one native binary from an optional dependency, no install script), 57 MB |
| Lint, whole repository | 4.3 s; 6.9 s type-aware | 0.32 s |
| Format, whole repository | 3.0 s | 0.14 s |
| Findings, recommended rules | 63 | 1,066, of which 731 are `noNonNullAssertion` |
| Floating promises | Type-aware only, and only on `src/` (the tsconfig has `allowJs: false`), with TypeScript 6.0.3 installed beside 7, since typescript-eslint supports TypeScript below 6.1. It found none. | `noFloatingPromises` infers types itself, in `.mjs` too, and found 2 in `bin/mr-cast.mjs` |
| React hooks | `rules-of-hooks`, `exhaustive-deps` and the React Compiler rules (`set-state-in-effect`, `immutability` and others) | `useHookAtTopLevel` and `useExhaustiveDependencies` only |
| `.mjs`, `.ts`, `.tsx` | All | All |
| JSON | Prettier formats it; ESLint needs `@eslint/json` | Formats and lints it |
| CSS, Markdown, YAML | Prettier formats all three | CSS only |

## Decision

- **Biome is the linter and the formatter**, `@biomejs/biome` pinned to 2.5.15 in `devDependencies`, configured in
  `biome.json`. It is one fast tool with one config, it needs no install script, it needs no second TypeScript, and
  its floating-promise rule covers the CLI's `.mjs`, where most of the async code is. The cost is the React Compiler
  rules, which mr-cast does not use, and Markdown and YAML formatting, which the docs do not need.
- **The format follows the existing style**: 2 spaces, single quotes, semicolons, 120 columns. Formatting all the code
  touched about 270 files at any width tried (100 to 160 columns), so 120 keeps the review width the code already
  mostly used. The formatting commit is listed in `.git-blame-ignore-revs`.
- **Data is not formatted.** Example storyboards, hunks and meta (`examples/**/*.json`) are data that the
  `generate.mjs` scripts write with `JSON.stringify(…, null, 2)` or that people write compactly; formatting would
  rewrite them unlike their generators and fight every regeneration. The verify skill's fixtures, the evaluation keys
  and fixtures, the vendored `bin/lib/kokoro`, the bundled outline in `shared/world`, and the generated
  `shared/font-metrics.mjs` are left out too. `dist/` is ignored through `.gitignore`.
- **Rules**: Biome's recommended set, `noFloatingPromises` and `noMisusedPromises` from nursery, `noDoubleEquals`
  (eqeqeq, allowing `== null`), and unused variables and imports as errors. Rules that fire on a deliberate style
  are turned off in `biome.json` with the reason beside them, never by ignoring files.
- **fallow checks unused code**, `fallow` pinned to 3.31.0, configured in `.fallowrc.json` with every real entry point
  (the CLI, the voice and update-check children, the player, the render and fit-report bundles, scripts, example
  generators, tests and the evaluation scripts). `pnpm fallow` runs `fallow dead-code` and fails on any unused file,
  export, dependency or type, so new dead code fails CI. Its native binary also comes from an optional dependency
  with no install script.
- **`pnpm check`** runs typecheck, lint, format check and fallow, and CI runs it in the `typecheck` job that `ci-ok`
  needs.
- Renovate groups Biome and fallow updates; majors still wait for a review.

## Consequences

- A contributor runs `pnpm format` once and `pnpm check` before committing. A PR that leaves an unused export or a
  floating promise fails CI.
- The large formatting commit makes `git blame` noisy unless `blame.ignoreRevsFile` is set; GitHub reads
  `.git-blame-ignore-revs` itself.
- Biome's `noFloatingPromises` is a nursery rule and may change between minor releases; Renovate's grouped update
  shows it in CI before it lands.
- The React Compiler's own lint rules are not run. If the player adopts the compiler, revisit ESLint for those rules.

## Alternatives considered

- **ESLint, typescript-eslint and Prettier.** The standard choice, with the richest React rules, but 13 times slower,
  70 more packages, a second TypeScript pinned below 6.1 for type-aware rules that would still skip every `.mjs`, and
  two configs.
- **No formatter, lint only.** Leaves quote and wrap style to review, which is what the user asked to end.
