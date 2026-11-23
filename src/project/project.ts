import path from "node:path";
import { safeReadFile, safeRealpath } from "../lib/fs-safe.js";
import {
  ownershipFindings,
  resolveRootDir,
  subjectFor,
  type Subject,
} from "./findings/index.js";
import { buildGraphFromFiles, type Graph } from "../lib/graph.js";
import { crossedGate } from "./crossing.js";
import { isNamedDoor, namedDoorReexports } from "./named-door.js";
import { extractImports } from "../lib/parse.js";
import { collectSourceFiles } from "../lib/walk.js";
import type { Options, RuleName } from "../options.js";

export type FindingKind =
  | "privateOutsideOwner"
  | "sharedTooHigh"
  | "sharedInsideOwner"
  | "singletonFolder"
  | "reachesPastEntry"
  | "namedDoorReexport";

export interface Finding {
  rule: RuleName;
  kind: FindingKind;
  file: string;
  range?: [number, number];
  data: Record<string, string>;
}

export interface Project {
  files(): string[];
  findings(file: string): Finding[];
}

function displayer(cwd: string): (filePath: string) => string {
  const realCwd = safeRealpath(cwd) ?? cwd;
  return (filePath) =>
    path.relative(realCwd, filePath).split(path.sep).join("/");
}

function displayDir(
  display: (filePath: string) => string,
  dir: string,
): string {
  const relative = display(dir);
  return relative === "" ? "./" : `${relative}/`;
}

function ownershipFindingsFor(
  subject: Subject,
  options: Options,
  cwd: string,
  display: (filePath: string) => string,
): Finding[] {
  return ownershipFindings(subject, cwd, options.layers).map(
    ({ kind, destination, standalone }) => ({
      rule: "ownership",
      kind,
      file: subject.file,
      data: {
        destination: displayDir(display, destination),
        ...(standalone === undefined
          ? {}
          : {
              owner: display(standalone.owner),
              moving: standalone.movingIsDir
                ? displayDir(display, standalone.moving)
                : display(standalone.moving),
            }),
      },
    }),
  );
}

function crossingFindings(
  subject: Subject,
  content: string,
  display: (filePath: string) => string,
): Finding[] {
  const findings: Finding[] = [];
  for (const { specifier, start, end } of extractImports(
    content,
    subject.file,
  )) {
    const c = crossedGate(specifier, subject);
    if (c !== undefined) {
      findings.push({
        rule: "entry",
        kind: "reachesPastEntry",
        file: subject.file,
        range: [start, end],
        data: {
          target: display(c.target),
          module: display(c.dir),
          entry: display(c.entry),
        },
      });
    }
  }
  return findings;
}

function reexportFindings(
  subject: Subject,
  graph: Graph,
  content: string,
  display: (filePath: string) => string,
): Finding[] {
  if (!isNamedDoor(subject.file)) {
    return [];
  }
  return namedDoorReexports(subject.file, graph, content).map(
    ({ target, pos, end }) => ({
      rule: "entry",
      kind: "namedDoorReexport",
      file: subject.file,
      range: [pos, end],
      data: {
        door: display(subject.file),
        target: display(target),
      },
    }),
  );
}

function entryFindingsFor(
  subject: Subject,
  graph: Graph,
  display: (filePath: string) => string,
): Finding[] {
  const content = safeReadFile(subject.file);
  if (content === undefined) {
    return [];
  }
  return [
    ...crossingFindings(subject, content, display),
    ...reexportFindings(subject, graph, content, display),
  ].sort((a, b) => (a.range?.[0] ?? 0) - (b.range?.[0] ?? 0));
}

const EMPTY_PROJECT: Project = { files: () => [], findings: () => [] };

export function openProject(options: Options, cwd: string): Project {
  const rootDir = resolveRootDir(options.root, cwd);
  const realRootDir = safeRealpath(rootDir);
  if (realRootDir === undefined) {
    return EMPTY_PROJECT;
  }
  const root = { rootDir, realRootDir };
  const display = displayer(cwd);
  const graph = buildGraphFromFiles(
    collectSourceFiles(realRootDir, options.ignore).files,
    realRootDir,
  );
  const subjectOf = (file: string): Subject | undefined =>
    subjectFor(file, root, options.ignore, graph);

  return {
    files: () =>
      graph.files
        .map((file) => subjectOf(file)?.file)
        .filter((file): file is string => file !== undefined)
        .sort(),
    findings: (file) => {
      const subject = subjectOf(file);
      if (subject === undefined) {
        return [];
      }
      return [
        ...(options.rules.includes("ownership")
          ? ownershipFindingsFor(subject, options, cwd, display)
          : []),
        ...(options.rules.includes("entry")
          ? entryFindingsFor(subject, graph, display)
          : []),
      ];
    },
  };
}
