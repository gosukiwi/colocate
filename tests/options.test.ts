import { describe, expect, it } from "vitest";
import { validateOptions } from "../src/options.js";

describe("validateOptions", () => {
  it("returns all defaults when raw is undefined", () => {
    expect(validateOptions(undefined)).toEqual({
      root: ".",
      ignore: [],
      layers: [],
      rules: ["ownership", "entry"],
    });
  });

  it("returns defaults for an empty object", () => {
    expect(validateOptions({})).toEqual({
      root: ".",
      ignore: [],
      layers: [],
      rules: ["ownership", "entry"],
    });
  });

  it("keeps every provided option", () => {
    expect(
      validateOptions({
        root: "src",
        ignore: ["**/*.test.ts"],
        layers: ["ui", "domain"],
        rules: ["entry"],
      }),
    ).toEqual({
      root: "src",
      ignore: ["**/*.test.ts"],
      layers: ["ui", "domain"],
      rules: ["entry"],
    });
  });

  it.each([
    ["null", null],
    ["an array", []],
    ["a string", "options"],
    ["a number", 3],
    ["a boolean", true],
  ])("rejects %s as the options object", (_label, raw) => {
    expect(() => validateOptions(raw)).toThrow(/must be an object/);
  });

  it("rejects an unknown key and names it", () => {
    expect(() => validateOptions({ shells: [] })).toThrow(/shells/);
  });

  it("rejects a non-string root and names it", () => {
    expect(() => validateOptions({ root: 42 })).toThrow(/root/);
  });

  it.each(["ignore", "layers"] as const)(
    "rejects a non-array %s and names it",
    (key) => {
      expect(() => validateOptions({ [key]: "src" })).toThrow(key);
    },
  );

  it.each(["ignore", "layers"] as const)(
    "rejects a %s array containing a non-string and names it",
    (key) => {
      expect(() => validateOptions({ [key]: ["ok", 1] })).toThrow(key);
    },
  );

  it("rejects rules that is not an array and names it", () => {
    expect(() => validateOptions({ rules: "entry" })).toThrow(/rules/);
  });

  it("rejects rules containing an unknown rule name and names it", () => {
    expect(() => validateOptions({ rules: ["entry", "style"] })).toThrow(
      /rules/,
    );
  });

  it("accepts an empty rules array", () => {
    expect(validateOptions({ rules: [] }).rules).toEqual([]);
  });
});
