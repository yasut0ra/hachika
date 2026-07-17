import { createHash } from "node:crypto";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  fingerprintExperimentConfig,
  type ExperimentConfig,
} from "./experiment-freeze.js";
import { formatCalendarDate } from "./life-metrics.js";
import { createInitialSnapshot } from "./state.js";

export interface ExperimentBirthOptions {
  config: ExperimentConfig;
  individualId: string;
  implementationRevision: string;
  configPath?: string;
  cwd?: string;
  now?: Date;
}

export interface ExperimentBirthResult {
  individualId: string;
  name: string;
  bornAt: string;
  dataDir: string;
  snapshotPath: string;
  snapshotSha256: string;
  birthRecordPath: string;
}

export interface ExperimentBirthCliOptions {
  configPath: string;
  individualIds: string[];
  help: boolean;
}

export async function assertExperimentBirthAvailable(
  options: ExperimentBirthOptions,
): Promise<void> {
  const prepared = prepareBirth(options);
  if (await pathExists(prepared.snapshotPath)) {
    throw new Error(`birth_snapshot_exists:${prepared.snapshotPath}`);
  }
  if (await pathExists(prepared.birthRecordPath)) {
    throw new Error(`birth_record_exists:${prepared.birthRecordPath}`);
  }
}

export async function createExperimentBirth(
  options: ExperimentBirthOptions,
): Promise<ExperimentBirthResult> {
  const prepared = prepareBirth(options);
  await assertExperimentBirthAvailable(options);
  await mkdir(prepared.dataDir, { recursive: true });
  await mkdir(dirname(prepared.birthRecordPath), { recursive: true });

  const snapshot = createInitialSnapshot();
  snapshot.discourse.hachikaName = {
    kind: "hachika_name",
    value: prepared.individual.name,
    confidence: 1,
    source: "seed",
    updatedAt: prepared.bornAt,
  };
  const snapshotSource = `${JSON.stringify(snapshot, null, 2)}\n`;
  const snapshotSha256 = createHash("sha256")
    .update(snapshotSource)
    .digest("hex");
  const record = renderBirthRecord({
    ...prepared,
    implementationRevision: options.implementationRevision,
    configPath:
      options.configPath ?? "docs/lab-notes/experiment-config.json",
    configFingerprint: fingerprintExperimentConfig(options.config),
    snapshotVersion: snapshot.version,
    snapshotRevision: snapshot.revision,
    snapshotSha256,
  });

  await writeFile(prepared.snapshotPath, snapshotSource, {
    encoding: "utf8",
    flag: "wx",
  });
  try {
    await writeFile(prepared.birthRecordPath, record, {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (error) {
    await rm(prepared.snapshotPath, { force: true });
    throw error;
  }

  return {
    individualId: prepared.individual.id,
    name: prepared.individual.name,
    bornAt: prepared.bornAt,
    dataDir: prepared.dataDir,
    snapshotPath: prepared.snapshotPath,
    snapshotSha256,
    birthRecordPath: prepared.birthRecordPath,
  };
}

export function parseExperimentBirthCliArgs(
  args: string[],
  options: { cwd?: string } = {},
): ExperimentBirthCliOptions {
  const cwd = options.cwd ?? process.cwd();
  let configPath = resolve(cwd, "docs/lab-notes/experiment-config.json");
  const individualIds: string[] = [];
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--help" || argument === "-h") {
      help = true;
      continue;
    }
    const [key, inlineValue] = argument.split("=", 2);
    if (key === "--config" || key === "--individual") {
      const value = inlineValue ?? args[index + 1];
      if (!value) {
        throw new Error(`experiment_birth_value_missing:${key}`);
      }
      if (inlineValue === undefined) {
        index += 1;
      }
      if (key === "--config") {
        configPath = resolve(cwd, value);
      } else if (!individualIds.includes(value)) {
        individualIds.push(value);
      }
      continue;
    }
    throw new Error(`experiment_birth_argument_unknown:${argument}`);
  }

  if (!help && individualIds.length === 0) {
    throw new Error("experiment_birth_individual_missing");
  }
  return { configPath, individualIds, help };
}

export function experimentBirthUsage(): string {
  return [
    "Usage: npm run experiment:birth -- --individual A --individual B [--config PATH]",
    "",
    "Creates revision-0 snapshots and immutable birth records on the configured birth date.",
    "Refuses existing snapshots and must be run from a clean, tagged freeze commit.",
  ].join("\n");
}

function prepareBirth(options: ExperimentBirthOptions) {
  const cwd = options.cwd ?? process.cwd();
  const now = options.now ?? new Date();
  const individual = options.config.individuals.find(
    (candidate) => candidate.id === options.individualId,
  );
  if (!individual) {
    throw new Error(`birth_individual_unknown:${options.individualId}`);
  }
  const localDate = formatCalendarDate(now, options.config.schedule.timeZone);
  if (localDate !== options.config.schedule.birthDate) {
    throw new Error(
      `birth_date_mismatch:${localDate}:${options.config.schedule.birthDate}`,
    );
  }
  const dataDir = resolve(cwd, individual.dataDir);
  return {
    config: options.config,
    individual,
    bornAt: now.toISOString(),
    localDate,
    dataDir,
    snapshotPath: join(dataDir, "hachika-state.json"),
    birthRecordPath: resolve(
      cwd,
      `docs/lab-notes/birth-${localDate}-${individual.id.toLowerCase()}.md`,
    ),
  };
}

function renderBirthRecord(
  input: ReturnType<typeof prepareBirth> & {
    implementationRevision: string;
    configPath: string;
    configFingerprint: string;
    snapshotVersion: number;
    snapshotRevision: number;
    snapshotSha256: string;
  },
): string {
  const { config, individual } = input;
  const roleModels = Object.keys(config.llm.roleModels).length > 0
    ? JSON.stringify(config.llm.roleModels)
    : "none";
  return `# Birth record: ${individual.id} / ${individual.name}

## Identity

- Analysis ID: \`${individual.id}\`
- Name: ${individual.name}
- Condition: \`${individual.condition}\`
- Born at: \`${input.bornAt}\` (${config.schedule.timeZone}: ${input.localDate})
- Data root: \`${individual.dataDir}\`
- Daily event seed: \`${individual.seed}\`

## Frozen implementation

- Git tag: \`${config.implementation.tag}\`
- Git revision: \`${input.implementationRevision}\`
- Snapshot schema: \`${input.snapshotVersion}\`
- Experiment config: \`${input.configPath}\`
- Config fingerprint: \`sha256:${input.configFingerprint}\`
- Node.js: \`${config.runtime.nodeVersion}\`
- Host: ${config.runtime.host}

## Birth snapshot

- Snapshot path: \`${individual.dataDir}/hachika-state.json\`
- Snapshot revision: \`${input.snapshotRevision}\`
- Snapshot SHA-256: \`${input.snapshotSha256}\`
- Initial archive: pending \`${individual.dataDir}/archive-snapshots/${input.localDate}.json\`
- Initial metrics date: pending \`${input.localDate}\`

## Runtime configuration

- Time zone: \`${config.schedule.timeZone}\`
- Loop interval: \`${config.runtime.loopIntervalMs}ms\`
- Clock mode: \`wall-clock\`
- Keep awake: ${config.runtime.keepAwake}
- LLM provider/base URL: \`${config.llm.provider}\` / \`${config.llm.baseUrl ?? "none"}\`
- Default model: \`${config.llm.defaultModel ?? "rule"}\`
- Role overrides: \`${roleModels}\`

## Life protocol

${individual.protocol}

## Day 0 verification

- [x] freeze manifest, tag, revision, and Node.js validated before birth
- [x] revision-0 snapshot created with the configured internal name
- [ ] resident lock is owned by exactly one process
- [ ] heartbeat is fresh
- [ ] first metrics row uses the frozen revision and time zone
- [ ] initial daily archive exists
- [x] no reset or pre-birth interaction occurred

## Notes and deviations

None.
`;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
