import assert from "node:assert/strict";
import test from "node:test";

import { createInitialSnapshot } from "./state.js";
import {
  buildTraceExtractionPayload,
  normalizeTraceExtraction,
} from "./trace-extractor.js";

test("buildTraceExtractionPayload surfaces known topics and signal summary", () => {
  const snapshot = createInitialSnapshot();
  snapshot.identity.anchors = ["設計"];
  snapshot.purpose.active = {
    kind: "continue_shared_work",
    topic: "仕様の境界",
    summary: "仕様の境界を決めたい。",
    confidence: 0.72,
    progress: 0.28,
    createdAt: "2026-03-20T00:00:00.000Z",
    lastUpdatedAt: "2026-03-20T00:00:00.000Z",
    turnsActive: 1,
  };
  snapshot.traces["仕様の境界"] = {
    topic: "仕様の境界",
    kind: "spec_fragment",
    status: "active",
    lastAction: "expanded",
    summary: "「仕様の境界」は断片として残っている。",
    sourceMotive: "continue_shared_work",
    artifact: {
      memo: ["仕様の境界を見直す"],
      fragments: ["責務を切り分ける"],
      decisions: [],
      nextSteps: ["API の責務を分ける"],
    },
    work: {
      focus: "API の責務を分ける",
      confidence: 0.46,
      blockers: ["責務が未定"],
      staleAt: "2026-03-21T00:00:00.000Z",
    },
    salience: 0.68,
    mentions: 2,
    createdAt: "2026-03-20T00:00:00.000Z",
    lastUpdatedAt: "2026-03-20T00:00:00.000Z",
  };

  const payload = buildTraceExtractionPayload({
    input: "仕様の境界が曖昧で、責務がまだ決まっていない。",
    snapshot,
    signals: {
      positive: 0,
      negative: 0,
      question: 0,
      novelty: 0,
      intimacy: 0,
      dismissal: 0,
      memoryCue: 0.14,
      expansionCue: 0.22,
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
      workCue: 0.78,
      topics: ["仕様の境界"],
    },
  });

  assert.ok(payload.knownTopics.includes("仕様の境界"));
  assert.ok(payload.topTraceTopics.includes("仕様の境界"));
  assert.equal(payload.activePurpose.topic, "仕様の境界");
  assert.equal(payload.signalSummary.workCue, 0.78);
});

test("normalizeTraceExtraction parses structured json safely", () => {
  const extraction = normalizeTraceExtraction(
    JSON.stringify({
      topics: ["仕様の境界", "仕様の境界"],
      kindHint: "spec_fragment",
      completion: 0.2,
      blockers: ["責務が未定"],
      memo: ["仕様の境界を見直す"],
      fragments: ["責務を切り分ける"],
      decisions: [],
      nextSteps: ["API の責務を分ける"],
    }),
  );

  assert.deepEqual(extraction?.topics, ["仕様の境界"]);
  assert.equal(extraction?.kindHint, "spec_fragment");
  assert.equal(extraction?.completion, 0.2);
  assert.deepEqual(extraction?.blockers, ["責務が未定"]);
  assert.deepEqual(extraction?.nextSteps, ["API の責務を分ける"]);
});
