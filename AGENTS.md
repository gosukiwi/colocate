# AGENTS.md

Standalone CLI (`colocate`, not an ESLint plugin) with two Rules over the same import graph: `ownership` (file location vs who depends on it) and `entry` (imports that reach past a module's entry into its internals). It reads files on disk only; see `docs/adr/0001-standalone-cli-not-lint-plugin.md`. Vocabulary (Rule, Finding, Baseline) is in `GLOSSARY.md`. ESM only, Node 20+, TypeScript `module: NodeNext`. Tests import `src/` directly; `npm run build` emits `dist/` for the published package.

Consumer-facing usage lives in `README.md`.

## Commands

```bash
npm test
npm run typecheck
npm run build
npm run lint                         # oxlint, zero errors and warnings (tests/fixtures ignored)
npm run colocate                     # run colocate on this repo's own src/; must exit 0
npm run format:check                 # Prettier gate; run `npm run format` to fix
npm run crap                         # coverage + CRAP gate (fails above 15); run after changing src/
npm run check:placement              # not part of npm test; run after ownership-model changes
CONFIGS=40 npm run check:placement   # quicker pass
SEED=<n> npm run check:placement     # reproduce a sweep
```

## Every task

- TypeScript imports use `.js` specifiers (`from "../lib/graph.js"`).
- No code comments. Only humans can add comments.
- Findings stay silent rather than throw. All filesystem reads go through `src/lib/fs-safe.ts`.
- Do not reintroduce a `shells` option or a transitive / wholesale shell exemption.
- Keep `npm run crap` green (every function CRAP ≤ 15). Fix findings by splitting functions, not by deleting tests.
- `npm run colocate` must stay clean: fix placement by moving files to the destination the message names, never by adding `ignore` or a Baseline.
- Do not parse or resolve with a second stack; reuse `parseSourceFile` and `resolveSpecifier`. "Is this file in the model" is `isInGraphScope` in `src/lib/scope.ts` and nowhere else.

## Read when relevant

| If you are…                                                               | Read                                        |
| ------------------------------------------------------------------------- | ------------------------------------------- |
| Lost, adding a module, or changing the CLI, exit codes or Baseline        | [architecture](docs/agents/architecture.md) |
| Changing owners, shells, layers, barrels, consumers, or ownership reports | [ownership](docs/agents/ownership.md)       |
| Changing gates, the `entry` Rule, or import-boundary detection            | [entry](docs/agents/entry.md)               |
| Changing `root` / `ignore` / `layers` / `rules` or the options schema     | [options](docs/agents/options.md)           |
| Changing the walk, resolution, or filesystem degradation                  | [graph](docs/agents/graph.md)               |
| Adding or changing tests or fixtures                                      | [testing](docs/agents/testing.md)           |
| About to change the model (do-not-regress checklist)                      | [invariants](docs/agents/invariants.md)     |
| Touching a GitHub issue or a graph/gate bug                               | [known-issues](docs/agents/known-issues.md) |
