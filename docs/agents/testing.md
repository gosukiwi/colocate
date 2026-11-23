# Tests

Vitest (`tests/**/*.test.ts`, fixtures excluded as test files). Behaviour tests are **fixture-first**: add `tests/fixtures/<name>/` and assert via `lintFixture(name, options?)` in `tests/ownership.test.ts` (a thin wrapper over `openProject` in `tests/helpers/lint-fixture.ts`). Default lint target is `["src"]`; pass another glob when the fixture is not under `src`. Prefer extending a fixture over adding options.

```ts
const messages = await lintFixture("private-sibling");
expect(sortMessages(messages)).toEqual([
  { file: "src/pages/helper.ts", kind: "privateOutsideOwner" },
  { file: "src/pages/MyPage/MyPage.ts", kind: "singletonFolder" },
]);
```

The helper throws if a fixture file cannot be read, so empty results must not mean "nothing was looked at".

Entry assertions get whole `FixtureMessage` objects (the `kind` field); narrow them with `pick(messages, "file", "line", "kind")` from the same helper rather than a local `.map`. Choose the keys per assertion — `message` is the payload wherever the report names a module and a door (`entry-paths-alias`, `entry-sibling-prefix`, `entry-deep-past-door` assert it in full), and noise wherever the point is which line was flagged.

Finding **order** for one file is pinned by exactly one test: `two-findings-one-file` in `ownership.test.ts`, asserted **unsorted**. Do not delete that fixture or sort its assertion. See [ownership](ownership.md).

After changing owners, shells, layers, barrels, or what counts as a consumer, run `npm run check:placement`. It generates random layouts, places a subject at every plausible path, and fails if any configuration has **no** accepted location.

```bash
npm run check:placement
CONFIGS=40 npm run check:placement
SEED=<n> npm run check:placement
```

## File split

- `ownership.test.ts` — `ownership` Findings against fixtures
- `entry.test.ts` — `entry` Findings against fixtures, including its degradation cases (missing root, missing file, unresolvable specifier) rather than in `robustness.test.ts`. Several `expect([])` assertions have no in-file positive control (the unresolvable-specifier and not-on-disk cases, plus `entry-dts-target`, both `entry-require-redeclared*` fixtures, `entry-require-nested-scope`, and the wrong-case-importer test); only the `ignore` pair does. They are not vacuous — each was verified by mutation to fail when the logic it pins is reverted, and the helper throws on an unreadable file — but do not read a bare `[]` as evidence the rule ran.
- `gates.test.ts` — `isEntryFile`, `getGates`, `findCrossedGate` unit tests
- `named-door.test.ts` — `isNamedDoor` unit tests
- `graph.test.ts` / `walk.test.ts` — resolution, walk, skip rules, temp trees + symlinks; `graph.test.ts` also covers importer recovery when the specifier and on-disk path differ only by NFC/NFD, using the same filesystem probe as the `collectReExports` case in `owners.test.ts`
- `parse.test.ts` — `extractImports`, including `scopeRequireBinding` cases: type-position import(), no-substitution templates, and spellings that must not become edges
- `owners.test.ts` — layer glob expansion / memoisation, and the one `collectReExports` case that fixtures cannot express: an NFD sibling re-exported through its NFC spelling. That test probes the filesystem for normalization folding rather than reading `ts.sys.useCaseSensitiveFileNames` — the two are independent axes, and it is the fixture-free proof that `collectReExports` canonicalises at all on a case-sensitive volume.
- `robustness.test.ts` — degradation cases: missing root, missing file, unreadable, deleted importer
- `cli.test.ts` — `run`: arguments, output formats, exit codes
- `baseline.test.ts` — Baseline read/write/absorb/stale semantics
- `project.test.ts` — `openProject` and Finding data (cwd-relative paths)
- `options.test.ts` — `validateOptions`
- `subject-for.test.ts` — `subjectFor`
- `findings.test.ts`, `paths.test.ts` — singleton stats and `isInsideDir` unit tests
- `root.test.ts` — relative root resolution and the project-boundary ceiling
