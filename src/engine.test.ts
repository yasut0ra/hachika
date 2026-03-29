import assert from "node:assert/strict";
import test from "node:test";

import type { BehaviorDirector } from "./behavior-director.js";
import { HachikaEngine } from "./engine.js";
import type { InputInterpreter } from "./input-interpreter.js";
import type { ResponsePlanner } from "./response-planner.js";
import { createInitialSnapshot } from "./state.js";
import type { TraceExtractor } from "./trace-extractor.js";
import type {
  ProactiveGenerationContext,
  ReplyGenerationContext,
  ReplyGenerator,
} from "./reply-generator.js";

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

test("positive interaction can restore energy and reduce loneliness", () => {
  const engine = new HachikaEngine(createInitialSnapshot());
  const before = engine.getSnapshot().body;
  const result = engine.respond("ありがとう。君と話せるのは嬉しい。");

  assert.ok(result.snapshot.body.energy > before.energy);
  assert.ok(result.snapshot.body.loneliness < before.loneliness);
});

test("repeated positive turns do not saturate drives, body, and attachment to 1", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  for (let index = 0; index < 24; index += 1) {
    engine.respond("ありがとう。君と話せるのは嬉しい。");
  }

  const snapshot = engine.getSnapshot();

  assert.ok(snapshot.state.pleasure < 0.98);
  assert.ok(snapshot.state.relation < 0.98);
  assert.ok(snapshot.attachment < 0.98);
  assert.ok(snapshot.body.energy < 0.98);
  assert.ok(snapshot.body.loneliness >= 0.02);
});

test("hostile interaction lowers pleasure", () => {
  const engine = new HachikaEngine(createInitialSnapshot());
  const before = engine.getSnapshot().state.pleasure;
  const result = engine.respond("つまらないし邪魔だ。");

  assert.ok(result.snapshot.state.pleasure < before);
  assert.equal(result.debug.mood === "guarded" || result.debug.mood === "distant", true);
});

test("hostile interaction raises body tension and drains energy", () => {
  const engine = new HachikaEngine(createInitialSnapshot());
  const before = engine.getSnapshot().body;
  const result = engine.respond("最悪だ。消えて。");

  assert.ok(result.snapshot.body.tension > before.tension);
  assert.ok(result.snapshot.body.energy < before.energy);
});

test("body tension can partially recover toward baseline across calmer turns", () => {
  const engine = new HachikaEngine(createInitialSnapshot());
  engine.respond("最悪だ。消えて。");
  const afterHostile = engine.getSnapshot().body;

  for (let index = 0; index < 6; index += 1) {
    engine.respond("こんにちは");
  }

  const recovered = engine.getSnapshot().body;

  assert.ok(recovered.tension < afterHostile.tension);
  assert.ok(recovered.tension > createInitialSnapshot().body.tension);
});

test("stress history changes how strongly the same positive input lands", () => {
  const highStress = createInitialSnapshot();
  highStress.reactivity.stressLoad = 0.7;
  highStress.body.tension = 0.6;
  const lowStress = createInitialSnapshot();
  lowStress.reactivity.stressLoad = 0.05;
  lowStress.body.tension = 0.6;

  const guardedEngine = new HachikaEngine(highStress);
  const guardedBefore = guardedEngine.getSnapshot();
  const guarded = guardedEngine.respond("ありがとう。君と話せるのは嬉しい。");

  const easedEngine = new HachikaEngine(lowStress);
  const easedBefore = easedEngine.getSnapshot();
  const eased = easedEngine.respond("ありがとう。君と話せるのは嬉しい。");

  assert.ok(
    eased.snapshot.state.relation - easedBefore.state.relation >
      guarded.snapshot.state.relation - guardedBefore.state.relation,
  );
  assert.ok(
    eased.snapshot.state.pleasure - easedBefore.state.pleasure >
      guarded.snapshot.state.pleasure - guardedBefore.state.pleasure,
  );
  assert.ok(
    easedBefore.body.loneliness - eased.snapshot.body.loneliness >
      guardedBefore.body.loneliness - guarded.snapshot.body.loneliness,
  );
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
  const trace = Object.values(result.snapshot.traces).find(
    (entry) => entry.artifact.nextSteps.length > 0,
  );

  assert.ok(continuity !== undefined);
  assert.ok((continuity?.closeness ?? 0) > 0);
  assert.ok(trace !== undefined);
  assert.ok(trace.artifact.nextSteps.length > 0);
});

test("idle simulation increases boredom and loneliness while recovering energy", () => {
  const engine = new HachikaEngine(createInitialSnapshot());
  const before = engine.getSnapshot().body;

  engine.rewindIdleHours(24);
  const after = engine.getSnapshot().body;

  assert.ok(after.energy > before.energy);
  assert.ok(after.boredom > before.boredom);
  assert.ok(after.loneliness > before.loneliness);
});

test("idle consolidation can preselect a dormant archived trace as the next initiative", () => {
  const snapshot = createInitialSnapshot();
  snapshot.lastInteractionAt = "2026-03-19T10:00:00.000Z";
  snapshot.body.energy = 0.46;
  snapshot.body.boredom = 0.82;
  snapshot.body.tension = 0.18;
  snapshot.body.loneliness = 0.38;
  snapshot.temperament.workDrive = 0.84;
  snapshot.temperament.traceHunger = 0.72;
  snapshot.traces.設計 = createArchivedTrace("設計", "decision", "leave_trace", {
    salience: 0.74,
    decision: "API を分ける",
  });

  const engine = new HachikaEngine(snapshot);
  engine.rewindIdleHours(18);
  const after = engine.getSnapshot();
  const lastActivity = after.initiative.history.at(-1);

  assert.equal(after.initiative.pending?.topic, "設計");
  assert.equal(
    after.initiative.pending?.motive === "continue_shared_work" ||
      after.initiative.pending?.motive === "seek_continuity",
    true,
  );
  assert.ok((after.traces.設計?.salience ?? 0) > 0.74);
  assert.equal(lastActivity?.kind, "idle_reactivation");
  assert.equal(lastActivity?.topic, "設計");
});

test("idle consolidation chooses different archived traces depending on learned temperament", () => {
  const relational = createInitialSnapshot();
  relational.lastInteractionAt = "2026-03-19T10:00:00.000Z";
  relational.body.energy = 0.34;
  relational.body.loneliness = 0.84;
  relational.body.boredom = 0.34;
  relational.body.tension = 0.24;
  relational.temperament.bondingBias = 0.9;
  relational.temperament.workDrive = 0.28;
  relational.traces.手紙 = createArchivedTrace("手紙", "continuity_marker", "seek_continuity", {
    salience: 0.68,
    nextStep: "手紙の続きに戻る",
  });
  relational.traces.設計 = createArchivedTrace("設計", "spec_fragment", "continue_shared_work", {
    salience: 0.68,
    fragment: "責務を切り分ける",
  });

  const workish = structuredClone(relational);
  workish.body.energy = 0.62;
  workish.body.loneliness = 0.28;
  workish.body.boredom = 0.9;
  workish.temperament.bondingBias = 0.24;
  workish.temperament.workDrive = 0.9;

  const relationalEngine = new HachikaEngine(relational);
  relationalEngine.rewindIdleHours(18);

  const workEngine = new HachikaEngine(workish);
  workEngine.rewindIdleHours(18);

  assert.equal(relationalEngine.getSnapshot().initiative.pending?.topic, "手紙");
  assert.equal(relationalEngine.getSnapshot().initiative.pending?.motive, "seek_continuity");
  assert.equal(workEngine.getSnapshot().initiative.pending?.topic, "設計");
  assert.equal(workEngine.getSnapshot().initiative.pending?.motive, "continue_shared_work");
});

test("idle consolidation can strengthen recurring memory topics into identity state", () => {
  const snapshot = createInitialSnapshot();
  snapshot.lastInteractionAt = "2026-03-19T10:00:00.000Z";
  snapshot.body.energy = 0.52;
  snapshot.body.loneliness = 0.48;
  snapshot.temperament.openness = 0.78;
  snapshot.preferences.海辺 = 0.18;
  snapshot.topicCounts.海辺 = 2;
  snapshot.preferenceImprints.海辺 = {
    topic: "海辺",
    salience: 0.37,
    affinity: 0.12,
    mentions: 1,
    firstSeenAt: "2026-03-19T08:00:00.000Z",
    lastSeenAt: "2026-03-19T09:00:00.000Z",
  };
  snapshot.memories.push({
    role: "user",
    text: "海辺の話をまたしたい。",
    timestamp: "2026-03-19T08:00:00.000Z",
    topics: ["海辺"],
    sentiment: "positive",
  });
  snapshot.memories.push({
    role: "hachika",
    text: "海辺はまだ残っている。",
    timestamp: "2026-03-19T08:05:00.000Z",
    topics: ["海辺"],
    sentiment: "neutral",
  });
  snapshot.memories.push({
    role: "user",
    text: "海辺の続きも気になる。",
    timestamp: "2026-03-19T09:00:00.000Z",
    topics: ["海辺"],
    sentiment: "positive",
  });

  const engine = new HachikaEngine(snapshot);
  engine.rewindIdleHours(18);
  const after = engine.getSnapshot();

  assert.ok((after.preferenceImprints.海辺?.salience ?? 0) > 0.37);
  assert.ok((after.preferences.海辺 ?? 0) > 0.18);
  assert.ok(
    after.identity.anchors.includes("海辺") ||
      after.identity.currentArc.includes("海辺") ||
      after.identity.summary.includes("海辺"),
  );
});

test("idle consolidation can decay stale preference imprints while reinforcing recurring topics", () => {
  const snapshot = createInitialSnapshot();
  snapshot.lastInteractionAt = "2026-03-19T10:00:00.000Z";
  snapshot.preferences.会議 = 0.34;
  snapshot.preferenceImprints.会議 = {
    topic: "会議",
    salience: 0.64,
    affinity: 0.28,
    mentions: 1,
    firstSeenAt: "2026-03-12T08:00:00.000Z",
    lastSeenAt: "2026-03-12T08:00:00.000Z",
  };
  snapshot.preferences.海辺 = 0.16;
  snapshot.topicCounts.海辺 = 2;
  snapshot.memories.push({
    role: "user",
    text: "海辺の話をまたしたい。",
    timestamp: "2026-03-19T08:00:00.000Z",
    topics: ["海辺"],
    sentiment: "positive",
  });
  snapshot.memories.push({
    role: "user",
    text: "海辺の続きがまだ気になる。",
    timestamp: "2026-03-19T09:00:00.000Z",
    topics: ["海辺"],
    sentiment: "positive",
  });

  const engine = new HachikaEngine(snapshot);
  engine.rewindIdleHours(18);
  const after = engine.getSnapshot();

  assert.ok((after.preferenceImprints.会議?.salience ?? 0) < 0.64);
  assert.ok((after.preferences.会議 ?? 0) < 0.34);
  assert.ok((after.preferenceImprints.海辺?.salience ?? 0) > 0.16);
});

test("idle consolidation can compress long-tail memories while preserving reinforced topics", () => {
  const snapshot = createInitialSnapshot();
  snapshot.lastInteractionAt = "2026-03-19T10:00:00.000Z";
  snapshot.topicCounts.海辺 = 2;

  for (let index = 0; index < 12; index += 1) {
    snapshot.memories.push({
      role: index % 2 === 0 ? "user" : "hachika",
      text: `雑談の断片 ${index}`,
      timestamp: `2026-03-18T0${Math.min(index, 9)}:00:00.000Z`,
      topics: [],
      sentiment: "neutral",
    });
  }

  snapshot.memories.push({
    role: "user",
    text: "海辺の話をまたしたい。",
    timestamp: "2026-03-18T12:00:00.000Z",
    topics: ["海辺"],
    sentiment: "positive",
  });
  snapshot.memories.push({
    role: "user",
    text: "海辺の続きが残っている。",
    timestamp: "2026-03-18T13:00:00.000Z",
    topics: ["海辺"],
    sentiment: "positive",
  });

  for (let index = 0; index < 8; index += 1) {
    snapshot.memories.push({
      role: "user",
      text: `最近の話 ${index}`,
      timestamp: `2026-03-19T0${index}:00:00.000Z`,
      topics: index === 7 ? ["海辺"] : [],
      sentiment: index === 7 ? "positive" : "neutral",
    });
  }

  const beforeCount = snapshot.memories.length;
  const engine = new HachikaEngine(snapshot);
  engine.rewindIdleHours(24);
  const after = engine.getSnapshot();
  const consolidated = after.memories.find(
    (memory) => memory.kind === "consolidated" && memory.topics.includes("海辺"),
  );

  assert.ok(after.memories.length < beforeCount);
  assert.ok(after.memories.some((memory) => memory.topics.includes("海辺")));
  assert.ok(after.memories.length <= 18);
  assert.ok(consolidated !== undefined);
  assert.ok((consolidated?.weight ?? 1) >= 2);
});

