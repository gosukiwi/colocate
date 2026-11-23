import path from "node:path";
import { parseArgs } from "node:util";
import { safeReadFile, safeRealpath } from "../lib/fs-safe.js";
import { formatMessage } from "../messages.js";
import { validateOptions, type Options } from "../options.js";
import { openProject, type Finding } from "../project.js";

export interface RunIo {
  cwd: string;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}

type Format = "text" | "json";

interface Args {
  format: Format;
  config: string | undefined;
  root: string | undefined;
}

interface Report {
  rule: string;
  kind: string;
  file: string;
  line?: number;
  column?: number;
  message: string;
  data: Record<string, string>;
}

const DEFAULT_CONFIG = "colocate.config.json";

function parseFormat(value: string | undefined): Format {
  if (value === undefined || value === "text") {
    return "text";
  }
  if (value === "json") {
    return "json";
  }
  throw new Error(`Invalid --format '${value}'; expected 'text' or 'json'`);
}

function parseArguments(argv: string[]): Args {
  const { values, positionals } = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: true,
    options: {
      format: { type: "string" },
      config: { type: "string" },
    },
  });
  if (positionals.length > 1) {
    throw new Error("Expected at most one root argument");
  }
  return {
    format: parseFormat(values.format),
    config: values.config,
    root: positionals[0],
  };
}

function loadOptions(args: Args, cwd: string): Options {
  const explicit = args.config !== undefined;
  const file = path.resolve(cwd, args.config ?? DEFAULT_CONFIG);
  const content = safeReadFile(file);
  if (content === undefined && explicit) {
    throw new Error(`Cannot read config file ${file}`);
  }
  let parsed: unknown = {};
  if (content !== undefined) {
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      throw new Error(`Invalid JSON in ${file}: ${(error as Error).message}`);
    }
  }
  return validateOptions({
    ...(parsed as object),
    ...(args.root === undefined ? {} : { root: args.root }),
  });
}

function toPosix(relative: string): string {
  return relative.split(path.sep).join("/");
}

function position(
  content: string,
  offset: number,
): { line: number; column: number } {
  const before = content.slice(0, offset);
  const line = before.split("\n").length;
  const column = offset - (before.lastIndexOf("\n") + 1) + 1;
  return { line, column };
}

function toReport(finding: Finding, base: string): Report {
  const report: Report = {
    rule: finding.rule,
    kind: finding.kind,
    file: toPosix(path.relative(base, finding.file)),
    message: formatMessage(finding),
    data: finding.data,
  };
  if (finding.range === undefined) {
    return report;
  }
  const content = safeReadFile(finding.file) ?? "";
  const { line, column } = position(content, finding.range[0]);
  return { ...report, line, column };
}

function textLine(report: Report): string {
  const where =
    report.line === undefined
      ? report.file
      : `${report.file}:${report.line}:${report.column}`;
  return `${where}  ${report.rule}/${report.kind}  ${report.message}\n`;
}

function collect(options: Options, cwd: string): Report[] {
  const base = safeRealpath(cwd) ?? cwd;
  const project = openProject(options, cwd);
  return project
    .files()
    .flatMap((file) => project.findings(file))
    .map((finding) => toReport(finding, base));
}

function emit(format: Format, reports: Report[], io: RunIo): void {
  if (format === "json") {
    io.stdout(JSON.stringify({ findings: reports }) + "\n");
    return;
  }
  for (const report of reports) {
    io.stderr(textLine(report));
  }
}

function emitError(format: Format, error: unknown, io: RunIo): void {
  const message = error instanceof Error ? error.message : String(error);
  if (format === "json") {
    io.stdout(JSON.stringify({ error: message }) + "\n");
  } else {
    io.stderr(`colocate: ${message}\n`);
  }
}

export function run(argv: string[], io: RunIo): number {
  let format: Format = "text";
  try {
    const args = parseArguments(argv);
    format = args.format;
    const reports = collect(loadOptions(args, io.cwd), io.cwd);
    emit(format, reports, io);
    return reports.length === 0 ? 0 : 2;
  } catch (error) {
    emitError(format, error, io);
    return 2;
  }
}
