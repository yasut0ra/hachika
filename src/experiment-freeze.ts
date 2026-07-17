import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const EXPERIMENT_CONFIG_SCHEMA_VERSION = 1;
export const EXPERIMENT_IMPLEMENTATION_TAG = "v3-life-1";

export interface ExperimentConfig {
  schemaVersion: number;
  experimentId: string;
  implementation: { tag: string };
  schedule: {
    birthDate: string;
    endDate: string;
    timeZone: string;
  };
  runtime: {
    host: string;
    nodeVersion: string;
    loopIntervalMs: number;
    fixedIdleHoursPerTick: null;
    keepAwake: string;
  };
  llm: {
    provider: "openai" | "openai-compatible" | "rule";
    baseUrl?: string;
    defaultModel?: string;
    roleModels: Record<string, string>;
  };
  fork: { enabled: boolean; day: number };
  publication: string;
  individuals: Array<{
    id: string;
    name: string;
    dataDir: string;
    seed: string;
    condition: "warm" | "quiet";
    protocol: string;
  }>;
}

export interface ExperimentRepositoryState {
  dirty: boolean;
  headRevision: string;
  tagsAtHead: string[];
  nodeVersion: string;
}

export interface ExperimentFreezeValidation {
  errors: string[];
  fingerprint: string;
}

export interface ExperimentCheckCliOptions {
  configPath: string;
  help: boolean;
}

