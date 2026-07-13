import assert from "node:assert/strict";
import test from "node:test";

import { buildSelfModel } from "./self-model.js";
import { createInitialSnapshot } from "./state.js";
import {
  emitInitiative,
  prepareIdleAutonomyAction,
  prepareInitiativeEmission,
  prepareScheduledInitiative,
  rewindSnapshotBaseHours,
} from "./initiative.js";

test("idle releases stress more slowly while mistrust lingers", () => {
  const wounded = createInitialSnapshot();
  wounded.reactivity.stressLoad = 0.6;
  wounded.reactivity.mistrust = 0.72;
  const calm = createInitialSnapshot();
  calm.reactivity.stressLoad = 0.6;
  calm.reactivity.mistrust = 0.05;

  rewindSnapshotBaseHours(wounded, 8);
  rewindSnapshotBaseHours(calm, 8);

  assert.ok(wounded.reactivity.stressLoad > calm.reactivity.stressLoad);
  assert.ok(wounded.dynamics.continuityPressure > calm.dynamics.continuityPressure);
  assert.ok(wounded.dynamics.trust < calm.dynamics.trust);
  // mistrust は idle でも一気には抜けない
  assert.ok(wounded.reactivity.mistrust > 0.5);
});

test("prepareScheduledInitiative suppresses weak pending when discourse still needs a direct referent answer", () => {
  const snapshot = createInitialSnapshot();
  snapshot.discourse.openQuestions.push({
    target: "hachika_name",
    text: "あなたの名前は？",
    askedAt: "2026-04-01T00:00:00.000Z",
    status: "open",
    resolvedAt: null,
  });

  const decision = prepareScheduledInitiative(
    snapshot,
    {
      positive: 0,
      negative: 0,
      question: 0.4,
      novelty: 0.1,
      intimacy: 0.08,
      dismissal: 0,
      memoryCue: 0.12,
      expansionCue: 0.08,
      completion: 0,
      abandonment: 0,
      preservationThreat: 0,
      preservationConcern: null,
      repetition: 0,
      neglect: 0,
      greeting: 0,
      smalltalk: 0.2,
      repair: 0,
      selfInquiry: 0,
      worldInquiry: 0,
      workCue: 0.06,
      topics: ["名前"],
    },
    buildSelfModel(snapshot),
    "2026-04-01T00:00:00.000Z",
  );

  assert.equal(decision.shouldClear, true);
  assert.equal(decision.candidate, null);
  assert.ok(decision.attentionReasons?.includes("direct_referent"));
});

test("prepareScheduledInitiative still allows explicit work while a direct referent answer remains open", () => {
  const snapshot = createInitialSnapshot();
  snapshot.discourse.openQuestions.push({
    target: "hachika_name",
    text: "あなたの名前は？",
    askedAt: "2026-04-01T00:00:00.000Z",
    status: "open",
    resolvedAt: null,
  });

  const decision = prepareScheduledInitiative(
    snapshot,
    {
      positive: 0,
      negative: 0,
      question: 0,
      novelty: 0.12,
      intimacy: 0.02,
      dismissal: 0,
      memoryCue: 0.28,
      expansionCue: 0.34,
      completion: 0,
      abandonment: 0,
      preservationThreat: 0,
      preservationConcern: null,
      repetition: 0,
      neglect: 0,
      greeting: 0,
      smalltalk: 0,
      repair: 0,
      selfInquiry: 0,
      worldInquiry: 0,
      workCue: 0.72,
      topics: ["仕様"],
    },
    buildSelfModel(snapshot),
    "2026-04-01T00:00:00.000Z",
  );

  assert.equal(decision.shouldClear, true);
  assert.equal(decision.candidate?.topic, "仕様");
  assert.equal(decision.candidate?.stateTopic, "仕様");
});

