import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { lintFixture, lintFixtureRule } from "./helpers/lint-fixture.js";
import { openProject } from "../src/project/project.js";
import { validateOptions } from "../src/options.js";

function sortMessages(
  messages: { file: string; kind: string }[],
): { file: string; kind: string }[] {
  return [...messages].sort((a, b) => {
    const fileOrder = a.file.localeCompare(b.file);
    return fileOrder !== 0 ? fileOrder : a.kind.localeCompare(b.kind);
  });
}

function tempProject(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "fol-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

describe("robustness", () => {
  it("stays silent instead of throwing when the configured root is missing", async () => {
    const messages = await lintFixture("missing-root", { root: "src" }, [
      "lib",
    ]);
    expect(messages).toEqual([]);
  });

  it("does not throw when a cached importer was deleted from disk", async () => {
    const dir = tempProject({
      "src/main.ts": 'import "./App";\n',
      "src/App.ts": 'import "./pages/MyPage";\n',
      "src/pages/helper.ts": "export const h = 1;\n",
      "src/pages/MyPage/index.ts":
        'import "../helper";\nexport * from "./MyPage";\n',
      "src/pages/MyPage/MyPage.ts": "export const p = 1;\n",
    });
    try {
      await lintFixture(dir, { root: "src" }, ["src"]);
      fs.rmSync(path.join(dir, "src/pages/MyPage/index.ts"));

      await expect(
        lintFixture(dir, { root: "src" }, ["src/pages/helper.ts"]),
      ).resolves.toBeDefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("stays silent instead of throwing when a source file is unreadable", async () => {
    const dir = tempProject({
      "src/main.ts": 'import "./App";\n',
      "src/App.ts": "export const a = 1;\n",
    });
    const secret = path.join(dir, "src/App.ts");
    try {
      fs.chmodSync(secret, 0o000);
      await expect(
        lintFixture(dir, { root: "src" }, ["src/main.ts"]),
      ).resolves.toBeDefined();
    } finally {
      fs.chmodSync(secret, 0o644);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("finds a relative root when invoked from a subdirectory", async () => {
    const fixture = path.join(
      path.dirname(new URL(import.meta.url).pathname),
      "fixtures/private-sibling",
    );
    const cwd = path.join(fixture, "src/pages");
    const project = openProject(validateOptions({ root: "src" }), cwd);
    const found = project
      .files()
      .filter((file) => path.basename(file) === "helper.ts")
      .flatMap((file) =>
        project.findings(file).map((finding) => ({
          file: path.relative(fixture, file),
          kind: finding.kind,
        })),
      );

    expect(found).toEqual([
      { file: "src/pages/helper.ts", kind: "privateOutsideOwner" },
    ]);
  });

  it("does not resolve a relative root past a project boundary", async () => {
    const outer = tempProject({
      "src/unrelated/lib.ts": "export const u = 1;\n",
      "src/repo/package.json": "{}\n",
      "src/repo/app/main.ts": 'import "./App";\n',
      "src/repo/app/App.ts": 'import "./MyPage/MyPage";\n',
      "src/repo/app/helper.ts": "export const h = 1;\n",
      "src/repo/app/MyPage/MyPage.ts":
        'import "../helper";\nexport const p = 1;\n',
    });
    const cwd = path.join(outer, "src/repo");
    try {
      expect(await lintFixture(cwd, { root: "src" }, ["app"])).toEqual([]);
    } finally {
      fs.rmSync(outer, { recursive: true, force: true });
    }
  });

  it("is not disabled by a __tests__ directory above the root", async () => {
    const outer = tempProject({
      "__tests__/repo/src/main.ts": 'import "./App";\n',
      "__tests__/repo/src/App.ts": 'import "./pages/MyPage/MyPage";\n',
      "__tests__/repo/src/pages/helper.ts": "export const h = 1;\n",
      "__tests__/repo/src/pages/MyPage/MyPage.ts":
        'import "../helper";\nexport const p = 1;\n',
      "__tests__/repo/src/pages/MyPage/MyPage.module.css": ".p {}\n",
    });
    const cwd = path.join(outer, "__tests__/repo");
    try {
      expect(await lintFixture(cwd, { root: "src" }, ["src"])).toEqual([
        { file: "src/pages/helper.ts", kind: "privateOutsideOwner" },
      ]);
    } finally {
      fs.rmSync(outer, { recursive: true, force: true });
    }
  });

  it("counts sources behind a symlinked subdirectory", async () => {
    const dir = tempProject({
      "src/app.ts": 'import "./Foo/Foo";\n',
      "src/Foo/Foo.ts": "export const f = 1;\n",
      "src/realsub/a.ts": "export const a = 1;\n",
      "src/realsub/b.ts": "export const b = 1;\n",
    });
    fs.symlinkSync("../realsub", path.join(dir, "src/Foo/sub"));
    try {
      const messages = await lintFixture(dir, { root: "src" }, ["src"]);
      expect(messages.filter((m) => m.kind === "singletonFolder")).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not report on files outside the configured root", async () => {
    const messages = await lintFixture("outside-root", { root: "src" }, [
      "src",
      "tools",
    ]);
    expect(sortMessages(messages)).toEqual([
      { file: "src/Feature/Feature.ts", kind: "singletonFolder" },
    ]);
  });

  it("defaults root to the working directory", async () => {
    const messages = await lintFixture("root-drop", {}, ["."]);
    expect(sortMessages(messages)).toEqual([
      { file: "Foo/Foo.ts", kind: "singletonFolder" },
    ]);
  });

  it.each([
    ["a string instead of an array", '{ "@/*": "src/*" }'],
    ["a non-string target", '{ "@/*": [{ "not": "a string" }] }'],
    ["a null target in the array", '{ "@/*": [null] }'],
    ["a null target list", '{ "@/*": null }'],
  ])("stays silent when tsconfig paths holds %s", async (_label, paths) => {
    const dir = tempProject({
      "tsconfig.json": `{ "compilerOptions": { "baseUrl": ".", "paths": ${paths} } }`,
      "src/app.ts": 'import "@/Feature/state";\n',
      "src/Feature/Feature.ts": "export const f = 1;\n",
      "src/Feature/state.ts": "export const s = 1;\n",
    });
    try {
      for (const rule of ["ownership", "entry"] as const) {
        expect(
          await lintFixtureRule(dir, rule, { root: "src" }, ["src"]),
        ).toEqual([]);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("still resolves an alias when a paths target list mixes null with a valid mapping", async () => {
    const dir = tempProject({
      "tsconfig.json":
        '{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": [null, "src/*"] } } }',
      "src/main.ts": 'import "./App";\n',
      "src/App.ts": 'import "@/pages/MyPage/MyPage";\n',
      "src/pages/MyPage/MyPage.ts":
        'import "@/pages/helper";\nexport const page = 1;\n',
      "src/pages/helper.ts": "export const h = 1;\n",
    });
    try {
      const messages = await lintFixture(dir, { root: "src" }, ["src"]);
      expect(sortMessages(messages)).toEqual([
        { file: "src/pages/helper.ts", kind: "privateOutsideOwner" },
        { file: "src/pages/MyPage/MyPage.ts", kind: "singletonFolder" },
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("answers entry findings from the build-time parse after a file changes on disk", () => {
    const dir = tempProject({
      "src/main.ts": 'import "./Other/Other";\n',
      "src/Other/Other.ts": 'export { x } from "./sib";\n',
      "src/Other/sib.ts": "export const x = 1;\n",
    });
    try {
      const project = openProject(validateOptions({ root: "src" }), dir);
      const door = fs.realpathSync(path.join(dir, "src/Other/Other.ts"));
      const before = project.findings(door);
      expect(before.map((f) => f.kind)).toEqual(["namedDoorReexport"]);
      fs.writeFileSync(door, "export const y = 1;\n");
      expect(project.findings(door)).toEqual(before);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
