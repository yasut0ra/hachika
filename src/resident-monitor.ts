import { readFileSync, existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface ResidentLoopStatus {
  active: boolean;
  pid: number | null;
  startedAt: string | null;
  heartbeatAt: string | null;
  lastTickAt: string | null;
  lastActivityAt: string | null;
  lastProactiveAt: string | null;
  lastError: string | null;
  lastActivities: string[];
  reply: string | null;
  config: {
    intervalMs: number;
    idleHoursPerTick: number;
  } | null;
  stoppedAt: string | null;
}

export interface ResidentLoopHealth {
  state: "active" | "stale" | "inactive";
  stale: boolean;
  heartbeatAgeMs: number | null;
  staleAfterMs: number | null;
}

export interface ResidentLoopLock {
  path: string;
  pid: number;
  acquiredAt: string;
}

interface ResidentLockPayload {
  pid: number;
  acquiredAt: string;
}

export async function acquireResidentLoopLock(
  filePath: string,
  pid = process.pid,
): Promise<ResidentLoopLock> {
  const payload: ResidentLockPayload = {
    pid,
    acquiredAt: new Date().toISOString(),
  };

  await mkdir(dirname(filePath), { recursive: true });

  try {
    await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    return {
      path: filePath,
      pid: payload.pid,
      acquiredAt: payload.acquiredAt,
    };
  } catch (error) {
    if (!isAlreadyExistsError(error)) {
      throw error;
    }

    const existing = await readResidentLoopLock(filePath);

    if (existing && isProcessAlive(existing.pid)) {
      throw new Error(`resident_loop_already_running:${existing.pid}`);
    }

    await rm(filePath, { force: true });
    await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });

    return {
      path: filePath,
      pid: payload.pid,
      acquiredAt: payload.acquiredAt,
    };
  }
}

export async function releaseResidentLoopLock(lock: ResidentLoopLock): Promise<void> {
  const current = await readResidentLoopLock(lock.path);

  if (current && current.pid !== lock.pid) {
    return;
  }

  await rm(lock.path, { force: true });
}

export async function saveResidentLoopStatus(
  filePath: string,
  status: ResidentLoopStatus,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(status, null, 2)}\n`, "utf8");
}

export async function loadResidentLoopStatus(
  filePath: string,
): Promise<ResidentLoopStatus | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    return parseResidentLoopStatus(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function loadResidentLoopStatusSync(
  filePath: string,
): ResidentLoopStatus | null {
  try {
    if (!existsSync(filePath)) {
      return null;
    }

    const raw = readFileSync(filePath, "utf8");
    return parseResidentLoopStatus(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function formatResidentLoopStatus(
  status: ResidentLoopStatus | null,
): string {
  if (!status) {
    return "none";
  }

  const health = deriveResidentLoopHealth(status);
  const state = health?.state ?? (status.active ? "active" : "inactive");
  const pid = status.pid !== null ? ` pid:${status.pid}` : "";
  const heartbeat = status.heartbeatAt ? ` heartbeat:${status.heartbeatAt}` : "";
  const proactive = status.lastProactiveAt ? ` proactive:${status.lastProactiveAt}` : "";
  const error = status.lastError ? ` error:${status.lastError}` : "";
  return `${state}${pid}${heartbeat}${proactive}${error}`;
}

export function deriveResidentLoopHealth(
  status: ResidentLoopStatus | null,
  now: Date = new Date(),
): ResidentLoopHealth | null {
  if (!status) {
    return null;
  }

  if (!status.active) {
    return {
      state: "inactive",
      stale: false,
      heartbeatAgeMs: calculateHeartbeatAgeMs(status.heartbeatAt, now),
      staleAfterMs: deriveResidentLoopStaleAfterMs(status),
    };
  }

  const heartbeatAgeMs = calculateHeartbeatAgeMs(status.heartbeatAt, now);
  const staleAfterMs = deriveResidentLoopStaleAfterMs(status);
  const stale =
    heartbeatAgeMs === null || (staleAfterMs !== null && heartbeatAgeMs > staleAfterMs);

  return {
    state: stale ? "stale" : "active",
    stale,
    heartbeatAgeMs,
    staleAfterMs,
  };
}

export function deriveResidentLoopStaleAfterMs(
  status: ResidentLoopStatus | null,
): number | null {
  const intervalMs = status?.config?.intervalMs;
  if (typeof intervalMs !== "number" || !Number.isFinite(intervalMs) || intervalMs <= 0) {
    return 45_000;
  }

  return Math.max(Math.round(intervalMs * 3), 45_000);
}

async function readResidentLoopLock(
  filePath: string,
): Promise<ResidentLockPayload | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return parseResidentLoopLock(parsed);
  } catch {
    return null;
  }
}

function parseResidentLoopLock(raw: unknown): ResidentLockPayload | null {
  if (!isRecord(raw) || typeof raw.pid !== "number" || !Number.isFinite(raw.pid)) {
    return null;
  }

  return {
    pid: Math.max(1, Math.round(raw.pid)),
    acquiredAt:
      typeof raw.acquiredAt === "string" ? raw.acquiredAt : new Date().toISOString(),
  };
}

function parseResidentLoopStatus(raw: unknown): ResidentLoopStatus | null {
  if (!isRecord(raw)) {
    return null;
  }

  return {
    active: raw.active === true,
    pid:
      typeof raw.pid === "number" && Number.isFinite(raw.pid)
        ? Math.max(1, Math.round(raw.pid))
        : null,
    startedAt: typeof raw.startedAt === "string" ? raw.startedAt : null,
    heartbeatAt: typeof raw.heartbeatAt === "string" ? raw.heartbeatAt : null,
    lastTickAt: typeof raw.lastTickAt === "string" ? raw.lastTickAt : null,
    lastActivityAt: typeof raw.lastActivityAt === "string" ? raw.lastActivityAt : null,
    lastProactiveAt: typeof raw.lastProactiveAt === "string" ? raw.lastProactiveAt : null,
    lastError: typeof raw.lastError === "string" ? raw.lastError : null,
    lastActivities: Array.isArray(raw.lastActivities)
      ? raw.lastActivities
          .filter((value): value is string => typeof value === "string")
          .slice(0, 6)
      : [],
    reply: typeof raw.reply === "string" ? raw.reply : null,
    config:
      isRecord(raw.config) &&
      typeof raw.config.intervalMs === "number" &&
      Number.isFinite(raw.config.intervalMs) &&
      typeof raw.config.idleHoursPerTick === "number" &&
      Number.isFinite(raw.config.idleHoursPerTick)
        ? {
            intervalMs: Math.max(1, Math.round(raw.config.intervalMs)),
            idleHoursPerTick: Math.max(0, raw.config.idleHoursPerTick),
          }
        : null,
    stoppedAt: typeof raw.stoppedAt === "string" ? raw.stoppedAt : null,
  };
}

function calculateHeartbeatAgeMs(
  heartbeatAt: string | null,
  now: Date,
): number | null {
  if (!heartbeatAt) {
    return null;
  }

  const heartbeatMs = Date.parse(heartbeatAt);
  if (Number.isNaN(heartbeatMs)) {
    return null;
  }

  return Math.max(0, now.getTime() - heartbeatMs);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error.code === "ESRCH" || error.code === "ERR_INVALID_ARG_TYPE")
    );
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EEXIST"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
