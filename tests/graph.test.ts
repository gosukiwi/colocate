import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildGraph,
  canonicalGraphPath,
  getGraphResolutionSettings,
  graphFilesInDir,
  type Graph,
} from "../src/lib/graph.js";
import {
  createResolutionSettings,
  resolveSpecifier,
} from "../src/lib/resolve.js";
import { isTestFile } from "../src/lib/scope.js";

const created: string[] = [];

afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop();
    if (dir !== undefined) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  created.push(dir);
  return dir;
}

function foldsNormalization(dir: string): boolean {
  const name = "probe-Café.ts";
  fs.writeFileSync(path.join(dir, name.normalize("NFD")), "");
  return fs.existsSync(path.join(dir, name.normalize("NFC")));
}

const normProbeDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "colocate-graph-norm-probe-"),
);
const filesystemFoldsNormalization = foldsNormalization(normProbeDir);
fs.rmSync(normProbeDir, { recursive: true, force: true });

const fixtureRoot = path.join(
  fileURLToPath(new URL(".", import.meta.url)),
  "fixtures/graph",
);

const jsExtFixtureRoot = path.join(
  fileURLToPath(new URL(".", import.meta.url)),
  "fixtures/graph-js-ext",
);

const aliasPrivateFixtureRoot = path.join(
  fileURLToPath(new URL(".", import.meta.url)),
  "fixtures/alias-private",
);

function fixture(name: string): string {
  return fs.realpathSync(
    path.join(fileURLToPath(new URL(".", import.meta.url)), "fixtures", name),
  );
}

describe("isTestFile", () => {
  it("returns true when any path segment is __tests__", () => {
    expect(isTestFile("src" + path.sep + "__tests__" + path.sep + "a.ts")).toBe(
      true,
    );
  });

  it("returns false for paths that do not contain a __tests__ segment", () => {
    expect(isTestFile("src/not_tests/a.ts")).toBe(false);
  });

  it("returns true for .test. or .spec. basenames", () => {
    expect(isTestFile("foo.test.ts")).toBe(true);
  });
});

describe("buildGraph resolution", () => {
  it("resolves the longest matching path alias prefix", () => {
    const rootDir = fixture("alias-longest-prefix");
    const graph = buildGraph(rootDir, []);

    expect(
      graph.importers.get(path.join(rootDir, "src/core/Thing.ts")),
    ).toEqual([path.join(rootDir, "src/main.ts")]);
    expect(
      graph.importers.get(path.join(rootDir, "src/legacy/core/Thing.ts")),
    ).toBeUndefined();
  });

  it("resolves exact path aliases and falls back to later path targets", () => {
    const rootDir = fixture("alias-shapes");
    const mainPath = path.join(rootDir, "src/main.ts");
    const graph = buildGraph(rootDir, []);

    expect(graph.importers.get(path.join(rootDir, "src/lib/thing.ts"))).toEqual(
      [mainPath],
    );
    expect(graph.importers.get(path.join(rootDir, "src/other.ts"))).toEqual([
      mainPath,
    ]);
  });

  it("resolves relative imports with .js extension to TypeScript sources", () => {
    const rootDir = fs.realpathSync(jsExtFixtureRoot);
    const aPath = path.join(rootDir, "src/a.ts");
    const bPath = path.join(rootDir, "src/b.ts");

    const graph = buildGraph(rootDir, []);

    expect(graph.importers.get(bPath)).toEqual([aPath]);
    expect(graph.files).toEqual([aPath, bPath]);
  });

  it("resolves a bare directory specifier to its index file", () => {
    const base = fs.realpathSync(tempDir("colocate-dir-index-"));
    const srcDir = path.join(base, "src");
    const featureDir = path.join(srcDir, "Feature");
    fs.mkdirSync(featureDir, { recursive: true });
    const indexPath = path.join(featureDir, "index.ts");
    fs.writeFileSync(indexPath, "export const x = 1;\n");

    expect(resolveSpecifier("./Feature", srcDir)).toBe(indexPath);
  });
});

describe("buildGraph", () => {
  it.skipIf(!filesystemFoldsNormalization)(
    "records an importer when the specifier and the on-disk path differ only by Unicode normalization",
    () => {
      const base = fs.realpathSync(tempDir("colocate-graph-nfd-"));
      const nfc = "Café"; // é as a single code point
      const nfd = "Café"; // e followed by a combining acute
      const srcDir = path.join(base, "src");
      fs.mkdirSync(path.join(srcDir, nfc), { recursive: true });
      fs.writeFileSync(
        path.join(srcDir, nfc, "helper.ts"),
        "export const h = 1;\n",
      );
      fs.writeFileSync(
        path.join(srcDir, "app.ts"),
        `import "./${nfd}/helper";\n`,
      );

      const graph = buildGraph(srcDir, []);
      const helperPath = graph.files.find(
        (file) => path.basename(file) === "helper.ts",
      );
      const appPath = path.join(srcDir, "app.ts");

      expect(helperPath).toBeDefined();
      expect(graph.importers.get(helperPath!)).toEqual([appPath]);
    },
  );
});

