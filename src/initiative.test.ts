import assert from "node:assert/strict";
import test from "node:test";

import { buildSelfModel } from "./self-model.js";
import { createInitialSnapshot } from "./state.js";
import {
  emitInitiative,
  prepareIdleAutonomyAction,
  prepareScheduledInitiative,
} from "./initiative.js";

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
