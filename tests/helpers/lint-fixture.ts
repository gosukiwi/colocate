import path from "node:path";
import { fileURLToPath } from "node:url";
import { safeReadFile } from "../../src/lib/fs-safe.js";
import { formatMessage } from "../../src/messages.js";
import { validateOptions } from "../../src/options.js";
import { openProject } from "../../src/project.js";

const fixturesDir = path.join(
  fileURLToPath(new URL(".", import.meta.url)),
  "../fixtures",
);

export type RuleName = "ownership" | "entry";

export interface FixtureMessage {
  file: string;
  messageId: string;
  line?: number;
  message: string;
}

function lineAt(content: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < content.length; i++) {
    if (content[i] === "\n") {
      line++;
    }
  }
  return line;
}

function isTargeted(relative: string, targets: string[]): boolean {
  return targets.some(
    (target) =>
      target === "." ||
      relative === target ||
      relative.startsWith(`${target}/`),
  );
}

export async function lintFixtureRule(
  name: string,
  rule: RuleName,
  ruleOptions?: Record<string, unknown>,
  targets: string[] = ["src"],
): Promise<FixtureMessage[]> {
  const cwd = path.resolve(fixturesDir, name);
  const project = await openProject(
    validateOptions({ ...ruleOptions, rules: [rule] }),
    cwd,
  );
  const messages: FixtureMessage[] = [];
  for (const file of project.files()) {
    const relative = path.relative(cwd, file).split(path.sep).join("/");
    if (!isTargeted(relative, targets)) {
      continue;
    }
    const content = safeReadFile(file) ?? "";
    for (const finding of project.findings(file)) {
      const message: FixtureMessage = {
        file: relative,
        messageId: finding.kind,
        message: formatMessage(finding),
      };
      if (finding.range !== undefined) {
        message.line = lineAt(content, finding.range[0]);
      }
      messages.push(message);
    }
  }
  return messages
    .map((message, index) => ({ message, index }))
    .sort(
      (a, b) =>
        a.message.file.localeCompare(b.message.file) ||
        (a.message.line ?? 0) - (b.message.line ?? 0) ||
        a.index - b.index,
    )
    .map(({ message }) => message);
}

export async function lintFixture(
  name: string,
  ruleOptions?: Record<string, unknown>,
  targets: string[] = ["src"],
): Promise<{ file: string; messageId: string }[]> {
  const messages = await lintFixtureRule(
    name,
    "ownership",
    ruleOptions,
    targets,
  );
  return messages.map(({ file, messageId }) => ({ file, messageId }));
}

export async function lintEntryFixture(
  name: string,
  ruleOptions?: Record<string, unknown>,
  targets: string[] = ["src"],
): Promise<FixtureMessage[]> {
  return lintFixtureRule(name, "entry", ruleOptions, targets);
}

export function pick<K extends keyof FixtureMessage>(
  messages: FixtureMessage[],
  ...keys: K[]
): Pick<FixtureMessage, K>[] {
  return messages.map((message) => {
    const picked = {} as Pick<FixtureMessage, K>;
    for (const key of keys) {
      picked[key] = message[key];
    }
    return picked;
  });
}
