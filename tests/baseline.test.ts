import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli/run.js";

function exec(argv: string[], cwd: string) {
  let stdout = "";
  let stderr = "";
  const code = run(argv, {
    cwd,
    stdout: (s) => (stdout += s),
    stderr: (s) => (stderr += s),
  });
  return { code, stdout, stderr };
}

function tmp(files: Record<string, string>): string {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "colocate-baseline-")),
  );
  write(dir, files);
  return dir;
}

function write(dir: string, files: Record<string, string>): void {
  for (const [name, content] of Object.entries(files)) {
    const full = path.join(dir, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
}

function readBaseline(dir: string): unknown {
  return JSON.parse(
    fs.readFileSync(path.join(dir, "colocate.baseline.json"), "utf8"),
  );
}

const feature = {
  "src/Feature/Feature.ts": "export const feature = 1;\n",
  "src/Feature/helper.ts": "export const helper = 2;\n",
  "src/Other/Other.ts": "export const other = 1;\n",
  "src/Other/inner.ts": "export const inner = 2;\n",
};
const appOne = {
  "src/app.ts": 'import { helper } from "./Feature/helper";\n',
};
const appTwo = {
  "src/app.ts":
    'import { helper } from "./Feature/helper";\nimport { inner } from "./Other/inner";\n',
};
const singleton = { "src/Foo/Foo.ts": "export const foo = 1;\n" };

const helperEntry = {
  rule: "entry",
  kind: "reachesPastEntry",
  file: "src/app.ts",
  subject: "src/Feature/helper.ts",
};
const innerEntry = {
  rule: "entry",
  kind: "reachesPastEntry",
  file: "src/app.ts",
  subject: "src/Other/inner.ts",
};

describe("baseline", () => {
  it("first --update-baseline records every finding and exits 0", () => {
    const dir = tmp({ ...feature, ...appOne });
    const { code, stderr } = exec(["--update-baseline"], dir);
    expect(code).toBe(0);
    expect(stderr).toBe("");
    const raw = fs.readFileSync(
      path.join(dir, "colocate.baseline.json"),
      "utf8",
    );
    expect(raw).toBe(
      JSON.stringify({ version: 1, findings: [helperEntry] }, null, 2) + "\n",
    );
  });

  it("omits subject for ownership kinds", () => {
    const dir = tmp(singleton);
    exec(["--update-baseline"], dir);
    const baseline = readBaseline(dir) as { findings: object[] };
    expect(baseline.findings).toHaveLength(1);
    expect(baseline.findings[0]).toEqual({
      rule: "ownership",
      kind: "singletonFolder",
      file: "src/Foo/Foo.ts",
    });
  });

  it("sorts entries by file, rule, kind, subject", () => {
    const dir = tmp({ ...feature, ...appTwo, ...singleton });
    exec(["--baseline-add-all"], dir);
    const baseline = readBaseline(dir) as { findings: object[] };
    expect(baseline.findings).toEqual([
      { rule: "ownership", kind: "singletonFolder", file: "src/Foo/Foo.ts" },
      helperEntry,
      innerEntry,
    ]);
  });

  it("a later run is silent and exits 0", () => {
    const dir = tmp({ ...feature, ...appOne });
    exec(["--update-baseline"], dir);
    const { code, stdout, stderr } = exec([], dir);
    expect(code).toBe(0);
    expect(stdout).toBe("");
    expect(stderr).toBe("");
  });

  it("reports a finding that is not in the baseline", () => {
    const dir = tmp({ ...feature, ...appOne });
    exec(["--update-baseline"], dir);
    write(dir, appTwo);
    const { code, stderr } = exec([], dir);
    expect(code).toBe(2);
    expect(stderr).toMatch(/src\/Other\/inner\.ts/);
    expect(stderr).not.toMatch(/src\/Feature\/helper\.ts/);
  });

  it("prints a stale notice when a baselined finding is fixed", () => {
    const dir = tmp({ ...feature, ...appOne });
    exec(["--update-baseline"], dir);
    write(dir, { "src/app.ts": "export {};\n" });
    const { code, stderr } = exec([], dir);
    expect(code).toBe(0);
    expect(stderr).toBe(
      "colocate: 1 baselined finding(s) no longer occur; run colocate --update-baseline\n",
    );
  });

  it("adds staleBaseline to json output", () => {
    const dir = tmp({ ...feature, ...appOne });
    exec(["--update-baseline"], dir);
    write(dir, { "src/app.ts": "export {};\n" });
    const { code, stdout, stderr } = exec(["--format", "json"], dir);
    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ findings: [], staleBaseline: 1 });
  });

  it("--update-baseline drops stale entries and never adds new ones", () => {
    const dir = tmp({ ...feature, ...appTwo });
    write(dir, {
      "colocate.baseline.json": JSON.stringify({
        version: 1,
        findings: [
          helperEntry,
          { ...helperEntry, subject: "src/Gone/gone.ts" },
        ],
      }),
    });
    const { code, stderr } = exec(["--update-baseline"], dir);
    expect(code).toBe(2);
    expect(stderr).toMatch(/src\/Other\/inner\.ts/);
    expect(stderr).not.toMatch(/baselined/);
    expect(readBaseline(dir)).toEqual({ version: 1, findings: [helperEntry] });
  });

  it("--baseline-add-all records everything, prints nothing, exits 0", () => {
    const dir = tmp({ ...feature, ...appTwo });
    const { code, stdout, stderr } = exec(["--baseline-add-all"], dir);
    expect(code).toBe(0);
    expect(stdout + stderr).toBe("");
    expect(readBaseline(dir)).toEqual({
      version: 1,
      findings: [helperEntry, innerEntry],
    });
  });

  it("matches one-to-one: two identical findings, one entry", () => {
    const dir = tmp({
      ...feature,
      "src/app.ts":
        'import { helper } from "./Feature/helper";\nimport { helper as h2 } from "./Feature/helper";\n',
    });
    write(dir, {
      "colocate.baseline.json": JSON.stringify({
        version: 1,
        findings: [helperEntry],
      }),
    });
    const { code, stderr } = exec([], dir);
    expect(code).toBe(2);
    expect(stderr.trim().split("\n")).toHaveLength(1);
  });

  it("exits 2 naming the file on invalid JSON", () => {
    const dir = tmp({ ...feature, ...appOne, "colocate.baseline.json": "{" });
    const { code, stderr } = exec([], dir);
    expect(code).toBe(2);
    expect(stderr).toMatch(/colocate\.baseline\.json/);
  });

  it("exits 2 on a baseline with the wrong shape", () => {
    const dir = tmp({
      ...feature,
      ...appOne,
      "colocate.baseline.json": JSON.stringify({ version: 2, findings: [] }),
    });
    const { code, stderr } = exec([], dir);
    expect(code).toBe(2);
    expect(stderr).toMatch(/colocate\.baseline\.json/);
  });

  it("rejects --update-baseline with --baseline-add-all", () => {
    const dir = tmp({ ...feature, ...appOne });
    const { code, stderr } = exec(
      ["--update-baseline", "--baseline-add-all"],
      dir,
    );
    expect(code).toBe(2);
    expect(stderr).toMatch(/--update-baseline/);
    expect(fs.existsSync(path.join(dir, "colocate.baseline.json"))).toBe(false);
  });

  it("--help prints usage to stdout and exits 0", () => {
    const dir = tmp({});
    const { code, stdout, stderr } = exec(["--help"], dir);
    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("colocate [root]");
    expect(stdout).toContain("--format text|json");
    expect(stdout).toContain("--config <path>");
    expect(stdout).toContain(
      "drop fixed entries from colocate.baseline.json; creates it if missing",
    );
    expect(stdout).toContain(
      "record every current finding in the baseline — for humans adopting colocate; agents must not use this",
    );
    expect(stdout).toMatch(/0 clean, 2 findings or error/);
  });
});
