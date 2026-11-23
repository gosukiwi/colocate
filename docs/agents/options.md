# Options

Options live in `src/options.ts`: `{ root: string, ignore: string[], layers: string[], rules: ("ownership" | "entry")[] }` with defaults `"."`, `[]`, `[]`, both Rules. `validateOptions` rejects unknown keys and wrong types by throwing; the CLI turns that into an error and exit 2. They come from `colocate.config.json` (or `--config`); a positional `root` argument overrides `root`. `layers` is for `ownership` only; the `entry` Rule uses `root` and `ignore`. Do not add `layers` to it.

## `root`

Directory walked for the graph, and the ceiling of the ownership walk. Default `"."`. Relative `root` is resolved against `cwd`, then walked **upward** until the directory exists, stopping at the nearest `package.json` or `.git`. Unbounded walk would resolve `src` to an unrelated parent named `src`. Files outside `root` are never reported.

Config **paths** (`root`) stay case-sensitive — `root: "SRC"` when the dir is `src` produces no findings.

## `layers`

Ownership only. Globs for layer directories. Matched against paths relative to **both** `root` and `cwd` (so `["src/ui"]` and `["ui"]` both work with `root: "src"`). Memoised on the graph for its lifetime.

A layer's **immediate children** are public peer owners: they may have one consumer and may sit beside trees that import them. That means files **directly in** the layer directory, plus each child folder's entry (`Button/Button.ts` or `Button/index.ts`). Deeper files are checked normally.

Declaring a layer gives up private-file reporting for those children. That is the intended trade: a public peer with one consumer is indistinguishable from a file that should have been private.

`layers: ["*"]` matches every top-level directory under `root`. Do not treat that as a no-op.

## `ignore`

Globs relative to `root`. Ignored files are neither reported nor counted as consumers, and do not populate the singleton-folder check. A glob naming a directory excludes everything under it (`["gen"]` ≡ `["gen/**"]`). Symlinks are checked under the link path **and** the real path.

No negation: each glob is independent, so `["!gen"]` matches everything except `gen` and silently disables the rule. List exclusions only.

For the `entry` Rule, `ignore` does more than silence: gates are derived from `graph.files`, so ignoring a **door** removes the gate and legalises every existing reach past it. That inverts the ratchet, and it is not what "not reported, not counted as a consumer" leads a reader to expect — check whether a glob covers an entry file before adding it.

## `rules`

Which Rules `openProject` runs. Both by default; an empty array is valid and yields no Findings. Entries must be `"ownership"` or `"entry"`.
