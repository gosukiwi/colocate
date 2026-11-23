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

import { validateOptions } from "../src/options.js";
import { openProject } from "../src/project/project.js";

const cwd = path.join(
  fileURLToPath(new URL(".", import.meta.url)),
  "fixtures/parse-once",
);

function isEntryFile(file: string): boolean {
  const stem = path.basename(file, path.extname(file));
  return stem === "index" || stem === path.basename(path.dirname(file));
}

describe("parse each file once", () => {
  beforeEach(() => {
    parsed.counts.clear();
  });

  it("parses every non-entry file exactly once across the graph and entry findings", () => {
    const project = openProject(validateOptions({}), cwd);
    const files = project.files();
    for (const file of files) {
      project.findings(file);
    }
    const nonEntry = files.filter((file) => !isEntryFile(file));
    expect(nonEntry.length).toBeGreaterThan(0);
    for (const file of nonEntry) {
      expect([file, parsed.counts.get(file)]).toEqual([file, 1]);
    }
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
});
