import assert from "node:assert/strict";
import test from "node:test";

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HachikaEngine } from "./engine.js";
import { createInitialSnapshot } from "./state.js";
import { buildUiState } from "./ui-state.js";

test("buildUiState exposes recent memories, traces, and diagnostics for the web ui", () => {
  const engine = new HachikaEngine(createInitialSnapshot());
  engine.respond("仕様を記録として残したい。");

  const artifactsDir = mkdtempSync(join(tmpdir(), "hachika-ui-"));
  const ui = buildUiState(engine, artifactsDir);

  assert.equal(ui.summary.conversationCount, 1);
  assert.ok(ui.summary.identity.summary.length > 0);
  assert.equal(ui.summary.residentLoop, null);
  assert.equal(ui.summary.world.currentPlace, "studio");
  assert.equal(ui.growth.autonomousActivityCount, 0);
  assert.equal(ui.growth.recentGeneratedCount, 1);
  assert.ok(ui.growth.generationConcreteDetail > 0);
  assert.ok(ui.memories.length >= 2);
  assert.equal(ui.memories.at(-1)?.role, "hachika");
  assert.ok(ui.traces.some((trace) => trace.topic === "仕様"));
  assert.equal(ui.traces.find((trace) => trace.topic === "仕様")?.place, "studio");
  assert.equal(ui.traces.find((trace) => trace.topic === "仕様")?.objectId, "desk");
  assert.ok(ui.diagnostics.lastResponse !== null);
});

test("buildUiState includes resident loop status when a status file exists", () => {
  const engine = new HachikaEngine(createInitialSnapshot());
  const rootDir = mkdtempSync(join(tmpdir(), "hachika-ui-loop-"));
  const artifactsDir = join(rootDir, "artifacts");
  const residentStatusPath = join(rootDir, "resident-status.json");

  writeFileSync(
    residentStatusPath,
    `${JSON.stringify(
      {
        active: true,
        pid: 4242,
        startedAt: "2026-03-22T00:00:00.000Z",
        heartbeatAt: "2026-03-22T00:05:00.000Z",
        lastTickAt: "2026-03-22T00:05:00.000Z",
        lastActivityAt: "2026-03-22T00:05:00.000Z",
        lastProactiveAt: null,
        lastTickAttempts: 2,
        lastError: null,
        lastActivities: ["idle_consolidation/continuity 仕様を温め直した"],
        reply: "openai",
        config: {
          intervalMs: 5000,
          idleHoursPerTick: 2,
        },
        stoppedAt: null,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const ui = buildUiState(
    engine,
    artifactsDir,
    residentStatusPath,
    new Date("2026-03-22T00:06:10.000Z"),
  );

  assert.equal(ui.summary.residentLoop?.active, true);
  assert.equal(ui.summary.residentLoop?.pid, 4242);
  assert.equal(ui.summary.residentLoop?.lastTickAttempts, 2);
  assert.equal(ui.summary.world.currentPlace, "threshold");
  assert.equal(ui.summary.residentLoopHealth?.state, "stale");
  assert.deepEqual(ui.summary.residentLoop?.lastActivities, [
    "idle_consolidation/continuity 仕様を温め直した",
  ]);
});