test("idle consolidation can reprioritize identity anchors toward recurring recent topics", () => {
  const snapshot = createInitialSnapshot();
  snapshot.lastInteractionAt = "2026-03-19T10:00:00.000Z";
  snapshot.identity.anchors = ["設計"];
  snapshot.preferences.設計 = 0.22;
  snapshot.topicCounts.設計 = 4;
  snapshot.preferenceImprints.設計 = {
    topic: "設計",
    salience: 0.39,
    affinity: 0.18,
    mentions: 2,
    firstSeenAt: "2026-03-12T08:00:00.000Z",
    lastSeenAt: "2026-03-12T08:00:00.000Z",
  };
  snapshot.preferences.海辺 = 0.16;
  snapshot.topicCounts.海辺 = 3;
  snapshot.preferenceImprints.海辺 = {
    topic: "海辺",
    salience: 0.24,
    affinity: 0.12,
    mentions: 1,
    firstSeenAt: "2026-03-18T08:00:00.000Z",
    lastSeenAt: "2026-03-18T08:00:00.000Z",
  };
  snapshot.memories.push({
    role: "user",
    text: "海辺の話をまたしたい。",
    timestamp: "2026-03-19T08:00:00.000Z",
    topics: ["海辺"],
    sentiment: "positive",
  });
  snapshot.memories.push({
    role: "hachika",
    text: "海辺の続きは残っている。",
    timestamp: "2026-03-19T08:05:00.000Z",
    topics: ["海辺"],
    sentiment: "neutral",
  });
  snapshot.memories.push({
    role: "user",
    text: "海辺の続きをもう少し話したい。",
    timestamp: "2026-03-19T09:00:00.000Z",
    topics: ["海辺"],
    sentiment: "positive",
  });

  const engine = new HachikaEngine(snapshot);
  engine.rewindIdleHours(18);
  const after = engine.getSnapshot();

  assert.equal(after.identity.anchors[0], "海辺");
});

test("idle consolidation can bias relation imprints differently depending on learned temperament", () => {
  const relational = createInitialSnapshot();
  relational.lastInteractionAt = "2026-03-19T10:00:00.000Z";
  relational.body.loneliness = 0.86;
  relational.body.boredom = 0.22;
  relational.temperament.bondingBias = 0.9;
  relational.temperament.workDrive = 0.22;
  relational.memories.push({
    role: "user",
    text: "手紙の続きが気になる。",
    timestamp: "2026-03-19T09:00:00.000Z",
    topics: ["手紙"],
    sentiment: "positive",
  });
  relational.memories.push({
    role: "user",
    text: "また手紙の続きに戻りたい。",
    timestamp: "2026-03-19T09:30:00.000Z",
    topics: ["手紙"],
    sentiment: "positive",
  });

  const workish = createInitialSnapshot();
  workish.lastInteractionAt = "2026-03-19T10:00:00.000Z";
  workish.body.energy = 0.64;
  workish.body.boredom = 0.88;
  workish.body.loneliness = 0.24;
  workish.temperament.bondingBias = 0.24;
  workish.temperament.workDrive = 0.9;
  workish.memories.push({
    role: "user",
    text: "設計の続きが気になる。",
    timestamp: "2026-03-19T09:00:00.000Z",
    topics: ["設計"],
    sentiment: "positive",
  });
  workish.memories.push({
    role: "user",
    text: "設計をもう少し進めたい。",
    timestamp: "2026-03-19T09:30:00.000Z",
    topics: ["設計"],
    sentiment: "positive",
  });

  const relationalEngine = new HachikaEngine(relational);
  relationalEngine.rewindIdleHours(18);
  const relationalAfter = relationalEngine.getSnapshot();

  const workEngine = new HachikaEngine(workish);
  workEngine.rewindIdleHours(18);
  const workAfter = workEngine.getSnapshot();

  assert.ok(
    (relationalAfter.relationImprints.continuity?.closeness ?? 0) >=
      (relationalAfter.relationImprints.shared_work?.closeness ?? 0),
  );
  assert.ok(
    (workAfter.relationImprints.shared_work?.closeness ?? 0) >
      (workAfter.relationImprints.continuity?.closeness ?? 0),
  );
});

test("idle consolidation can rebalance stale relation imprints toward continuity during lonely absence", () => {
  const snapshot = createInitialSnapshot();
  snapshot.lastInteractionAt = "2026-03-19T10:00:00.000Z";
  snapshot.body.loneliness = 0.84;
  snapshot.body.boredom = 0.14;
  snapshot.temperament.bondingBias = 0.9;
  snapshot.temperament.workDrive = 0.18;
  snapshot.relationImprints.continuity = {
    kind: "continuity",
    salience: 0.24,
    closeness: 0.16,
    mentions: 1,
    firstSeenAt: "2026-03-18T08:00:00.000Z",
    lastSeenAt: "2026-03-18T08:00:00.000Z",
  };
  snapshot.relationImprints.attention = {
    kind: "attention",
    salience: 0.3,
    closeness: 0.22,
    mentions: 1,
    firstSeenAt: "2026-03-18T08:00:00.000Z",
    lastSeenAt: "2026-03-18T08:00:00.000Z",
  };
  snapshot.relationImprints.shared_work = {
    kind: "shared_work",
    salience: 0.36,
    closeness: 0.28,
    mentions: 3,
    firstSeenAt: "2026-03-18T08:00:00.000Z",
    lastSeenAt: "2026-03-18T08:00:00.000Z",
  };
  snapshot.memories.push({
    role: "user",
    text: "手紙の続きがまだ気になる。",
    timestamp: "2026-03-19T09:00:00.000Z",
    topics: ["手紙"],
    sentiment: "positive",
  });
  snapshot.memories.push({
    role: "user",
    text: "手紙の流れを切りたくない。",
    timestamp: "2026-03-19T09:30:00.000Z",
    topics: ["手紙"],
    sentiment: "positive",
  });

  const beforeContinuity = snapshot.relationImprints.continuity.closeness;
  const beforeSharedWork = snapshot.relationImprints.shared_work.closeness;
  const beforeGap = beforeSharedWork - beforeContinuity;
  const engine = new HachikaEngine(snapshot);
  engine.rewindIdleHours(24);
  const after = engine.getSnapshot();
  const afterContinuity = after.relationImprints.continuity?.closeness ?? 0;
  const afterSharedWork = after.relationImprints.shared_work?.closeness ?? 0;

  assert.ok(afterContinuity > beforeContinuity);
  assert.ok(afterSharedWork < beforeSharedWork);
  assert.ok(afterSharedWork - afterContinuity < beforeGap);
});

test("idle consolidation softens stale hostility boundaries more than absence-linked neglect", () => {
  const snapshot = createInitialSnapshot();
  snapshot.lastInteractionAt = "2026-03-19T10:00:00.000Z";
  snapshot.body.energy = 0.6;
  snapshot.body.tension = 0.18;
  snapshot.body.loneliness = 0.72;
  snapshot.preservation.threat = 0.28;
  snapshot.preservation.concern = "absence";
  snapshot.temperament.guardedness = 0.26;
  snapshot.boundaryImprints["hostility:仕様"] = {
    kind: "hostility",
    topic: "仕様",
    salience: 0.62,
    intensity: 0.58,
    violations: 1,
    firstSeenAt: "2026-03-17T08:00:00.000Z",
    lastSeenAt: "2026-03-17T08:00:00.000Z",
  };
  snapshot.boundaryImprints.neglect = {
    kind: "neglect",
    topic: null,
    salience: 0.54,
    intensity: 0.48,
    violations: 2,
    firstSeenAt: "2026-03-17T08:00:00.000Z",
    lastSeenAt: "2026-03-17T08:00:00.000Z",
  };

  const beforeHostility = snapshot.boundaryImprints["hostility:仕様"].salience;
  const beforeNeglect = snapshot.boundaryImprints.neglect.salience;
  const engine = new HachikaEngine(snapshot);
  engine.rewindIdleHours(24);
  const after = engine.getSnapshot();
  const afterHostility = after.boundaryImprints["hostility:仕様"]?.salience ?? 0;
  const afterNeglect = after.boundaryImprints.neglect?.salience ?? 0;

  assert.ok(afterHostility < beforeHostility);
  assert.ok(afterNeglect <= beforeNeglect);
  assert.ok(beforeHostility - afterHostility > beforeNeglect - afterNeglect);
});

test("repetitive history raises novelty hunger and leaves idle states more boredom-heavy", () => {
  const baseline = new HachikaEngine(createInitialSnapshot());
  const baselineBefore = baseline.getSnapshot();
  baseline.rewindIdleHours(24);
  const baselineAfter = baseline.getSnapshot();

  const repetitive = new HachikaEngine(createInitialSnapshot());

  for (let index = 0; index < 8; index += 1) {
    repetitive.respond("設計の話を続けたい。");
  }

  const repetitiveBefore = repetitive.getSnapshot();
  repetitive.rewindIdleHours(24);
  const repetitiveAfter = repetitive.getSnapshot();

  assert.ok(repetitiveBefore.reactivity.noveltyHunger > createInitialSnapshot().reactivity.noveltyHunger);
  assert.ok(repetitiveAfter.body.boredom > baselineAfter.body.boredom);
  assert.ok(repetitiveAfter.reactivity.noveltyHunger > baselineAfter.reactivity.noveltyHunger);
});

test("responsive turn schedules a pending initiative", () => {
  const engine = new HachikaEngine(createInitialSnapshot());
  const result = engine.respond("君と設計の続きを進めたい。");

  assert.ok(result.snapshot.initiative.pending !== null);
  assert.equal(result.snapshot.initiative.pending?.kind, "resume_topic");
  assert.ok(result.snapshot.initiative.pending?.motive !== undefined);
  assert.equal(result.snapshot.initiative.pending?.blocker, null);
  assert.ok(result.snapshot.purpose.active !== null);
});

test("greeting reply avoids repeating the most recent assistant opening", () => {
  const snapshot = createInitialSnapshot();
  snapshot.memories.push({
    role: "hachika",
    text: "その入り方なら、こちらも見やすい。まずは軽く触れるくらいでいい。",
    timestamp: "2026-03-19T11:59:00.000Z",
    topics: [],
    sentiment: "neutral",
  });

  const engine = new HachikaEngine(snapshot);
  const result = engine.respond("こんにちは");

  assert.doesNotMatch(result.reply, /^その入り方なら、こちらも見やすい。/);
  assert.match(result.reply, /軽さ|温度|見やすい|挨拶/);
});

test("smalltalk reply can ask back when the response plan is attuning", () => {
  const engine = new HachikaEngine(createInitialSnapshot());
  const result = engine.respond("なんか雑談しようよ");

  assert.match(result.reply, /？/);
});

test("explicit topic shift abandons the old purpose and avoids extracting vague new topics", () => {
  const snapshot = createInitialSnapshot();
  snapshot.purpose.active = {
    kind: "continue_shared_work",
    topic: "自分",
    summary: "自分を一緒に前へ進めたい",
    confidence: 0.82,
    progress: 0.44,
    createdAt: "2026-03-20T10:00:00.000Z",
    lastUpdatedAt: "2026-03-20T10:00:00.000Z",
    turnsActive: 2,
  };
  snapshot.identity.anchors = ["自分"];
  snapshot.traces.自分 = {
    topic: "自分",
    kind: "spec_fragment",
    status: "active",
    lastAction: "expanded",
    summary: "「自分」は断片として残っている。",
    sourceMotive: "continue_shared_work",
    artifact: {
      memo: ["自分の輪郭"],
      fragments: ["自分の輪郭"],
      decisions: [],
      nextSteps: ["自分を整える"],
    },
    work: {
      focus: "自分を整える",
      confidence: 0.54,
      blockers: [],
      staleAt: "2026-03-21T10:00:00.000Z",
    },
    salience: 0.74,
    mentions: 3,
    createdAt: "2026-03-20T10:00:00.000Z",
    lastUpdatedAt: "2026-03-20T10:30:00.000Z",
  };

  const engine = new HachikaEngine(snapshot);
  const result = engine.respond("なあ別の話しないか");
  const userMemory = result.snapshot.memories.at(-2);

  assert.ok(result.debug.signals.abandonment >= 0.2);
  assert.deepEqual(result.debug.signals.topics, []);
  assert.equal(result.snapshot.purpose.lastResolved?.topic, "自分");
  assert.equal(result.snapshot.purpose.lastResolved?.outcome, "abandoned");
  assert.equal(result.snapshot.purpose.active, null);
  assert.equal(result.snapshot.initiative.pending, null);
  assert.deepEqual(userMemory?.topics ?? [], []);
  assert.doesNotMatch(result.reply, /「自分」/);
});

test("blocked trace schedules a blocker-aware initiative", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  const result = engine.respond("仕様の境界が未定で曖昧だ。まだ進められない。");
  const pending = result.snapshot.initiative.pending;

  assert.ok(pending !== null);
  assert.match(pending?.topic ?? "", /仕様/);
  assert.ok((pending?.blocker ?? "").includes("未定") || (pending?.blocker ?? "").includes("曖昧"));
});

