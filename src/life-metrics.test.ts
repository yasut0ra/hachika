import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  appendDailyLifeMetrics,
  buildDailyLifeMetricsRecord,
  formatCalendarDate,
  readLifeMetricsLog,
  resolveImplementationRevision,
} from "./life-metrics.js";
import { createInitialSnapshot } from "./state.js";

test("daily life metrics capture longitudinal state and recent user turns", () => {
  const now = new Date("2026-07-17T12:00:00.000Z");
  const snapshot = createInitialSnapshot();
  snapshot.revision = 42;
  snapshot.constitution.driveSetPoints.curiosity = 0.73;
  snapshot.constitution.bodySetPoints.energy = 0.61;
  snapshot.constitution.urgeSetPoints.recallUrge = 0.31;
  snapshot.constitution.attachmentSetPoint = 0.47;
  snapshot.constitution.plasticity = 0.44;
  snapshot.attachment = 0.52;
  snapshot.aspirations = [
    {
      theme: "long experiment",
      origin: "resolutions",
      strength: 0.7,
      formedAt: "2026-07-01T00:00:00.000Z",
      lastFedAt: "2026-07-16T00:00:00.000Z",
      waning: false,
    },
    {
      theme: "old thread",
      origin: "resolutions",
      strength: 0.2,
      formedAt: "2026-06-01T00:00:00.000Z",
      lastFedAt: "2026-06-20T00:00:00.000Z",
      waning: true,
    },
  ];
  snapshot.voice = {
    preferredOpenings: ["たしかに"],
    brevityBias: 0.25,
    updatedAt: "2026-07-16T09:00:00.000Z",
  };
  snapshot.journal = [
    {
      writtenAt: "2026-07-17T08:00:00.000Z",
      source: "idle",
      mood: "curious",
      focus: "experiment",
      text: "観測を続ける。",
    },
  ];
  snapshot.conversationCount = 9;
  snapshot.memories = [
    memory("user", "2026-07-16T12:00:00.000Z"),
    memory("user", "2026-07-17T11:00:00.000Z"),
    memory("hachika", "2026-07-17T11:01:00.000Z"),
    memory("user", "2026-07-17T10:00:00.000Z", "consolidated"),
    memory("user", "2026-07-16T11:59:59.000Z"),
    memory("user", "2026-07-17T12:00:01.000Z"),
  ];

  const record = buildDailyLifeMetricsRecord(snapshot, {
    now,
    timeZone: "Asia/Tokyo",
    implementationRevision: "test-revision",
  });

  assert.equal(record.date, "2026-07-17");
  assert.equal(record.recordedAt, now.toISOString());
  assert.equal(record.implementationRevision, "test-revision");
  assert.deepEqual(record.snapshot, { version: snapshot.version, revision: 42 });
  assert.equal(record.constitution.driveSetPoints.curiosity, 0.73);
  assert.equal(record.constitution.bodySetPoints.energy, 0.61);
  assert.equal(record.constitution.attachmentSetPoint, 0.47);
  assert.equal(record.constitution.plasticity, 0.44);
  assert.equal(record.urgeBaselines.recallUrge, 0.31);
  assert.equal(record.attachment, 0.52);
  assert.deepEqual(record.aspirations, {
    count: 2,
    activeCount: 1,
    totalStrength: 0.9,
    entries: [
      { theme: "long experiment", strength: 0.7, waning: false },
      { theme: "old thread", strength: 0.2, waning: true },
    ],
  });
  assert.deepEqual(record.voice, snapshot.voice);
  assert.deepEqual(record.journal, {
    count: 1,
    latestWrittenAt: "2026-07-17T08:00:00.000Z",
  });
  assert.deepEqual(record.turns, { last24Hours: 2, total: 9 });
});

test("calendar date follows the configured metrics time zone", () => {
  const now = new Date("2026-07-17T15:30:00.000Z");

  assert.equal(formatCalendarDate(now, "UTC"), "2026-07-17");
  assert.equal(formatCalendarDate(now, "Asia/Tokyo"), "2026-07-18");
});

test("metrics log appends once per local day and recovers after a partial line", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "hachika-life-metrics-"));
  const filePath = join(rootDir, "metrics-log.jsonl");
  const snapshot = createInitialSnapshot();

  try {
    await writeFile(filePath, '{"partial":', "utf8");

    const first = await appendDailyLifeMetrics(filePath, snapshot, {
      now: new Date("2026-07-17T12:00:00.000Z"),
      timeZone: "UTC",
      implementationRevision: "a",
    });
    const duplicate = await appendDailyLifeMetrics(filePath, snapshot, {
      now: new Date("2026-07-17T23:00:00.000Z"),
      timeZone: "UTC",
      implementationRevision: "b",
    });
    const nextDay = await appendDailyLifeMetrics(filePath, snapshot, {
      now: new Date("2026-07-18T00:00:00.000Z"),
      timeZone: "UTC",
      implementationRevision: "c",
    });

    assert.equal(first.appended, true);
    assert.equal(duplicate.appended, false);
    assert.equal(duplicate.record.implementationRevision, "a");
    assert.equal(nextDay.appended, true);
    const records = await readLifeMetricsLog(filePath);
    assert.deepEqual(
      records.map((record) => [record.date, record.implementationRevision]),
      [
        ["2026-07-17", "a"],
        ["2026-07-18", "c"],
      ],
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("implementation revision uses an override or resolves a loose git ref", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "hachika-life-metrics-git-"));
  const revision = "0123456789abcdef0123456789abcdef01234567";

  try {
    await mkdir(join(rootDir, ".git", "refs", "heads"), { recursive: true });
    await writeFile(join(rootDir, ".git", "HEAD"), "ref: refs/heads/main\n", "utf8");
    await writeFile(join(rootDir, ".git", "refs", "heads", "main"), `${revision}\n`, "utf8");

    assert.equal(
      resolveImplementationRevision({ cwd: rootDir, configured: " release-7 " }),
      "release-7",
    );
    assert.equal(
      resolveImplementationRevision({ cwd: rootDir, configured: null }),
      revision,
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

function memory(
  role: "user" | "hachika",
  timestamp: string,
  kind: "turn" | "consolidated" = "turn",
) {
  return {
    role,
    text: "memory",
    timestamp,
    topics: [],
    sentiment: "neutral" as const,
    kind,
  };
}