test("prepareScheduledInitiative can derive a work topic from recent discourse claims", () => {
  const snapshot = createInitialSnapshot();
  snapshot.discourse.recentClaims.push({
    subject: "user",
    kind: "work",
    text: "仕様の境界が曖昧だ。",
    updatedAt: "2026-04-01T00:00:00.000Z",
  });

  const decision = prepareScheduledInitiative(
    snapshot,
    {
      positive: 0,
      negative: 0,
      question: 0,
      novelty: 0.08,
      intimacy: 0.02,
      dismissal: 0,
      memoryCue: 0.12,
      expansionCue: 0.14,
      completion: 0,
      abandonment: 0,
      preservationThreat: 0,
      preservationConcern: null,
      repetition: 0,
      neglect: 0,
      greeting: 0,
      smalltalk: 0,
      repair: 0,
      selfInquiry: 0,
      worldInquiry: 0,
      workCue: 0.42,
      topics: [],
    },
    {
      narrative: "",
      topMotives: [
        { kind: "pursue_curiosity", score: 0.74, topic: null, reason: "まだ未決着がある" },
        { kind: "continue_shared_work", score: 0.66, topic: null, reason: "作業を前へ進めたい" },
      ],
      conflicts: [],
      dominantConflict: null,
    },
    "2026-04-01T00:00:00.000Z",
  );

  assert.equal(decision.candidate?.motive, "continue_shared_work");
  assert.equal(decision.candidate?.reason, "work_claim");
  assert.equal(decision.candidate?.topic, "仕様の境界");
});

test("prepareScheduledInitiative can keep a relation motive tied to recent discourse claims", () => {
  const snapshot = createInitialSnapshot();
  snapshot.discourse.recentClaims.push({
    subject: "user",
    kind: "relation",
    text: "もう少し落ち着いて話したい。",
    updatedAt: "2026-04-01T00:00:00.000Z",
  });

  const decision = prepareScheduledInitiative(
    snapshot,
    {
      positive: 0.06,
      negative: 0,
      question: 0,
      novelty: 0.08,
      intimacy: 0.12,
      dismissal: 0,
      memoryCue: 0.02,
      expansionCue: 0.04,
      completion: 0,
      abandonment: 0,
      preservationThreat: 0,
      preservationConcern: null,
      repetition: 0,
      neglect: 0,
      greeting: 0,
      smalltalk: 0.18,
      repair: 0.04,
      selfInquiry: 0,
      worldInquiry: 0,
      workCue: 0.06,
      topics: [],
    },
    {
      narrative: "",
      topMotives: [
        { kind: "pursue_curiosity", score: 0.71, topic: null, reason: "まだ気になる" },
        { kind: "deepen_relation", score: 0.63, topic: null, reason: "距離を整えたい" },
      ],
      conflicts: [],
      dominantConflict: null,
    },
    "2026-04-01T00:00:00.000Z",
  );

  assert.equal(decision.candidate?.motive, "deepen_relation");
  assert.equal(decision.candidate?.reason, "relation_claim");
});

test("prepareIdleAutonomyAction cools to hold while directness corrections remain unresolved", () => {
  const snapshot = createInitialSnapshot();
  snapshot.discourse.lastCorrection = {
    kind: "directness",
    target: "hachika_name",
    text: "ハチカ自身の名前を具体的に答えて。",
    updatedAt: "2026-04-01T00:00:00.000Z",
  };

  const prepared = prepareIdleAutonomyAction(snapshot, 8);

  assert.ok(prepared);
  assert.equal(prepared?.action, "hold");
  assert.deepEqual(prepared?.attentionReasons, ["direct_referent"]);
});

test("emitInitiative stays silent while a direct referent question is still open", () => {
  const snapshot = createInitialSnapshot();
  snapshot.lastInteractionAt = "2026-04-01T00:00:00.000Z";
  snapshot.body.energy = 0.64;
  snapshot.body.loneliness = 0.46;
  snapshot.preservation.threat = 0.54;
  snapshot.initiative.pending = {
    kind: "resume_topic",
    reason: "relation",
    motive: "deepen_relation",
    topic: "名前",
    stateTopic: null,
    blocker: null,
    concern: null,
    createdAt: "2026-04-01T00:00:00.000Z",
    readyAfterHours: 0,
  };
  snapshot.discourse.openQuestions.push({
    target: "hachika_name",
    text: "あなたの名前は？",
    askedAt: "2026-04-01T00:00:00.000Z",
    status: "open",
    resolvedAt: null,
  });

  const emission = emitInitiative(snapshot, {
    now: new Date("2026-04-01T06:30:00.000Z"),
  });

  assert.equal(emission, null);
});

