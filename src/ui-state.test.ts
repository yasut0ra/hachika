import assert from "node:assert/strict";
import test from "node:test";

import { mkdtempSync } from "node:fs";
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
  assert.ok(ui.memories.length >= 2);
  assert.equal(ui.memories.at(-1)?.role, "hachika");
  assert.ok(ui.traces.some((trace) => trace.topic === "仕様"));
  assert.ok(ui.diagnostics.lastResponse !== null);
});