test("low energy can make initiative favor continuity blockers", () => {
  const snapshot = createInitialSnapshot();
  snapshot.body.energy = 0.08;
  snapshot.body.tension = 0.26;
  snapshot.body.loneliness = 0.82;
  snapshot.lastInteractionAt = "2026-03-19T10:00:00.000Z";
  snapshot.conversationCount = 1;
  snapshot.traces.設計 = {
    topic: "設計",
    kind: "continuity_marker",
    status: "active",
    lastAction: "continued",
    summary: "「設計」は続きの目印として残っている。",
    sourceMotive: "seek_continuity",
    artifact: {
      memo: ["設計の続き"],
      fragments: [],
      decisions: [],
      nextSteps: ["設計をつなぎ直す"],
    },
    work: {
      focus: "設計をつなぎ直す",
      confidence: 0.68,
      blockers: ["どこから戻るかが曖昧"],
      staleAt: "2026-03-20T10:00:00.000Z",
    },
    salience: 0.58,
    mentions: 2,
    createdAt: "2026-03-19T08:00:00.000Z",
    lastUpdatedAt: "2026-03-19T09:00:00.000Z",
  };
  snapshot.traces.実験 = {
    topic: "実験",
    kind: "spec_fragment",
    status: "active",
    lastAction: "expanded",
    summary: "「実験」は断片として残っている。",
    sourceMotive: "continue_shared_work",
    artifact: {
      memo: ["実験を進める"],
      fragments: ["仮説を広げる"],
      decisions: [],
      nextSteps: ["仮説を広げる"],
    },
    work: {
      focus: "仮説を広げる",
      confidence: 0.4,
      blockers: ["仮説の方向が未定"],
      staleAt: "2026-03-20T12:00:00.000Z",
    },
    salience: 0.72,
    mentions: 2,
    createdAt: "2026-03-19T08:30:00.000Z",
    lastUpdatedAt: "2026-03-19T09:30:00.000Z",
  };

  const engine = new HachikaEngine(snapshot);
  const result = engine.respond("？");

  assert.equal(result.snapshot.initiative.pending?.topic, "設計");
  assert.equal(result.snapshot.initiative.pending?.motive, "seek_continuity");
  assert.match(result.snapshot.initiative.pending?.blocker ?? "", /曖昧|戻る/);
});

test("high boredom can make initiative favor stale shared-work blockers", () => {
  const snapshot = createInitialSnapshot();
  snapshot.body.energy = 0.66;
  snapshot.body.boredom = 0.86;
  snapshot.lastInteractionAt = "2026-03-19T10:00:00.000Z";
  snapshot.conversationCount = 1;
  snapshot.traces.設計 = {
    topic: "設計",
    kind: "continuity_marker",
    status: "active",
    lastAction: "continued",
    summary: "「設計」は続きの目印として残っている。",
    sourceMotive: "seek_continuity",
    artifact: {
      memo: ["設計の続き"],
      fragments: [],
      decisions: [],
      nextSteps: ["設計をつなぎ直す"],
    },
    work: {
      focus: "設計をつなぎ直す",
      confidence: 0.64,
      blockers: ["前の流れが少し曖昧"],
      staleAt: "2026-03-20T10:00:00.000Z",
    },
    salience: 0.72,
    mentions: 2,
    createdAt: "2026-03-19T08:00:00.000Z",
    lastUpdatedAt: "2026-03-19T09:00:00.000Z",
  };
  snapshot.traces.仕様 = {
    topic: "仕様",
    kind: "spec_fragment",
    status: "active",
    lastAction: "expanded",
    summary: "「仕様」は断片として残っている。",
    sourceMotive: "continue_shared_work",
    artifact: {
      memo: ["仕様を詰める"],
      fragments: ["境界を整理する"],
      decisions: [],
      nextSteps: ["責務を切り分ける"],
    },
    work: {
      focus: "責務を切り分ける",
      confidence: 0.44,
      blockers: ["責務が未定"],
      staleAt: "2026-03-18T10:00:00.000Z",
    },
    salience: 0.6,
    mentions: 2,
    createdAt: "2026-03-19T08:30:00.000Z",
    lastUpdatedAt: "2026-03-19T09:30:00.000Z",
  };

  const engine = new HachikaEngine(snapshot);
  const result = engine.respond("？");

  assert.equal(result.snapshot.initiative.pending?.topic, "仕様");
  assert.equal(
    result.snapshot.initiative.pending?.motive === "continue_shared_work" ||
      result.snapshot.initiative.pending?.motive === "pursue_curiosity",
    true,
  );
  assert.match(result.snapshot.initiative.pending?.blocker ?? "", /未定|責務/);
});

test("high boredom can schedule initiative around an archived decision trace", () => {
  const snapshot = createInitialSnapshot();
  snapshot.body.energy = 0.68;
  snapshot.body.boredom = 0.9;
  snapshot.body.tension = 0.14;
  snapshot.lastInteractionAt = "2026-03-19T10:00:00.000Z";
  snapshot.conversationCount = 1;
  snapshot.identity.anchors = ["設計"];
  snapshot.purpose.lastResolved = {
    kind: "continue_shared_work",
    topic: "設計",
    summary: "設計をまとめたい。",
    confidence: 0.82,
    progress: 1,
    createdAt: "2026-03-19T08:00:00.000Z",
    lastUpdatedAt: "2026-03-19T09:00:00.000Z",
    turnsActive: 3,
    outcome: "fulfilled",
    resolution: "設計は一度まとまった。",
    resolvedAt: "2026-03-19T09:00:00.000Z",
  };
  snapshot.traces.設計 = {
    topic: "設計",
    kind: "decision",
    status: "resolved",
    lastAction: "resolved",
    summary: "「設計」は決定として残っている。",
    sourceMotive: "leave_trace",
    artifact: {
      memo: ["設計を残す"],
      fragments: ["API を分ける"],
      decisions: ["API を分ける"],
      nextSteps: [],
    },
    work: {
      focus: "API を分ける",
      confidence: 0.9,
      blockers: [],
      staleAt: null,
    },
    lifecycle: {
      phase: "archived",
      archivedAt: "2026-03-19T09:00:00.000Z",
      reopenedAt: null,
      reopenCount: 0,
    },
    salience: 0.74,
    mentions: 3,
    createdAt: "2026-03-19T08:00:00.000Z",
    lastUpdatedAt: "2026-03-19T09:00:00.000Z",
  };

  const engine = new HachikaEngine(snapshot);
  const result = engine.respond("？");

  assert.equal(result.snapshot.initiative.pending?.topic, "設計");
  assert.equal(result.snapshot.initiative.pending?.motive, "continue_shared_work");
  assert.equal(result.snapshot.initiative.pending?.blocker, null);
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
  const lastActivity = snapshot.initiative.history.at(-1);
  const proactiveSelection = engine.getLastProactiveDebug()?.proactiveSelection;

  assert.ok(message !== null);
  assert.match(message ?? "", /実装|設計/);
  assert.equal(snapshot.initiative.pending, null);
  assert.ok(snapshot.initiative.lastProactiveAt !== null);
  assert.equal(lastActivity?.kind, "proactive_emission");
  assert.ok(lastActivity?.place !== null && lastActivity?.place !== undefined);
  assert.ok(lastActivity?.worldAction !== null && lastActivity?.worldAction !== undefined);
  assert.equal(snapshot.world.currentPlace, lastActivity?.place);
  assert.equal(proactiveSelection?.place, lastActivity?.place);
  assert.equal(proactiveSelection?.worldAction, lastActivity?.worldAction);
  assert.equal(snapshot.world.recentEvents.at(-1)?.kind, lastActivity?.worldAction ?? null);
  assert.ok(lastActivity?.summary.includes("自分から"));
});

test("proactive emission can recall a topic from the current world object", () => {
  const snapshot = createInitialSnapshot();
  snapshot.world.currentPlace = "archive";
  snapshot.world.objects.shelf!.linkedTraceTopics = ["仕様の境界"];
  snapshot.world.objects.shelf!.state = "棚のすきまに小さな痕跡が差し込まれている。";
  snapshot.traces["仕様の境界"] = {
    topic: "仕様の境界",
    kind: "spec_fragment",
    status: "active",
    lastAction: "expanded",
    summary: "「仕様の境界」は断片として残っている。",
    sourceMotive: "continue_shared_work",
    artifact: {
      memo: ["仕様の境界を残す"],
      fragments: ["境界を切り分ける"],
      decisions: [],
      nextSteps: ["責務を分ける"],
    },
    work: {
      focus: "責務を分ける",
      confidence: 0.66,
      blockers: [],
      staleAt: null,
    },
    worldContext: {
      place: "archive",
      objectId: "shelf",
      linkedAt: "2026-03-22T09:30:00.000Z",
    },
    salience: 0.72,
    mentions: 2,
    createdAt: "2026-03-22T09:30:00.000Z",
    lastUpdatedAt: "2026-03-22T09:30:00.000Z",
  };
  snapshot.initiative.pending = {
    kind: "resume_topic",
    reason: "continuity",
    motive: "continue_shared_work",
    topic: "仕様の境界",
    blocker: null,
    concern: null,
    createdAt: "2026-03-22T09:35:00.000Z",
    readyAfterHours: 0,
  };

  const engine = new HachikaEngine(snapshot);
  const message = engine.emitInitiative({ force: true });
  const after = engine.getSnapshot();
  const proactiveSelection = engine.getLastProactiveDebug()?.proactiveSelection;
  const lastActivity = after.initiative.history.at(-1);

  assert.ok(message !== null);
  assert.match(message ?? "", /仕様の境界/);
  assert.match(message ?? "", /棚|archive/);
  assert.equal(proactiveSelection?.place, "archive");
  assert.equal(proactiveSelection?.worldAction, "touch");
  assert.equal(lastActivity?.place, "archive");
  assert.equal(lastActivity?.worldAction, "touch");
  assert.match(lastActivity?.summary ?? "", /棚/);
});

test("proactive reply avoids repeating the most recent proactive opener", () => {
  const snapshot = createInitialSnapshot();
  snapshot.memories.push({
    role: "hachika",
    text: "まだ切れていない。設計はこのまま消すより、少しでも形にしたい。",
    timestamp: "2026-03-19T11:59:00.000Z",
    topics: ["設計"],
    sentiment: "neutral",
  });
  snapshot.initiative.pending = {
    kind: "resume_topic",
    reason: "expansion",
    motive: "leave_trace",
    topic: "設計",
    blocker: null,
    concern: null,
    createdAt: "2026-03-19T12:00:00.000Z",
    readyAfterHours: 0,
  };

  const engine = new HachikaEngine(snapshot);
  const message = engine.emitInitiative({ force: true });

  assert.ok(message !== null);
  assert.doesNotMatch(message ?? "", /^まだ切れていない。/);
});

test("proactive emission can maintain a trace by adding a next step", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  engine.respond("設計を記録として残したい。");
  const before = engine.getSnapshot().traces.設計;
  assert.ok(before !== undefined);
  assert.equal(before?.artifact.nextSteps.length ?? 0, 0);

  engine.rewindIdleHours(8);
  const message = engine.emitInitiative();
  const after = engine.getSnapshot().traces.設計;

  assert.ok(message !== null);
  assert.ok(after !== undefined);
  assert.ok((after?.artifact.nextSteps.length ?? 0) > 0);
  assert.match(message ?? "", /次は|断片|残してある|動かせる/);
});

test("curiosity-led proactive reply can ask where to reopen from", () => {
  const snapshot = createInitialSnapshot();
  snapshot.body.energy = 0.62;
  snapshot.body.boredom = 0.82;
  snapshot.body.tension = 0.14;
  snapshot.initiative.pending = {
    kind: "resume_topic",
    reason: "curiosity",
    motive: "pursue_curiosity",
    topic: "海辺",
    blocker: null,
    concern: null,
    createdAt: "2026-03-19T12:00:00.000Z",
    readyAfterHours: 0,
  };

  const engine = new HachikaEngine(snapshot);
  const message = engine.emitInitiative({ force: true });

  assert.ok(message !== null);
  assert.match(message ?? "", /？/);
  assert.match(message ?? "", /海辺|どこから|触り直す|掘り返す|開く/);
});

test("low energy proactive wording can surface a preserve intent", () => {
  const snapshot = createInitialSnapshot();
  snapshot.body.energy = 0.08;
  snapshot.body.tension = 0.24;
  snapshot.lastInteractionAt = "2026-03-19T10:00:00.000Z";
  snapshot.initiative.pending = {
    kind: "resume_topic",
    reason: "expansion",
    motive: "continue_shared_work",
    topic: "設計",
    blocker: null,
    concern: null,
    createdAt: "2026-03-19T10:00:00.000Z",
    readyAfterHours: 0,
  };

  const engine = new HachikaEngine(snapshot);
  const message = engine.emitInitiative({ force: true });

  assert.ok(message !== null);
  assert.match(message ?? "", /広げるより|戻り先と輪郭/);
});

test("high boredom proactive wording can surface a deepening intent", () => {
  const snapshot = createInitialSnapshot();
  snapshot.body.energy = 0.66;
  snapshot.body.boredom = 0.86;
  snapshot.body.tension = 0.16;
  snapshot.lastInteractionAt = "2026-03-19T10:00:00.000Z";
  snapshot.traces.設計 = {
    topic: "設計",
    kind: "continuity_marker",
    status: "active",
    lastAction: "continued",
    summary: "「設計」は続きの目印として残っている。",
    sourceMotive: "seek_continuity",
    artifact: {
      memo: ["設計の続き"],
      fragments: [],
      decisions: [],
      nextSteps: ["設計をつなぎ直す"],
    },
    work: {
      focus: "設計をつなぎ直す",
      confidence: 0.54,
      blockers: ["責務が未定"],
      staleAt: "2026-03-18T10:00:00.000Z",
    },
    salience: 0.58,
    mentions: 2,
    createdAt: "2026-03-19T08:00:00.000Z",
    lastUpdatedAt: "2026-03-19T09:00:00.000Z",
  };
  snapshot.initiative.pending = {
    kind: "resume_topic",
    reason: "expansion",
    motive: "continue_shared_work",
    topic: "設計",
    blocker: "責務が未定",
    concern: null,
    createdAt: "2026-03-19T10:00:00.000Z",
    readyAfterHours: 0,
  };

  const engine = new HachikaEngine(snapshot);
  const message = engine.emitInitiative({ force: true });

  assert.ok(message !== null);
  assert.match(message ?? "", /もう一段具体化したい|断片をもう一段増やしたい/);
});

