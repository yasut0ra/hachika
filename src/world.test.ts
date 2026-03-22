import assert from "node:assert/strict";
import test from "node:test";

import { createInitialSnapshot } from "./state.js";
import { advanceWorldByIdle, advanceWorldFromInteraction, formatWorldSummary } from "./world.js";

test("interaction can move the world toward the studio on focused work cues", () => {
  const snapshot = createInitialSnapshot();
  snapshot.lastInteractionAt = "2026-03-22T09:10:00.000Z";

  advanceWorldFromInteraction(
    snapshot,
    {
      positive: 0,
      negative: 0,
      question: 0.2,
      novelty: 0.24,
      intimacy: 0.1,
      dismissal: 0,
      memoryCue: 0,
      expansionCue: 0.42,
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
      workCue: 0.78,
      topics: ["仕様の境界"],
    },
    snapshot.lastInteractionAt,
  );

  assert.equal(snapshot.world.currentPlace, "studio");
  assert.match(formatWorldSummary(snapshot.world), /studio/);
  assert.ok(snapshot.world.recentEvents.some((event) => event.place === "studio"));
});

test("idle world update can drift toward the archive and advance time", () => {
  const snapshot = createInitialSnapshot();
  snapshot.world.clockHour = 18.5;
  snapshot.body.energy = 0.22;
  snapshot.preservation.threat = 0.42;
  snapshot.temperament.traceHunger = 0.88;

  advanceWorldByIdle(snapshot, 8, "2026-03-22T23:00:00.000Z");

  assert.equal(snapshot.world.currentPlace, "archive");
  assert.equal(snapshot.world.phase, "night");
  assert.ok(snapshot.world.clockHour > 2 && snapshot.world.clockHour < 3);
  assert.ok(snapshot.world.recentEvents.length > 0);
});
