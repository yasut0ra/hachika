import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readLifeMetricsLog } from "./life-metrics.js";
import { commitSnapshot, loadSnapshot } from "./persistence.js";
import { loadResidentLoopStatus } from "./resident-monitor.js";
import {
  isResidentLoopAlreadyRunningError,
  ResidentLoopRuntime,
} from "./resident-runtime.js";
import { createInitialSnapshot } from "./state.js";

test("resident runtime owns the loop lifecycle and writes a live heartbeat", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "hachika-resident-runtime-"));
  const snapshotPath = join(rootDir, "hachika-state.json");
  const artifactsDir = join(rootDir, "artifacts");
  const lockPath = join(rootDir, "resident-lock.json");
  const statusPath = join(rootDir, "resident-status.json");
  const metricsLogPath = join(rootDir, "metrics-log.jsonl");
  const runtime = createRuntime({
    snapshotPath,
    artifactsDir,
    lockPath,
    statusPath,
    metricsLogPath,
  });

  try {
    await commitSnapshot(snapshotPath, createInitialSnapshot());
    await runtime.start();
    await runtime.tick();

    const activeStatus = await loadResidentLoopStatus(statusPath);
    assert.equal(activeStatus?.active, true);
    assert.equal(activeStatus?.pid, process.pid);
    assert.ok(activeStatus?.lastTickAt);
    assert.equal(existsSync(lockPath), true);
    const metrics = await readLifeMetricsLog(metricsLogPath);
    assert.equal(metrics.length, 1);
    assert.equal(metrics[0]?.implementationRevision, "test-revision");
    assert.equal(metrics[0]?.snapshot.revision, 2);

    await runtime.stop("test");

    const stoppedStatus = await loadResidentLoopStatus(statusPath);
    assert.equal(stoppedStatus?.active, false);
    assert.ok(stoppedStatus?.stoppedAt);
    assert.equal(existsSync(lockPath), false);
  } finally {
    await runtime.stop("cleanup");
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("resident runtime refuses to replace a live loop owned by another runtime", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "hachika-resident-runtime-lock-"));
  const paths = {
    snapshotPath: join(rootDir, "hachika-state.json"),
    artifactsDir: join(rootDir, "artifacts"),
    lockPath: join(rootDir, "resident-lock.json"),
    statusPath: join(rootDir, "resident-status.json"),
    metricsLogPath: join(rootDir, "metrics-log.jsonl"),
  };
  const first = createRuntime(paths);
  const second = createRuntime(paths);

  try {
    await commitSnapshot(paths.snapshotPath, createInitialSnapshot());
    await first.start();

    await assert.rejects(
      () => second.start(),
      (error: unknown) => isResidentLoopAlreadyRunningError(error),
    );
  } finally {
    await first.stop("test");
    await second.stop("cleanup");
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("resident runtime advances the substrate by actual wall-clock elapsed time", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "hachika-resident-runtime-wall-"));
  const paths = {
    snapshotPath: join(rootDir, "hachika-state.json"),
    artifactsDir: join(rootDir, "artifacts"),
    lockPath: join(rootDir, "resident-lock.json"),
    statusPath: join(rootDir, "resident-status.json"),
    metricsLogPath: join(rootDir, "metrics-log.jsonl"),
  };
  let now = new Date("2026-04-01T00:00:00.000Z");
  const initial = createInitialSnapshot();
  initial.lastInteractionAt = now.toISOString();
  const runtime = new ResidentLoopRuntime({
    ...paths,
    config: {
      intervalMs: 3_600_000,
      idleHoursPerTick: null,
    },
    replyDescription: "local",
    now: () => now,
    implementationRevision: "test-revision",
    metricsTimeZone: "UTC",
    individualId: "test-individual",
  });

  try {
    await commitSnapshot(paths.snapshotPath, initial);
    await runtime.start();
    await runtime.tick();

    now = new Date("2026-04-01T01:00:00.000Z");
    await runtime.tick();

    const snapshot = await loadSnapshot(paths.snapshotPath);
    assert.equal(snapshot.idleClock.absenceHours, 1);
    assert.equal(snapshot.lastInteractionAt, "2026-04-01T00:00:00.000Z");
  } finally {
    await runtime.stop("test");
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("resident runtime lives through the time the host was stopped", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "hachika-resident-runtime-downtime-"));
  const paths = {
    snapshotPath: join(rootDir, "hachika-state.json"),
    artifactsDir: join(rootDir, "artifacts"),
    lockPath: join(rootDir, "resident-lock.json"),
    statusPath: join(rootDir, "resident-status.json"),
    metricsLogPath: join(rootDir, "metrics-log.jsonl"),
  };
  let now = new Date("2026-08-10T00:00:00.000Z");
  const initial = createInitialSnapshot();
  initial.lastInteractionAt = now.toISOString();
  const createWallRuntime = () =>
    new ResidentLoopRuntime({
      ...paths,
      config: {
        intervalMs: 3_600_000,
        idleHoursPerTick: null,
      },
      replyDescription: "local",
      now: () => now,
      implementationRevision: "test-revision",
      metricsTimeZone: "UTC",
      individualId: "test-individual",
    });
  const before = createWallRuntime();
  const after = createWallRuntime();

  try {
    await commitSnapshot(paths.snapshotPath, initial);
    await before.start();
    await before.tick();
    now = new Date("2026-08-10T02:00:00.000Z");
    await before.tick();
    await before.stop("test");
    assert.equal((await loadSnapshot(paths.snapshotPath)).idleClock.absenceHours, 2);

    // host が48時間止まっていた
    now = new Date("2026-08-12T02:00:00.000Z");
    await after.start();
    await after.tick();

    const snapshot = await loadSnapshot(paths.snapshotPath);
    assert.equal(snapshot.idleClock.absenceHours, 50);
    assert.equal(snapshot.residentClockAt, "2026-08-12T02:00:00.000Z");
  } finally {
    await before.stop("cleanup");
    await after.stop("cleanup");
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("resident runtime leaves a corrupt snapshot untouched and reports the error", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "hachika-resident-runtime-corrupt-"));
  const paths = {
    snapshotPath: join(rootDir, "hachika-state.json"),
    artifactsDir: join(rootDir, "artifacts"),
    lockPath: join(rootDir, "resident-lock.json"),
    statusPath: join(rootDir, "resident-status.json"),
    metricsLogPath: join(rootDir, "metrics-log.jsonl"),
  };
  const corrupt = '{"version":34,"revision":5000,"conversationCount":3';
  const runtime = createRuntime(paths);

  try {
    await writeFile(paths.snapshotPath, corrupt, "utf8");
    await runtime.start();
    await runtime.tick();

    const status = await loadResidentLoopStatus(paths.statusPath);
    assert.match(status?.lastError ?? "", /^snapshot_invalid_json:/u);
    assert.equal(await readFile(paths.snapshotPath, "utf8"), corrupt);
    assert.equal(existsSync(paths.metricsLogPath), false);
  } finally {
    await runtime.stop("test");
    await rm(rootDir, { recursive: true, force: true });
  }
});

function createRuntime(paths: {
  snapshotPath: string;
  artifactsDir: string;
  lockPath: string;
  statusPath: string;
  metricsLogPath: string;
}): ResidentLoopRuntime {
  return new ResidentLoopRuntime({
    ...paths,
    config: {
      intervalMs: 60_000,
      idleHoursPerTick: 0.5,
    },
    replyDescription: "local",
    implementationRevision: "test-revision",
    metricsTimeZone: "UTC",
    individualId: "test-individual",
  });
}