describe("canonicalGraphPath", () => {
  it.skipIf(ts.sys.useCaseSensitiveFileNames)(
    "recovers the graph's own casing for a path resolved through wrong-case specifier text",
    () => {
      const base = fs.realpathSync(tempDir("colocate-canonical-"));
      const srcDir = path.join(base, "src");
      const featureDir = path.join(srcDir, "Feature");
      fs.mkdirSync(featureDir, { recursive: true });
      const entryPath = path.join(featureDir, "Feature.ts");
      const helperPath = path.join(featureDir, "helper.ts");
      fs.writeFileSync(entryPath, "export const x = 1;\n");
      fs.writeFileSync(helperPath, "export const h = 1;\n");
      fs.writeFileSync(
        path.join(srcDir, "app.ts"),
        'import "./Feature/FEATURE";\n',
      );

      const graph = buildGraph(srcDir, []);
      const settings = getGraphResolutionSettings(graph);

      const wrongCaseEntry = resolveSpecifier(
        "./Feature/FEATURE",
        srcDir,
        settings,
      );
      expect(wrongCaseEntry).toBeDefined();
      expect(wrongCaseEntry).not.toBe(entryPath);
      expect(canonicalGraphPath(graph, wrongCaseEntry as string)).toBe(
        entryPath,
      );

      const wrongCaseHelper = resolveSpecifier(
        "./feature/helper",
        srcDir,
        settings,
      );
      expect(wrongCaseHelper).toBeDefined();
      expect(wrongCaseHelper).not.toBe(helperPath);
      expect(canonicalGraphPath(graph, wrongCaseHelper as string)).toBe(
        helperPath,
      );
    },
  );

  it.skipIf(!ts.sys.useCaseSensitiveFileNames)(
    "returns the path unchanged on a case-sensitive filesystem",
    () => {
      const graph = {
        files: ["/root/Feature/Feature.ts"],
        importers: new Map(),
      };
      expect(canonicalGraphPath(graph, "/root/Feature/FEATURE.ts")).toBe(
        "/root/Feature/FEATURE.ts",
      );
    },
  );

  it("returns the path unchanged when it matches no file in the graph", () => {
    const graph = { files: ["/root/Feature/Feature.ts"], importers: new Map() };
    expect(canonicalGraphPath(graph, "/root/Nowhere/Nowhere.ts")).toBe(
      "/root/Nowhere/Nowhere.ts",
    );
  });

  it.skipIf(ts.sys.useCaseSensitiveFileNames)(
    "prefers an exact graph member over the lowercase fold",
    () => {
      const graph = {
        files: ["/root/Foo/Index.ts", "/root/Foo/index.ts"],
        importers: new Map(),
      };
      expect(canonicalGraphPath(graph, "/root/Foo/Index.ts")).toBe(
        "/root/Foo/Index.ts",
      );
      expect(canonicalGraphPath(graph, "/root/Foo/index.ts")).toBe(
        "/root/Foo/index.ts",
      );
      expect(canonicalGraphPath(graph, "/root/foo/INDEX.ts")).toBe(
        "/root/Foo/index.ts",
      );
    },
  );

  it("recovers the graph's own spelling across Unicode normalization forms", () => {
    const nfc = "Café"; // é as a single code point
    const nfd = "Café"; // e followed by a combining acute
    expect(nfc).not.toBe(nfd);
    expect(nfc.normalize("NFC")).toBe(nfd.normalize("NFC"));

    const storedNfc = {
      files: [`/root/${nfc}/inner.ts`],
      importers: new Map(),
    };
    expect(canonicalGraphPath(storedNfc, `/root/${nfd}/inner.ts`)).toBe(
      `/root/${nfc}/inner.ts`,
    );

    const storedNfd = {
      files: [`/root/${nfd}/inner.ts`],
      importers: new Map(),
    };
    expect(canonicalGraphPath(storedNfd, `/root/${nfc}/inner.ts`)).toBe(
      `/root/${nfd}/inner.ts`,
    );

    expect(canonicalGraphPath(storedNfc, `/root/${nfc}/inner.ts`)).toBe(
      `/root/${nfc}/inner.ts`,
    );
    expect(canonicalGraphPath(storedNfd, `/root/${nfd}/inner.ts`)).toBe(
      `/root/${nfd}/inner.ts`,
    );

    expect(canonicalGraphPath(storedNfc, "/root/Other/inner.ts")).toBe(
      "/root/Other/inner.ts",
    );
  });
});

