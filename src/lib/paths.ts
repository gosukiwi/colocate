import path from "node:path";

export function isInsideDir(filePath: string, dir: string): boolean {
  const prefix = dir.endsWith(path.sep) ? dir : dir + path.sep;
  return filePath.startsWith(prefix);
}

export function isAtOrInsideDir(filePath: string, dir: string): boolean {
  return filePath === dir || isInsideDir(filePath, dir);
}

export function stem(filePath: string): string {
  return path.basename(filePath, path.extname(filePath));
}

export function isEntryFile(filePath: string): boolean {
  const base = stem(filePath);
  return base === "index" || base === path.basename(path.dirname(filePath));
}
