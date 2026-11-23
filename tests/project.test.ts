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
        messageId: "singletonFolder",
        file,
        data: { destination: "src/" },
      },
    ]);
  });

  it("reports reachesPastEntry with the specifier range and message", () => {
    const { cwd, project } = open("entry-reaches-past", { root: "src" });
    const file = path.join(cwd, "src/app.ts");
    const found = project.findings(file);
    expect(found).toHaveLength(1);
    const [finding] = found;
    expect(finding?.kind).toBe("reachesPastEntry");
    expect(finding?.messageId).toBe("reachesPastEntry");
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
    expect(found[0]?.messageId).toBe("namedDoorReexport");
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
    expect(found[0]?.messageId).toBe("privateOutsideOwner");
    expect(found[0]?.data).toEqual({ destination: "src/pages/MyPage/" });
    expect(formatMessage(found[0]!)).toBe(
      "File is imported by a single owner but sits outside that owner's folder; move it into 'src/pages/MyPage/'.",
    );
  });

  it.each([
    {
      fixture: "private-standalone-owner",
      flagged: "src/pages/helper.ts",
      kinds: ["privateOutsideOwner"],
      messageId: "privateOutsideStandaloneOwner",
      data: {
        destination: "src/pages/MyPage/",
        owner: "src/pages/MyPage.ts",
        moving: "src/pages/helper.ts",
      },
      message:
        "File is imported only by the standalone file 'src/pages/MyPage.ts'; move 'src/pages/helper.ts' and 'src/pages/MyPage.ts' into the folder 'src/pages/MyPage/' so the owner becomes its entry.",
    },
    {
      fixture: "standalone-owner-folder-entry",
      flagged: "src/MyPage/MyPage.ts",
      kinds: ["privateOutsideOwner"],
      messageId: "privateOutsideStandaloneOwner",
      data: { destination: "src/x/", owner: "src/x.ts", moving: "src/MyPage/" },
      message:
        "File is imported only by the standalone file 'src/x.ts'; move 'src/MyPage/' and 'src/x.ts' into the folder 'src/x/' so the owner becomes its entry.",
    },
    {
      fixture: "standalone-owner-sibling-of-entry",
      flagged: "src/MyPage/util.ts",
      kinds: ["privateOutsideOwner"],
      messageId: "privateOutsideStandaloneOwner",
      data: {
        destination: "src/x/",
        owner: "src/x.ts",
        moving: "src/MyPage/util.ts",
      },
      message:
        "File is imported only by the standalone file 'src/x.ts'; move 'src/MyPage/util.ts' and 'src/x.ts' into the folder 'src/x/' so the owner becomes its entry.",
    },
    {
      fixture: "standalone-owner-ancestor-folder",
      flagged: "src/Feat/lib/deep.ts",
      kinds: ["privateOutsideOwner"],
      messageId: "privateOutsideStandaloneOwner",
      data: {
        destination: "src/x/",
        owner: "src/x.ts",
        moving: "src/Feat/lib/deep.ts",
      },
      message:
        "File is imported only by the standalone file 'src/x.ts'; move 'src/Feat/lib/deep.ts' and 'src/x.ts' into the folder 'src/x/' so the owner becomes its entry.",
    },
    {
      fixture: "standalone-owner-same-name-folder",
      flagged: "src/x/index.ts",
      kinds: ["singletonFolder", "privateOutsideOwner"],
      messageId: "privateOutsideStandaloneOwnerOnly",
      data: { destination: "src/x/", owner: "src/x.ts" },
      message:
        "File is imported only by the standalone file 'src/x.ts' beside its folder; move 'src/x.ts' into 'src/x/' so it becomes the folder's entry.",
    },
    {
      fixture: "standalone-owner-helper-in-owner-folder",
      flagged: "src/x/helper.ts",
      kinds: ["privateOutsideOwner"],
      messageId: "privateOutsideStandaloneOwnerOnly",
      data: { destination: "src/x/", owner: "src/x.ts" },
      message:
        "File is imported only by the standalone file 'src/x.ts' beside its folder; move 'src/x.ts' into 'src/x/' so it becomes the folder's entry.",
    },
    {
      fixture: "standalone-owner-entry-in-owner-folder",
      flagged: "src/x/MyPage/MyPage.ts",
      kinds: ["singletonFolder", "privateOutsideOwner"],
      messageId: "privateOutsideStandaloneOwnerOnly",
      data: { destination: "src/x/", owner: "src/x.ts" },
      message:
        "File is imported only by the standalone file 'src/x.ts' beside its folder; move 'src/x.ts' into 'src/x/' so it becomes the folder's entry.",
    },
  ])(
    "explains the standalone-owner move for $fixture",
    ({ fixture, flagged, kinds, messageId, data, message }) => {
      const { cwd, project } = open(fixture, { root: "src" });
      const all = project.findings(path.join(cwd, flagged));
      expect(all.map((f) => f.kind)).toEqual(kinds);
      const found = all.filter((f) => f.kind === "privateOutsideOwner");
      expect(found).toHaveLength(1);
      expect(found[0]?.messageId).toBe(messageId);
      expect(found[0]?.data).toEqual(data);
      expect(formatMessage(found[0]!)).toBe(message);
    },
  );

  it.each([
    [
      "private-standalone-owner-grouped",
      ["main", "App", "MyPage/MyPage", "MyPage/helper"].map(
        (f) => `src/pages/${f}.ts`,
      ),
    ],
    [
      "standalone-owner-folder-entry-grouped",
      ["main", "App", "x/x", "x/MyPage/MyPage", "x/MyPage/helper"].map(
        (f) => `src/${f}.ts`,
      ),
    ],
    [
      "standalone-owner-same-name-folder-grouped",
      ["main", "App", "x/x", "x/index"].map((f) => `src/${f}.ts`),
    ],
  ])("reports nothing once %s follows the advice", (fixture, files) => {
    const { cwd, project } = open(fixture, { root: "src" });
    for (const file of files) {
      expect(project.findings(path.join(cwd, file))).toEqual([]);
    }
  });

  it("points sharedTooHigh at the owners' common ancestor", () => {
    const { cwd, project } = open("shared-too-high", { root: "src" });
    const found = project.findings(path.join(cwd, "src/helpers/fmt.ts"));
    expect(found.map((f) => f.kind)).toEqual(["sharedTooHigh"]);
    expect(found[0]?.messageId).toBe("sharedTooHigh");
    expect(found[0]?.data).toEqual({ destination: "src/pages/" });
    expect(formatMessage(found[0]!)).toBe(
      "File is imported by multiple owners but sits above their common ancestor directory; move it into 'src/pages/'.",
    );
  });

  it("points sharedInsideOwner at the owners' common ancestor", () => {
    const { cwd, project } = open("mixed-importers", { root: "src" });
    const found = project.findings(path.join(cwd, "src/pages/A/fmt-buried.ts"));
    expect(found.map((f) => f.kind)).toEqual(["sharedInsideOwner"]);
    expect(found[0]?.messageId).toBe("sharedInsideOwner");
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
