import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { subjectFor } from "../src/lib/findings/index.js";
import { buildGraphFromFiles } from "../src/lib/graph.js";
import { collectSourceFiles } from "../src/lib/walk.js";

const fixtures = path.join(
  fileURLToPath(new URL(".", import.meta.url)),
  "fixtures",
);

function setup(fixture: string, ignore: string[] = []) {
  const rootDir = fs.realpathSync(path.join(fixtures, fixture, "src"));
  const graph = buildGraphFromFiles(
    collectSourceFiles(rootDir, ignore).files,
    rootDir,
  );
  return { root: { rootDir, realRootDir: rootDir }, graph, ignore };
}

describe("subjectFor", () => {
  it("returns a subject for an in-scope file", () => {
    const { root, graph, ignore } = setup("entry-reaches-past");
    const file = path.join(root.rootDir, "Feature/helper.ts");
    const subject = subjectFor(file, root, ignore, graph);
    expect(subject?.file).toBe(file);
    expect(subject?.realRootDir).toBe(root.realRootDir);
    expect(subject?.graph()).toBe(graph);
    expect(subject?.display(file)).toBe("Feature/helper.ts");
    expect(subject?.covers(file)).toBe(true);
  });

  it("uses the realpath of the file", () => {
    const { root, graph, ignore } = setup("entry-reaches-past");
    const link = path.join(root.rootDir, "..", "link.ts");
    const target = path.join(root.rootDir, "Feature/helper.ts");
    fs.symlinkSync(target, link);
    try {
      expect(subjectFor(link, root, ignore, graph)?.file).toBe(target);
    } finally {
      fs.rmSync(link);
    }
  });

  it("returns undefined for a non-source extension", () => {
    const { root, graph, ignore } = setup("two-findings-one-file");
    const css = path.join(root.rootDir, "pages/Home/Home.module.css");
    expect(subjectFor(css, root, ignore, graph)).toBeUndefined();
  });

  it("returns undefined for a missing file", () => {
    const { root, graph, ignore } = setup("entry-reaches-past");
    const file = path.join(root.rootDir, "ghost.ts");
    expect(subjectFor(file, root, ignore, graph)).toBeUndefined();
  });

  it("returns undefined for an ignored file", () => {
    const { root, graph, ignore } = setup("entry-ignore", [
      "Feature/helper.ts",
    ]);
    const file = path.join(root.rootDir, "Feature/helper.ts");
    expect(subjectFor(file, root, ignore, graph)).toBeUndefined();
  });

  it("returns undefined for a file outside the root", () => {
    const { root, graph, ignore } = setup("entry-reaches-past");
    const outside = path.join(root.rootDir, "..", "outside.ts");
    fs.writeFileSync(outside, "export const o = 1;\n");
    try {
      expect(subjectFor(outside, root, ignore, graph)).toBeUndefined();
    } finally {
      fs.rmSync(outside);
    }
  });
});
