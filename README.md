# colocate

colocate suggests where to move TypeScript files based on who imports them. It also flags imports that bypass a module's entry file.

![Animated walkthrough of moving private and shared helpers and importing through a module entry file](docs/colocate-demo.gif)

## Install and run

Requires Node 20+.

```sh
npm i -D @gosukiwi/colocate
npx colocate
```

Use the same command in CI. To override the configured root, run `npx colocate src`. Use `--config path/to/config.json` to select a config file.

## Rules

### `ownership`

Keep private files with their owner and shared files in the nearest folder that contains all their owners. A folder owns its files if it has an entry file named after it or outside code imports its `index`. A standalone file owns itself. When an `index` only groups independent helpers, each helper is its own owner. An entry file stays with its folder when the folder moves.

| Finding                              | Fix                                                                                                                                                                                                                                                                     |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `privateOutsideOwner`                | Move the file into its owner's folder. If the owner is a standalone file, put both files in a folder named after the owner.                                                                                                                                             |
| `sharedInsideOwner`, `sharedTooHigh` | Move the shared file to the nearest folder containing all its owners. For example, if `pages/A` and `pages/B` use `fmt.ts`, put it at `pages/fmt.ts`.                                                                                                                   |
| `singletonFolder`                    | Move a lone entry file up a level or keep related files beside it. A stylesheet beside the entry file also counts. Supported extensions are `.css`, `.scss`, `.sass`, `.less`, and `.styl`. An `index` can stay if it re-exports at least two files in the same folder. |

Suppose nothing imports `main.ts` and it imports `App.ts` directly. If only `App.ts` imports `pages/Home/Home.ts`, `Home` can stay in `pages`. Use `layers` for longer startup chains or standalone top-level files that should stay in place.

### `entry`

Outside code must use a module's entry file. For example, import from `pages/Inbox/Inbox.ts` or `pages/Inbox/index.ts` if present. Importing directly from `pages/Inbox/state.ts` produces `reachesPastEntry`. Outside code can also import a nested module's entry file. Folders outside any module can expose individual files.

Use `index.ts` to re-export values from other checked files. A value re-export from an entry named after its folder, such as `Inbox/Inbox.ts`, produces `namedDoorReexport`. Type-only re-exports are allowed.

## Configuration

colocate reads `colocate.config.json` from the current directory. All options are optional. Unknown keys cause an error.

```json
{
  "root": "src",
  "layers": ["src/ui"],
  "ignore": ["**/*.generated.ts"],
  "rules": ["ownership", "entry"]
}
```

- `root` sets the directory to check and limits how far up `ownership` can move files. It defaults to `"."`. For relative paths, colocate tries the current directory first, then walks up as needed, stopping at the nearest `package.json` or `.git`. Match the capitalization on disk.
- `layers` lets direct files and direct child modules stay in a directory even if only one owner imports them. With `["src/ui"]`, `src/ui/Button/Button.ts` can stay in `src/ui`. colocate still checks files deeper in the directory. Patterns match paths relative to both `root` and the current directory.
- `ignore` excludes files and their imports using paths or globs relative to `root`. Matching a directory excludes its contents. List exclusions directly and avoid `!` patterns. Ignoring a module's entry file disables its import boundary.
- `rules` defaults to both `ownership` and `entry`. Both use `root` and `ignore`. Only `ownership` uses `layers`.

colocate follows TypeScript's import resolution, including `paths` and `baseUrl` from the nearest `tsconfig.json`. It skips tests, declaration files, dependencies, build and coverage output, and version control directories.

## Output and exit codes

colocate exits with `0` when checks pass and `2` when it reports findings or cannot run. Text output goes to stderr and reports a path, rule, kind, and message per finding. Import findings include a line and column. Paths are relative to the current directory.

With `--format json`, colocate writes to stdout as `{ "findings": [...] }` or, on failure, `{ "error": "<message>" }`. Each finding has `rule`, `kind`, `file`, `message`, and `data`. Import findings include `line`, `column`, and `data.target`.

For ownership findings, `data.destination` is the destination folder with a trailing slash. When the owner is a standalone file, move `data.owner` and, if present, `data.moving` into that folder. `data.moving` can name a module folder and appears only when the other path still needs to move.

## Baseline

Use `colocate.baseline.json` to accept existing findings and report new ones as they appear.

- `npx colocate --baseline-add-all` records every current finding. Run it yourself when adopting colocate. Agents must not use this flag.
- `npx colocate --update-baseline` removes entries for fixed findings. If the file is missing, it creates one from the current findings.

JSON output includes `staleBaseline` when accepted findings no longer occur.