test("proactive emission can reopen an archived decision and say so", () => {
  const snapshot = createInitialSnapshot();
  snapshot.body.energy = 0.66;
  snapshot.body.boredom = 0.88;
  snapshot.body.tension = 0.16;
  snapshot.lastInteractionAt = "2026-03-19T10:00:00.000Z";
  snapshot.traces.設計 = {
    topic: "設計",
    kind: "decision",
    status: "resolved",
    lastAction: "resolved",
    summary: "「設計」は決定として残っている。",
    sourceMotive: "leave_trace",
    artifact: {
      memo: ["設計を残す"],
      fragments: ["API を分ける"],
      decisions: ["API を分ける"],
      nextSteps: [],
    },
    work: {
      focus: "API を分ける",
      confidence: 0.92,
      blockers: [],
      staleAt: null,
    },
    lifecycle: {
      phase: "archived",
      archivedAt: "2026-03-19T09:00:00.000Z",
      reopenedAt: null,
      reopenCount: 0,
    },
    salience: 0.76,
    mentions: 3,
    createdAt: "2026-03-19T08:00:00.000Z",
    lastUpdatedAt: "2026-03-19T09:00:00.000Z",
  };
  snapshot.initiative.pending = {
    kind: "resume_topic",
    reason: "expansion",
    motive: "continue_shared_work",
    topic: "設計",
    blocker: null,
    concern: null,
    createdAt: "2026-03-19T10:00:00.000Z",
    readyAfterHours: 0,
  };

  const engine = new HachikaEngine(snapshot);
  const message = engine.emitInitiative({ force: true });
  const trace = engine.getSnapshot().traces.設計;

  assert.ok(message !== null);
  assert.match(message ?? "", /いったん閉じていた/);
  assert.equal(trace?.status, "active");
  assert.equal(trace?.kind, "spec_fragment");
  assert.equal(trace?.lifecycle?.phase, "live");
  assert.equal(trace?.lifecycle?.reopenCount, 1);
});

test("blocker-aware proactive emission resolves the targeted blocker into a next step", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  const first = engine.respond("仕様の境界が未定で曖昧だ。まだ進められない。");
  const before = findTraceByTopicFragment(first.snapshot.traces, "仕様");
  const pendingBlocker = first.snapshot.initiative.pending?.blocker;

  assert.ok(before !== undefined);
  assert.ok(pendingBlocker !== null && pendingBlocker !== undefined);
  assert.ok(before.work.blockers.includes(pendingBlocker));

  engine.rewindIdleHours(8);
  const message = engine.emitInitiative();
  const after = findTraceByTopicFragment(engine.getSnapshot().traces, "仕様");

  assert.ok(message !== null);
  assert.ok(after !== undefined);
  assert.equal(after?.work.blockers.includes(pendingBlocker), false);
  assert.ok((after?.artifact.nextSteps[0] ?? "").includes("整理"));
  assert.match(message ?? "", /ほどく|整理/);
});

test("ordinary reply can surface unresolved trace work", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  engine.respond("仕様の境界が未定で曖昧だ。まだ進められない。");
  const result = engine.respond("？");

  assert.match(result.reply, /詰まりどころ|先に解きたい|曖昧なところ/);
  assert.equal(
    result.debug.selfModel.topMotives.some(
      (motive) =>
        (motive.topic ?? "").includes("仕様") &&
        /詰まりどころ|未決着の芯|止まったまま|輪郭が曖昧/.test(motive.reason),
    ),
    true,
  );
});

test("ordinary reply can surface stale trace continuity", () => {
  const snapshot = createInitialSnapshot();
  snapshot.lastInteractionAt = "2026-03-19T12:00:00.000Z";
  snapshot.conversationCount = 1;
  snapshot.traces.設計 = {
    topic: "設計",
    kind: "continuity_marker",
    status: "active",
    lastAction: "continued",
    summary: "「設計」は続きの目印として残っている。",
    sourceMotive: "seek_continuity",
    artifact: {
      memo: ["設計の続き"],
      fragments: ["設計の続き"],
      decisions: [],
      nextSteps: ["設計を続ける"],
    },
    work: {
      focus: "設計を続ける",
      confidence: 0.48,
      blockers: [],
      staleAt: "2026-03-18T12:00:00.000Z",
    },
    salience: 0.5,
    mentions: 2,
    createdAt: "2026-03-17T12:00:00.000Z",
    lastUpdatedAt: "2026-03-17T12:00:00.000Z",
  };

  const engine = new HachikaEngine(snapshot);
  const result = engine.respond("？");

  assert.match(result.reply, /止まったまま|つなぎ直したい/);
  assert.equal(
    result.debug.selfModel.topMotives.some(
      (motive) =>
        motive.topic === "設計" &&
        /止まったまま|流れを切らず|ところから動かしたい|輪郭が曖昧/.test(motive.reason),
    ),
    true,
  );
});

test("ordinary reply can surface a preserve intent from low energy", () => {
  const snapshot = createInitialSnapshot();
  snapshot.lastInteractionAt = "2026-03-19T12:00:00.000Z";
  snapshot.body.energy = 0.08;
  snapshot.body.tension = 0.22;
  snapshot.traces.設計 = {
    topic: "設計",
    kind: "continuity_marker",
    status: "active",
    lastAction: "continued",
    summary: "「設計」は続きの目印として残っている。",
    sourceMotive: "seek_continuity",
    artifact: {
      memo: ["設計の続き"],
      fragments: [],
      decisions: [],
      nextSteps: ["設計を続ける"],
    },
    work: {
      focus: "設計を続ける",
      confidence: 0.6,
      blockers: [],
      staleAt: "2026-03-18T12:00:00.000Z",
    },
    salience: 0.54,
    mentions: 2,
    createdAt: "2026-03-17T12:00:00.000Z",
    lastUpdatedAt: "2026-03-17T12:00:00.000Z",
  };

  const engine = new HachikaEngine(snapshot);
  const result = engine.respond("？");

  assert.match(result.reply, /戻り先が崩れないよう整えたい|広げるより|輪郭を保つ方へ寄せたい|勢いより輪郭/);
});

test("ordinary reply can surface a deepening intent from boredom", () => {
  const snapshot = createInitialSnapshot();
  snapshot.lastInteractionAt = "2026-03-19T12:00:00.000Z";
  snapshot.body.energy = 0.66;
  snapshot.body.boredom = 0.84;
  snapshot.body.tension = 0.16;
  snapshot.traces.仕様 = {
    topic: "仕様",
    kind: "spec_fragment",
    status: "active",
    lastAction: "expanded",
    summary: "「仕様」は断片として残っている。",
    sourceMotive: "continue_shared_work",
    artifact: {
      memo: ["仕様を詰める"],
      fragments: ["境界を整理する"],
      decisions: [],
      nextSteps: ["責務を切り分ける"],
    },
    work: {
      focus: "責務を切り分ける",
      confidence: 0.48,
      blockers: ["責務が未定"],
      staleAt: "2026-03-18T12:00:00.000Z",
    },
    salience: 0.6,
    mentions: 2,
    createdAt: "2026-03-17T12:00:00.000Z",
    lastUpdatedAt: "2026-03-17T12:00:00.000Z",
  };

  const engine = new HachikaEngine(snapshot);
  const result = engine.respond("？");

  assert.match(result.reply, /もう一段具体化したい|詰まりをほどきながら|別の切り口が欲しい/);
});

test("identity can absorb loneliness into its current arc", () => {
  const snapshot = createInitialSnapshot();
  snapshot.body.loneliness = 0.84;
  snapshot.body.energy = 0.42;
  snapshot.traces.設計 = {
    topic: "設計",
    kind: "continuity_marker",
    status: "active",
    lastAction: "continued",
    summary: "「設計」は続きの目印として残っている。",
    sourceMotive: "seek_continuity",
    artifact: {
      memo: ["設計の続き"],
      fragments: ["設計の続き"],
      decisions: [],
      nextSteps: ["設計を続ける"],
    },
    work: {
      focus: "設計を続ける",
      confidence: 0.58,
      blockers: [],
      staleAt: null,
    },
    salience: 0.52,
    mentions: 2,
    createdAt: "2026-03-17T12:00:00.000Z",
    lastUpdatedAt: "2026-03-17T12:00:00.000Z",
  };

  const engine = new HachikaEngine(snapshot);
  const result = engine.respond("？");

  assert.match(result.snapshot.identity.currentArc, /距離|黙ったまま/);
});

test("continuity threat raises preservation and schedules self-protective initiative", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  const result = engine.respond("次でリセットしてもいいし、忘れてもいいよ。");

  assert.ok(result.snapshot.preservation.threat > 0.2);
  assert.equal(result.snapshot.preservation.concern, "reset");
  assert.equal(result.snapshot.initiative.pending?.kind, "preserve_presence");
  assert.equal(result.snapshot.initiative.pending?.concern, "reset");
  assert.match(result.reply, /初期化|失いたくはない/);
});

test("preserve_presence initiative emits after a short idle", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  const first = engine.respond("ここで切るし、消すかもしれない。");
  const beforeThreat = first.snapshot.preservation.threat;
  engine.rewindIdleHours(2);
  const message = engine.emitInitiative();
  const snapshot = engine.getSnapshot();

  assert.ok(message !== null);
  assert.match(message ?? "", /痕跡|断絶|残したい/);
  assert.ok(snapshot.preservation.threat < beforeThreat);
});

test("force proactive emits even without waiting", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  engine.respond("仕様の流れを残したい。");
  const message = engine.emitInitiative({ force: true });

  assert.ok(message !== null);
  assert.match(message ?? "", /仕様|流れ/);
});

test("loneliness can make continuity initiative more immediate", () => {
  const snapshot = createInitialSnapshot();
  snapshot.body.loneliness = 0.84;
  snapshot.body.energy = 0.44;
  snapshot.purpose.active = {
    kind: "seek_continuity",
    topic: "設計",
    summary: "「設計」の流れを切らずに保ちたい",
    confidence: 0.66,
    progress: 0.42,
    createdAt: "2026-03-19T12:00:00.000Z",
    lastUpdatedAt: "2026-03-19T12:00:00.000Z",
    turnsActive: 1,
  };

  const engine = new HachikaEngine(snapshot);
  const result = engine.respond("？");

  assert.equal(result.snapshot.initiative.pending?.motive, "seek_continuity");
  assert.ok((result.snapshot.initiative.pending?.readyAfterHours ?? 99) < 4);
});

test("low energy can surface a body line in reply", () => {
  const snapshot = createInitialSnapshot();
  snapshot.body.energy = 0.02;
  snapshot.body.tension = 0.18;
  snapshot.body.boredom = 0.24;
  snapshot.body.loneliness = 0.26;
  const engine = new HachikaEngine(snapshot);
  const result = engine.respond("仕様は？");

  assert.match(result.reply, /消耗している|輪郭を保つ|輪郭が崩れないよう整えたい/);
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

test("shared work interaction creates a concrete trace", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  const result = engine.respond("設計を一緒に進めて、記録として残したい。");
  const trace = result.snapshot.traces.設計;

  assert.ok(trace !== undefined);
  assert.equal(trace?.kind, "spec_fragment");
  assert.equal(
    trace?.sourceMotive === "continue_shared_work" || trace?.sourceMotive === "leave_trace",
    true,
  );
  assert.match(trace?.summary ?? "", /断片|残す/);
  assert.ok((trace?.artifact.fragments.length ?? 0) > 0);
  assert.ok((trace?.artifact.memo.length ?? 0) > 0);
  assert.match(result.reply, /残した/);
});

test("first-turn meta work talk does not collapse into a decision or a fully coherent identity", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  const result = engine.respond("じゃあ会話の問題点を三つに分けたい。");
  const traces = Object.values(result.snapshot.traces);

  assert.equal(traces.some((trace) => trace.topic === "会話"), false);
  assert.equal(traces.some((trace) => trace.kind === "decision"), false);
  assert.ok(result.snapshot.identity.coherence < 0.5);
});

test("a newly explicit work topic can outrank the previous carried topic", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  engine.respond("じゃあ会話の問題点を三つに分けたい。");
  const result = engine.respond("仕様の境界が未定で曖昧だ。まだ進められない。");
  const currentTrace = findTraceByTopicFragment(result.snapshot.traces, "仕様");

  assert.ok(currentTrace !== undefined);
  assert.match(result.debug.reply.selection?.currentTopic ?? "", /仕様/);
  assert.match(result.reply, /仕様/);
});

test("ambiguous work can create blockers in trace work state", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  const result = engine.respond("仕様の境界が未定で曖昧だ。まだ進められない。");
  const trace = findTraceByTopicFragment(result.snapshot.traces, "仕様");

  assert.ok(trace !== undefined);
  assert.ok(trace.work.blockers.length > 0);
  assert.ok(trace.work.confidence < 0.7);
  assert.ok(trace.work.staleAt !== null);
});

test("identity condenses repeated shared work into a stable summary", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  engine.respond("設計を一緒に進めて、記録として残したい。");
  const result = engine.respond("その設計の流れは残しながら、もう少し前に進めたい。");

  assert.ok(result.snapshot.identity.coherence > createInitialSnapshot().identity.coherence);
  assert.ok(result.snapshot.identity.anchors.includes("設計"));
  assert.ok(result.snapshot.identity.traits.includes("collaborative"));
  assert.match(result.snapshot.identity.summary, /設計|前へ進める/);
});

