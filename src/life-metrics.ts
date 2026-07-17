import { readFileSync, statSync } from "node:fs";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { HachikaSnapshot } from "./types.js";

export const LIFE_METRICS_SCHEMA_VERSION = 1;

export interface LifeMetricsRecord {
  schemaVersion: typeof LIFE_METRICS_SCHEMA_VERSION;
  date: string;
  recordedAt: string;
  timeZone: string;
  implementationRevision: string;
  snapshot: {
    version: number;
    revision: number;
  };
  constitution: {
    driveSetPoints: HachikaSnapshot["constitution"]["driveSetPoints"];
    bodySetPoints: HachikaSnapshot["constitution"]["bodySetPoints"];
    attachmentSetPoint: number;
    plasticity: number;
  };
  urgeBaselines: HachikaSnapshot["constitution"]["urgeSetPoints"];
  attachment: number;
  aspirations: {
    count: number;
    activeCount: number;
    totalStrength: number;
    entries: Array<{
      theme: string;
      strength: number;
      waning: boolean;
    }>;
  };
  voice: {
    preferredOpenings: string[];
    brevityBias: number;
    updatedAt: string | null;
  };
  journal: {
    count: number;
    latestWrittenAt: string | null;
  };
  turns: {
    last24Hours: number;
    total: number;
  };
}

export interface BuildLifeMetricsOptions {
  now?: Date;
  timeZone?: string;
  implementationRevision?: string;
}

export interface AppendLifeMetricsResult {
  appended: boolean;
  record: LifeMetricsRecord;
}

export function buildDailyLifeMetricsRecord(
  snapshot: HachikaSnapshot,
  options: BuildLifeMetricsOptions = {},
): LifeMetricsRecord {
  const now = options.now ?? new Date();
  const timeZone = resolveMetricsTimeZone(options.timeZone);
  const implementationRevision =
    options.implementationRevision?.trim() || "unknown";
  const cutoff = now.getTime() - 24 * 60 * 60 * 1000;
  const nowMs = now.getTime();
  const turnsLast24Hours = snapshot.memories.filter((memory) => {
    if (memory.role !== "user" || memory.kind === "consolidated") {
      return false;
    }
    const timestamp = Date.parse(memory.timestamp);
    return Number.isFinite(timestamp) && timestamp >= cutoff && timestamp <= nowMs;
  }).length;
  const aspirationEntries = snapshot.aspirations.map((aspiration) => ({
    theme: aspiration.theme,
    strength: aspiration.strength,
    waning: aspiration.waning,
  }));

  return {
    schemaVersion: LIFE_METRICS_SCHEMA_VERSION,
    date: formatCalendarDate(now, timeZone),
    recordedAt: now.toISOString(),
    timeZone,
    implementationRevision,
    snapshot: {
      version: snapshot.version,
      revision: snapshot.revision,
    },
    constitution: {
      driveSetPoints: { ...snapshot.constitution.driveSetPoints },
      bodySetPoints: { ...snapshot.constitution.bodySetPoints },
      attachmentSetPoint: snapshot.constitution.attachmentSetPoint,
      plasticity: snapshot.constitution.plasticity,
    },
    urgeBaselines: { ...snapshot.constitution.urgeSetPoints },
    attachment: snapshot.attachment,
    aspirations: {
      count: aspirationEntries.length,
      activeCount: aspirationEntries.filter((entry) => !entry.waning).length,
      totalStrength: roundMetric(
        aspirationEntries.reduce((sum, entry) => sum + entry.strength, 0),
      ),
      entries: aspirationEntries,
    },
    voice: {
      preferredOpenings: [...snapshot.voice.preferredOpenings],
      brevityBias: snapshot.voice.brevityBias,
      updatedAt: snapshot.voice.updatedAt,
    },
    journal: {
      count: snapshot.journal.length,
      latestWrittenAt: snapshot.journal.at(-1)?.writtenAt ?? null,
    },
    turns: {
      last24Hours: turnsLast24Hours,
      total: snapshot.conversationCount,
    },
  };
}

