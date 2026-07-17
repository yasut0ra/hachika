import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  createExperimentBirth,
  parseExperimentBirthCliArgs,
} from "./experiment-birth.js";
import type { ExperimentConfig } from "./experiment-freeze.js";

test("experiment birth creates a named revision-0 snapshot and hashed record", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "hachika-birth-"));
  const config = testConfig();
  try {
    const result = await createExperimentBirth({
      config,
      individualId: "A",
      implementationRevision: "a".repeat(40),
      cwd,
      now: new Date("2026-07-31T15:00:00.000Z"),
    });
    const snapshot = JSON.parse(await readFile(result.snapshotPath, "utf8")) as {
      revision: number;
      discourse: { hachikaName: { value: string } };
    };
    const record = await readFile(result.birthRecordPath, "utf8");

    assert.equal(snapshot.revision, 0);
    assert.equal(snapshot.discourse.hachikaName.value, "ミオ");
    assert.match(result.snapshotSha256, /^[0-9a-f]{64}$/u);
    assert.match(record, /# Birth record: A \/ ミオ/);
    assert.match(record, new RegExp(result.snapshotSha256, "u"));
    assert.match(record, /2026-08-01/);

    await assert.rejects(
      () =>
        createExperimentBirth({
          config,
          individualId: "A",
          implementationRevision: "a".repeat(40),
          cwd,
          now: new Date("2026-07-31T15:00:00.000Z"),
        }),
      /birth_snapshot_exists/,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("experiment birth refuses a date outside the configured local birth day", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "hachika-birth-date-"));
  try {
    await assert.rejects(
      () =>
        createExperimentBirth({
          config: testConfig(),
          individualId: "B",
          implementationRevision: "b".repeat(40),
          cwd,
          now: new Date("2026-07-30T15:00:00.000Z"),
        }),
      /birth_date_mismatch:2026-07-31:2026-08-01/,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("experiment birth CLI accepts multiple individuals in one invocation", () => {
  const cwd = resolve("/tmp", "hachika-birth-cli");
  assert.deepEqual(
    parseExperimentBirthCliArgs(
      ["--individual", "A", "--individual=B", "--config=config.json"],
      { cwd },
    ),
    {
      configPath: resolve(cwd, "config.json"),
      individualIds: ["A", "B"],
      help: false,
    },
  );
});

function testConfig(): ExperimentConfig {
  return {
    schemaVersion: 1,
    experimentId: "test-life",
    implementation: { tag: "v3-life-1" },
    schedule: {
      birthDate: "2026-08-01",
      endDate: "2026-10-30",
      timeZone: "Asia/Tokyo",
    },
    runtime: {
      host: "test-host",
      nodeVersion: process.version,
      loopIntervalMs: 15_000,
      fixedIdleHoursPerTick: null,
      keepAwake: "test harness",
    },
    llm: {
      provider: "rule",
      roleModels: {},
    },
    fork: { enabled: true, day: 45 },
    publication: "tests",
    individuals: [
      {
        id: "A",
        name: "ミオ",
        dataDir: "individuals/a",
        seed: "a",
        condition: "warm",
        protocol: "warm protocol",
      },
      {
        id: "B",
        name: "リツ",
        dataDir: "individuals/b",
        seed: "b",
        condition: "quiet",
        protocol: "quiet protocol",
      },
    ],
  };
}
