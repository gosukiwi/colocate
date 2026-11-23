# Architecture

colocate is a standalone CLI. There is no ESLint, no peer dependency, no rule adapter. TypeScript is both a runtime dependency (compiler API for parse/resolve) and a devDependency. Layout is enforced on this repo too: `npm run colocate` runs against `src/` (`colocate.config.json`).

## Layout

```
src/bin.ts                    process entry: run(argv, io) -> exit code
src/index.ts                  library surface: openProject, validateOptions, formatMessage
src/options.ts                Options, defaults, validateOptions (unknown keys rejected)
src/messages.ts               one template per MessageId, formatMessage(Finding)
src/cli/run.ts                argument parsing, config load, output, exit codes
src/cli/baseline.ts           colocate.baseline.json: read, write, absorb, drop stale
src/project/                  folder owned by project.ts: the model behind a run
src/project/project.ts        openProject: graph once, Finding list per file
src/project/crossing.ts       illegal-crossing lookup for an import specifier
src/project/gates.ts          entry detection, gate map, crossed-gate lookup
src/project/named-door.ts     named-door identity re-export detection
src/project/findings/         folder owned by findings.ts: the ownership Finding set
src/project/findings/index.ts     barrel door: the folder's public surface
src/project/findings/findings.ts  what `ownership` reports, in report order
src/project/findings/owners.ts    owners, shells, layers, colocation
src/project/findings/subject.ts   subjectFor: a file known to be in the model
src/project/findings/root.ts      resolve a configured root from any working directory
src/lib/scope.ts              what is in the model: source/test/ignore/skip predicates
src/lib/walk.ts               the tree walk: every source file under a root
src/lib/parse.ts              TypeScript parse + import-specifier extraction
src/lib/require-binding.ts    is this `require` the CJS one: scopeRequireBinding
src/lib/resolve.ts            tsconfig load, `paths` aliasing, specifier resolution
src/lib/graph.ts              Graph, build, membership, path canonicalisation
src/lib/paths.ts              is-this-path-inside-that-directory, one copy only
src/lib/derived.ts            index derived from a graph, memoised for its lifetime
src/lib/fs-safe.ts            every filesystem read: degrade to skip, never throw
tests/fixtures/<name>/        one layout per scenario
tests/helpers/lint-fixture.ts fixture runner over openProject
scripts/check-placement.ts    opt-in satisfiability sweep, both Rules
```

The placement of `src/project/` is dictated by colocate itself: `project.ts` is the only consumer of `crossing.ts`, `gates.ts`, `named-door.ts` and `findings/`, so they live in its folder. Keep it that way; if `npm run colocate` reports a file here, move it where the message says.

## Data flow

`bin.ts` calls `run` in `cli/run.ts`, which parses arguments (`node:util` `parseArgs`), loads `colocate.config.json` through `fs-safe.ts`, and validates it with `validateOptions`. It then calls `openProject(options, cwd)` from `project/project.ts`, asks the Project for `files()` and `findings(file)`, converts each `Finding` to a report (cwd-relative path, line/column from the Finding's `range`, text from `formatMessage`), applies the Baseline, and prints.

`openProject` builds the graph once (`collectSourceFiles` then `buildGraphFromFiles`); there is no cache across runs and no revalidation. A missing root yields an empty Project. A `Finding` is `{ rule, kind, messageId, file, range?, data }`. `messageId` picks the template in `messages.ts`: it equals `kind` except for the two standalone-owner variants of `privateOutsideOwner`, and it never reaches JSON output or the Baseline. `data` is the only place a Finding carries paths for messages and for the Baseline, and **those paths are already cwd-relative and posix** (`display` in `project.ts`). Do not hand absolute paths to `messages.ts` or the Baseline.

`subjectFor(file, root, ignore, graph)` in `findings/subject.ts` is the one preamble that turns a path into a `Subject` (realpath, scope test) or `undefined`. `Subject.covers` tests a resolved target; use it rather than rebuilding the disjunction.

## Derived indexes

Every per-graph derived index — resolution settings, the member and folded-path indexes, files-by-directory, gates, shells, layer directories — goes through `derivedFromGraph` in `src/lib/derived.ts`: do not hand-roll another `WeakMap<Graph, X>`, and do not hang feature state on `Graph` (it is `readonly` precisely so those indexes can be trusted for the graph's lifetime). Membership: `graphHasFile` from `graph.ts`, never `new Set(graph.files)`. Files in a directory: `graphFilesInDir`, never `graph.files.filter` by dirname.

## Scope and subject

"Is this path in the model" is `isInGraphScope` in `src/lib/scope.ts` and nowhere else.

Two asymmetries inside `Subject` are load-bearing and must survive any tidying. `rootDir` is resolved but **not** realpathed (`realRootDir` is the realpathed one). The subject file is scope-tested but not extension-tested again after realpath, so a `.ts` symlink pointing at a `.txt` file is still a subject, whereas resolved targets _are_ extension-tested.

`isInsideDir` has **exactly one** implementation, `src/lib/paths.ts`, used by `project/gates.ts`, `project/findings/owners.ts` and (as `isAtOrInsideDir`) `walk.ts`. It once existed in three copies sharing one defect: appending a separator to a `dir` that already ends in one builds `"//"` and matches nothing, so with `root: "/"` a file plainly inside a directory looked outside it. Do not reintroduce a local copy.

## `require` scoping

`scopeRequireBinding` in `src/lib/require-binding.ts` is the one policy for "is this `require` the CJS one". The nearest scope that declares `require` decides: a parameter, `var`/`let`/`const`, or function named `require` makes it `"shadowed"`; a `const require = createRequire(...)` in that scope makes it `"cjs"`; no declaration keeps looking outward. `parse.ts` (graph edges) and `named-door.ts` (via `scopeBindsRequire`) both use it. Do not add a second implementation.

## Exit codes and Baseline

Exit 0 is clean; exit 2 is any Finding that the Baseline does not absorb **or any error** (bad flags, bad config, bad Baseline, anything thrown). Claude Code hooks only show stderr to the agent on exit 2, so errors must not use exit 1. Nothing else returns a non-zero code. Text output goes to stderr (that is what hooks surface); JSON goes to stdout, with `{ "error": ... }` on failure.

Baseline (`colocate.baseline.json`, `{ version: 1, findings: [...] }`, sorted) matches Findings on `rule`, `kind`, `file`, and `subject` (the `target` for `reachesPastEntry` / `namedDoorReexport`), as a multiset. Entries nothing matched are **stale**: reported (`staleBaseline` in JSON) but they do not fail the run. `--update-baseline` only drops stale entries; it never adds Findings to an existing Baseline. `--baseline-add-all` replaces the Baseline with every current Finding and exits 0; it is for humans adopting colocate and must not be used by agents. The two flags are mutually exclusive.