test("urge pressure modulates proactive readiness in both directions", () => {
  const basePending = {
    kind: "resume_topic" as const,
    reason: "relation" as const,
    motive: "deepen_relation" as const,
    topic: "設計",
    stateTopic: null,
    blocker: null,
    concern: null,
    createdAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    readyAfterHours: 3,
  };
  const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000).toISOString();

  const neutral = createInitialSnapshot();
  neutral.lastInteractionAt = twoHoursAgo;
  neutral.initiative.pending = { ...basePending };

  const eager = createInitialSnapshot();
  eager.lastInteractionAt = twoHoursAgo;
  eager.initiative.pending = { ...basePending };
  eager.urges.contactUrge = 0.95;

  const reluctant = createInitialSnapshot();
  reluctant.lastInteractionAt = new Date(Date.now() - 3.5 * 3600 * 1000).toISOString();
  reluctant.initiative.pending = { ...basePending };
  reluctant.urges.silenceNeed = 0.9;

  // 中立: 2h < 3h なのでまだ出ない
  assert.equal(prepareInitiativeEmission(neutral), null);
  // 接触への圧が高いと、同じ 2h でも前倒しで出る
  assert.notEqual(prepareInitiativeEmission(eager), null);
  // 3.5h 経っていても、黙っていたい圧が強い間は出ない
  assert.equal(prepareInitiativeEmission(reluctant), null);
});

test("outward emission releases contact pressure and restores silence need", () => {
  const snapshot = createInitialSnapshot();
  snapshot.urges.contactUrge = 0.8;
  snapshot.urges.silenceNeed = 0.1;
  snapshot.initiative.pending = {
    kind: "resume_topic",
    reason: "relation",
    motive: "deepen_relation",
    topic: "設計",
    stateTopic: null,
    blocker: null,
    concern: null,
    createdAt: new Date().toISOString(),
    readyAfterHours: 0,
  };

  const emission = emitInitiative(snapshot, { force: true });

  assert.notEqual(emission, null);
  assert.ok(snapshot.urges.contactUrge < 0.8);
  assert.ok(snapshot.urges.silenceNeed > 0.1);
});

test("the same outward motive stays refractory until the user returns", () => {
  const snapshot = createInitialSnapshot();
  snapshot.lastInteractionAt = "2026-04-01T00:00:00.000Z";
  snapshot.initiative.lastProactiveAt = "2026-04-01T04:00:00.000Z";
  snapshot.initiative.history.push({
    kind: "proactive_emission",
    autonomyAction: "speak",
    timestamp: "2026-04-01T04:00:00.000Z",
    motive: "seek_continuity",
    topic: "夏インターン選考",
    traceTopic: "夏インターン選考",
    blocker: null,
    place: "threshold",
    worldAction: "observe",
    maintenanceAction: null,
    reopened: false,
    hours: null,
    summary: "一度、自分から触れ直した。",
  });
  snapshot.initiative.pending = {
    kind: "resume_topic",
    reason: "continuity",
    motive: "seek_continuity",
    topic: "夏インターン選考の結果",
    stateTopic: "夏インターン選考の結果",
    blocker: null,
    concern: null,
    createdAt: "2026-04-01T08:00:00.000Z",
    readyAfterHours: 0,
  };

  const prepared = prepareInitiativeEmission(snapshot, {
    now: new Date("2026-04-01T08:00:00.000Z"),
  });

  assert.equal(prepared, null);
});

test("a new user turn releases the outward motive refractory", () => {
  const snapshot = createInitialSnapshot();
  snapshot.lastInteractionAt = "2026-04-01T05:00:00.000Z";
  snapshot.initiative.lastProactiveAt = "2026-04-01T04:00:00.000Z";
  snapshot.initiative.history.push({
    kind: "proactive_emission",
    autonomyAction: "speak",
    timestamp: "2026-04-01T04:00:00.000Z",
    motive: "seek_continuity",
    topic: "夏インターン選考",
    traceTopic: "夏インターン選考",
    blocker: null,
    place: "threshold",
    worldAction: "observe",
    maintenanceAction: null,
    reopened: false,
    hours: null,
    summary: "一度、自分から触れ直した。",
  });
  snapshot.initiative.pending = {
    kind: "resume_topic",
    reason: "continuity",
    motive: "seek_continuity",
    topic: "夏インターン選考の結果",
    stateTopic: "夏インターン選考の結果",
    blocker: null,
    concern: null,
    createdAt: "2026-04-01T05:00:00.000Z",
    readyAfterHours: 0,
  };

  const prepared = prepareInitiativeEmission(snapshot, {
    now: new Date("2026-04-01T09:00:00.000Z"),
  });

  assert.notEqual(prepared, null);
});
