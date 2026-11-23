export type RuleName = "ownership" | "entry";

export interface Options {
  root: string;
  ignore: string[];
  layers: string[];
  rules: RuleName[];
}

const RULE_NAMES: readonly RuleName[] = ["ownership", "entry"];

interface OptionCheck {
  valid: (value: unknown) => boolean;
  expected: string;
}

const CHECKS: Record<keyof Options, OptionCheck> = {
  root: { valid: isString, expected: "a string" },
  ignore: { valid: isStringArray, expected: "an array of strings" },
  layers: { valid: isStringArray, expected: "an array of strings" },
  rules: {
    valid: isRuleArray,
    expected: 'an array containing only "ownership" or "entry"',
  },
};

function defaults(): Options {
  return { root: ".", ignore: [], layers: [], rules: [...RULE_NAMES] };
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

function isRuleName(value: unknown): value is RuleName {
  return RULE_NAMES.includes(value as RuleName);
}

function isRuleArray(value: unknown): value is RuleName[] {
  return Array.isArray(value) && value.every(isRuleName);
}

function isPlainObject(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}

function assertKnownKeys(raw: Record<string, unknown>): void {
  for (const key of Object.keys(raw)) {
    if (!Object.hasOwn(CHECKS, key)) {
      throw new Error(`Unknown option "${key}"`);
    }
  }
}

function assertOption(key: keyof Options, value: unknown): void {
  const check = CHECKS[key];
  if (!check.valid(value)) {
    throw new Error(`Option "${key}" must be ${check.expected}`);
  }
}

export function validateOptions(raw: unknown): Options {
  const options = defaults();
  if (raw === undefined) {
    return options;
  }
  if (!isPlainObject(raw)) {
    throw new Error("Options must be an object");
  }
  assertKnownKeys(raw);
  for (const key of Object.keys(CHECKS) as (keyof Options)[]) {
    if (Object.hasOwn(raw, key)) {
      assertOption(key, raw[key]);
      Object.assign(options, { [key]: raw[key] });
    }
  }
  return options;
}
