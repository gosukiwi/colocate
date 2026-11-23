import path from "node:path";
import { parseArgs } from "node:util";
import { safeReadFile, safeRealpath } from "../lib/fs-safe.js";
import {
  absorb,
  dropStale,
  entryOf,
  readBaseline,
  writeBaseline,
} from "./baseline.js";
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
  updateBaseline: boolean;
  baselineAddAll: boolean;
  help: boolean;
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

const USAGE = `Usage: colocate [root] [options]

  colocate [root]       lint the project; root overrides the configured root
  --format text|json    output format (default text)
  --config <path>       config file (default colocate.config.json)
  --update-baseline     drop fixed entries from colocate.baseline.json; creates it if missing
  --baseline-add-all    record every current finding in the baseline \u2014 for humans adopting colocate; agents must not use this
  --help                show this help

Exit codes: 0 clean, 2 findings or error
`;

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
      "update-baseline": { type: "boolean" },
      "baseline-add-all": { type: "boolean" },
      help: { type: "boolean" },
    },
  });
  if (positionals.length > 1) {
    throw new Error("Expected at most one root argument");
  }
  if (values["update-baseline"] && values["baseline-add-all"]) {
    throw new Error(
      "--update-baseline and --baseline-add-all cannot be used together",
    );
  }
  return {
    format: parseFormat(values.format),
    config: values.config,
    root: positionals[0],
    updateBaseline: values["update-baseline"] === true,
    baselineAddAll: values["baseline-add-all"] === true,
    help: values.help === true,
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

function emit(
  format: Format,
  reports: Report[],
  stale: number,
  io: RunIo,
): void {
  if (format === "json") {
    const body =
      stale > 0
        ? { findings: reports, staleBaseline: stale }
        : { findings: reports };
    io.stdout(JSON.stringify(body) + "\n");
    return;
  }
  for (const report of reports) {
    io.stderr(textLine(report));
  }
  if (stale > 0) {
    io.stderr(
      `colocate: ${stale} baselined finding(s) no longer occur; run colocate --update-baseline\n`,
    );
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

function applyBaseline(args: Args, reports: Report[], cwd: string) {
  if (args.baselineAddAll) {
    writeBaseline(cwd, reports.map(entryOf));
    return undefined;
  }
  let baseline = readBaseline(cwd);
  if (args.updateBaseline) {
    baseline =
      baseline === undefined
        ? reports.map(entryOf)
        : dropStale(baseline, absorb(reports, baseline).stale);
    writeBaseline(cwd, baseline);
  }
  return absorb(reports, baseline ?? []);
}

export function run(argv: string[], io: RunIo): number {
  let format: Format = "text";
  try {
    const args = parseArguments(argv);
    format = args.format;
    if (args.help) {
      io.stdout(USAGE);
      return 0;
    }
    const reports = collect(loadOptions(args, io.cwd), io.cwd);
    const result = applyBaseline(args, reports, io.cwd);
    if (result === undefined) {
      return 0;
    }
    emit(format, result.unabsorbed, result.stale.length, io);
    return result.unabsorbed.length === 0 ? 0 : 2;
  } catch (error) {
    emitError(format, error, io);
    return 2;
  }
}