export async function loadExperimentConfig(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

export function parseExperimentConfig(raw: unknown): ExperimentConfig {
  const result = validateExperimentFreeze(raw);
  if (result.errors.length > 0) {
    throw new Error(`experiment_config_invalid:${result.errors.join("; ")}`);
  }
  return raw as ExperimentConfig;
}

export function validateExperimentFreeze(
  raw: unknown,
  repository?: ExperimentRepositoryState,
): ExperimentFreezeValidation {
  const errors: string[] = [];
  const root = asRecord(raw, "config", errors);

  if (!root) {
    return { errors, fingerprint: fingerprintExperimentConfig(raw) };
  }

  if (root.schemaVersion !== EXPERIMENT_CONFIG_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${EXPERIMENT_CONFIG_SCHEMA_VERSION}`);
  }
  requiredString(root.experimentId, "experimentId", errors);
  requiredString(root.publication, "publication", errors);

  const implementation = asRecord(root.implementation, "implementation", errors);
  const implementationTag = implementation
    ? requiredString(implementation.tag, "implementation.tag", errors)
    : null;
  if (
    implementationTag &&
    implementationTag !== EXPERIMENT_IMPLEMENTATION_TAG
  ) {
    errors.push(
      `implementation.tag must be ${EXPERIMENT_IMPLEMENTATION_TAG}`,
    );
  }

  const schedule = asRecord(root.schedule, "schedule", errors);
  const birthDate = schedule
    ? requiredCalendarDate(schedule.birthDate, "schedule.birthDate", errors)
    : null;
  const endDate = schedule
    ? requiredCalendarDate(schedule.endDate, "schedule.endDate", errors)
    : null;
  const timeZone = schedule
    ? requiredString(schedule.timeZone, "schedule.timeZone", errors)
    : null;
  if (birthDate && endDate && endDate <= birthDate) {
    errors.push("schedule.endDate must be after schedule.birthDate");
  }
  if (timeZone && !isValidTimeZone(timeZone)) {
    errors.push("schedule.timeZone must be a valid IANA time zone");
  }

  const runtime = asRecord(root.runtime, "runtime", errors);
  const runtimeNodeVersion = runtime
    ? requiredString(runtime.nodeVersion, "runtime.nodeVersion", errors)
    : null;
  if (runtime) {
    requiredString(runtime.host, "runtime.host", errors);
    requiredString(runtime.keepAwake, "runtime.keepAwake", errors);
    if (
      typeof runtime.loopIntervalMs !== "number" ||
      !Number.isFinite(runtime.loopIntervalMs) ||
      runtime.loopIntervalMs <= 0
    ) {
      errors.push("runtime.loopIntervalMs must be a positive number");
    }
    if (runtime.fixedIdleHoursPerTick !== null) {
      errors.push(
        "runtime.fixedIdleHoursPerTick must be null for a wall-clock life",
      );
    }
  }

  const llm = asRecord(root.llm, "llm", errors);
  if (llm) {
    const provider = requiredString(llm.provider, "llm.provider", errors);
    if (
      provider &&
      provider !== "openai" &&
      provider !== "openai-compatible" &&
      provider !== "rule"
    ) {
      errors.push("llm.provider must be openai, openai-compatible, or rule");
    }
    if (provider !== "rule") {
      requiredString(llm.baseUrl, "llm.baseUrl", errors);
      requiredString(llm.defaultModel, "llm.defaultModel", errors);
    }
    if (!isRecord(llm.roleModels)) {
      errors.push("llm.roleModels must be an object");
    }
    if ("apiKey" in llm && llm.apiKey !== undefined) {
      errors.push("llm.apiKey must not be recorded in the tracked manifest");
    }
  }

  const fork = asRecord(root.fork, "fork", errors);
  if (fork) {
    if (typeof fork.enabled !== "boolean") {
      errors.push("fork.enabled must be boolean");
    }
    if (
      fork.enabled === true &&
      (typeof fork.day !== "number" ||
        !Number.isInteger(fork.day) ||
        fork.day <= 0)
    ) {
      errors.push("fork.day must be a positive integer when enabled");
    }
  }

  validateIndividuals(root.individuals, errors);

  if (repository) {
    if (repository.dirty) {
      errors.push("git worktree must be clean");
    }
    if (
      implementationTag &&
      !repository.tagsAtHead.includes(implementationTag)
    ) {
      errors.push(`git HEAD must carry tag ${implementationTag}`);
    }
    if (runtimeNodeVersion && runtimeNodeVersion !== repository.nodeVersion) {
      errors.push("runtime.nodeVersion must equal the current Node.js version");
    }
  }

  return {
    errors: unique(errors),
    fingerprint: fingerprintExperimentConfig(raw),
  };
}

export function fingerprintExperimentConfig(raw: unknown): string {
  const canonical = JSON.stringify(canonicalize(raw));
  return createHash("sha256").update(canonical).digest("hex");
}

export function parseExperimentCheckCliArgs(
  args: string[],
  options: { cwd?: string } = {},
): ExperimentCheckCliOptions {
  const cwd = options.cwd ?? process.cwd();
  let configPath = resolve(cwd, "docs/lab-notes/experiment-config.json");
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--help" || argument === "-h") {
      help = true;
      continue;
    }
    if (argument === "--config") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("experiment_config_path_missing");
      }
      configPath = resolve(cwd, value);
      index += 1;
      continue;
    }
    if (argument.startsWith("--config=")) {
      configPath = resolve(cwd, argument.slice("--config=".length));
      continue;
    }
    throw new Error(`experiment_check_argument_unknown:${argument}`);
  }

  return { configPath, help };
}

export function experimentCheckUsage(): string {
  return [
    "Usage: npm run experiment:check -- [--config PATH]",
    "",
    "Validates the tracked, secret-free experiment manifest against git HEAD,",
    `tag ${EXPERIMENT_IMPLEMENTATION_TAG}, Node.js, and the birth protocol.`,
  ].join("\n");
}

function validateIndividuals(raw: unknown, errors: string[]): void {
  if (!Array.isArray(raw) || raw.length < 2) {
    errors.push("individuals must contain at least two entries");
    return;
  }

  const ids: string[] = [];
  const names: string[] = [];
  const dataDirs: string[] = [];
  const seeds: string[] = [];
  const conditions: string[] = [];

  raw.forEach((value, index) => {
    const path = `individuals[${index}]`;
    const individual = asRecord(value, path, errors);
    if (!individual) {
      return;
    }
    const id = requiredString(individual.id, `${path}.id`, errors);
    const name = requiredString(individual.name, `${path}.name`, errors);
    const dataDir = requiredString(
      individual.dataDir,
      `${path}.dataDir`,
      errors,
    );
    const seed = requiredString(individual.seed, `${path}.seed`, errors);
    const condition = requiredString(
      individual.condition,
      `${path}.condition`,
      errors,
    );
    requiredString(individual.protocol, `${path}.protocol`, errors);
    if (condition && condition !== "warm" && condition !== "quiet") {
      errors.push(`${path}.condition must be warm or quiet`);
    }
    if (id) ids.push(id);
    if (name) names.push(name);
    if (dataDir) dataDirs.push(dataDir);
    if (seed) seeds.push(seed);
    if (condition) conditions.push(condition);
  });

  requireUnique(ids, "individual id", errors);
  requireUnique(names, "individual name", errors);
  requireUnique(dataDirs, "individual dataDir", errors);
  requireUnique(seeds, "individual seed", errors);
  if (!conditions.includes("warm") || !conditions.includes("quiet")) {
    errors.push("individuals must include both warm and quiet conditions");
  }
}

function requiredString(
  raw: unknown,
  path: string,
  errors: string[],
): string | null {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    errors.push(`${path} is required`);
    return null;
  }
  const value = raw.trim();
  if (isPlaceholder(value)) {
    errors.push(`${path} still contains a placeholder`);
    return null;
  }
  return value;
}

function requiredCalendarDate(
  raw: unknown,
  path: string,
  errors: string[],
): string | null {
  const value = requiredString(raw, path, errors);
  if (!value) {
    return null;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) {
    errors.push(`${path} must be YYYY-MM-DD`);
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    errors.push(`${path} must be a real calendar date`);
    return null;
  }
  return value;
}

function asRecord(
  raw: unknown,
  path?: string,
  errors?: string[],
): Record<string, unknown> | null {
  if (!isRecord(raw)) {
    if (path && errors) {
      errors.push(`${path} must be an object`);
    }
    return null;
  }
  return raw;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlaceholder(value: string): boolean {
  return /<[^>]+>|\b(?:TODO|TBD)\b|未定/iu.test(value);
}

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

function requireUnique(values: string[], label: string, errors: string[]): void {
  if (new Set(values).size !== values.length) {
    errors.push(`${label}s must be unique`);
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function unique(values: string[]): string[] {
  return values.filter((value, index) => values.indexOf(value) === index);
}