export async function appendDailyLifeMetrics(
  filePath: string,
  snapshot: HachikaSnapshot,
  options: BuildLifeMetricsOptions = {},
): Promise<AppendLifeMetricsResult> {
  const record = buildDailyLifeMetricsRecord(snapshot, options);
  const source = await readMetricsSource(filePath);
  const records = parseLifeMetricsSource(source);
  const existing = records.find((entry) => entry.date === record.date);

  if (existing) {
    return {
      appended: false,
      record: existing,
    };
  }

  await mkdir(dirname(filePath), { recursive: true });
  const separator = source.length > 0 && !source.endsWith("\n") ? "\n" : "";
  await appendFile(filePath, `${separator}${JSON.stringify(record)}\n`, "utf8");

  return {
    appended: true,
    record,
  };
}

export async function readLifeMetricsLog(
  filePath: string,
): Promise<LifeMetricsRecord[]> {
  return parseLifeMetricsSource(await readMetricsSource(filePath));
}

export function resolveMetricsTimeZone(
  configured = process.env.HACHIKA_METRICS_TIME_ZONE,
): string {
  const timeZone = configured?.trim() || "UTC";
  // Invalid IANA names fail at startup instead of silently moving a daily boundary.
  new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date(0));
  return timeZone;
}

export function formatCalendarDate(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = values.get("year");
  const month = values.get("month");
  const day = values.get("day");

  if (!year || !month || !day) {
    throw new Error("metrics_calendar_date_unavailable");
  }

  return `${year}-${month}-${day}`;
}

export function resolveImplementationRevision(
  options: {
    cwd?: string;
    configured?: string | null;
  } = {},
): string {
  const configured =
    options.configured === undefined
      ? process.env.HACHIKA_IMPLEMENTATION_REVISION
      : options.configured;
  const override = configured?.trim();
  if (override) {
    return override;
  }

  try {
    const cwd = options.cwd ?? process.cwd();
    const gitDir = resolveGitDir(cwd);
    const head = readFileSync(resolve(gitDir, "HEAD"), "utf8").trim();

    if (isGitRevision(head)) {
      return head;
    }

    const refMatch = head.match(/^ref:\s+(.+)$/);
    const ref = refMatch?.[1]?.trim();
    if (!ref) {
      return "unknown";
    }

    try {
      const revision = readFileSync(resolve(gitDir, ref), "utf8").trim();
      return isGitRevision(revision) ? revision : "unknown";
    } catch {
      const packed = readFileSync(resolve(gitDir, "packed-refs"), "utf8");
      const match = packed
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => !line.startsWith("#") && line.endsWith(` ${ref}`));
      const revision = match?.split(/\s+/)[0] ?? "";
      return isGitRevision(revision) ? revision : "unknown";
    }
  } catch {
    return "unknown";
  }
}

function resolveGitDir(cwd: string): string {
  const dotGit = resolve(cwd, ".git");
  if (statSync(dotGit).isDirectory()) {
    return dotGit;
  }

  const pointer = readFileSync(dotGit, "utf8").trim();
  const match = pointer.match(/^gitdir:\s+(.+)$/);
  if (!match?.[1]) {
    throw new Error("git_dir_unavailable");
  }
  return resolve(cwd, match[1]);
}

function isGitRevision(value: string): boolean {
  return /^[0-9a-f]{7,64}$/iu.test(value);
}

async function readMetricsSource(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

function parseLifeMetricsSource(source: string): LifeMetricsRecord[] {
  const records: LifeMetricsRecord[] = [];

  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (isLifeMetricsRecord(parsed)) {
        records.push(parsed);
      }
    } catch {
      // A partial final line can be followed by a valid recovery record.
    }
  }

  return records;
}

function isLifeMetricsRecord(value: unknown): value is LifeMetricsRecord {
  return (
    isRecord(value) &&
    value.schemaVersion === LIFE_METRICS_SCHEMA_VERSION &&
    typeof value.date === "string" &&
    typeof value.recordedAt === "string" &&
    typeof value.timeZone === "string" &&
    typeof value.implementationRevision === "string" &&
    isRecord(value.snapshot) &&
    isRecord(value.constitution) &&
    isRecord(value.urgeBaselines) &&
    typeof value.attachment === "number" &&
    isRecord(value.aspirations) &&
    isRecord(value.voice) &&
    isRecord(value.journal) &&
    isRecord(value.turns)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}

function roundMetric(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
