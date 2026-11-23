import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { formatMessage } from "../src/messages.js";
import { validateOptions } from "../src/options.js";
import { openProject } from "../src/project.js";

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
      { rule: "ownership", kind: "singletonFolder", file, data: {} },
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
      "'Feature/helper.ts' is inside module 'Feature'; import it through 'Feature/Feature.ts', or move it out of 'Feature' if it is not part of it.",
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
      "Named door 'Foo/Foo.ts' re-exports 'Foo/sib.ts'; use an index.ts in the same folder for a multi-file public surface, or export only what this file declares.",
    );
  });

  it("formats ownership messages", () => {
    const { cwd, project } = open("singleton-flag", {});
    const found = project.findings(path.join(cwd, "src/Foo/Foo.ts"));
    expect(formatMessage(found[0]!)).toBe(
      "Directory contains a single source file with no companion CSS; colocate or flatten the file.",
    );
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
