import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  acquireResidentLoopLock,
  deriveResidentLoopHealth,
  formatResidentLoopStatus,
  loadResidentLoopStatusSync,
  releaseResidentLoopLock,
  saveResidentLoopStatus,
} from "./resident-monitor.js";

test("acquireResidentLoopLock can replace a stale lock from a dead pid", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hachika-lock-"));
  const path = join(dir, "resident-lock.json");

  await writeFile(
    path,
    `${JSON.stringify({ pid: 999999, acquiredAt: "2026-03-22T00:00:00.000Z" }, null, 2)}\n`,
    "utf8",
  );

  const lock = await acquireResidentLoopLock(path, 12345);

  assert.equal(lock.pid, 12345);
  await releaseResidentLoopLock(lock);
});

test("loadResidentLoopStatusSync reads a saved status and formats it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hachika-status-"));
  const path = join(dir, "resident-status.json");

  await saveResidentLoopStatus(path, {
    active: true,
    pid: 4321,
    startedAt: "2026-03-22T00:00:00.000Z",
    heartbeatAt: "2026-03-22T00:01:00.000Z",
    lastTickAt: "2026-03-22T00:01:00.000Z",
    lastActivityAt: "2026-03-22T00:01:00.000Z",
    lastInternalAt: "2026-03-22T00:01:00.000Z",
    lastProactiveAt: null,
    lastTickAttempts: 2,
    lastError: null,
    lastInternalActivities: ["recall idle_reactivation/設計 静かな時間で寄せ直した。"],
    lastActivities: ["hold idle_consolidation/設計 静かな時間で寄せ直した。"],
    reply: "openai",
    config: {
      intervalMs: 15000,
      idleHoursPerTick: 0.5,
    },
    stoppedAt: null,
  });

  const status = loadResidentLoopStatusSync(path);

  assert.equal(status?.active, true);
  assert.equal(status?.pid, 4321);
  assert.match(formatResidentLoopStatus(status), /(active|stale) pid:4321/);
});

test("deriveResidentLoopHealth marks an active loop stale after the heartbeat threshold", () => {
  const health = deriveResidentLoopHealth(
    {
      active: true,
      pid: 4321,
      startedAt: "2026-03-22T00:00:00.000Z",
      heartbeatAt: "2026-03-22T00:00:00.000Z",
      lastTickAt: "2026-03-22T00:00:00.000Z",
      lastActivityAt: null,
      lastInternalAt: null,
      lastProactiveAt: null,
      lastTickAttempts: 1,
      lastError: null,
      lastInternalActivities: [],
      lastActivities: [],
      reply: "openai",
      config: {
        intervalMs: 5_000,
        idleHoursPerTick: 0.5,
      },
      stoppedAt: null,
    },
    new Date("2026-03-22T00:01:10.000Z"),
  );

  assert.equal(health?.state, "stale");
  assert.equal(health?.stale, true);
  assert.equal(health?.staleAfterMs, 45_000);
  assert.equal(health?.heartbeatAgeMs, 70_000);
});

test("deriveResidentLoopHealth keeps an inactive loop non-stale", () => {
  const health = deriveResidentLoopHealth(
    {
      active: false,
      pid: 4321,
      startedAt: "2026-03-22T00:00:00.000Z",
      heartbeatAt: "2026-03-22T00:00:00.000Z",
      lastTickAt: "2026-03-22T00:00:00.000Z",
      lastActivityAt: null,
      lastInternalAt: null,
      lastProactiveAt: null,
      lastTickAttempts: 1,
      lastError: "stopped:SIGINT",
      lastInternalActivities: [],
      lastActivities: [],
      reply: "openai",
      config: {
        intervalMs: 5_000,
        idleHoursPerTick: 0.5,
      },
      stoppedAt: "2026-03-22T00:00:01.000Z",
    },
    new Date("2026-03-22T00:05:00.000Z"),
  );

  assert.equal(health?.state, "inactive");
  assert.equal(health?.stale, false);
  assert.equal(health?.heartbeatAgeMs, 300_000);
});
