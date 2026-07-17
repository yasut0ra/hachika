import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { resolveHachikaDataPaths } from "./data-paths.js";

const CWD = resolve("/tmp", "hachika-workspace");

test("data paths default to cwd/data", () => {
  const paths = resolveHachikaDataPaths({ cwd: CWD, dataDir: null });

  assert.equal(paths.dataDir, resolve(CWD, "data"));
  assert.equal(paths.snapshotPath, resolve(CWD, "data/hachika-state.json"));
  assert.equal(paths.artifactsDir, resolve(CWD, "data/artifacts"));
  assert.equal(paths.residentLockPath, resolve(CWD, "data/resident-lock.json"));
  assert.equal(paths.residentStatusPath, resolve(CWD, "data/resident-status.json"));
  assert.equal(paths.metricsLogPath, resolve(CWD, "data/metrics-log.jsonl"));
  assert.equal(paths.archiveSnapshotsDir, resolve(CWD, "data/archive-snapshots"));
});

test("relative HACHIKA_DATA_DIR resolves from the process cwd", () => {
  const paths = resolveHachikaDataPaths({
    cwd: CWD,
    dataDir: "individuals/a",
  });

  assert.equal(paths.dataDir, resolve(CWD, "individuals/a"));
  assert.equal(
    paths.snapshotPath,
    resolve(CWD, "individuals/a/hachika-state.json"),
  );
});

test("data paths read HACHIKA_DATA_DIR from the environment", () => {
  const original = process.env.HACHIKA_DATA_DIR;
  process.env.HACHIKA_DATA_DIR = "individuals/from-env";

  try {
    const paths = resolveHachikaDataPaths({ cwd: CWD });
    assert.equal(paths.dataDir, resolve(CWD, "individuals/from-env"));
  } finally {
    if (original === undefined) {
      delete process.env.HACHIKA_DATA_DIR;
    } else {
      process.env.HACHIKA_DATA_DIR = original;
    }
  }
});

test("absolute HACHIKA_DATA_DIR remains outside the process cwd", () => {
  const absolute = resolve("/tmp", "hachika-individual-b");
  const paths = resolveHachikaDataPaths({
    cwd: CWD,
    dataDir: absolute,
  });

  assert.equal(paths.dataDir, absolute);
  assert.equal(paths.artifactsDir, resolve(absolute, "artifacts"));
});

test("two individual roots separate all persistent and operational paths", () => {
  const a = resolveHachikaDataPaths({ cwd: CWD, dataDir: "individuals/a" });
  const b = resolveHachikaDataPaths({ cwd: CWD, dataDir: "individuals/b" });

  for (const key of [
    "snapshotPath",
    "artifactsDir",
    "residentLockPath",
    "residentStatusPath",
    "metricsLogPath",
    "archiveSnapshotsDir",
  ] as const) {
    assert.notEqual(a[key], b[key]);
  }
});