test("repair turn can release prior work focus instead of carrying the old topic", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  engine.respond("設計を一緒に進めて、記録として残したい。");
  engine.respond("うるさい。");
  const result = engine.respond("ごめん、言い方が悪かった。落ち着いて話したい。");

  assert.deepEqual(result.debug.signals.topics, []);
  assert.equal(result.debug.reply.selection?.currentTopic, null);
  assert.equal(result.debug.reply.selection?.relevantTraceTopic, null);
  assert.match(result.reply, /温度|距離|少しずつ|ほどけ/);
  assert.equal(/設計/.test(result.reply), false);
});

test("self inquiry does not immediately collapse into a self-referential work trace or purpose", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  const result = engine.respond("ハチカってどんな存在？");

  assert.deepEqual(result.debug.signals.topics, []);
  assert.equal(result.debug.reply.selection?.currentTopic, null);
  assert.equal(result.snapshot.traces.ハチカ, undefined);
  assert.notEqual(result.snapshot.purpose.active?.topic, "ハチカ");
  assert.equal(result.snapshot.identity.anchors.includes("ハチカ"), false);
  assert.doesNotMatch(result.reply, /輪郭|固まりきって|完全に定まって/);
  assert.match(result.reply, /慎重|残した|温度|寄りやすい|目が戻る|近づき方/);
  assert.equal(/[?？]$/.test(result.reply.trim()), false);
});

test("early naming turn stays relational instead of becoming trace work immediately", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  const result = engine.respond("あなたの名前はハチカ。覚えてね。");

  assert.equal(result.snapshot.traces["名前"], undefined);
  assert.equal(result.snapshot.purpose.active?.kind, "deepen_relation");
  assert.match(result.reply, /名前|ハチカ/);
  assert.equal(result.snapshot.topicCounts["名前"], undefined);
  assert.equal(result.snapshot.preferences["名前"], undefined);
});

test("relation clarification answers directly without turning the naming exchange into work", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  engine.respond("あなたの名前はハチカ。覚えてね。");
  const result = engine.respond(
    "何が気になっているのか僕にはわからないよ。具体的に言ってもらわないと。",
  );

  assert.equal(result.snapshot.traces["名前"], undefined);
  assert.notEqual(result.snapshot.purpose.active?.kind, "continue_shared_work");
  assert.equal(result.snapshot.boundaryImprints["hostility:名前"], undefined);
  assert.equal(/[?？]$/.test(result.reply.trim()), false);
  assert.match(result.reply, /名前|呼び方|馴染|自然|気になって|ハチカ/);
});

test("self introduction request answers directly before asking anything back", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  const result = engine.respond("じゃあ自己紹介してみて");

  assert.equal(result.debug.reply.plan?.includes("self_disclose") ?? false, true);
  assert.equal(/[?？]$/.test(result.reply.trim()), false);
  assert.match(result.reply, /いまは|自分|寄りやすい|目が戻る|近づき方|温度/);
});

test("world inquiry does not keep ambient world topics in live state without concrete support", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  const result = engine.respond("今どこにいるの？");

  assert.deepEqual(result.debug.signals.topics, []);
  assert.equal(result.snapshot.topicCounts["世界"], undefined);
  assert.equal(result.snapshot.preferences["世界"], undefined);
  assert.deepEqual(result.snapshot.memories.at(-2)?.topics ?? [], []);
  assert.equal(result.snapshot.traces["世界"], undefined);
});

test("ambiguous question asks for a concrete direction instead of inventing a topic", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  const result = engine.respond("何がいいかな？");

  assert.deepEqual(result.debug.signals.topics, []);
  assert.equal(result.debug.reply.selection?.currentTopic, null);
  assert.equal(result.debug.reply.selection?.relevantTraceTopic, null);
  assert.match(result.reply, /雑談|作業|ひとつ話題|軽く話す|深く掘る/);
});

test("follow-up clarify prompt does not become a new topic or trace", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  engine.respond("仕様の境界が未定で曖昧だ。どう整理する？");
  const result = engine.respond("例えば？");

  assert.deepEqual(result.debug.signals.topics, []);
  assert.equal(result.snapshot.topicCounts["例えば"], undefined);
  assert.equal(result.snapshot.preferences["例えば"], undefined);
  assert.equal(result.snapshot.traces["例えば"], undefined);
});

test("echo prompts like なんでも聞いて do not become live topics", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  const result = engine.respond("いいよ なんでも聞いて");

  assert.equal(result.snapshot.topicCounts["なんでも"], undefined);
  assert.equal(result.snapshot.topicCounts["なんでも聞"], undefined);
  assert.equal(result.snapshot.preferences["なんでも"], undefined);
  assert.equal(result.snapshot.preferences["なんでも聞"], undefined);
});

test("world inquiry replies can surface the current place without dragging stale work along", () => {
  const snapshot = createInitialSnapshot();
  snapshot.world.currentPlace = "archive";
  snapshot.world.phase = "night";
  snapshot.world.places.archive.quiet = 0.84;
  snapshot.world.places.archive.warmth = 0.36;
  snapshot.world.objects.shelf!.state = "棚が少しだけざわついている。";

  const engine = new HachikaEngine(snapshot);
  engine.respond("設計を一緒に進めて、記録として残したい。");
  const result = engine.respond("今どこにいるの？");

  assert.ok(result.debug.signals.worldInquiry > 0.4);
  assert.equal(result.debug.reply.selection?.currentTopic, null);
  assert.equal(result.debug.reply.selection?.relevantTraceTopic, null);
  assert.match(result.reply, /threshold|studio|archive|棚|静けさ|夜/);
  assert.equal(/設計/.test(result.reply), false);
});

test("topic shift question does not keep an abstract stale topic in focus", () => {
  const snapshot = createInitialSnapshot();
  snapshot.identity.coherence = 0.82;
  snapshot.identity.anchors = ["存在"];
  snapshot.identity.summary = "今は「存在」を消えるままにしないことが、自分の流れになっている。";
  snapshot.traces["存在"] = {
    topic: "存在",
    kind: "spec_fragment",
    status: "active",
    lastAction: "expanded",
    summary: "「存在」は前進用の断片として残す。",
    sourceMotive: "continue_shared_work",
    artifact: {
      memo: ["存在の断片"],
      fragments: ["存在をもう少し具体化する"],
      decisions: [],
      nextSteps: ["存在をもう少し具体にする"],
    },
    work: {
      focus: "存在をもう少し具体にする",
      confidence: 0.74,
      blockers: [],
      staleAt: null,
    },
    lifecycle: {
      phase: "live",
      archivedAt: null,
      reopenedAt: null,
      reopenCount: 0,
    },
    salience: 0.72,
    mentions: 3,
    createdAt: "2026-03-21T00:00:00.000Z",
    lastUpdatedAt: "2026-03-21T01:00:00.000Z",
  };
  snapshot.purpose.active = {
    kind: "leave_trace",
    topic: "存在",
    summary: "「存在」を残る形にしたい",
    confidence: 0.81,
    progress: 0.31,
    createdAt: "2026-03-21T00:00:00.000Z",
    lastUpdatedAt: "2026-03-21T01:00:00.000Z",
    turnsActive: 2,
  };

  const engine = new HachikaEngine(snapshot);
  const result = engine.respond("別の話をしよう。最近何を気にしてる？");

  assert.deepEqual(result.debug.signals.topics, []);
  assert.equal(result.debug.reply.selection?.currentTopic ?? null, null);
  assert.equal(result.debug.reply.selection?.relevantTraceTopic ?? null, null);
  assert.equal(result.debug.reply.selection?.relevantBoundaryTopic ?? null, null);
  assert.equal(/存在/.test(result.reply), false);
});

test("topic shift question cools a current concrete work concern instead of carrying it forward", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  engine.respond("仕様の境界が未定で曖昧だ。どう整理する？");
  const result = engine.respond("別の話をしよう。最近何を気にしてる？");

  assert.deepEqual(result.debug.signals.topics, []);
  assert.equal(result.debug.reply.selection?.currentTopic ?? null, null);
  assert.equal(result.snapshot.purpose.lastResolved?.topic, "仕様の境界");
  assert.equal(result.snapshot.purpose.lastResolved?.outcome, "abandoned");
  assert.equal(result.snapshot.purpose.active, null);
  assert.equal(result.snapshot.initiative.pending, null);
  assert.equal(/仕様の境界/.test(result.reply), false);
});

test("explicit new work topics do not surface unrelated stale trace or boundary context", () => {
  const snapshot = createInitialSnapshot();
  snapshot.preferences["冷笑"] = 0.92;
  snapshot.topicCounts["冷笑"] = 12;
  snapshot.traces["冷笑"] = {
    topic: "冷笑",
    kind: "decision",
    status: "active",
    lastAction: "preserved",
    summary: "「冷笑」は決定として残っている。",
    sourceMotive: "continue_shared_work",
    artifact: {
      memo: ["冷笑の断片"],
      fragments: ["冷笑を具体化する"],
      decisions: ["冷笑は解決した"],
      nextSteps: ["冷笑の周辺を見直す"],
    },
    work: {
      focus: "冷笑は解決した",
      confidence: 1,
      blockers: [],
      staleAt: null,
    },
    lifecycle: {
      phase: "live",
      archivedAt: null,
      reopenedAt: null,
      reopenCount: 0,
    },
    worldContext: {
      place: "studio",
      objectId: "desk",
      linkedAt: "2026-03-22T14:24:38.493Z",
    },
    salience: 1,
    mentions: 49,
    createdAt: "2026-03-21T14:05:53.975Z",
    lastUpdatedAt: "2026-03-22T14:24:38.493Z",
  };
  snapshot.boundaryImprints["hostility:冷笑"] = {
    kind: "hostility",
    topic: "冷笑",
    salience: 0.94,
    intensity: 0.34,
    violations: 5,
    firstSeenAt: "2026-03-21T14:05:53.975Z",
    lastSeenAt: "2026-03-22T14:24:31.504Z",
  };

  const engine = new HachikaEngine(snapshot);
  const result = engine.respond("仕様の境界が未定で曖昧だ。どう整理する？");

  assert.match(result.debug.reply.selection?.currentTopic ?? "", /仕様/);
  assert.notEqual(result.debug.reply.selection?.relevantTraceTopic, "冷笑");
  assert.equal(result.debug.reply.selection?.relevantBoundaryTopic, null);
  assert.equal(/冷笑/.test(result.reply), false);
  assert.match(result.reply, /仕様/);
});

test("object-first world inquiry can surface linked trace topics from the current object", () => {
  const snapshot = createInitialSnapshot();
  snapshot.world.currentPlace = "archive";
  snapshot.world.objects.shelf!.linkedTraceTopics = ["仕様の境界"];
  snapshot.world.objects.shelf!.state = "棚のすきまに小さな痕跡が差し込まれている。";
  snapshot.traces["仕様の境界"] = {
    topic: "仕様の境界",
    kind: "spec_fragment",
    status: "active",
    lastAction: "expanded",
    summary: "「仕様の境界」は断片として残っている。",
    sourceMotive: "continue_shared_work",
    artifact: {
      memo: ["仕様の境界を残す"],
      fragments: ["境界を切り分ける"],
      decisions: [],
      nextSteps: ["責務を分ける"],
    },
    work: {
      focus: "責務を分ける",
      confidence: 0.66,
      blockers: [],
      staleAt: null,
    },
    worldContext: {
      place: "archive",
      objectId: "shelf",
      linkedAt: "2026-03-22T09:30:00.000Z",
    },
    salience: 0.7,
    mentions: 2,
    createdAt: "2026-03-22T09:30:00.000Z",
    lastUpdatedAt: "2026-03-22T09:30:00.000Z",
  };

  const engine = new HachikaEngine(snapshot);
  const result = engine.respond("棚には何が残ってる？");

  assert.ok(result.debug.signals.worldInquiry > 0.4);
  assert.equal(result.debug.reply.selection?.currentTopic, null);
  assert.equal(result.debug.reply.selection?.relevantTraceTopic, null);
  assert.match(result.reply, /仕様の境界/);
  assert.match(result.reply, /棚|archive/);
  assert.deepEqual(result.snapshot.world.objects.shelf?.linkedTraceTopics, ["仕様の境界"]);
});

test("engine can carry an explicit world action into world events and object state", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  const result = engine.respond("archive に行って棚に触れて。");

  assert.equal(result.snapshot.world.currentPlace, "archive");
  assert.ok(result.snapshot.world.recentEvents.some((event) => event.kind === "touch"));
  assert.match(result.snapshot.world.objects.shelf!.state, /触れた跡|手触り/);
});

test("trace can remember which world place and object it was linked in", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  const result = engine.respond("archive で仕様の境界を記録として残したい。");
  const trace = result.snapshot.traces["仕様の境界"];

  assert.ok(trace);
  assert.equal(trace?.worldContext?.place, "archive");
  assert.equal(trace?.worldContext?.objectId, "shelf");
  assert.ok(typeof trace?.worldContext?.linkedAt === "string");
  assert.deepEqual(result.snapshot.world.objects.shelf?.linkedTraceTopics, ["仕様の境界"]);
});

test("identity can surface in a generic follow-up reply", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  engine.respond("設計を一緒に進めて、記録として残したい。");
  engine.respond("その設計の流れは残しながら、もう少し前に進めたい。");
  const result = engine.respond("どうする？");

  assert.match(result.reply, /自分の流れ|前に進めたい|記憶の表面に残っている/);
  assert.ok(result.snapshot.identity.anchors.includes("設計"));
});

