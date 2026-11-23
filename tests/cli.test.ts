import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli/run.js";

const fixtures = path.join(
  fileURLToPath(new URL(".", import.meta.url)),
  "fixtures",
);

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
    fs.mkdtempSync(path.join(os.tmpdir(), "colocate-cli-")),
  );
  for (const [name, content] of Object.entries(files)) {
    const full = path.join(dir, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

const entryFixture = path.join(fixtures, "entry-reaches-past");
const singletonFixture = path.join(fixtures, "singleton-flag");
const importLine = fs
  .readFileSync(path.join(entryFixture, "src/app.ts"), "utf8")
  .split("\n")[0]!;
const importCol = importLine.indexOf('"./Feature/helper"') + 1;
const entryMessage =
  "'src/Feature/helper.ts' is inside module 'src/Feature'; import it through 'src/Feature/Feature.ts', or move it out of 'src/Feature' if it is not part of it.";

const entryTree = {
  "src/app.ts": 'import { helper } from "./Feature/helper";\n',
  "src/Feature/Feature.ts": "export const feature = 1;\n",
  "src/Feature/helper.ts": "export const helper = 2;\n",
};

describe("cli text output", () => {
  it("prints a ranged finding as path:line:col", () => {
    const { code, stdout, stderr } = exec(["src"], entryFixture);
    expect(code).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toBe(
      `src/app.ts:1:${importCol}  entry/reachesPastEntry  ${entryMessage}\n`,
    );
  });

  it("prints a file-level finding without a position", () => {
    const { code, stderr } = exec([], singletonFixture);
    expect(code).toBe(2);
    expect(stderr).toMatch(
      /^src\/Foo\/Foo\.ts {2}ownership\/singletonFolder {2}\S/,
    );
    expect(stderr.endsWith("\n")).toBe(true);
  });

  it("exits 0 with no output for a clean project", () => {
    const dir = tmp({ "src/a.ts": "export const a = 1;\n" });
    expect(exec([], dir)).toEqual({ code: 0, stdout: "", stderr: "" });
  });
});

describe("cli config", () => {
  it("reads colocate.config.json from cwd", () => {
    const dir = tmp({
      ...entryTree,
      "colocate.config.json": JSON.stringify({ root: "src" }),
    });
    const { code, stderr } = exec([], dir);
    expect(code).toBe(2);
    expect(stderr).toContain("src/app.ts:1:");
  });

  it("lets the positional root override the config root", () => {
    const dir = tmp({
      ...entryTree,
      "colocate.config.json": JSON.stringify({ root: "nowhere" }),
    });
    expect(exec([], dir).code).toBe(0);
    expect(exec(["src"], dir).code).toBe(2);
  });

  it("reads a file given with --config", () => {
    const dir = tmp({
      ...entryTree,
      "conf/custom.json": JSON.stringify({ root: "src" }),
    });
    expect(exec(["--config", "conf/custom.json"], dir).code).toBe(2);
  });

  it("fails when an explicit --config is missing", () => {
    const dir = tmp({});
    const { code, stderr } = exec(["--config", "nope.json"], dir);
    expect(code).toBe(2);
    expect(stderr).toMatch(/^colocate: .*nope\.json/);
  });

  it("fails on invalid JSON naming the file", () => {
    const dir = tmp({ "colocate.config.json": "{ nope" });
    const { code, stderr } = exec([], dir);
    expect(code).toBe(2);
    expect(stderr).toMatch(/^colocate: .*colocate\.config\.json/);
  });

  it("fails on an invalid option key", () => {
    const dir = tmp({
      "colocate.config.json": JSON.stringify({ bogus: true }),
    });
    const { code, stderr } = exec([], dir);
    expect(code).toBe(2);
    expect(stderr).toMatch(/^colocate: /);
  });
});

describe("cli json output", () => {
  it("writes findings to stdout", () => {
    const { code, stdout, stderr } = exec(
      ["--format", "json", "src"],
      entryFixture,
    );
    expect(code).toBe(2);
    expect(stderr).toBe("");
    expect(stdout.endsWith("\n")).toBe(true);
    expect(JSON.parse(stdout)).toEqual({
      findings: [
        {
          rule: "entry",
          kind: "reachesPastEntry",
          file: "src/app.ts",
          line: 1,
          column: importCol,
          message: entryMessage,
          data: {
            target: "src/Feature/helper.ts",
            module: "src/Feature",
            entry: "src/Feature/Feature.ts",
          },
        },
      ],
    });
  });

  it("omits line and column for file-level findings", () => {
    const { stdout } = exec(["--format", "json"], singletonFixture);
    const [finding] = JSON.parse(stdout).findings;
    expect(finding.file).toBe("src/Foo/Foo.ts");
    expect(finding).not.toHaveProperty("line");
    expect(finding).not.toHaveProperty("column");
  });

  it("writes an empty list when clean", () => {
    const dir = tmp({ "src/a.ts": "export const a = 1;\n" });
    expect(exec(["--format", "json"], dir)).toEqual({
      code: 0,
      stdout: '{"findings":[]}\n',
      stderr: "",
    });
  });

  it("writes errors as JSON on stdout", () => {
    const dir = tmp({ "colocate.config.json": "{ nope" });
    const { code, stdout, stderr } = exec(["--format", "json"], dir);
    expect(code).toBe(2);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout).error).toContain("colocate.config.json");
  });
});

describe("cli usage errors", () => {
  it("rejects an unknown flag", () => {
    const { code, stderr } = exec(["--wat"], tmp({}));
    expect(code).toBe(2);
    expect(stderr).toMatch(/^colocate: /);
  });

  it("rejects an unknown format", () => {
    const { code, stderr } = exec(["--format", "xml"], tmp({}));
    expect(code).toBe(2);
    expect(stderr).toMatch(/^colocate: /);
  });

  it("rejects more than one positional", () => {
    const { code, stderr } = exec(["a", "b"], tmp({}));
    expect(code).toBe(2);
    expect(stderr).toMatch(/^colocate: /);
  });
});
