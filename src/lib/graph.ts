import path from "node:path";
import ts from "typescript";
import { derivedFromGraph } from "./derived.js";
import { safeReadFile, safeRealpath } from "./fs-safe.js";
import {
  parsedFilesOf,
  parseForStore,
  type ParsedFile,
} from "./parsed-files.js";
import {
  createResolutionSettings,
  resolveSpecifier,
  type ResolutionSettings,
} from "./resolve.js";
import { collectSourceFiles } from "./walk.js";

export interface Graph {
  readonly importers: ReadonlyMap<string, readonly string[]>;
  readonly files: readonly string[];
}

const graphFileSet = derivedFromGraph((graph) => new Set(graph.files));

export function graphHasFile(graph: Graph, filePath: string): boolean {
  return graphFileSet(graph).has(filePath);
}

function filesByParentDir(files: readonly string[]): Map<string, string[]> {
  const byDir = new Map<string, string[]>();
  for (const file of files) {
    const dir = path.dirname(file);
    const list = byDir.get(dir);
    if (list === undefined) {
      byDir.set(dir, [file]);
    } else {
      list.push(file);
    }
  }
  return byDir;
}

const graphFilesByDir = derivedFromGraph((graph) =>
  filesByParentDir(graph.files),
);

export function graphFilesInDir(graph: Graph, dir: string): readonly string[] {
  return graphFilesByDir(graph).get(dir) ?? [];
}

function foldGraphPath(filePath: string): string {
  const normalized = filePath.normalize("NFC");
  return ts.sys.useCaseSensitiveFileNames
    ? normalized
    : normalized.toLowerCase();
}

const graphFilesByFoldedPath = derivedFromGraph(
  (graph) => new Map(graph.files.map((file) => [foldGraphPath(file), file])),
);

function graphFileForPath(
  fileSet: ReadonlySet<string>,
  filesByFoldedPath: ReadonlyMap<string, string>,
  filePath: string,
): string | undefined {
  if (fileSet.has(filePath)) {
    return filePath;
  }
  return filesByFoldedPath.get(foldGraphPath(filePath));
}

export function canonicalGraphPath(graph: Graph, filePath: string): string {
  return (
    graphFileForPath(
      graphFileSet(graph),
      graphFilesByFoldedPath(graph),
      filePath,
    ) ?? filePath
  );
}

function noProjectResolutionSettings(): ResolutionSettings {
  const resolutionOptions: ts.CompilerOptions = {
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowJs: true,
  };
  return {
    options: resolutionOptions,
    cache: ts.createModuleResolutionCache(
      "/",
      (fileName) => fileName,
      resolutionOptions,
    ),
    configPaths: [],
  };
}

export const getGraphResolutionSettings = derivedFromGraph(() =>
  noProjectResolutionSettings(),
);

export function buildGraphFromFiles(
  files: readonly string[],
  resolvedRoot: string,
  retainSource: (file: string) => boolean = () => false,
): Graph {
  const fileSet = new Set(files);
  const filesByFoldedPath = new Map(
    files.map((file) => [foldGraphPath(file), file]),
  );
  const importers = new Map<string, string[]>();
  const settings = createResolutionSettings(resolvedRoot);
  const store = new Map<string, ParsedFile>();

  for (const file of files) {
    const realFile = safeRealpath(file);
    if (realFile !== undefined && realFile !== file) {
      continue;
    }
    const content = safeReadFile(file);
    if (content === undefined) {
      continue;
    }
    const fromDir = path.dirname(file);
    const parsed = parseForStore(file, content, retainSource);
    store.set(file, parsed);

    for (const { specifier } of parsed.imports) {
      const resolved = resolveSpecifier(specifier, fromDir, settings);
      if (resolved === undefined) {
        continue;
      }
      const target = graphFileForPath(fileSet, filesByFoldedPath, resolved);
      if (target === undefined || target === file) {
        continue;
      }

      const existing = importers.get(target);
      if (existing === undefined) {
        importers.set(target, [file]);
      } else if (!existing.includes(file)) {
        existing.push(file);
      }
    }
  }

  const graph: Graph = { importers, files };
  getGraphResolutionSettings.prime(graph, settings);
  graphFileSet.prime(graph, fileSet);
  graphFilesByFoldedPath.prime(graph, filesByFoldedPath);
  graphFilesByDir.prime(graph, filesByParentDir(files));
  parsedFilesOf.prime(graph, store);
  return graph;
}

export function buildGraph(
  rootDir: string,
  ignoreGlobs: string[],
  retainSource?: (file: string) => boolean,
): Graph {
  const resolvedRoot = safeRealpath(rootDir);
  if (resolvedRoot === undefined) {
    return { importers: new Map(), files: [] };
  }
  const { files } = collectSourceFiles(resolvedRoot, ignoreGlobs);
  return buildGraphFromFiles(files, resolvedRoot, retainSource);
}
