import { describe, expect, it } from "vitest";
import { extractImports, extractSpecifiers } from "../src/lib/parse.js";

describe("extractSpecifiers", () => {
  it("records type-position import()", () => {
    expect(
      extractSpecifiers('export type X = import("./mod").T;\n', "a.ts"),
    ).toEqual(["./mod"]);
  });

  it("records typeof import()", () => {
    expect(
      extractSpecifiers('export type X = typeof import("./mod");\n', "a.ts"),
    ).toEqual(["./mod"]);
  });

  it("records a type-position import() in a type annotation", () => {
    expect(extractSpecifiers('let v: import("./mod").T;\n', "a.ts")).toEqual([
      "./mod",
    ]);
  });

  it("ignores a type-position import() whose argument is not a string literal", () => {
    expect(
      extractSpecifiers("export type X = import(foo).T;\n", "a.ts"),
    ).toEqual([]);
  });

  it("records quoted import() and require() specifiers", () => {
    expect(extractSpecifiers('import("./mod");\n', "a.ts")).toEqual(["./mod"]);
    expect(extractSpecifiers('require("./mod");\n', "a.js")).toEqual(["./mod"]);
  });

  it("records import() nested in lazy(() => import())", () => {
    expect(
      extractSpecifiers('const Page = lazy(() => import("./mod"));\n', "a.ts"),
    ).toEqual(["./mod"]);
  });

  it("records import() with a no-substitution template specifier", () => {
    expect(extractSpecifiers("import(`./mod`);\n", "a.ts")).toEqual(["./mod"]);
  });

  it("records require() with a no-substitution template specifier", () => {
    expect(extractSpecifiers("require(`./mod`);\n", "a.js")).toEqual(["./mod"]);
  });

  it("records type-position import() with a no-substitution template specifier", () => {
    expect(
      extractSpecifiers("export type X = import(`./mod`).T;\n", "a.ts"),
    ).toEqual(["./mod"]);
  });

  it("records the cooked value of a no-substitution template specifier", () => {
    expect(extractSpecifiers("import(`./hel\\u0070er`);\n", "a.ts")).toEqual([
      "./helper",
    ]);
  });

  it("ignores a template specifier with substitutions", () => {
    expect(extractSpecifiers("import(`./mod${y}`);\n", "a.ts")).toEqual([]);
  });
});

describe("extractImports", () => {
  const cases: [string, string, string][] = [
    ["import declaration", 'import a from "./x";\n', "a.ts"],
    ["export-from", 'export * from "./x";\n', "a.ts"],
    ["dynamic import()", 'const m = import("./x");\n', "a.ts"],
    ["require() call", 'const m = require("./x");\n', "a.js"],
    ["import-equals require", 'import m = require("./x");\n', "a.ts"],
    ["import type node", 'let v: import("./x").T;\n', "a.ts"],
  ];

  it.each(cases)("locates the literal for %s", (_name, content, fileName) => {
    const start = content.indexOf('"./x"');
    expect(extractImports(content, fileName)).toEqual([
      { specifier: "./x", start, end: start + '"./x"'.length },
    ]);
  });

  it("matches extractSpecifiers order and skips shadowed require", () => {
    const content =
      'import "./a";\nfunction f(require) { require("./b"); }\nrequire("./c");\n';
    const imports = extractImports(content, "a.js");
    expect(imports.map((i) => i.specifier)).toEqual(
      extractSpecifiers(content, "a.js"),
    );
    expect(imports.map((i) => content.slice(i.start, i.end))).toEqual([
      '"./a"',
      '"./c"',
    ]);
  });
});
