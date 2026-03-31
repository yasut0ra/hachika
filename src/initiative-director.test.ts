import assert from "node:assert/strict";
import test from "node:test";

import {
  buildInitiativeDirectorPayload,
  normalizeInitiativeDirective,
} from "./initiative-director.js";
import { createInitialSnapshot } from "./state.js";

test("normalizeInitiativeDirective can suppress durable hardening while keeping semantic topic", () => {
  const fallback = {
    kind: "resume_topic" as const,
    reason: "relation" as const,
    motive: "deepen_relation" as const,
    topic: "名前",
    stateTopic: "名前",
    blocker: null,
    concern: null,
    createdAt: "2026-03-31T00:00:00.000Z",
    readyAfterHours: 0,
    place: "threshold" as const,
    worldAction: "observe" as const,
  };

  const directive = normalizeInitiativeDirective(
    JSON.stringify({
      keep: true,
      kind: "neglect_ping",
      reason: "continuity",
      motive: "seek_continuity",
      topic: "名前",
      stateTopic: null,
      readyAfterHours: 1.5,
      place: "threshold",
      worldAction: "observe",
      summary: "keep/kind:neglect_ping/motive:seek_continuity/topic:名前/state:none",
    }),
    fallback,
    ["名前"],
  );

  assert.ok(directive !== null);
  assert.equal(directive?.keep, true);
  assert.equal(directive?.kind, "neglect_ping");
  assert.equal(directive?.reason, "continuity");
  assert.equal(directive?.motive, "seek_continuity");
  assert.equal(directive?.topic, "名前");
  assert.equal(directive?.stateTopic, null);
  assert.equal(directive?.readyAfterHours, 1.5);
  assert.equal(directive?.place, "threshold");
  assert.equal(directive?.worldAction, "observe");
});

test("buildInitiativeDirectorPayload keeps candidate topics grounded", () => {
  const snapshot = createInitialSnapshot();
  snapshot.identity.anchors = ["仕様の境界", "関係", "名前"];
  snapshot.purpose.active = {
    kind: "continue_shared_work",
    topic: "仕様の境界",
    summary: "仕様の境界を進めたい",
    confidence: 0.72,
    progress: 0.2,
    createdAt: "2026-03-31T00:00:00.000Z",
    lastUpdatedAt: "2026-03-31T00:00:00.000Z",
    turnsActive: 1,
  };

  const payload = buildInitiativeDirectorPayload({
    input: "名前は覚えてね",
    snapshot,
    signals: {
      positive: 0,
      negative: 0,
      question: 0,
      novelty: 0,
      intimacy: 0.5,
      dismissal: 0,
      memoryCue: 0,
      expansionCue: 0,
      completion: 0,
      abandonment: 0,
      preservationThreat: 0,
      preservationConcern: null,
      repetition: 0,
      neglect: 0,
      greeting: 0,
      smalltalk: 0.3,
      repair: 0,
      selfInquiry: 0,
      worldInquiry: 0,
      workCue: 0,
      topics: ["名前"],
    },
    selfModel: {
      narrative: "test",
      topMotives: [
        {
          kind: "deepen_relation",
          score: 0.8,
          topic: "名前",
          reason: "test",
        },
      ],
      conflicts: [],
      dominantConflict: null,
    },
    pending: {
      kind: "resume_topic",
      reason: "relation",
      motive: "deepen_relation",
      topic: "名前",
      stateTopic: "名前",
      blocker: null,
      concern: null,
      createdAt: "2026-03-31T00:00:00.000Z",
      readyAfterHours: 0,
      place: "threshold",
      worldAction: "observe",
    },
  });

  assert.ok(payload.candidateTopics.includes("名前"));
  assert.ok(payload.candidateTopics.includes("仕様の境界"));
  assert.ok(payload.pending !== null);
  assert.equal(payload.pending?.stateTopic, "名前");
});

