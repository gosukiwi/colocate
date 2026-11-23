import type ts from "typescript";
import { derivedFromGraph } from "./derived.js";
import { safeReadFile } from "./fs-safe.js";
import type { Graph } from "./graph.js";
import {
  importsFromSourceFile,
  parseSourceFile,
  type ParsedImport,
} from "./parse.js";

export interface ParsedFile {
  readonly imports: readonly ParsedImport[];
  readonly sourceFile?: ts.SourceFile;
}

export function parseForStore(
  file: string,
  content: string,
  retainSource: boolean,
): ParsedFile {
  const sourceFile = parseSourceFile(file, content);
  const imports = importsFromSourceFile(sourceFile);
  return retainSource ? { imports, sourceFile } : { imports };
}

export const parsedFilesOf = derivedFromGraph(
  () => new Map<string, ParsedFile>(),
);

function load(
  graph: Graph,
  file: string,
  needSource: boolean,
): ParsedFile | undefined {
  const store = parsedFilesOf(graph);
  const known = store.get(file);
  if (known !== undefined && (!needSource || known.sourceFile !== undefined)) {
    return known;
  }
  const content = safeReadFile(file);
  if (content === undefined) {
    return undefined;
  }
  const parsed = parseForStore(file, content, needSource);
  store.set(file, parsed);
  return parsed;
}

export function parsedSourceFile(
  graph: Graph,
  file: string,
): ts.SourceFile | undefined {
  return load(graph, file, true)?.sourceFile;
}

export function parsedImports(
  graph: Graph,
  file: string,
): readonly ParsedImport[] | undefined {
  return load(graph, file, false)?.imports;
}
