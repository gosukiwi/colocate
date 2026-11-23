import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { formatMessage } from "../src/messages.js";
import { validateOptions } from "../src/options.js";
import { openProject } from "../src/project/project.js";

const fixtures = path.join(
  fileURLToPath(new URL(".", import.meta.url)),
  "fixtures",
);

function open(fixture: string, options: unknown) {
  const cwd = fs.realpathSync(path.join(fixtures, fixture));
  return { cwd, project: openProject(validateOptions(options), cwd) };
}

describe("openProject", () => {
  it("reports singletonFolder without a range", () => {
    const { cwd, project } = open("singleton-flag", {});
    const file = path.join(cwd, "src/Foo/Foo.ts");
    expect(project.findings(file)).toEqual([
      {
        rule: "ownership",
        kind: "singletonFolder",
        file,
        data: { destination: "src/" },
      },
    ]);
  });

  it("orders ownership findings as the rule does", () => {
    const { cwd, project } = open("two-findings-one-file", { root: "src" });
    const file = path.join(cwd, "src/shared/Widget/Widget.ts");
    expect(project.findings(file).map((f) => f.kind)).toEqual([
      "singletonFolder",
      "privateOutsideOwner",
    ]);
  });

  it("reports reachesPastEntry with the specifier range and message", () => {
    const { cwd, project } = open("entry-reaches-past", { root: "src" });
    const file = path.join(cwd, "src/app.ts");
    const found = project.findings(file);
    expect(found).toHaveLength(1);
    const [finding] = found;
    expect(finding?.kind).toBe("reachesPastEntry");
    expect(finding?.rule).toBe("entry");
    const content = fs.readFileSync(file, "utf8");
    const [start, end] = finding?.range ?? [0, 0];
    expect(content.slice(start, end)).toBe('"./Feature/helper"');
    expect(formatMessage(finding!)).toBe(
      "'src/Feature/helper.ts' is inside module 'src/Feature'; import it through 'src/Feature/Feature.ts', or move it out of 'src/Feature' if it is not part of it.",
    );
  });

  it("orders entry findings by position", () => {
    const { cwd, project } = open("entry-type-import-node", { root: "src" });
    const found = project.findings(path.join(cwd, "src/app.ts"));
    expect(found.map((f) => f.kind)).toEqual([
      "reachesPastEntry",
      "reachesPastEntry",
    ]);
    expect(found[0]!.range![0]).toBeLessThan(found[1]!.range![0]);
  });

  it("reports a named door re-export", () => {
    const { cwd, project } = open("entry-named-door-reexport", {
      root: "src",
    });
    const file = path.join(cwd, "src/Foo/Foo.ts");
    const found = project.findings(file);
    expect(found.map((f) => f.kind)).toEqual(["namedDoorReexport"]);
    expect(formatMessage(found[0]!)).toBe(
      "Named door 'src/Foo/Foo.ts' re-exports 'src/Foo/sib.ts'; use an index.ts in the same folder for a multi-file public surface, or export only what this file declares.",
    );
  });

  it("formats ownership messages", () => {
    const { cwd, project } = open("singleton-flag", {});
    const found = project.findings(path.join(cwd, "src/Foo/Foo.ts"));
    expect(formatMessage(found[0]!)).toBe(
      "Directory contains a single source file with no companion CSS; colocate or flatten the file into 'src/'.",
    );
  });

  it("points privateOutsideOwner at the owner's folder", () => {
    const { cwd, project } = open("private-sibling", { root: "src" });
    const found = project.findings(path.join(cwd, "src/pages/helper.ts"));
    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe("privateOutsideOwner");
    expect(found[0]?.data).toEqual({ destination: "src/pages/MyPage/" });
    expect(formatMessage(found[0]!)).toBe(
      "File is imported by a single owner but sits outside that owner's folder; move it into 'src/pages/MyPage/'.",
    );
  });

  it("asks to group a helper with its standalone owner into the owner's folder", () => {
    const { cwd, project } = open("private-standalone-owner", { root: "src" });
    const found = project.findings(path.join(cwd, "src/pages/helper.ts"));
    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe("privateOutsideOwner");
    expect(found[0]?.data).toEqual({
      destination: "src/pages/MyPage/",
      owner: "src/pages/MyPage.ts",
    });
    expect(formatMessage(found[0]!)).toBe(
      "File is imported only by the standalone file 'src/pages/MyPage.ts'; move both files into a new folder 'src/pages/MyPage/' so the owner becomes its entry.",
    );
  });

  it("points sharedTooHigh at the owners' common ancestor", () => {
    const { cwd, project } = open("shared-too-high", { root: "src" });
    const found = project.findings(path.join(cwd, "src/helpers/fmt.ts"));
    expect(found.map((f) => f.kind)).toEqual(["sharedTooHigh"]);
    expect(found[0]?.data).toEqual({ destination: "src/pages/" });
    expect(formatMessage(found[0]!)).toBe(
      "File is imported by multiple owners but sits above their common ancestor directory; move it into 'src/pages/'.",
    );
  });

  it("points sharedInsideOwner at the owners' common ancestor", () => {
    const { cwd, project } = open("mixed-importers", { root: "src" });
    const found = project.findings(path.join(cwd, "src/pages/A/fmt-buried.ts"));
    expect(found.map((f) => f.kind)).toEqual(["sharedInsideOwner"]);
    expect(found[0]?.data).toEqual({ destination: "src/" });
    expect(formatMessage(found[0]!)).toBe(
      "File is imported by multiple owners but sits inside a single owner's folder; move it into 'src/'.",
    );
  });

  it("renders the destination as ./ when it is the working directory", () => {
    const { cwd, project } = open("singleton-flag", { root: "src" });
    const found = project.findings(path.join(cwd, "src/Foo/Foo.ts"));
    expect(found[0]?.data).toEqual({ destination: "src/" });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "colocate-dot-"));
    const real = fs.realpathSync(dir);
    fs.mkdirSync(path.join(real, "Foo"));
    fs.writeFileSync(path.join(real, "Foo/Foo.ts"), "export const a = 1;\n");
    const opened = openProject(validateOptions({ root: "." }), real);
    const file = path.join(real, "Foo/Foo.ts");
    expect(opened.findings(file)[0]?.data).toEqual({ destination: "./" });
    fs.rmSync(real, { recursive: true, force: true });
  });

  it("skips ownership findings when only entry is enabled", () => {
    const { cwd, project } = open("singleton-flag", { rules: ["entry"] });
    expect(project.findings(path.join(cwd, "src/Foo/Foo.ts"))).toEqual([]);
  });

  it("returns nothing for a missing root", () => {
    const { cwd, project } = open("entry-reaches-past", {
      root: "does-not-exist",
    });
    expect(project.files()).toEqual([]);
    expect(project.findings(path.join(cwd, "src/app.ts"))).toEqual([]);
  });

  it("lists sorted files and excludes ignored ones", () => {
    const { cwd, project } = open("entry-ignore", {
      root: "src",
      ignore: ["Feature/helper.ts"],
    });
    expect(project.files()).toEqual([
      path.join(cwd, "src/Feature/Feature.ts"),
      path.join(cwd, "src/app.ts"),
    ]);
  });
});
