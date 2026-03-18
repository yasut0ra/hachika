import assert from "node:assert/strict";
import test from "node:test";

import { HachikaEngine } from "./engine.js";
import { createInitialSnapshot } from "./state.js";

test("positive interaction increases relation and pleasure", () => {
  const engine = new HachikaEngine(createInitialSnapshot());
  const before = engine.getSnapshot();
  const result = engine.respond("ありがとう。君と実装を進めたい。");

  assert.ok(result.reply.length > 0);
  assert.ok(result.snapshot.state.relation > before.state.relation);
  assert.ok(result.snapshot.state.pleasure > before.state.pleasure);
  assert.ok(result.snapshot.attachment > before.attachment);
  assert.equal(result.snapshot.memories.length, 2);
  assert.ok(result.snapshot.relationImprints.attention !== undefined);
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
  const architectureImprint = result.snapshot.preferenceImprints.architecture;

  assert.ok(result.snapshot.preferences.architecture !== undefined);
  assert.ok(architectureCount >= 2);
  assert.ok(architectureImprint !== undefined);
  assert.ok((architectureImprint?.salience ?? 0) > 0);
});

test("negative repeated topic creates adverse imprint", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  engine.respond("この仕様は最悪だ。");
  const result = engine.respond("仕様の話はまだ嫌いだ。");
  const imprint = result.snapshot.preferenceImprints.仕様;
  const boundary = result.snapshot.boundaryImprints["hostility:仕様"];

  assert.ok(imprint !== undefined);
  assert.ok((imprint?.affinity ?? 0) < 0);
  assert.ok(boundary !== undefined);
  assert.ok((boundary?.intensity ?? 0) > 0);
  assert.ok(result.snapshot.attachment < createInitialSnapshot().attachment);
  assert.equal(result.debug.selfModel.topMotives[0]?.kind, "protect_boundary");
});

test("memory cue builds continuity relation imprint", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  engine.respond("前回の設計の続きに戻りたい。覚えてる？");
  const result = engine.respond("この続きは残しておきたい。");
  const continuity = result.snapshot.relationImprints.continuity;

  assert.ok(continuity !== undefined);
  assert.ok((continuity?.closeness ?? 0) > 0);
});

test("responsive turn schedules a pending initiative", () => {
  const engine = new HachikaEngine(createInitialSnapshot());
  const result = engine.respond("君と設計の続きを進めたい。");

  assert.ok(result.snapshot.initiative.pending !== null);
  assert.equal(result.snapshot.initiative.pending?.kind, "resume_topic");
  assert.ok(result.snapshot.initiative.pending?.motive !== undefined);
});

test("pending initiative emits a proactive resume after idle", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  engine.respond("実装を記録して、仕様として残したい。");
  assert.equal(
    engine.getSnapshot().initiative.pending?.motive === "continue_shared_work" ||
      engine.getSnapshot().initiative.pending?.motive === "leave_trace",
    true,
  );
  engine.rewindIdleHours(8);
  const message = engine.emitInitiative();
  const snapshot = engine.getSnapshot();

  assert.ok(message !== null);
  assert.match(message ?? "", /実装|設計/);
  assert.equal(snapshot.initiative.pending, null);
  assert.ok(snapshot.initiative.lastProactiveAt !== null);
});

test("force proactive emits even without waiting", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  engine.respond("仕様の流れを残したい。");
  const message = engine.emitInitiative({ force: true });

  assert.ok(message !== null);
  assert.match(message ?? "", /仕様|流れ/);
});

test("shared work interaction surfaces a high-level motive", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  const result = engine.respond("設計を一緒に進めて、記録として残したい。");
  const selfModel = engine.getSelfModel();
  const motiveKinds = selfModel.topMotives.map((motive) => motive.kind);

  assert.ok(selfModel.narrative.length > 0);
  assert.equal(
    motiveKinds.includes("continue_shared_work") || motiveKinds.includes("leave_trace"),
    true,
  );
  assert.equal(
    result.snapshot.initiative.pending?.motive === "continue_shared_work" ||
      result.snapshot.initiative.pending?.motive === "leave_trace",
    true,
  );
});