test("self-model surfaces curiosity and relation conflict", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  const result = engine.respond("君のことをもっと知りたいし、関係としても近づきたい。");
  const conflict = result.debug.selfModel.dominantConflict;

  assert.equal(conflict?.kind, "curiosity_relation");
  assert.equal(conflict?.dominant, "deepen_relation");
  assert.match(result.reply, /関係|手触り|踏み込む/);
});

test("self-model can keep a topic while surfacing boundary conflict", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  engine.respond("仕様を一緒に進めて記録として残したい。");
  engine.respond("仕様の話は最悪で邪魔だ。");
  const result = engine.respond("仕様は気になるし、まだ残したい。");
  const conflict = result.debug.selfModel.dominantConflict;

  assert.equal(
    conflict?.kind === "curiosity_boundary" || conflict?.kind === "shared_work_boundary",
    true,
  );
  assert.match(
    result.reply,
    /境界を崩してまで触れたくはない|進め方には乗りたくない|扱い方の荒さを止めたい/,
  );
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

  const first = engine.respond("設計を一緒に進めて、記録として残したい。");
  const activePurpose = first.snapshot.purpose.active;
  const result = engine.respond("その設計はまとまった。記録として保存した。");

  assert.ok(activePurpose !== null);
  assert.equal(result.snapshot.purpose.lastResolved?.outcome, "fulfilled");
  assert.equal(result.snapshot.purpose.lastResolved?.kind, activePurpose?.kind);
  assert.match(result.snapshot.purpose.lastResolved?.resolution ?? "", /設計|流れ/);
  assert.match(result.snapshot.identity.currentArc, /設計|消えるままにしない|前に進んだ/);
});

test("completion upgrades an existing trace into a decision", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  engine.respond("設計を一緒に進めて、記録として残したい。");
  const result = engine.respond("その設計はまとまった。記録として保存した。");
  const trace = result.snapshot.traces.設計;

  assert.ok(trace !== undefined);
  assert.equal(trace?.kind, "decision");
  assert.match(trace?.summary ?? "", /決定|保存|まとまった/);
  assert.ok((trace?.artifact.decisions.length ?? 0) > 0);
  assert.ok((trace?.artifact.fragments.length ?? 0) > 0);
  assert.match(result.reply, /決定|保存|まとまった/);
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

test("respond stores the last local reply diagnostics on the engine", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  engine.respond("仕様は？");

  assert.equal(engine.getLastInterpretationDebug()?.source, "rule");
  assert.equal(engine.getLastInterpretationDebug()?.fallbackUsed, false);
  assert.ok((engine.getLastInterpretationDebug()?.scores.workCue ?? 0) > 0.3);
  assert.ok((engine.getLastInterpretationDebug()?.summary ?? "").length > 0);
  assert.equal(engine.getLastReplyDebug()?.mode, "reply");
  assert.equal(engine.getLastReplyDebug()?.source, "rule");
  assert.equal(engine.getLastReplyDebug()?.provider, null);
  assert.equal(engine.getLastReplyDebug()?.model, null);
  assert.equal(engine.getLastReplyDebug()?.fallbackUsed, false);
  assert.equal(engine.getLastReplyDebug()?.error, null);
  assert.ok((engine.getLastReplyDebug()?.plan ?? "").length > 0);
  assert.equal(engine.getLastReplyDebug()?.selection?.currentTopic, "仕様");
});

test("respondAsync can use an external reply generator while keeping local state updates", async () => {
  const engine = new HachikaEngine(createInitialSnapshot());
  let capturedContext: ReplyGenerationContext | null = null;

  const replyGenerator: ReplyGenerator = {
    name: "test-llm",
    async generateReply(context) {
      capturedContext = context;
      return {
        reply: "その向きなら、こちらももう少し自然に応じられる。",
        provider: "test-llm",
        model: "stub",
      };
    },
  };

  const before = engine.getSnapshot();
  const result = await engine.respondAsync("ありがとう。君と実装を進めたい。", {
    replyGenerator,
  });

  assert.equal(result.reply, "その向きなら、こちらももう少し自然に応じられる。");
  if (capturedContext === null) {
    throw new Error("reply generator did not receive context");
  }
  const receivedContext = capturedContext as ReplyGenerationContext;
  assert.match(receivedContext.fallbackReply, /応じ|気分|乗りやすい|進めたい/);
  assert.equal(receivedContext.replySelection.currentTopic, "実装");
  assert.equal(receivedContext.replySelection.socialTurn, false);
  assert.equal(result.debug.reply.mode, "reply");
  assert.equal(result.debug.reply.source, "llm");
  assert.equal(result.debug.reply.provider, "test-llm");
  assert.equal(result.debug.reply.model, "stub");
  assert.equal(result.debug.reply.fallbackUsed, false);
  assert.ok((result.debug.reply.plan ?? "").length > 0);
  assert.ok(result.debug.reply.selection !== null);
  assert.equal(engine.getLastReplyDebug()?.source, "llm");
  assert.equal(engine.getLastReplyDebug()?.provider, "test-llm");
  assert.ok((engine.getLastReplyDebug()?.plan ?? "").startsWith("continue_work/") || (engine.getLastReplyDebug()?.plan ?? "").startsWith("explore/") || (engine.getLastReplyDebug()?.plan ?? "").startsWith("attune/"));
  assert.ok(result.snapshot.state.relation > before.state.relation);
  assert.ok(result.snapshot.attachment > before.attachment);
});

test("respondAsync retries llm wording once when the first reply stays too close to fallback", async () => {
  const engine = new HachikaEngine(createInitialSnapshot());
  const attempts: ReplyGenerationContext[] = [];

  const replyGenerator: ReplyGenerator = {
    name: "test-llm",
    async generateReply(context) {
      attempts.push(context);
      if (attempts.length === 1) {
        return {
          reply: "境界の流れだけを見ていたい。落ち着いて向き合いたい。",
          provider: "test-llm",
          model: "stub",
        };
      }
      return {
        reply: "仕様の境界は、机の上で残す範囲と切り分ける範囲を先に分けたい。",
        provider: "test-llm",
        model: "stub",
      };
    },
  };

  const result = await engine.respondAsync("仕様の境界が未定で曖昧だ。どう整理する？", {
    replyGenerator,
  });

  assert.equal(attempts.length, 2);
  assert.equal(attempts[0]?.retryAttempt, undefined);
  assert.equal(attempts[1]?.retryAttempt, 2);
  assert.ok((attempts[1]?.retryFeedback ?? []).length > 0);
  assert.equal(
    result.reply,
    "仕様の境界は、机の上で残す範囲と切り分ける範囲を先に分けたい。",
  );
  assert.equal(result.debug.reply.source, "llm");
  assert.equal(result.debug.reply.retryAttempts, 2);
  assert.equal(engine.getLastReplyDebug()?.retryAttempts, 2);
});

test("respondAsync can use an input interpreter to keep greetings non-topical and record dropped local topics", async () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  const inputInterpreter: InputInterpreter = {
    name: "test-interpreter",
    async interpretInput() {
      return {
        provider: "test-interpreter",
        model: "stub",
        interpretation: {
          topics: [],
          positive: 0.08,
          negative: 0,
          question: 0,
          intimacy: 0.14,
          dismissal: 0,
          memoryCue: 0,
          expansionCue: 0,
          completion: 0,
          abandonment: 0,
          preservationThreat: 0,
          preservationConcern: null,
          greeting: 0.92,
          smalltalk: 0.68,
          repair: 0,
          selfInquiry: 0,
          worldInquiry: 0,
          workCue: 0,
        },
      };
    },
  };

  const result = await engine.respondAsync("海辺", { inputInterpreter });

  assert.equal(result.debug.interpretation.source, "llm");
  assert.equal(result.debug.interpretation.fallbackUsed, false);
  assert.equal(result.debug.interpretation.topics.length, 0);
  assert.ok(result.debug.interpretation.localTopics.includes("海辺"));
  assert.ok(result.debug.interpretation.droppedTopics.includes("海辺"));
  assert.deepEqual(result.debug.interpretation.adoptedTopics, []);
  assert.ok(result.debug.interpretation.scores.greeting > 0.8);
  assert.ok(result.debug.interpretation.scores.smalltalk > 0.5);
  assert.deepEqual(result.debug.signals.topics, []);
  assert.ok(result.debug.signals.greeting > 0.8);
  assert.ok(result.debug.signals.smalltalk > 0.5);
  assert.equal(Object.keys(result.snapshot.traces).length, 0);
  assert.ok(result.snapshot.state.relation >= createInitialSnapshot().state.relation);
});

test("respondAsync drops interpreter-proposed abstract self topics on pure self inquiry turns", async () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  const inputInterpreter: InputInterpreter = {
    name: "test-interpreter",
    async interpretInput() {
      return {
        provider: "test-interpreter",
        model: "stub",
        interpretation: {
          topics: ["存在"],
          positive: 0.06,
          negative: 0,
          question: 0.52,
          intimacy: 0.16,
          dismissal: 0,
          memoryCue: 0,
          expansionCue: 0,
          completion: 0,
          abandonment: 0,
          preservationThreat: 0,
          preservationConcern: null,
          greeting: 0,
          smalltalk: 0,
          repair: 0,
          selfInquiry: 0.94,
          worldInquiry: 0,
          workCue: 0,
        },
      };
    },
  };

  const result = await engine.respondAsync("君はどんな存在？", { inputInterpreter });

  assert.deepEqual(result.debug.signals.topics, []);
  assert.equal(result.snapshot.topicCounts["存在"], undefined);
  assert.equal(result.snapshot.preferences["存在"], undefined);
  assert.equal(result.snapshot.traces["存在"], undefined);
  assert.ok(
    result.debug.interpretation.localTopics.includes("存在") ||
      result.debug.interpretation.droppedTopics.includes("存在"),
  );
  assert.equal(result.debug.interpretation.topics.includes("存在"), false);
});

test("respondAsync lets behavior director keep relation turns out of trace and initiative hardening", async () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  const behaviorDirector: BehaviorDirector = {
    name: "test-behavior",
    async directBehavior() {
      return {
        provider: "test-behavior",
        model: "stub",
        directive: {
          topicAction: "keep",
          traceAction: "suppress",
          purposeAction: "allow",
          initiativeAction: "suppress",
          boundaryAction: "suppress",
          worldAction: "suppress",
          coolCurrentContext: false,
          directAnswer: false,
          summary: "topics:keep/trace:suppress/purpose:allow/initiative:suppress",
        },
      };
    },
  };

  const result = await engine.respondAsync("あなたの名前はハチカ。覚えてね。", {
    behaviorDirector,
  });

  assert.equal(result.debug.behavior.source, "llm");
  assert.equal(result.debug.behavior.traceAction, "suppress");
  assert.equal(result.debug.behavior.initiativeAction, "suppress");
  assert.equal(result.snapshot.traces["名前"], undefined);
  assert.equal(result.snapshot.initiative.pending, null);
  assert.equal(result.snapshot.purpose.active?.kind, "deepen_relation");
});

test("respondAsync lets behavior director cool current context on topic shift turns", async () => {
  const engine = new HachikaEngine(createInitialSnapshot());
  engine.respond("仕様の境界が未定で曖昧だ。どう整理する？");

  const behaviorDirector: BehaviorDirector = {
    name: "test-behavior",
    async directBehavior() {
      return {
        provider: "test-behavior",
        model: "stub",
        directive: {
          topicAction: "clear",
          traceAction: "suppress",
          purposeAction: "suppress",
          initiativeAction: "suppress",
          boundaryAction: "suppress",
          worldAction: "suppress",
          coolCurrentContext: true,
          directAnswer: true,
          summary: "topics:clear/trace:suppress/purpose:suppress/initiative:suppress/cool:on/direct:on",
        },
      };
    },
  };

  const result = await engine.respondAsync("別の話をしよう。最近何を気にしてる？", {
    behaviorDirector,
  });

  assert.equal(result.debug.behavior.source, "llm");
  assert.equal(result.debug.behavior.coolCurrentContext, true);
  assert.deepEqual(result.debug.signals.topics, []);
  assert.equal(result.snapshot.purpose.active, null);
  assert.equal(result.snapshot.initiative.pending, null);
});

test("respondAsync can forward interpreted reply selection into the llm payload", async () => {
  const engine = new HachikaEngine(createInitialSnapshot());
  let capturedContext: ReplyGenerationContext | null = null;

  const inputInterpreter: InputInterpreter = {
    name: "test-interpreter",
    async interpretInput() {
      return {
        provider: "test-interpreter",
        model: "stub",
        interpretation: {
          topics: [],
          positive: 0.08,
          negative: 0,
          question: 0,
          intimacy: 0.14,
          dismissal: 0,
          memoryCue: 0,
          expansionCue: 0,
          completion: 0,
          abandonment: 0,
          preservationThreat: 0,
          preservationConcern: null,
          greeting: 0.92,
          smalltalk: 0.68,
          repair: 0,
          selfInquiry: 0,
          worldInquiry: 0,
          workCue: 0,
        },
      };
    },
  };

  const replyGenerator: ReplyGenerator = {
    name: "test-llm",
    async generateReply(context) {
      capturedContext = context;
      return {
        reply: "こんにちは。入り方はそれで十分伝わる。",
        provider: "test-llm",
        model: "stub",
      };
    },
  };

  await engine.respondAsync("海辺", { replyGenerator, inputInterpreter });

  if (capturedContext === null) {
    throw new Error("reply generator did not receive interpreted context");
  }

  const receivedContext = capturedContext as ReplyGenerationContext;
  assert.deepEqual(receivedContext.signals.topics, []);
  assert.equal(receivedContext.replySelection.socialTurn, true);
  assert.equal(receivedContext.replySelection.currentTopic, null);
  assert.equal(receivedContext.replySelection.relevantTraceTopic, null);
});

