import path from "node:path";
import type { Subject } from "./findings/index.js";
import {
  canonicalGraphPath,
  getGraphResolutionSettings,
} from "../lib/graph.js";
import { resolveSpecifier } from "../lib/resolve.js";
import { findCrossedGate, type CrossedGate } from "./gates.js";

export interface Crossing extends CrossedGate {
  target: string;
}

export function crossedGate(
  specifier: string,
  subject: Subject,
): Crossing | undefined {
  const graph = subject.graph();
  const resolved = resolveSpecifier(
    specifier,
    path.dirname(subject.file),
    getGraphResolutionSettings(graph),
  );
  if (resolved === undefined) {
    return undefined;
  }
  const target = canonicalGraphPath(graph, resolved);
  if (!subject.covers(target)) {
    return undefined;
  }
  const crossed = findCrossedGate(
    target,
    canonicalGraphPath(graph, subject.file),
    graph,
    subject.realRootDir,
  );
  return crossed === undefined ? undefined : { ...crossed, target };
}
