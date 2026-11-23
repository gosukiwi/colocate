import path from "node:path";
import { safeRealpath } from "../../lib/fs-safe.js";
import type { Graph } from "../../lib/graph.js";
import { isInGraphScope, isSourceFile } from "../../lib/scope.js";

export interface Subject {
  readonly rootDir: string;
  readonly realRootDir: string;
  readonly file: string;
  readonly ignore: string[];
  graph(): Graph;
  covers(filePath: string): boolean;
}

export function subjectFor(
  file: string,
  root: { rootDir: string; realRootDir: string },
  ignore: string[],
  graph: Graph,
): Subject | undefined {
  if (!isSourceFile(file)) {
    return undefined;
  }
  const realFile = safeRealpath(file);
  if (realFile === undefined) {
    return undefined;
  }
  const { rootDir, realRootDir } = root;
  if (!isInGraphScope(path.relative(realRootDir, realFile), ignore)) {
    return undefined;
  }
  return {
    rootDir,
    realRootDir,
    file: realFile,
    ignore,
    graph: () => graph,
    covers: (filePath) =>
      isSourceFile(filePath) &&
      isInGraphScope(path.relative(realRootDir, filePath), ignore),
  };
}
