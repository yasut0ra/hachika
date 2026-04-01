import assert from "node:assert/strict";
import test from "node:test";

import { updatePurpose } from "./purpose.js";
import { createInitialSnapshot } from "./state.js";

test("updatePurpose prefers shared work when an open task request keeps work active in discourse", () => {
  const snapshot = createInitialSnapshot();
  snapshot.discourse.openRequests.push({
    target: "work_topic",
    kind: "task",
    text: "仕様の境界を整理して",
    askedAt: "2026-04-01T00:00:00.000Z",
    status: "open",
    resolvedAt: null,
  });

  updatePurpose(
    snapshot,
    {
      narrative: "",
      topMotives: [
        { kind: "pursue_curiosity", score: 0.72, topic: null, reason: "まだ曖昧さがある" },
        {
          kind: "continue_shared_work",
          score: 0.63,
          topic: "仕様の境界",
          reason: "仕様の境界を前へ進めたい",
        },
      ],
      conflicts: [],
      dominantConflict: null,
    },
    {
      positive: 0,
      negative: 0,
      question: 0,
      novelty: 0.12,
      intimacy: 0.04,
      dismissal: 0,
      memoryCue: 0.1,
      expansionCue: 0.12,
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
      workCue: 0.18,
      topics: [],
    },
    "2026-04-01T00:00:00.000Z",
  );

  assert.equal(snapshot.purpose.active?.kind, "continue_shared_work");
  assert.equal(snapshot.purpose.active?.topic, "仕様の境界");
});

test("updatePurpose prefers relation when recent relation claims outweigh nearby curiosity", () => {
  const snapshot = createInitialSnapshot();
  snapshot.discourse.recentClaims.push({
    subject: "user",
    kind: "relation",
    text: "もう少し落ち着いて話したい。",
    updatedAt: "2026-04-01T00:00:00.000Z",
  });

  updatePurpose(
    snapshot,
    {
      narrative: "",
      topMotives: [
        { kind: "pursue_curiosity", score: 0.7, topic: null, reason: "まだ気になることがある" },
        {
          kind: "deepen_relation",
          score: 0.62,
          topic: null,
          reason: "距離の取り方を合わせたい",
        },
      ],
      conflicts: [],
      dominantConflict: null,
    },
    {
      positive: 0.08,
      negative: 0,
      question: 0,
      novelty: 0.06,
      intimacy: 0.12,
      dismissal: 0,
      memoryCue: 0.04,
      expansionCue: 0.06,
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
      workCue: 0.08,
      topics: [],
    },
    "2026-04-01T00:00:00.000Z",
  );

  assert.equal(snapshot.purpose.active?.kind, "deepen_relation");
  assert.equal(snapshot.purpose.active?.topic, null);
});
