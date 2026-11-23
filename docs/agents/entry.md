# Entry model (the `entry` Rule)

Separate Rule, separate concept. `ownership` asks where a file belongs; `entry` asks whether an import may cross into a module.

**Gate.** A directory containing an entry file: named after the directory, or `index`. Detection is **structural** — unlike `isOwnerEntryFile`, nothing has to import it. That difference is deliberate: the imported-through condition exists to stop a convenience barrel from redrawing _ownership_ boundaries, and a door that gated nothing until consumers had already migrated would never engage. Do not reuse `isOwnerEntryFile` for entry detection.

**Two kinds of door.** A file named after its folder (`Foo/Foo.ts`) is the shortcut door: the public module is that file. `index.ts` is the barrel door: the public surface may come from more than one file. `index` re-exporting siblings is allowed; a named door identity-re-exporting another source file in the graph is not.

**Illegal crossing** ⟺ the target is not an entry file **and** some gate contains the target but not the importer. Finding location is the specifier's range, naming the **innermost** such gate (`index` wins when a directory has two doors). Kind: `reachesPastEntry`; `data` carries `target`, `module`, `entry` (cwd-relative).

**Named door re-export** is a separate finding (`namedDoorReexport`): shape-only — it does not change gates, `isEntryFile`, or `isOwnerEntryFile`. Detection lives in `src/project/named-door.ts`; `project.ts` turns it into Findings. Identity forms: `export … from`, import-then-export, and `require` / `import-equals` as sources. Type-only re-exports are skipped; package specifiers are skipped; wrap-around re-exports (re-exporting through the door again) are silent. CJS `module.exports` is out of scope ([#35](https://github.com/gosukiwi/eslint-plugin-colocate/issues/35)).

**Nested doors count.** Landing on any entry is legal, including a child module's. This is what makes innermost the right gate to name: any door is a legal terminus, so one report is always one edit, with no cascade.

Options are `{ root, ignore }` only. Do not add `layers` — placement and access are different questions, and conflating them is what the design explicitly rejected.

Invariants: no shell exemption (that is the point of the rule); no barrel exemption for importers, unlike `getColocationConsumers`; type-only imports treated like value imports, in both the `import type { T } from "./x"` and the inline `import("./x").T` / `typeof import("./x")` spellings; colocate never edits files; no check on whether the door re-exports the symbol; never a requirement that a directory _have_ an entry.

Specifiers must be **statically known**: a quoted string or a template literal with no substitutions, as `extractImports` yields them. Backticks resolve exactly as quotes do, so leaving them out would make them a one-character way to launder every crossing past a ratchet rule. The `cooked` value is what gets resolved, not `raw`. Anything else (a substituted template, concatenation, `as string`, an identifier) stays out. Declaration files are outside the model as **targets** as well as doors: `resolveSpecifier`'s probe still finds `types.d.ts` for a `"./types.d"` specifier, so the target is filtered on `isSourceFile`.

Both the target _and_ the importer must be passed through `canonicalGraphPath` before reaching `findCrossedGate` (done in `project/crossing.ts`). `realpath` does not fold case, so a wrong-case path made `isInsideDir` miss and reported a file for reaching into the directory it lives in, a Finding whose only fix is a cycle through its own door. Contrast a wrong-case **root**, which produces _no_ Findings (see [graph](graph.md)).

`requireIsShadowed` semantics live in `scopeRequireBinding` (see [architecture](architecture.md)): a `require` binding counts as the real one only when the nearest scope declaring it does so through `createRequire`.

`scripts/check-placement.ts` treats only `reachesPastEntry` as a crossing for satisfiability; `namedDoorReexport` is ignored there.
