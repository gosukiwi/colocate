import fs from "node:fs";
import path from "node:path";
import { safeReadFile } from "../lib/fs-safe.js";

export const BASELINE_FILE = "colocate.baseline.json";

export interface BaselineEntry {
  rule: string;
  kind: string;
  file: string;
  subject?: string;
}

export interface Reportable {
  rule: string;
  kind: string;
  file: string;
  data: Record<string, string>;
}

const SUBJECT_KINDS = new Set(["reachesPastEntry", "namedDoorReexport"]);

export function entryOf(report: Reportable): BaselineEntry {
  const entry: BaselineEntry = {
    rule: report.rule,
    kind: report.kind,
    file: report.file,
  };
  const target = report.data["target"];
  if (SUBJECT_KINDS.has(report.kind) && target !== undefined) {
    entry.subject = target;
  }
  return entry;
}

function compareText(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

function compareEntries(a: BaselineEntry, b: BaselineEntry): number {
  return (
    compareText(a.file, b.file) ||
    compareText(a.rule, b.rule) ||
    compareText(a.kind, b.kind) ||
    compareText(a.subject ?? "", b.subject ?? "")
  );
}

function entryKey(entry: BaselineEntry): string {
  return JSON.stringify([
    entry.rule,
    entry.kind,
    entry.file,
    entry.subject ?? null,
  ]);
}

function isEntry(value: unknown): value is BaselineEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const entry = value as Record<string, unknown>;
  return (
    typeof entry["rule"] === "string" &&
    typeof entry["kind"] === "string" &&
    typeof entry["file"] === "string" &&
    (entry["subject"] === undefined || typeof entry["subject"] === "string")
  );
}

function parseBaseline(content: string, file: string): BaselineEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(`Invalid JSON in ${file}: ${(error as Error).message}`);
  }
  const shape = parsed as { version?: unknown; findings?: unknown } | null;
  if (
    typeof shape !== "object" ||
    shape === null ||
    shape.version !== 1 ||
    !Array.isArray(shape.findings) ||
    !shape.findings.every(isEntry)
  ) {
    throw new Error(`Invalid baseline in ${file}`);
  }
  return shape.findings as BaselineEntry[];
}

export function readBaseline(cwd: string): BaselineEntry[] | undefined {
  const file = path.join(cwd, BASELINE_FILE);
  const content = safeReadFile(file);
  return content === undefined ? undefined : parseBaseline(content, file);
}

export function writeBaseline(cwd: string, entries: BaselineEntry[]): void {
  const sorted = [...entries].sort(compareEntries);
  const text = JSON.stringify({ version: 1, findings: sorted }, null, 2);
  fs.writeFileSync(path.join(cwd, BASELINE_FILE), text + "\n");
}

export interface Absorption<T> {
  unabsorbed: T[];
  stale: BaselineEntry[];
}

export function absorb<T extends Reportable>(
  reports: T[],
  baseline: BaselineEntry[],
): Absorption<T> {
  const pending = new Map<string, BaselineEntry[]>();
  for (const entry of baseline) {
    const key = entryKey(entry);
    pending.set(key, [...(pending.get(key) ?? []), entry]);
  }
  const unabsorbed: T[] = [];
  for (const report of reports) {
    const bucket = pending.get(entryKey(entryOf(report)));
    if (bucket === undefined || bucket.length === 0) {
      unabsorbed.push(report);
    } else {
      bucket.pop();
    }
  }
  return { unabsorbed, stale: [...pending.values()].flat() };
}

export function dropStale(
  baseline: BaselineEntry[],
  stale: BaselineEntry[],
): BaselineEntry[] {
  const remaining = new Map<string, number>();
  for (const entry of stale) {
    const key = entryKey(entry);
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  return baseline.filter((entry) => {
    const key = entryKey(entry);
    const count = remaining.get(key) ?? 0;
    if (count === 0) {
      return true;
    }
    remaining.set(key, count - 1);
    return false;
  });
}
