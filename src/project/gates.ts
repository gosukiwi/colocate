import path from "node:path";
import { derivedFromGraph } from "../lib/derived.js";
import type { Graph } from "../lib/graph.js";
import { isEntryFile, isInsideDir, stem } from "../lib/paths.js";

export const getGates = derivedFromGraph<ReadonlyMap<string, string>>(
  (graph) => {
    const gates = new Map<string, string>();
    for (const file of graph.files) {
      if (!isEntryFile(file)) {
        continue;
      }
      const dir = path.dirname(file);
      const isIndex = stem(file) === "index";
      const existing = gates.get(dir);
      const existingIsIndex =
        existing !== undefined && stem(existing) === "index";
      if (existing === undefined || (isIndex && !existingIsIndex)) {
        gates.set(dir, file);
      }
    }
    return gates;
  },
);

export interface CrossedGate {
  dir: string;
  entry: string;
}

export function findCrossedGate(
  target: string,
  importer: string,
  graph: Graph,
  rootDir: string,
): CrossedGate | undefined {
  if (isEntryFile(target)) {
    return undefined;
  }

  const gates = getGates(graph);
  let dir = path.dirname(target);

  while (true) {
    const entry = gates.get(dir);
    if (entry !== undefined && !isInsideDir(importer, dir)) {
      return { dir, entry };
    }
    if (dir === rootDir) {
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  return undefined;
}
