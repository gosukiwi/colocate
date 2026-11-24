import type ts from "typescript";
import { derivedFromGraph } from "./derived.js";
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

export function parsedSourceFile(
  graph: Graph,
  file: string,
): ts.SourceFile | undefined {
  return parsedFilesOf(graph).get(file)?.sourceFile;
}

export function parsedImports(
  graph: Graph,
  file: string,
): readonly ParsedImport[] | undefined {
  return parsedFilesOf(graph).get(file)?.imports;
}