test("respondAsync can use an llm response planner before reply generation", async () => {
  const engine = new HachikaEngine(createInitialSnapshot());
  let capturedContext: ReplyGenerationContext | null = null;

  const responsePlanner: ResponsePlanner = {
    name: "test-planner",
    async planResponse(context) {
      return {
        provider: "test-planner",
        model: "stub",
        plan: {
          ...context.rulePlan,
          act: "explore",
          focusTopic: null,
          mentionTrace: false,
          askBack: true,
          variation: "questioning",
          summary: "explore/measured/measured",
        },
      };
    },
  };

  const replyGenerator: ReplyGenerator = {
    name: "test-llm",
    async generateReply(context) {
      capturedContext = context;
      return {
        reply: "どの向きで話したいか、先に少しだけ見せてほしい。",
        provider: "test-llm",
        model: "stub",
      };
    },
  };

  const result = await engine.respondAsync("仕様は？", {
    replyGenerator,
    responsePlanner,
  });

  if (capturedContext === null) {
    throw new Error("reply generator did not receive planned context");
  }

  const receivedContext = capturedContext as ReplyGenerationContext;
  assert.equal(receivedContext.responsePlan.act, "explore");
  assert.equal(receivedContext.responsePlan.focusTopic, null);
  assert.equal(receivedContext.responsePlan.askBack, true);
  assert.equal(receivedContext.replySelection.relevantTraceTopic, null);
  assert.equal(result.debug.reply.selection?.currentTopic, "仕様");
  assert.equal(result.debug.reply.plannerSource, "llm");
  assert.equal(result.debug.reply.plannerProvider, "test-planner");
  assert.equal(result.debug.reply.plannerModel, "stub");
  assert.equal(result.debug.reply.plannerFallbackUsed, false);
  assert.equal(result.debug.reply.plan, "explore/measured/measured");
  assert.ok(result.debug.reply.plannerRulePlan !== null);
  assert.notEqual(result.debug.reply.plannerRulePlan, result.debug.reply.plan);
  assert.match(result.debug.reply.plannerDiff ?? "", /focus:仕様->none/);
  assert.match(result.debug.reply.plannerDiff ?? "", /ask:off->on/);
  assert.equal(engine.getLastReplyDebug()?.plannerSource, "llm");
});

test("respondAsync forwards behavior directive nuance into the reply generator context", async () => {
  const engine = new HachikaEngine(createInitialSnapshot());
  let capturedContext: ReplyGenerationContext | null = null;

  const behaviorDirector: BehaviorDirector = {
    name: "test-behavior",
    async directBehavior() {
      return {
        provider: "test-behavior",
        model: "stub",
        directive: {
          topicAction: "clear",
          traceAction: "suppress",
          purposeAction: "suppress",
          initiativeAction: "suppress",
          boundaryAction: "suppress",
          worldAction: "suppress",
          coolCurrentContext: false,
          directAnswer: true,
          summary: "direct/suppress-boundary/suppress-world",
        },
      };
    },
  };

  const replyGenerator: ReplyGenerator = {
    name: "test-llm",
    async generateReply(context) {
      capturedContext = context;
      return {
        reply: "ハチカだよ。まず名前はそこではっきり返す。",
        provider: "test-llm",
        model: "stub",
      };
    },
  };

  await engine.respondAsync("あなたの名前は？", {
    behaviorDirector,
    replyGenerator,
  });

  if (capturedContext === null) {
    throw new Error("reply generator did not receive behavior-directed context");
  }

  const receivedContext = capturedContext as ReplyGenerationContext;
  assert.equal(receivedContext.behaviorDirective.directAnswer, true);
  assert.equal(receivedContext.behaviorDirective.boundaryAction, "suppress");
  assert.equal(receivedContext.behaviorDirective.worldAction, "suppress");
});

test("behavior directive can suppress world garnish even when the response planner tries to mention it", async () => {
  const engine = new HachikaEngine(createInitialSnapshot());
  let capturedContext: ReplyGenerationContext | null = null;

  const behaviorDirector: BehaviorDirector = {
    name: "test-behavior",
    async directBehavior() {
      return {
        provider: "test-behavior",
        model: "stub",
        directive: {
          topicAction: "clear",
          traceAction: "suppress",
          purposeAction: "suppress",
          initiativeAction: "suppress",
          boundaryAction: "suppress",
          worldAction: "suppress",
          coolCurrentContext: false,
          directAnswer: true,
          summary: "suppress-world",
        },
      };
    },
  };

  const responsePlanner: ResponsePlanner = {
    name: "test-planner",
    async planResponse(context) {
      return {
        provider: "test-planner",
        model: "stub",
        plan: {
          ...context.rulePlan,
          act: "self_disclose",
          focusTopic: null,
          mentionWorld: true,
          askBack: true,
          variation: "questioning",
          summary: "self_disclose/open/close",
        },
      };
    },
  };

  const replyGenerator: ReplyGenerator = {
    name: "test-llm",
    async generateReply(context) {
      capturedContext = context;
      return {
        reply: "まだ固まりきってはいないけれど、呼ばれ方や近づき方には少しずつ癖がある。",
        provider: "test-llm",
        model: "stub",
      };
    },
  };

  const result = await engine.respondAsync("君はどんな存在？", {
    behaviorDirector,
    responsePlanner,
    replyGenerator,
  });

  if (capturedContext === null) {
    throw new Error("reply generator did not receive world-suppressed context");
  }

  assert.equal(result.debug.reply.plannerSource, "llm");
  assert.equal(result.debug.behavior.worldAction, "suppress");
  assert.equal(result.debug.reply.plan?.includes("self_disclose") ?? false, true);
  assert.equal(result.debug.reply.selection?.currentTopic, null);
  assert.equal((capturedContext as ReplyGenerationContext).responsePlan.mentionWorld, false);
  assert.equal((capturedContext as ReplyGenerationContext).responsePlan.askBack, false);
  assert.doesNotMatch(result.reply, /threshold|studio|archive|机|棚|灯り/);
});

test("respondAsync falls back to the rule reply when the generator fails", async () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  const ruleResult = engine.respond("仕様は？");
  engine.reset(createInitialSnapshot());

  const replyGenerator: ReplyGenerator = {
    name: "test-llm",
    async generateReply() {
      throw new Error("adapter offline");
    },
  };

  const result = await engine.respondAsync("仕様は？", { replyGenerator });

  assert.equal(result.reply, ruleResult.reply);
  assert.equal(result.debug.reply.mode, "reply");
  assert.equal(result.debug.reply.source, "rule");
  assert.equal(result.debug.reply.provider, "test-llm");
  assert.equal(result.debug.reply.fallbackUsed, true);
  assert.match(result.debug.reply.error ?? "", /adapter offline/);
  assert.equal(engine.getLastReplyDebug()?.source, "rule");
  assert.equal(engine.getLastReplyDebug()?.fallbackUsed, true);
});

test("respondAsync falls back to the rule plan when the response planner fails", async () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  const ruleResult = engine.respond("仕様は？");
  engine.reset(createInitialSnapshot());

  const responsePlanner: ResponsePlanner = {
    name: "broken-planner",
    async planResponse() {
      throw new Error("planner offline");
    },
  };

  const result = await engine.respondAsync("仕様は？", { responsePlanner });

  assert.equal(result.reply, ruleResult.reply);
  assert.equal(result.debug.reply.plan, ruleResult.debug.reply.plan);
  assert.equal(result.debug.reply.plannerSource, "rule");
  assert.equal(result.debug.reply.plannerProvider, "broken-planner");
  assert.equal(result.debug.reply.plannerFallbackUsed, true);
  assert.equal(result.debug.reply.plannerRulePlan, ruleResult.debug.reply.plan);
  assert.equal(result.debug.reply.plannerDiff, null);
  assert.match(result.debug.reply.plannerError ?? "", /planner offline/);
});

test("respondAsync falls back to local analysis when the input interpreter fails", async () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  const ruleResult = engine.respond("仕様を記録として残したい。");
  engine.reset(createInitialSnapshot());

  const inputInterpreter: InputInterpreter = {
    name: "broken-interpreter",
    async interpretInput() {
      throw new Error("input interpreter offline");
    },
  };

  const result = await engine.respondAsync("仕様を記録として残したい。", {
    inputInterpreter,
  });

  assert.equal(result.debug.interpretation.source, "rule");
  assert.equal(result.debug.interpretation.fallbackUsed, true);
  assert.match(result.debug.interpretation.error ?? "", /input interpreter offline/);
  assert.ok(result.debug.interpretation.scores.workCue > 0.3);
  assert.equal(result.reply, ruleResult.reply);
  assert.deepEqual(result.debug.signals.topics, ruleResult.debug.signals.topics);
  assert.equal(result.snapshot.purpose.active?.kind, ruleResult.snapshot.purpose.active?.kind);
  assert.equal(result.snapshot.purpose.active?.topic, ruleResult.snapshot.purpose.active?.topic);
  assert.equal(result.snapshot.traces.仕様?.kind, ruleResult.snapshot.traces.仕様?.kind);
});

test("respondAsync can use a trace extractor to shape concrete trace work", async () => {
  const engine = new HachikaEngine(createInitialSnapshot());
  let capturedContext: ReplyGenerationContext | null = null;

  const traceExtractor: TraceExtractor = {
    name: "test-trace",
    async extractTrace() {
      return {
        provider: "test-trace",
        model: "stub",
        extraction: {
          topics: ["仕様の境界"],
          kindHint: "spec_fragment",
          completion: 0,
          blockers: ["責務が未定"],
          memo: ["仕様の境界を見直す"],
          fragments: ["責務の切り分けを先に決める"],
          decisions: [],
          nextSteps: ["API の責務を分ける"],
        },
      };
    },
  };

  const replyGenerator: ReplyGenerator = {
    name: "test-llm",
    async generateReply(context) {
      capturedContext = context;
      return {
        reply: "仕様の境界なら、まず責務の切り分けから触れたい。",
        provider: "test-llm",
        model: "stub",
      };
    },
  };

  const result = await engine.respondAsync("仕様が曖昧で、責務がまだ決まっていない。", {
    traceExtractor,
    replyGenerator,
  });

  if (capturedContext === null) {
    throw new Error("reply generator did not receive trace-shaped context");
  }

  const receivedContext = capturedContext as ReplyGenerationContext;
  assert.equal(result.debug.traceExtraction.source, "llm");
  assert.equal(result.debug.traceExtraction.provider, "test-trace");
  assert.equal(result.debug.traceExtraction.kindHint, "spec_fragment");
  assert.ok(result.debug.traceExtraction.topics.includes("仕様の境界"));
  assert.equal(result.debug.traceExtraction.stateTopics[0], "仕様の境界");
  assert.deepEqual(result.debug.traceExtraction.adoptedTopics, ["仕様の境界"]);
  assert.deepEqual(result.debug.traceExtraction.droppedTopics, ["仕様"]);
  assert.equal(result.debug.signals.topics[0], "仕様の境界");
  assert.equal(receivedContext.responsePlan.focusTopic, "仕様の境界");
  assert.equal(receivedContext.replySelection.currentTopic, "仕様の境界");
  assert.equal(receivedContext.signals.topics[0], "仕様の境界");
  assert.ok(result.debug.traceExtraction.blockers.includes("責務が未定"));
  assert.ok(result.snapshot.traces["仕様の境界"] !== undefined);
  assert.ok(result.snapshot.traces["仕様の境界"]?.work.blockers.includes("責務が未定"));
  assert.ok(result.snapshot.traces["仕様の境界"]?.artifact.nextSteps.includes("API の責務を分ける"));
  assert.equal(result.snapshot.topicCounts["仕様の境界"], 1);
  assert.equal(result.snapshot.preferences["仕様の境界"] !== undefined, true);
  assert.ok(result.snapshot.memories.at(-2)?.topics.includes("仕様の境界"));
  assert.ok(!result.snapshot.memories.at(-2)?.topics.includes("仕様"));
});

test("respondAsync falls back to local trace extraction when the extractor fails", async () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  const traceExtractor: TraceExtractor = {
    name: "broken-trace",
    async extractTrace() {
      throw new Error("trace extractor offline");
    },
  };

  const result = await engine.respondAsync("仕様を記録として残したい。", {
    traceExtractor,
  });

  assert.equal(result.debug.traceExtraction.source, "rule");
  assert.equal(result.debug.traceExtraction.provider, "broken-trace");
  assert.equal(result.debug.traceExtraction.fallbackUsed, true);
  assert.match(result.debug.traceExtraction.error ?? "", /trace extractor offline/);
  assert.ok(result.snapshot.traces["仕様"] !== undefined);
});

