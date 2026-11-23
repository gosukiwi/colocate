import path from "node:path";
import { minimatch } from "minimatch";
import ts from "typescript";
import { derivedFromGraph } from "../../lib/derived.js";
import { safeReadFile, safeReaddir, safeRealpath } from "../../lib/fs-safe.js";
import {
  canonicalGraphPath,
  getGraphResolutionSettings,
  graphFilesInDir,
  type Graph,
} from "../../lib/graph.js";
import { parseSourceFile } from "../../lib/parse.js";
import { isAtOrInsideDir, isInsideDir, stem } from "../../lib/paths.js";
import { resolveSpecifier } from "../../lib/resolve.js";
import { SKIP_DIRS } from "../../lib/scope.js";

export interface OwnershipContext {
  graph: Graph;
  rootDir: string;
  layerDirs: string[];
}

export interface SharedIssue {
  kind: "sharedTooHigh" | "sharedInsideOwner";
  lca: string;
}

const reExportsByGraph = derivedFromGraph(() => new Map<string, string[]>());

function scanReExports(indexFile: string, dir: string, graph: Graph): string[] {
  const content = safeReadFile(indexFile);
  const realDir = safeRealpath(dir);
  const realIndex = safeRealpath(indexFile);
  if (content === undefined || realDir === undefined) {
    return [];
  }
  const sourceFile = parseSourceFile(indexFile, content);
  const settings = getGraphResolutionSettings(graph);
  const local = new Set<string>();

  const visit = (node: ts.Node): void => {
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const specifier = node.moduleSpecifier.text;
      const resolved = resolveSpecifier(specifier, dir, settings);
      const target =
        resolved === undefined
          ? undefined
          : canonicalGraphPath(graph, resolved);
      if (target !== undefined && target !== realIndex) {
        if (path.dirname(target) === realDir) {
          local.add(target);
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return [...local];
}

export function collectReExports(
  indexFile: string,
  dir: string,
  graph: Graph,
): string[] {
  const key = indexFile + "\0" + dir;
  const perGraph = reExportsByGraph(graph);
  const cached = perGraph.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const result = scanReExports(indexFile, dir, graph);
  perGraph.set(key, result);
  return result;
}

function isNamespaceBarrel(filePath: string, graph: Graph): boolean {
  const basename = stem(filePath);
  if (basename !== "index") {
    return false;
  }
  return collectReExports(filePath, path.dirname(filePath), graph).length >= 2;
}

function isOwnerEntryFile(file: string, dir: string, graph: Graph): boolean {
  if (path.dirname(file) !== dir) {
    return false;
  }
  const base = stem(file);
  if (base === path.basename(dir)) {
    return true;
  }
  if (base !== "index") {
    return false;
  }
  return (graph.importers.get(file) ?? []).some(
    (importer) => path.dirname(importer) !== dir,
  );
}

function directoryHasMatchingEntry(dir: string, graph: Graph): boolean {
  return graphFilesInDir(graph, dir).some((file) =>
    isOwnerEntryFile(file, dir, graph),
  );
}

export interface Owner {
  kind: "folder" | "standalone";
  path: string;
}

export function getOwner(
  filePath: string,
  graph: Graph,
  rootDir: string,
): Owner {
  let dir = path.dirname(filePath);
  const realRoot = safeRealpath(rootDir) ?? rootDir;

  while (true) {
    if (directoryHasMatchingEntry(dir, graph)) {
      return { kind: "folder", path: dir };
    }
    if (dir === realRoot) {
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  return { kind: "standalone", path: filePath };
}

function buildImports(graph: Graph): Map<string, string[]> {
  const imports = new Map<string, string[]>();
  for (const [target, importers] of graph.importers) {
    for (const importer of importers) {
      const existing = imports.get(importer);
      if (existing === undefined) {
        imports.set(importer, [target]);
      } else {
        existing.push(target);
      }
    }
  }
  return imports;
}

function popComponent(
  stack: string[],
  onStack: Set<string>,
  ids: Map<string, number>,
  id: number,
  root: string,
): void {
  while (true) {
    const member = stack.pop();
    if (member === undefined) {
      break;
    }
    onStack.delete(member);
    ids.set(member, id);
    if (member === root) {
      break;
    }
  }
}

interface TarjanFrame {
  node: string;
  edges: string[];
  next: number;
}

function stronglyConnectedIds(
  nodes: readonly string[],
  edgesOf: (node: string) => string[],
): Map<string, number> {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const ids = new Map<string, number>();
  let counter = 0;
  let nextId = 0;

  const push = (node: string, frames: TarjanFrame[]): void => {
    index.set(node, counter);
    low.set(node, counter);
    counter += 1;
    stack.push(node);
    onStack.add(node);
    frames.push({ node, edges: edgesOf(node), next: 0 });
  };

  const visitEdge = (
    frame: TarjanFrame,
    child: string,
    frames: TarjanFrame[],
  ): void => {
    if (!index.has(child)) {
      push(child, frames);
      return;
    }
    if (onStack.has(child)) {
      low.set(
        frame.node,
        Math.min(low.get(frame.node) ?? 0, index.get(child) ?? 0),
      );
    }
  };

  const finishFrame = (frame: TarjanFrame, frames: TarjanFrame[]): void => {
    frames.pop();
    const parent = frames[frames.length - 1];
    if (parent !== undefined) {
      low.set(
        parent.node,
        Math.min(low.get(parent.node) ?? 0, low.get(frame.node) ?? 0),
      );
    }
    if (low.get(frame.node) === index.get(frame.node)) {
      const id = nextId;
      nextId += 1;
      popComponent(stack, onStack, ids, id, frame.node);
    }
  };

  for (const start of nodes) {
    if (index.has(start)) {
      continue;
    }

    const frames: TarjanFrame[] = [];
    push(start, frames);

    while (frames.length > 0) {
      const frame = frames[frames.length - 1];

      if (frame.next < frame.edges.length) {
        const child = frame.edges[frame.next];
        frame.next += 1;
        visitEdge(frame, child, frames);
        continue;
      }

      finishFrame(frame, frames);
    }
  }

  return ids;
}

function getRoots(graph: Graph): Set<string> {
  const imports = buildImports(graph);
  const componentIds = stronglyConnectedIds(
    graph.files,
    (file) => imports.get(file) ?? [],
  );
  const importedFromOutside = new Set<number>();
  for (const file of graph.files) {
    const component = componentIds.get(file);
    for (const importer of graph.importers.get(file) ?? []) {
      if (componentIds.get(importer) !== component && component !== undefined) {
        importedFromOutside.add(component);
      }
    }
  }

  const roots = new Set<string>();
  for (const file of graph.files) {
    const component = componentIds.get(file);
    if (component === undefined || !importedFromOutside.has(component)) {
      roots.add(file);
    }
  }

  return roots;
}

export const getShells = derivedFromGraph((graph) => {
  const roots = getRoots(graph);
  const shells = new Set(roots);

  for (const file of graph.files) {
    if (shells.has(file)) {
      continue;
    }
    const importers = graph.importers.get(file) ?? [];
    if (
      importers.length > 0 &&
      importers.every((importer) => roots.has(importer))
    ) {
      shells.add(file);
    }
  }

  return shells;
});

function partitionImporters(
  filePath: string,
  graph: Graph,
  shells: Set<string>,
): { consumers: string[]; shellVoices: string[] } {
  const consumers: string[] = [];
  const shellVoices: string[] = [];
  for (const importer of graph.importers.get(filePath) ?? []) {
    if (isNamespaceBarrel(importer, graph)) {
      continue;
    }
    if (shells.has(importer)) {
      shellVoices.push(importer);
    } else {
      consumers.push(importer);
    }
  }
  return { consumers, shellVoices };
}

export function getColocationConsumers(
  filePath: string,
  graph: Graph,
  shells: Set<string>,
): string[] {
  return partitionImporters(filePath, graph, shells).consumers;
}

function collectLayerDirs(
  dir: string,
  cwd: string,
  rootDir: string,
  layerGlobs: string[],
  out: string[],
): void {
  for (const entry of safeReaddir(dir)) {
    if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    const candidates = [
      path.relative(cwd, fullPath).split(path.sep).join("/"),
      path.relative(rootDir, fullPath).split(path.sep).join("/"),
    ];
    if (
      layerGlobs.some((glob) =>
        candidates.some((candidate) => minimatch(candidate, glob)),
      )
    ) {
      const realPath = safeRealpath(fullPath);
      if (realPath !== undefined) {
        out.push(realPath);
      }
    }
    collectLayerDirs(fullPath, cwd, rootDir, layerGlobs, out);
  }
}

export function collectLayerDirectories(
  cwd: string,
  layerGlobs: string[],
  rootDir: string = cwd,
): string[] {
  if (layerGlobs.length === 0) {
    return [];
  }
  const dirs: string[] = [];
  collectLayerDirs(cwd, cwd, rootDir, layerGlobs, dirs);
  return dirs;
}

const layerDirsByGraph = derivedFromGraph(() => new Map<string, string[]>());

export function resolveLayerDirectories(
  graph: Graph,
  cwd: string,
  layerGlobs: string[],
  rootDir: string = cwd,
): string[] {
  if (layerGlobs.length === 0) {
    return [];
  }

  const key = cwd + "\0" + rootDir + "\0" + layerGlobs.join("\0");
  const perGraph = layerDirsByGraph(graph);
  const cached = perGraph.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const dirs = collectLayerDirectories(cwd, layerGlobs, rootDir);
  perGraph.set(key, dirs);
  return dirs;
}

export function isLayerPublicModule(
  filePath: string,
  layerDirs: string[],
): boolean {
  if (layerDirs.length === 0) {
    return false;
  }

  const parent = path.dirname(filePath);
  if (layerDirs.includes(parent)) {
    return true;
  }

  const grandparent = path.dirname(parent);
  if (!layerDirs.includes(grandparent)) {
    return false;
  }

  const folderName = path.basename(parent);
  const fileBase = stem(filePath);
  return fileBase === folderName || fileBase === "index";
}

export function shouldSkipColocation(
  filePath: string,
  ctx: OwnershipContext,
): boolean {
  const shells = getShells(ctx.graph);
  if (shells.has(filePath)) {
    return true;
  }
  if (isLayerPublicModule(filePath, ctx.layerDirs)) {
    return true;
  }
  return getColocationConsumers(filePath, ctx.graph, shells).length === 0;
}

function collectConsumerOwners(
  filePath: string,
  ctx: OwnershipContext,
): Map<string, Owner> {
  const shells = getShells(ctx.graph);
  const consumers = getColocationConsumers(filePath, ctx.graph, shells);
  const owners = new Map<string, Owner>();
  for (const consumer of consumers) {
    const owner = getOwner(consumer, ctx.graph, ctx.rootDir);
    owners.set(owner.path, owner);
  }
  return owners;
}

function ownerDir(owner: Owner): string {
  return owner.kind === "folder" ? owner.path : path.dirname(owner.path);
}

export function ownerHome(owner: Owner): string {
  if (owner.kind === "folder") {
    return owner.path;
  }
  return path.join(path.dirname(owner.path), stem(owner.path));
}

export interface Moved {
  path: string;
  isDir: boolean;
}

export function movedWithStandaloneOwner(
  file: string,
  owner: Owner,
  graph: Graph,
): Moved | undefined {
  const isDir = isOwnerEntryFile(file, path.dirname(file), graph);
  const movedPath = isDir ? path.dirname(file) : file;
  if (isAtOrInsideDir(movedPath, ownerHome(owner))) {
    return undefined;
  }
  return { path: movedPath, isDir };
}

function isOutsideOwner(filePath: string, owner: Owner): boolean {
  return owner.kind === "folder"
    ? !isInsideDir(filePath, owner.path)
    : filePath !== owner.path;
}

export function privateOutsideOwner(
  filePath: string,
  ctx: OwnershipContext,
): Owner | undefined {
  if (shouldSkipColocation(filePath, ctx)) {
    return undefined;
  }

  const owners = collectConsumerOwners(filePath, ctx);

  if (owners.size !== 1) {
    return undefined;
  }

  if (collectExtraShellOwners(filePath, ctx, owners).size > 0) {
    return undefined;
  }

  const owner = owners.values().next().value;
  if (owner === undefined || !isOutsideOwner(filePath, owner)) {
    return undefined;
  }
  return owner;
}

function longestCommonAncestor(dirs: string[]): string {
  if (dirs.length === 0) {
    return "";
  }
  const segments = dirs.map((dir) => dir.split(path.sep));
  const minLen = Math.min(...segments.map((parts) => parts.length));
  const common: string[] = [];
  for (let i = 0; i < minLen; i++) {
    const part = segments[0][i];
    if (segments.every((parts) => parts[i] === part)) {
      common.push(part);
    } else {
      break;
    }
  }
  return common.join(path.sep);
}

function folderOwnerAncestors(
  filePath: string,
  graph: Graph,
  rootDir: string,
): string[] {
  const realRoot = safeRealpath(rootDir) ?? rootDir;
  const dirs: string[] = [];
  let dir = path.dirname(filePath);

  while (true) {
    if (directoryHasMatchingEntry(dir, graph)) {
      dirs.push(dir);
    }
    if (dir === realRoot) {
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  return dirs;
}

function shellVoiceImporters(
  filePath: string,
  graph: Graph,
  shells: Set<string>,
): string[] {
  return partitionImporters(filePath, graph, shells).shellVoices;
}

function collectExtraShellOwners(
  filePath: string,
  ctx: OwnershipContext,
  countedOwners: Map<string, Owner>,
): Map<string, Owner> {
  const shells = getShells(ctx.graph);
  const extra = new Map<string, Owner>();
  for (const importer of shellVoiceImporters(filePath, ctx.graph, shells)) {
    const owner = getOwner(importer, ctx.graph, ctx.rootDir);
    if (!countedOwners.has(owner.path) && !extra.has(owner.path)) {
      extra.set(owner.path, owner);
    }
  }
  return extra;
}

function evaluateSharedPosition(
  filePath: string,
  ctx: OwnershipContext,
  owners: Map<string, Owner>,
): SharedIssue | undefined {
  const ownerDirs = [...new Set([...owners.values()].map(ownerDir))];
  const lca = longestCommonAncestor(ownerDirs);

  const consumerFolderDirs = [...owners.values()]
    .filter((owner) => owner.kind === "folder")
    .map((owner) => owner.path);
  const candidates = new Set([
    ...consumerFolderDirs,
    ...folderOwnerAncestors(filePath, ctx.graph, ctx.rootDir),
  ]);

  const containing = [...candidates].filter((dir) => {
    if (!isInsideDir(filePath, dir)) {
      return false;
    }
    if (!isInsideDir(dir, lca)) {
      return false;
    }
    return !isOwnerEntryFile(filePath, dir, ctx.graph);
  });

  if (containing.length > 0) {
    return { kind: "sharedInsideOwner", lca };
  }

  if (!isInsideDir(filePath, lca)) {
    return { kind: "sharedTooHigh", lca };
  }
  return undefined;
}

export function getSharedColocationIssue(
  filePath: string,
  ctx: OwnershipContext,
): SharedIssue | undefined {
  if (shouldSkipColocation(filePath, ctx)) {
    return undefined;
  }

  const owners = collectConsumerOwners(filePath, ctx);
  if (owners.size === 0) {
    return undefined;
  }
  const merged = new Map([
    ...owners,
    ...collectExtraShellOwners(filePath, ctx, owners),
  ]);
  if (merged.size < 2) {
    return undefined;
  }
  return evaluateSharedPosition(filePath, ctx, merged);
}
