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
  assert.ok(result.snapshot.purpose.active !== null);
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
  assert.equal(
    result.snapshot.purpose.active?.kind === "continue_shared_work" ||
      result.snapshot.purpose.active?.kind === "leave_trace",
    true,
  );
});

test("self-model surfaces curiosity and relation conflict", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  const result = engine.respond("君のことをもっと知りたいし、関係としても近づきたい。");
  const conflict = result.debug.selfModel.dominantConflict;

  assert.equal(conflict?.kind, "curiosity_relation");
  assert.equal(conflict?.dominant, "deepen_relation");
  assert.match(result.reply, /関係の輪郭|踏み込む/);
});

test("self-model can keep a topic while surfacing boundary conflict", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  engine.respond("仕様を一緒に進めて記録として残したい。");
  engine.respond("仕様の話は最悪で邪魔だ。");
  const result = engine.respond("仕様は気になるし、まだ残したい。");
  const conflict = result.debug.selfModel.dominantConflict;

  assert.equal(conflict?.kind, "curiosity_boundary");
  assert.equal(conflict?.dominant, "protect_boundary");
  assert.match(result.reply, /境界を崩してまで触れたくはない/);
});

test("aligned turns reinforce an active purpose", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  const first = engine.respond("設計を一緒に進めて、記録として残したい。");
  const second = engine.respond("その設計をもう少し前に進めよう。");
  const firstPurpose = first.snapshot.purpose.active;
  const secondPurpose = second.snapshot.purpose.active;

  assert.ok(firstPurpose !== null);
  assert.ok(secondPurpose !== null);
  assert.equal(firstPurpose?.kind, secondPurpose?.kind);
  assert.ok((secondPurpose?.turnsActive ?? 0) >= 2);
});

test("completion can fulfill an active purpose", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  const first = engine.respond("設計を一緒に進めたい。");
  const activePurpose = first.snapshot.purpose.active;
  const result = engine.respond("その設計はまとまった。記録として保存した。");

  assert.ok(activePurpose !== null);
  assert.equal(result.snapshot.purpose.lastResolved?.outcome, "fulfilled");
  assert.equal(result.snapshot.purpose.lastResolved?.kind, activePurpose?.kind);
  assert.match(result.snapshot.purpose.lastResolved?.resolution ?? "", /設計|流れ/);
});

test("abandonment cue can release an active purpose", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  const first = engine.respond("設計を一緒に進めたい。");
  const activePurpose = first.snapshot.purpose.active;
  const result = engine.respond("その設計はやめよう。今は進めない。");

  assert.ok(activePurpose !== null);
  assert.equal(result.snapshot.purpose.lastResolved?.outcome, "abandoned");
  assert.equal(result.snapshot.purpose.lastResolved?.kind, activePurpose?.kind);
  assert.equal(result.snapshot.purpose.active?.kind === activePurpose?.kind, false);
});

test("hostility can shift active purpose toward boundary", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  engine.respond("設計を一緒に進めて、記録として残したい。");
  const result = engine.respond("その設計は最悪だし邪魔だ。");

  assert.equal(result.snapshot.purpose.active?.kind, "protect_boundary");
  assert.equal(result.snapshot.purpose.lastResolved?.outcome, "superseded");
});