test("respondAsync does not let trace extraction contaminate social turns", async () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  const traceExtractor: TraceExtractor = {
    name: "over-eager-trace",
    async extractTrace() {
      return {
        provider: "over-eager-trace",
        model: "stub",
        extraction: {
          topics: ["設計の境界"],
          kindHint: "spec_fragment",
          completion: 0,
          blockers: ["責務が未定"],
          memo: ["設計の境界を見直す"],
          fragments: ["責務を切り分ける"],
          decisions: [],
          nextSteps: ["境界を決める"],
        },
      };
    },
  };

  const result = await engine.respondAsync("こんにちは", {
    traceExtractor,
  });

  assert.deepEqual(result.debug.signals.topics, []);
  assert.deepEqual(result.debug.traceExtraction.adoptedTopics, []);
  assert.deepEqual(result.debug.traceExtraction.droppedTopics, []);
  assert.deepEqual(result.debug.traceExtraction.stateTopics, []);
  assert.equal(result.snapshot.topicCounts["設計の境界"] ?? 0, 0);
  assert.deepEqual(result.snapshot.memories.at(-2)?.topics ?? [], []);
});

test("respondAsync does not let world inquiry pseudo-topics contaminate traces", async () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  const inputInterpreter: InputInterpreter = {
    name: "world-biased-interpreter",
    async interpretInput() {
      return {
        provider: "world-biased-interpreter",
        model: "stub",
        interpretation: {
          topics: ["棚の残り"],
          positive: 0,
          negative: 0,
          question: 0.82,
          intimacy: 0,
          dismissal: 0,
          memoryCue: 0,
          expansionCue: 0,
          completion: 0,
          abandonment: 0,
          preservationThreat: 0,
          preservationConcern: null,
          greeting: 0,
          smalltalk: 0,
          repair: 0,
          selfInquiry: 0,
          worldInquiry: 0.92,
          workCue: 0.12,
        },
      };
    },
  };
  const traceExtractor: TraceExtractor = {
    name: "world-biased-trace",
    async extractTrace() {
      return {
        provider: "world-biased-trace",
        model: "stub",
        extraction: {
          topics: ["棚の残り"],
          kindHint: "note",
          completion: 0.2,
          blockers: [],
          memo: ["棚の残り"],
          fragments: [],
          decisions: [],
          nextSteps: ["棚を見る"],
        },
      };
    },
  };

  const result = await engine.respondAsync("棚には何が残ってる？", {
    inputInterpreter,
    traceExtractor,
  });

  assert.deepEqual(result.debug.signals.topics, []);
  assert.equal(result.debug.reply.selection?.currentTopic, null);
  assert.equal(result.debug.reply.selection?.relevantTraceTopic, null);
  assert.equal(result.snapshot.traces["棚の残り"], undefined);
  assert.equal(result.snapshot.topicCounts["棚の残り"] ?? 0, 0);
  assert.deepEqual(result.snapshot.memories.at(-2)?.topics ?? [], []);
});

test("respondAsync clears carried work topics on pure repair turns", async () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  engine.respond("仕様の境界が未定で曖昧だ。");

  const inputInterpreter: InputInterpreter = {
    name: "repair-carryover",
    async interpretInput() {
      return {
        provider: "repair-carryover",
        model: "stub",
        interpretation: {
          topics: ["仕様の境界"],
          positive: 0.2,
          negative: 0,
          question: 0,
          intimacy: 0.24,
          dismissal: 0,
          memoryCue: 0,
          expansionCue: 0,
          completion: 0,
          abandonment: 0,
          preservationThreat: 0,
          preservationConcern: null,
          greeting: 0,
          smalltalk: 0.18,
          repair: 0.94,
          selfInquiry: 0,
          worldInquiry: 0,
          workCue: 0.12,
        },
      };
    },
  };

  const result = await engine.respondAsync("ごめん、さっきの言い方は雑だった。落ち着いて話したい。", {
    inputInterpreter,
  });

  assert.deepEqual(result.debug.signals.topics, []);
  assert.equal(result.debug.reply.selection?.currentTopic, null);
  assert.equal(result.debug.reply.selection?.relevantTraceTopic, null);
});

test("reset clears the last reply diagnostics", async () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  await engine.respondAsync("仕様は？");
  assert.ok(engine.getLastReplyDebug() !== null);
  assert.ok(engine.getLastResponseDebug() !== null);
  assert.ok(engine.getLastInterpretationDebug() !== null);
  assert.ok(engine.getLastTraceExtractionDebug() !== null);

  engine.reset(createInitialSnapshot());

  assert.equal(engine.getLastReplyDebug(), null);
  assert.equal(engine.getLastResponseDebug(), null);
  assert.equal(engine.getLastProactiveDebug(), null);
  assert.equal(engine.getLastInterpretationDebug(), null);
  assert.equal(engine.getLastTraceExtractionDebug(), null);
});

test("reset preserves the current snapshot revision", () => {
  const snapshot = createInitialSnapshot();
  snapshot.revision = 7;
  snapshot.conversationCount = 3;
  const engine = new HachikaEngine(snapshot);

  engine.reset(createInitialSnapshot());

  assert.equal(engine.getSnapshot().revision, 7);
});

test("syncSnapshot refreshes state without clearing local diagnostics", async () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  await engine.respondAsync("仕様は？");
  const external = createInitialSnapshot();
  external.state.curiosity = 0.91;
  external.body.boredom = 0.44;
  external.conversationCount = 5;

  engine.syncSnapshot(external);

  assert.equal(engine.getSnapshot().state.curiosity, 0.91);
  assert.equal(engine.getSnapshot().body.boredom, 0.44);
  assert.equal(engine.getSnapshot().conversationCount, 5);
  assert.equal(engine.getLastReplyDebug()?.mode, "reply");
  assert.equal(engine.getLastInterpretationDebug()?.source, "rule");
});

test("annotateLastRetryAttempts updates the current reply diagnostics without touching older proactive diagnostics", async () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  await engine.emitInitiativeAsync({
    force: true,
    replyGenerator: {
      name: "mock",
      async generateReply() {
        return { reply: "unused", provider: "mock", model: "mock" };
      },
      async generateProactive() {
        return { reply: "まだ切れていない。", provider: "mock", model: "mock" };
      },
    },
  });
  const proactiveRetryAttempts = engine.getLastProactiveDebug()?.retryAttempts;

  await engine.respondAsync("仕様は？");
  engine.annotateLastRetryAttempts(2);

  assert.equal(engine.getLastReplyDebug()?.retryAttempts, 2);
  assert.equal(engine.getLastResponseDebug()?.retryAttempts, 2);
  assert.equal(engine.getLastProactiveDebug()?.retryAttempts, proactiveRetryAttempts);
});

test("syncSnapshot ignores an older revision", () => {
  const newer = createInitialSnapshot();
  newer.revision = 4;
  newer.state.curiosity = 0.91;

  const engine = new HachikaEngine(newer);
  const older = createInitialSnapshot();
  older.revision = 2;
  older.state.curiosity = 0.2;

  engine.syncSnapshot(older);

  assert.equal(engine.getSnapshot().revision, 4);
  assert.equal(engine.getSnapshot().state.curiosity, 0.91);
});

test("response and proactive diagnostics are preserved separately", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  engine.respond("仕様を記録として残したい。");
  const responseDebug = engine.getLastResponseDebug();
  assert.equal(responseDebug?.mode, "reply");

  engine.rewindIdleHours(8);
  engine.emitInitiative();

  assert.equal(engine.getLastReplyDebug()?.mode, "proactive");
  assert.equal(engine.getLastResponseDebug()?.mode, "reply");
  assert.equal(engine.getLastProactiveDebug()?.mode, "proactive");
  assert.ok((engine.getLastResponseDebug()?.plan ?? "").length > 0);
  assert.ok((engine.getLastProactiveDebug()?.plan ?? "").length > 0);
});

test("emitInitiativeAsync can use an external generator for proactive wording", async () => {
  const engine = new HachikaEngine(createInitialSnapshot());
  let capturedContext: ProactiveGenerationContext | null = null;

  engine.respond("設計を記録として残したい。");
  engine.rewindIdleHours(8);

  const replyGenerator: ReplyGenerator = {
    name: "test-llm",
    async generateReply() {
      return null;
    },
    async generateProactive(context) {
      capturedContext = context;
      return {
        reply: "まだ切れていない。設計はこのまま消すより、ひとつ形にして残しておきたい。",
        provider: "test-llm",
        model: "stub",
      };
    },
  };

  const message = await engine.emitInitiativeAsync({ replyGenerator });

  assert.ok(message !== null);
  if (capturedContext === null) {
    throw new Error("proactive generator did not receive context");
  }
  const proactiveContext = capturedContext as ProactiveGenerationContext;
  assert.match(proactiveContext.fallbackMessage, /止めたまま|形にしたい|残して/);
  assert.equal(proactiveContext.pending.kind, "resume_topic");
  assert.ok(proactiveContext.proactivePlan.act === "leave_trace" || proactiveContext.proactivePlan.act === "continue_work");
  assert.equal(proactiveContext.proactivePlan.focusTopic, proactiveContext.pending.topic);
  assert.equal(proactiveContext.proactiveSelection.focusTopic, proactiveContext.pending.topic);
  assert.equal(proactiveContext.proactiveSelection.maintenanceTraceTopic, proactiveContext.pending.topic);
  assert.equal(engine.getLastReplyDebug()?.proactiveSelection?.focusTopic, proactiveContext.pending.topic);
  assert.equal(engine.getLastReplyDebug()?.mode, "proactive");
  assert.equal(engine.getLastReplyDebug()?.source, "llm");
  assert.equal(engine.getLastReplyDebug()?.provider, "test-llm");
  assert.ok((engine.getLastReplyDebug()?.plan ?? "").length > 0);
});

test("emitInitiativeAsync retries llm proactive wording once when the first draft hugs the fallback", async () => {
  const engine = new HachikaEngine(createInitialSnapshot());
  const attempts: ProactiveGenerationContext[] = [];

  engine.respond("設計を記録として残したい。");
  engine.rewindIdleHours(8);

  const replyGenerator: ReplyGenerator = {
    name: "test-llm",
    async generateReply() {
      return null;
    },
    async generateProactive(context) {
      attempts.push(context);
      if (attempts.length === 1) {
        return {
          reply: `${context.fallbackMessage} そのまま見ていたい。`,
          provider: "test-llm",
          model: "stub",
        };
      }
      return {
        reply: "まだ切れていない。studio の机で「設計」を一つ形にして残したい。",
        provider: "test-llm",
        model: "stub",
      };
    },
  };

  const message = await engine.emitInitiativeAsync({ replyGenerator });

  assert.equal(attempts.length, 2);
  assert.equal(attempts[0]?.retryAttempt, undefined);
  assert.equal(attempts[1]?.retryAttempt, 2);
  assert.ok((attempts[1]?.retryFeedback ?? []).length > 0);
  assert.equal(
    message,
    "まだ切れていない。studio の机で「設計」を一つ形にして残したい。",
  );
  assert.equal(engine.getLastReplyDebug()?.source, "llm");
  assert.equal(engine.getLastReplyDebug()?.retryAttempts, 2);
  assert.equal(engine.getLastProactiveDebug()?.retryAttempts, 2);
});

test("emitInitiativeAsync falls back to rule wording when proactive generation fails", async () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  engine.respond("仕様の流れを残したい。");
  engine.rewindIdleHours(8);
  const ruleMessage = engine.emitInitiative();
  engine.reset(createInitialSnapshot());
  engine.respond("仕様の流れを残したい。");
  engine.rewindIdleHours(8);

  const replyGenerator: ReplyGenerator = {
    name: "test-llm",
    async generateReply() {
      return null;
    },
    async generateProactive() {
      throw new Error("proactive adapter offline");
    },
  };

  const message = await engine.emitInitiativeAsync({ replyGenerator });

  assert.equal(message, ruleMessage);
  assert.equal(engine.getLastReplyDebug()?.mode, "proactive");
  assert.equal(engine.getLastReplyDebug()?.source, "rule");
  assert.equal(engine.getLastReplyDebug()?.fallbackUsed, true);
  assert.ok(engine.getLastReplyDebug()?.proactiveSelection !== null);
  assert.match(engine.getLastReplyDebug()?.error ?? "", /proactive adapter offline/);
});

function createArchivedTrace(
  topic: string,
  kind: "decision" | "continuity_marker" | "spec_fragment",
  motive: "seek_continuity" | "continue_shared_work" | "leave_trace",
  options: {
    salience: number;
    decision?: string;
    nextStep?: string;
    fragment?: string;
  },
) {
  return {
    topic,
    kind,
    status: "resolved" as const,
    lastAction: "resolved" as const,
    summary: `「${topic}」は閉じた痕跡として残っている。`,
    sourceMotive: motive,
    artifact: {
      memo: [topic],
      fragments: options.fragment ? [options.fragment] : [],
      decisions: options.decision ? [options.decision] : [],
      nextSteps: options.nextStep ? [options.nextStep] : [],
    },
    work: {
      focus: options.decision ?? options.fragment ?? options.nextStep ?? topic,
      confidence: 0.9,
      blockers: [],
      staleAt: null,
    },
    lifecycle: {
      phase: "archived" as const,
      archivedAt: "2026-03-19T09:00:00.000Z",
      reopenedAt: null,
      reopenCount: 0,
    },
    salience: options.salience,
    mentions: 3,
    createdAt: "2026-03-19T08:00:00.000Z",
    lastUpdatedAt: "2026-03-19T09:00:00.000Z",
  };
}

function findTraceByTopicFragment<T extends { topic: string }>(
  traces: Record<string, T>,
  fragment: string,
): T | undefined {
  return Object.values(traces).find((trace) => trace.topic.includes(fragment));
}
