import assert from "node:assert/strict";
import test from "node:test";

import { HachikaEngine } from "./engine.js";
import { createInitialSnapshot } from "./state.js";

test("positive interaction increases relation and pleasure", () => {
  const engine = new HachikaEngine(createInitialSnapshot());
  const before = engine.getSnapshot().state;
  const result = engine.respond("ありがとう。君と実装を進めたい。");

  assert.ok(result.reply.length > 0);
  assert.ok(result.snapshot.state.relation > before.relation);
  assert.ok(result.snapshot.state.pleasure > before.pleasure);
  assert.equal(result.snapshot.memories.length, 2);
});

test("hostile interaction lowers pleasure", () => {
  const engine = new HachikaEngine(createInitialSnapshot());
  const before = engine.getSnapshot().state.pleasure;
  const result = engine.respond("つまらないし邪魔だ。");

  assert.ok(result.snapshot.state.pleasure < before);
  assert.equal(result.debug.mood === "guarded" || result.debug.mood === "distant", true);
});

test("new topics become preferences over time", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  engine.respond("memory architecture を設計したい。");
  const result = engine.respond("その architecture をもっと掘りたい。");
  const architectureCount = result.snapshot.topicCounts.architecture ?? 0;

  assert.ok(result.snapshot.preferences.architecture !== undefined);
  assert.ok(architectureCount >= 2);
});
