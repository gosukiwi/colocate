import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const parsed = vi.hoisted(() => ({ counts: new Map<string, number>() }));

vi.mock("typescript", async (importOriginal) => {
  const actual = await importOriginal<typeof import("typescript")>();
  const real = actual.default;
  const proxy = new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === "createSourceFile") {
        return (fileName: string, ...rest: unknown[]) => {
          parsed.counts.set(fileName, (parsed.counts.get(fileName) ?? 0) + 1);
          return (real.createSourceFile as (...args: unknown[]) => unknown)(
            fileName,
            ...rest,
          );
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
  return { ...actual, default: proxy };
});

import { buildGraph } from "../src/lib/graph.js";
import { parsedImports, parsedSourceFile } from "../src/lib/parsed-files.js";
import { validateOptions } from "../src/options.js";
import { openProject } from "../src/project/project.js";

const cwd = path.join(
  fileURLToPath(new URL(".", import.meta.url)),
  "fixtures/parse-once",
);

describe("parse each file once", () => {
  beforeEach(() => {
    parsed.counts.clear();
  });

  it("parses every file exactly once, entry files included", () => {
    const project = openProject(validateOptions({}), cwd);
    const files = project.files();
    for (const file of files) {
      project.findings(file);
    }
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect([file, parsed.counts.get(file)]).toEqual([file, 1]);
    }
  });

  it("answers from the build snapshot and never reads the disk on a miss", () => {
    const dir = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "parse-snapshot-")),
    );
    try {
      const src = path.join(dir, "src");
      fs.mkdirSync(path.join(src, "feat"), { recursive: true });
      fs.mkdirSync(path.join(src, "late"), { recursive: true });
      const entry = path.join(src, "feat", "feat.ts");
      fs.writeFileSync(entry, 'import "../a.js";\n');
      fs.writeFileSync(path.join(src, "a.ts"), "export const a = 1;\n");
      const graph = buildGraph(src, []);
      const lateFile = path.join(src, "late.ts");
      const lateEntry = path.join(src, "late", "late.ts");
      fs.writeFileSync(lateFile, 'import "./a.js";\n');
      fs.writeFileSync(lateEntry, 'import "../a.js";\n');
      expect(parsedSourceFile(graph, entry)).toBeDefined();
      expect(parsedImports(graph, entry)).toBeDefined();
      expect(parsedImports(graph, lateFile)).toBeUndefined();
      expect(parsedSourceFile(graph, lateEntry)).toBeUndefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
