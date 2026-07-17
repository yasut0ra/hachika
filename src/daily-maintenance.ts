import { link, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { formatCalendarDate, resolveMetricsTimeZone } from "./life-metrics.js";
import {
  deriveResidentLoopHealth,
  loadResidentLoopStatus,
} from "./resident-monitor.js";

export interface SnapshotArchiveResult {
  created: boolean;
  date: string;
  filePath: string;
  timeZone: string;
  snapshot: {
    version: number;
    revision: number;
  };
}

export interface ResidentHealthCheck {
  healthy: boolean;
  state: "active" | "stale" | "inactive" | "missing";
  checkedAt: string;
  heartbeatAt: string | null;
  heartbeatAgeMs: number | null;
  staleAfterMs: number | null;
  pid: number | null;
  lastError: string | null;
}

export interface MaintenanceAlert extends ResidentHealthCheck {
  event: "hachika_resident_unhealthy";
  dataDir: string;
  message: string;
}

export type MaintenanceNotifier = (alert: MaintenanceAlert) => Promise<void>;

export interface RunDailyMaintenanceOptions {
  dataDir: string;
  snapshotPath: string;
  archiveSnapshotsDir: string;
  residentStatusPath: string;
  now?: Date;
  timeZone?: string;
  notify?: MaintenanceNotifier | null;
}

export interface DailyMaintenanceResult {
  archive: SnapshotArchiveResult;
  health: ResidentHealthCheck;
  alert: MaintenanceAlert | null;
}

export async function archiveDailySnapshot(
  snapshotPath: string,
  archiveSnapshotsDir: string,
  options: {
    now?: Date;
    timeZone?: string;
  } = {},
): Promise<SnapshotArchiveResult> {
  const now = options.now ?? new Date();
  const timeZone = resolveMetricsTimeZone(options.timeZone);
  const date = formatCalendarDate(now, timeZone);
  const filePath = join(archiveSnapshotsDir, `${date}.json`);
  const source = await readFile(snapshotPath, "utf8");
  const snapshot = parseSnapshotMetadata(source, snapshotPath);

  await mkdir(archiveSnapshotsDir, { recursive: true });
  const tempPath = join(
    archiveSnapshotsDir,
    `.${date}.${process.pid}.${Date.now().toString(36)}.${Math.random()
      .toString(36)
      .slice(2, 8)}.tmp`,
  );
  let created = false;

  try {
    await writeFile(tempPath, source, { encoding: "utf8", flag: "wx" });
    try {
      // A hard link publishes the fully written file atomically and never replaces
      // an archive another invocation already created for this calendar day.
      await link(tempPath, filePath);
      created = true;
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        throw error;
      }
    }
  } finally {
    await rm(tempPath, { force: true }).catch(() => undefined);
  }

  if (!created) {
    const archivedSource = await readFile(filePath, "utf8");
    return {
      created: false,
      date,
      filePath,
      timeZone,
      snapshot: parseSnapshotMetadata(archivedSource, filePath),
    };
  }

  return {
    created: true,
    date,
    filePath,
    timeZone,
    snapshot,
  };
}

export async function checkResidentHealth(
  residentStatusPath: string,
  now: Date = new Date(),
): Promise<ResidentHealthCheck> {
  const status = await loadResidentLoopStatus(residentStatusPath);

  if (!status) {
    return {
      healthy: false,
      state: "missing",
      checkedAt: now.toISOString(),
      heartbeatAt: null,
      heartbeatAgeMs: null,
      staleAfterMs: null,
      pid: null,
      lastError: "resident_status_unavailable",
    };
  }

  const health = deriveResidentLoopHealth(status, now);
  const state = health?.state ?? (status.active ? "stale" : "inactive");

  return {
    healthy: state === "active",
    state,
    checkedAt: now.toISOString(),
    heartbeatAt: status.heartbeatAt,
    heartbeatAgeMs: health?.heartbeatAgeMs ?? null,
    staleAfterMs: health?.staleAfterMs ?? null,
    pid: status.pid,
    lastError: status.lastError,
  };
}

export async function runDailyMaintenance(
  options: RunDailyMaintenanceOptions,
): Promise<DailyMaintenanceResult> {
  const now = options.now ?? new Date();
  const archive = await archiveDailySnapshot(
    options.snapshotPath,
    options.archiveSnapshotsDir,
    {
      now,
      ...(options.timeZone ? { timeZone: options.timeZone } : {}),
    },
  );
  const health = await checkResidentHealth(options.residentStatusPath, now);
  const alert = health.healthy
    ? null
    : buildMaintenanceAlert(options.dataDir, health);

  if (alert && options.notify) {
    await options.notify(alert);
  }

  return {
    archive,
    health,
    alert,
  };
}

export function createWebhookNotifier(
  configuredUrl = process.env.HACHIKA_MONITOR_WEBHOOK_URL,
): MaintenanceNotifier | null {
  const value = configuredUrl?.trim();
  if (!value) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("monitor_webhook_url_invalid");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("monitor_webhook_url_invalid");
  }

  return async (alert) => {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(alert),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error(`monitor_webhook_failed:${response.status}`);
    }
  };
}

export function formatMaintenanceHealth(check: ResidentHealthCheck): string {
  const age =
    check.heartbeatAgeMs === null ? "unknown" : `${check.heartbeatAgeMs}ms`;
  const threshold =
    check.staleAfterMs === null ? "unknown" : `${check.staleAfterMs}ms`;
  const pid = check.pid === null ? "unknown" : String(check.pid);
  return `${check.state} pid:${pid} heartbeatAge:${age} staleAfter:${threshold}`;
}

function buildMaintenanceAlert(
  dataDir: string,
  health: ResidentHealthCheck,
): MaintenanceAlert {
  return {
    event: "hachika_resident_unhealthy",
    dataDir,
    ...health,
    message: `resident loop is ${health.state}: ${formatMaintenanceHealth(health)}`,
  };
}

function parseSnapshotMetadata(
  source: string,
  sourcePath: string,
): SnapshotArchiveResult["snapshot"] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch {
    throw new Error(`archive_snapshot_invalid_json:${sourcePath}`);
  }

  if (
    !isRecord(parsed) ||
    typeof parsed.version !== "number" ||
    !Number.isFinite(parsed.version) ||
    typeof parsed.revision !== "number" ||
    !Number.isFinite(parsed.revision)
  ) {
    throw new Error(`archive_snapshot_metadata_invalid:${sourcePath}`);
  }

  return {
    version: Math.max(0, Math.round(parsed.version)),
    revision: Math.max(0, Math.round(parsed.revision)),
  };
}

function isAlreadyExistsError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "EEXIST"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
