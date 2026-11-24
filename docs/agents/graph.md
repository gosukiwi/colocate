# Graph, resolution, cache

## Walk and edges

Walk skips `node_modules`, `dist`, `coverage`, `.git`, `.hg`, `.svn`, declaration files (`.d.ts` `.d.mts` `.d.cts`), and tests (`__tests__` segment or `.test.` / `.spec.` in the basename). `isTestFile` takes a path **relative to root** — an absolute path with `__tests__` above the project would disable the rule.

`ignore` and `SKIP_DIRS` apply to subjects, consumers, singleton counts, and cache invalidation alike.

Edges from `import`, `export ... from`, `import()`, type-position `import()` (`import("./x").T` and `typeof import("./x")`), `require()`, and `import x = require()`. `require` is scope-aware through `scopeRequireBinding` (nearest scope declaring `require` decides): a shadowed `require` is not an edge, except `const require = createRequire(...)`. A file importing itself is not an ownership edge.

`parse.ts` takes `require`'s `arguments[0]` at any arity, and the `entry` Rule uses the same `extractImports`, so both Rules see the same edges.

## Resolution

Resolution goes through the TypeScript compiler (`getParsedCommandLineOfConfigFile`, so `extends` is honoured) with **bundler** `moduleResolution` regardless of `tsc` settings: extensionless imports resolve, `./x.js` maps onto `x.ts`. Extra probe for `.cts`/`.cjs` and path-mapping targets the compiler will not try. `paths` picks **one** pattern (exact key, else longest prefix) — do not try every matching pattern.

A throw from `ts.resolveModuleName` (malformed `tsconfig.json` `paths`) is treated as unresolved and does not abort the run.

## Symlinks

Follow while the real path stays inside `root`. Outside-root targets stay out of the graph (they cannot be reported; counting them as owners created phantom second owners). An in-root file symlink is a graph member under both its walk path and its real path; specifiers are extracted only from the real path. Sibling links to one real directory are both walked; nested links to the same real directory are entered at most once. Ignore applies to both the link path and the real path.

## Case and normalisation

Case-insensitive disks: recover import specifiers that differ in case from the on-disk path. Unicode NFC/NFD differences are recovered too, on every platform. Both recoveries are `canonicalGraphPath`, and it is applied in two places: `crossing.ts` (importer and target), and `collectReExports` in `owners.ts` (each resolved re-export target). It is **not** applied everywhere a resolved path meets the graph. Do not read the two call sites as a general rule.

The graph's own **edge index** uses the same fold: `buildGraphFromFiles` recovers a resolved target through the folded-path map `canonicalGraphPath` uses (`foldGraphPath`: NFC on every platform, lower-case only when the filesystem ignores case), built on every platform, with exact `graph.files` membership first. `collectReExports` and `graph.importers` now agree on an NFC/NFD mismatch. Config **paths** (`root`, the root argument) stay case-sensitive — `root: "SRC"` when the dir is `src` produces no findings.

`collectReExports` resolves with the graph's `ResolutionSettings` (`getGraphResolutionSettings`) and canonicalises every resolved path, so a sibling is a sibling whatever the specifier's spelling — relative, aliased through tsconfig `paths`, or wrong-case. Do not put a bare `resolveSpecifier(specifier, dir)` back there: the settings parameter is optional and falls back to a lenient default with no project `paths`, so an aliased re-export resolves to nothing with nothing looking broken, which silently reclassifies the barrel and moves every finding downstream of `getColocationConsumers`.

## Per-run caches

The graph is built once per `openProject` call and never revalidated: a run is a snapshot of the disk. Resolution settings cache final results, including misses, by importer directory and specifier for that graph. There is no visit token, no staleness window and no cross-run or per-process cache. Anything that looks like one belongs to the old ESLint plugin and must not come back.

The graph also carries a per-run parse memo (`src/lib/parsed-files.ts`, keyed by path, attached to the `Graph` with `derivedFromGraph`). The build parses and reads each file once. It stores the imports with positions for every file and also the `SourceFile` for entry files (`isEntryFile`, which includes named doors). Lookups are plain reads and never touch the disk, so the memo is a snapshot: a file that was unreadable at build time, or that appears or changes afterwards, is answered from the build or not at all. A file deleted after the build yields no Findings, because `subjectFor` resolves its real path first. Do not add another parse or read of a graph file elsewhere: ask the memo.

## Robustness

Filesystem errors never abort a run. Missing `root`, a file deleted mid-run, an unreadable file or directory → no Findings for it. All reads go through `src/lib/fs-safe.ts`.