describe("graphFilesInDir", () => {
  it("returns graph files in a directory in graph.files order", () => {
    const base = fs.realpathSync(tempDir("colocate-files-by-dir-"));
    const srcDir = path.join(base, "src");
    const featDir = path.join(srcDir, "feat");
    fs.mkdirSync(featDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, "a.ts"), "export const a = 1;\n");
    fs.writeFileSync(path.join(srcDir, "b.ts"), "export const b = 1;\n");
    fs.writeFileSync(path.join(featDir, "Feat.ts"), "export const Feat = 1;\n");
    const aPath = fs.realpathSync(path.join(srcDir, "a.ts"));
    const bPath = fs.realpathSync(path.join(srcDir, "b.ts"));
    const featPath = fs.realpathSync(path.join(featDir, "Feat.ts"));
    const graph = buildGraph(srcDir, []);

    expect(graphFilesInDir(graph, srcDir)).toEqual([aPath, bPath]);
    expect(graphFilesInDir(graph, featDir)).toEqual([featPath]);
    expect(graphFilesInDir(graph, path.join(srcDir, "missing"))).toEqual([]);
  });

  it("works on an unprimed graph via the derived factory", () => {
    const base = fs.realpathSync(tempDir("colocate-files-by-dir-unprimed-"));
    const srcDir = path.join(base, "src");
    const featDir = path.join(srcDir, "feat");
    fs.mkdirSync(featDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, "a.ts"), "export const a = 1;\n");
    fs.writeFileSync(path.join(srcDir, "b.ts"), "export const b = 1;\n");
    fs.writeFileSync(path.join(featDir, "Feat.ts"), "export const Feat = 1;\n");
    const aPath = fs.realpathSync(path.join(srcDir, "a.ts"));
    const bPath = fs.realpathSync(path.join(srcDir, "b.ts"));
    const featPath = fs.realpathSync(path.join(featDir, "Feat.ts"));
    const graph: Graph = {
      files: [aPath, bPath, featPath],
      importers: new Map(),
    };

    expect(new Set(graphFilesInDir(graph, srcDir))).toEqual(
      new Set([aPath, bPath]),
    );
    expect(new Set(graphFilesInDir(graph, featDir))).toEqual(
      new Set([featPath]),
    );
    expect(graphFilesInDir(graph, path.join(srcDir, "missing"))).toEqual([]);
  });
});

describe("getGraphResolutionSettings", () => {
  it("resolves an aliased specifier the way the graph did, and pins the degraded fallback", () => {
    const base = fs.realpathSync(tempDir("colocate-settings-"));
    const srcDir = path.join(base, "src");
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, "a.ts"), "export const a = 1;\n");
    fs.writeFileSync(path.join(srcDir, "b.ts"), "export const b = 1;\n");
    fs.writeFileSync(
      path.join(base, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: { "@/*": ["src/*"] },
        },
      }),
    );

    const graph = buildGraph(srcDir, []);
    const settings = getGraphResolutionSettings(graph);

    expect(settings.options.paths).toEqual({ "@/*": ["src/*"] });
    expect(settings.configPaths).toContain(path.join(base, "tsconfig.json"));
    expect(resolveSpecifier("@/b", srcDir, settings)).toBe(
      path.join(base, "src", "b.ts"),
    );
    expect(resolveSpecifier("@/b", srcDir)).toBeUndefined();
  });

  it("returns no-project settings for a graph that was never built", () => {
    const base = tempDir("colocate-settings-unprimed-");
    const srcDir = path.join(base, "src");
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, "a.ts"), "export const a = 1;\n");
    fs.writeFileSync(path.join(srcDir, "b.ts"), "export const b = 1;\n");
    fs.writeFileSync(
      path.join(base, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: { "@/*": ["src/*"] },
        },
      }),
    );

    const settings = getGraphResolutionSettings({
      files: [],
      importers: new Map(),
    });

    expect(settings.options.paths).toBeUndefined();
    expect(resolveSpecifier("@/b", srcDir, settings)).toBeUndefined();
  });

  it("computes settings from a real root without a graph", () => {
    const base = tempDir("colocate-settings-root-");
    const srcDir = path.join(base, "src");
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, "a.ts"), "export const a = 1;\n");
    fs.writeFileSync(path.join(srcDir, "b.ts"), "export const b = 1;\n");
    fs.writeFileSync(
      path.join(base, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: { "@/*": ["src/*"] },
        },
      }),
    );

    const settings = createResolutionSettings(srcDir);

    expect(settings.options.paths).toEqual({ "@/*": ["src/*"] });
    expect(resolveSpecifier("@/b", srcDir, settings)).toBe(
      fs.realpathSync(path.join(base, "src", "b.ts")),
    );
  });
});