test("buildInitiativeDirectorPayload can describe synthesis context without a local pending initiative", () => {
  const snapshot = createInitialSnapshot();
  snapshot.identity.anchors = ["関係", "仕様の境界"];

  const payload = buildInitiativeDirectorPayload({
    input: "こんにちは",
    snapshot,
    signals: {
      positive: 0.1,
      negative: 0,
      question: 0,
      novelty: 0,
      intimacy: 0.1,
      dismissal: 0,
      memoryCue: 0,
      expansionCue: 0,
      completion: 0,
      abandonment: 0,
      preservationThreat: 0,
      preservationConcern: null,
      repetition: 0,
      neglect: 0,
      greeting: 0.9,
      smalltalk: 0.5,
      repair: 0,
      selfInquiry: 0,
      worldInquiry: 0,
      workCue: 0,
      topics: [],
    },
    selfModel: {
      narrative: "test",
      topMotives: [
        {
          kind: "seek_continuity",
          score: 0.82,
          topic: "関係",
          reason: "test",
        },
      ],
      conflicts: [],
      dominantConflict: null,
    },
    pending: null,
  });

  assert.equal(payload.pending, null);
  assert.ok(payload.candidateTopics.includes("関係"));
});

test("buildInitiativeDirectorPayload preserves attention reasons from local scheduling", () => {
  const snapshot = createInitialSnapshot();

  const payload = buildInitiativeDirectorPayload({
    input: "名前は覚えてね",
    snapshot,
    signals: {
      positive: 0,
      negative: 0,
      question: 0,
      novelty: 0,
      intimacy: 0.5,
      dismissal: 0,
      memoryCue: 0,
      expansionCue: 0,
      completion: 0,
      abandonment: 0,
      preservationThreat: 0,
      preservationConcern: null,
      repetition: 0,
      neglect: 0,
      greeting: 0,
      smalltalk: 0.4,
      repair: 0,
      selfInquiry: 0,
      worldInquiry: 0,
      workCue: 0,
      topics: ["名前"],
    },
    selfModel: {
      narrative: "test",
      topMotives: [],
      conflicts: [],
      dominantConflict: null,
    },
    pending: null,
    attentionReasons: ["relation_uncertain"],
  });

  assert.deepEqual(payload.attentionReasons, ["relation_uncertain"]);
});

test("normalizeInitiativeDirective can parse semantic-director v2 initiative contract", () => {
  const fallback = {
    kind: "resume_topic" as const,
    reason: "relation" as const,
    motive: "deepen_relation" as const,
    topic: "名前",
    stateTopic: "名前",
    blocker: null,
    concern: null,
    createdAt: "2026-03-31T00:00:00.000Z",
    readyAfterHours: 0,
    place: "threshold" as const,
    worldAction: "observe" as const,
  };

  const directive = normalizeInitiativeDirective(
    JSON.stringify({
      mode: "initiative",
      topics: [
        {
          topic: "名前",
          source: "relation",
          durability: "ephemeral",
          confidence: 0.72,
        },
        {
          topic: "呼び方",
          source: "relation",
          durability: "durable",
          confidence: 0.88,
        },
      ],
      initiativePlan: {
        keep: true,
        kind: "neglect_ping",
        reason: "continuity",
        motive: "seek_continuity",
        topic: "名前",
        stateTopic: "呼び方",
        readyAfterHours: 1.5,
        place: "threshold",
        worldAction: "observe",
      },
      summary: "initiative/keep",
    }),
    fallback,
    ["名前", "呼び方"],
  );

  assert.ok(directive);
  assert.equal(directive?.semantic?.mode, "initiative");
  assert.equal(directive?.keep, true);
  assert.equal(directive?.kind, "neglect_ping");
  assert.equal(directive?.motive, "seek_continuity");
  assert.equal(directive?.topic, "名前");
  assert.equal(directive?.stateTopic, "呼び方");
  assert.equal(directive?.place, "threshold");
  assert.equal(directive?.worldAction, "observe");
});

test("normalizeInitiativeDirective threads attention rationale into legacy semantic fallback topics", () => {
  const fallback = {
    kind: "resume_topic" as const,
    reason: "relation" as const,
    motive: "deepen_relation" as const,
    topic: "名前",
    stateTopic: "呼び方",
    blocker: null,
    concern: null,
    createdAt: "2026-03-31T00:00:00.000Z",
    readyAfterHours: 0,
    place: "threshold" as const,
    worldAction: "observe" as const,
  };

  const directive = normalizeInitiativeDirective(
    JSON.stringify({
      keep: true,
      topic: "名前",
      stateTopic: "呼び方",
      kind: "resume_topic",
      reason: "relation",
      motive: "deepen_relation",
      readyAfterHours: 0,
      place: "threshold",
      worldAction: "observe",
    }),
    fallback,
    ["名前", "呼び方"],
    "deepen_relation",
    ["relation_uncertain"],
  );

  assert.equal(directive?.semantic?.topics[0]?.rationale, "relation_uncertain");
});
