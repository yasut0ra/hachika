import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  archiveDailySnapshot,
  checkResidentHealth,
  createWebhookNotifier,
  runDailyMaintenance,
  type MaintenanceAlert,
} from "./daily-maintenance.js";
import {
  saveResidentLoopStatus,
  type ResidentLoopStatus,
} from "./resident-monitor.js";
import { createInitialSnapshot } from "./state.js";

test("daily snapshot archive is immutable within a calendar day", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "hachika-daily-archive-"));
  const snapshotPath = join(rootDir, "hachika-state.json");
  const archiveDir = join(rootDir, "archive-snapshots");
  const initial = createInitialSnapshot();
  const initialSource = `${JSON.stringify(initial, null, 2)}\n`;

  try {
    await writeFile(snapshotPath, initialSource, "utf8");
    const first = await archiveDailySnapshot(snapshotPath, archiveDir, {
      now: new Date("2026-07-17T12:00:00.000Z"),
      timeZone: "UTC",
    });

    initial.revision = 7;
    await writeFile(snapshotPath, `${JSON.stringify(initial, null, 2)}\n`, "utf8");
    const duplicate = await archiveDailySnapshot(snapshotPath, archiveDir, {
      now: new Date("2026-07-17T23:59:59.000Z"),
      timeZone: "UTC",
    });
    const nextDay = await archiveDailySnapshot(snapshotPath, archiveDir, {
      now: new Date("2026-07-18T00:00:00.000Z"),
      timeZone: "UTC",
    });

    assert.equal(first.created, true);
    assert.equal(first.date, "2026-07-17");
    assert.equal(first.snapshot.revision, 0);
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.snapshot.revision, 0);
    assert.equal(nextDay.created, true);
    assert.equal(nextDay.snapshot.revision, 7);
    assert.equal(await readFile(first.filePath, "utf8"), initialSource);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("daily snapshot archive shares the configured metrics time-zone boundary", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "hachika-daily-archive-zone-"));
  const snapshotPath = join(rootDir, "hachika-state.json");

  try {
    await writeFile(
      snapshotPath,
      `${JSON.stringify(createInitialSnapshot())}\n`,
      "utf8",
    );
    const result = await archiveDailySnapshot(
      snapshotPath,
      join(rootDir, "archive-snapshots"),
      {
        now: new Date("2026-07-17T15:30:00.000Z"),
        timeZone: "Asia/Tokyo",
      },
    );

    assert.equal(result.date, "2026-07-18");
    assert.equal(result.timeZone, "Asia/Tokyo");
    assert.equal(result.filePath, join(rootDir, "archive-snapshots/2026-07-18.json"));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("resident health distinguishes fresh, stale, inactive, and missing status", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "hachika-maintenance-health-"));
  const statusPath = join(rootDir, "resident-status.json");
  const now = new Date("2026-07-17T12:01:00.000Z");

  try {
    await saveResidentLoopStatus(
      statusPath,
      residentStatus({ heartbeatAt: "2026-07-17T12:00:30.000Z" }),
    );
    const fresh = await checkResidentHealth(statusPath, now);
    assert.equal(fresh.healthy, true);
    assert.equal(fresh.state, "active");
    assert.equal(fresh.heartbeatAgeMs, 30_000);

    await saveResidentLoopStatus(
      statusPath,
      residentStatus({ heartbeatAt: "2026-07-17T11:59:00.000Z" }),
    );
    const stale = await checkResidentHealth(statusPath, now);
    assert.equal(stale.healthy, false);
    assert.equal(stale.state, "stale");
    assert.equal(stale.staleAfterMs, 45_000);

    await saveResidentLoopStatus(
      statusPath,
      residentStatus({ active: false, stoppedAt: "2026-07-17T12:00:00.000Z" }),
    );
    const inactive = await checkResidentHealth(statusPath, now);
    assert.equal(inactive.healthy, false);
    assert.equal(inactive.state, "inactive");

    const missing = await checkResidentHealth(join(rootDir, "missing.json"), now);
    assert.equal(missing.healthy, false);
    assert.equal(missing.state, "missing");
    assert.equal(missing.lastError, "resident_status_unavailable");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("daily maintenance archives first and notifies once when heartbeat is stale", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "hachika-daily-maintenance-"));
  const snapshotPath = join(rootDir, "hachika-state.json");
  const statusPath = join(rootDir, "resident-status.json");
  const alerts: MaintenanceAlert[] = [];

  try {
    await writeFile(
      snapshotPath,
      `${JSON.stringify(createInitialSnapshot())}\n`,
      "utf8",
    );
    await saveResidentLoopStatus(
      statusPath,
      residentStatus({ heartbeatAt: "2026-07-17T11:00:00.000Z" }),
    );

    const result = await runDailyMaintenance({
      dataDir: rootDir,
      snapshotPath,
      archiveSnapshotsDir: join(rootDir, "archive-snapshots"),
      residentStatusPath: statusPath,
      now: new Date("2026-07-17T12:00:00.000Z"),
      timeZone: "UTC",
      notify: async (alert) => {
        alerts.push(alert);
      },
    });

    assert.equal(result.archive.created, true);
    assert.equal(result.health.state, "stale");
    assert.equal(result.alert?.event, "hachika_resident_unhealthy");
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0]?.dataDir, rootDir);
    assert.match(alerts[0]?.message ?? "", /resident loop is stale/);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("webhook notifier is optional and rejects non-http URLs", () => {
  assert.equal(createWebhookNotifier(""), null);
  assert.throws(
    () => createWebhookNotifier("file:///tmp/alert"),
    /monitor_webhook_url_invalid/,
  );
});

function residentStatus(
  overrides: Partial<ResidentLoopStatus> = {},
): ResidentLoopStatus {
  return {
    active: true,
    pid: 4321,
    startedAt: "2026-07-17T11:00:00.000Z",
    heartbeatAt: "2026-07-17T12:00:30.000Z",
    lastTickAt: "2026-07-17T12:00:30.000Z",
    lastActivityAt: null,
    lastInternalAt: null,
    lastProactiveAt: null,
    lastTickAttempts: 1,
    lastError: null,
    lastInternalActivities: [],
    lastActivities: [],
    reply: "local",
    config: {
      intervalMs: 15_000,
      idleHoursPerTick: null,
    },
    stoppedAt: null,
    ...overrides,
  };
}
