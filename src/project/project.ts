import path from "node:path";
import { safeRealpath } from "../lib/fs-safe.js";
import {
  ownershipFindings,
  resolveRootDir,
  type Moved,
  type OwnershipResult,
  subjectFor,
  type Subject,
} from "./findings/index.js";
import { isEntryFile } from "./gates.js";
import { buildGraphFromFiles, type Graph } from "../lib/graph.js";
import { crossedGate } from "./crossing.js";
import { isNamedDoor, namedDoorReexports } from "./named-door.js";
import { parsedImports } from "../lib/parsed-files.js";
import { collectSourceFiles } from "../lib/walk.js";
import type { Options, RuleName } from "../options.js";

export type FindingKind =
  | "privateOutsideOwner"
  | "sharedTooHigh"
  | "sharedInsideOwner"
  | "singletonFolder"
  | "reachesPastEntry"
  | "namedDoorReexport";

export type MessageId =
  | FindingKind
  | "privateOutsideStandaloneOwner"
  | "privateOutsideStandaloneOwnerOnly";

export interface Finding {
  rule: RuleName;
  kind: FindingKind;
  messageId: MessageId;
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

function displayMoved(
  display: (filePath: string) => string,
  moved: Moved,
): string {
  return moved.isDir ? displayDir(display, moved.path) : display(moved.path);
}

function standaloneData(
  result: OwnershipResult,
  display: (filePath: string) => string,
): Record<string, string> {
  switch (result.messageId) {
    case "privateOutsideStandaloneOwner":
      return {
        owner: display(result.owner),
        moving: displayMoved(display, result.moving),
      };
    case "privateOutsideStandaloneOwnerOnly":
      return { owner: display(result.owner) };
    default:
      return {};
  }
}

function ownershipFindingsFor(
  subject: Subject,
  options: Options,
  cwd: string,
  display: (filePath: string) => string,
): Finding[] {
  return ownershipFindings(subject, cwd, options.layers).map((result) => ({
    rule: "ownership",
    kind: result.kind,
    messageId: result.messageId,
    file: subject.file,
    data: {
      destination: displayDir(display, result.destination),
      ...standaloneData(result, display),
    },
  }));
}

function crossingFindings(
  subject: Subject,
  graph: Graph,
  display: (filePath: string) => string,
): Finding[] {
  const findings: Finding[] = [];
  for (const { specifier, start, end } of parsedImports(graph, subject.file) ??
    []) {
    const c = crossedGate(specifier, subject);
    if (c !== undefined) {
      findings.push({
        rule: "entry",
        kind: "reachesPastEntry",
        messageId: "reachesPastEntry",
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
  display: (filePath: string) => string,
): Finding[] {
  if (!isNamedDoor(subject.file)) {
    return [];
  }
  return namedDoorReexports(subject.file, graph).map(
    ({ target, pos, end }) => ({
      rule: "entry",
      kind: "namedDoorReexport",
      messageId: "namedDoorReexport",
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
  return [
    ...crossingFindings(subject, graph, display),
    ...reexportFindings(subject, graph, display),
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
    isEntryFile,
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
