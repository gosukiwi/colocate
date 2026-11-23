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
  retainSource: (file: string) => boolean,
): ParsedFile {
  const sourceFile = parseSourceFile(file, content);
  const imports = importsFromSourceFile(sourceFile);
  return retainSource(file) ? { imports, sourceFile } : { imports };
}

export const parsedFilesOf = derivedFromGraph(
  () => new Map<string, ParsedFile>(),
);

export function parsedSourceFile(
  graph: Graph,
  file: string,
): ts.SourceFile | undefined {
  const store = parsedFilesOf(graph);
  const known = store.get(file)?.sourceFile;
  if (known !== undefined) {
    return known;
  }
  const content = safeReadFile(file);
  if (content === undefined) {
    return undefined;
  }
  const parsed = parseForStore(file, content, () => true);
  store.set(file, parsed);
  return parsed.sourceFile;
}

export function parsedImports(
  graph: Graph,
  file: string,
): readonly ParsedImport[] | undefined {
  const store = parsedFilesOf(graph);
  const known = store.get(file);
  if (known !== undefined) {
    return known.imports;
  }
  const content = safeReadFile(file);
  if (content === undefined) {
    return undefined;
  }
  const parsed = parseForStore(file, content, () => false);
  store.set(file, parsed);
  return parsed.imports;
}
