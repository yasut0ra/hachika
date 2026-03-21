import assert from "node:assert/strict";
import test from "node:test";

import { buildResponsePlan } from "./response-planner.js";
import { buildSelfModel } from "./self-model.js";
import { createInitialSnapshot } from "./state.js";
import { rewindTemperamentHours, updateTemperament } from "./temperament.js";
import type { InteractionSignals } from "./types.js";

test("temperament becomes more open and self-disclosing after repeated repair and self inquiry", () => {
  const snapshot = createInitialSnapshot();
  const signals = createSignals({
    positive: 0.6,
    intimacy: 0.42,
    repair: 0.78,
    selfInquiry: 0.92,
    smalltalk: 0.44,
    greeting: 0.26,
    novelty: 0.24,
    question: 0.42,
  });

  for (let index = 0; index < 6; index += 1) {
    updateTemperament(snapshot, signals);
  }

  assert.ok(snapshot.temperament.openness > createInitialSnapshot().temperament.openness);
  assert.ok(
    snapshot.temperament.selfDisclosureBias >
      createInitialSnapshot().temperament.selfDisclosureBias,
  );
  assert.ok(snapshot.temperament.bondingBias > createInitialSnapshot().temperament.bondingBias);
});

test("temperament becomes more guarded after repeated hostility", () => {
  const snapshot = createInitialSnapshot();
  const signals = createSignals({
    negative: 0.94,
    dismissal: 0.56,
    preservationThreat: 0.22,
  });

  for (let index = 0; index < 6; index += 1) {
    updateTemperament(snapshot, signals);
  }

  assert.ok(snapshot.temperament.guardedness > createInitialSnapshot().temperament.guardedness);
  assert.ok(snapshot.temperament.openness < createInitialSnapshot().temperament.openness);
});

test("same drive/body can yield different top motives depending on learned temperament", () => {
  const exploratory = createInitialSnapshot();
  exploratory.identity.anchors = ["自分"];
  exploratory.state.curiosity = 0.72;
  exploratory.state.relation = 0.54;
  exploratory.attachment = 0.42;
  exploratory.body.energy = 0.64;
  exploratory.body.tension = 0.22;
  exploratory.body.boredom = 0.32;
  exploratory.temperament.openness = 0.84;
  exploratory.temperament.bondingBias = 0.26;
  exploratory.temperament.selfDisclosureBias = 0.22;
  exploratory.temperament.guardedness = 0.2;

  const relational = createInitialSnapshot();
  relational.identity.anchors = ["自分"];
  relational.state = { ...exploratory.state };
  relational.body = { ...exploratory.body };
  relational.attachment = exploratory.attachment;
  relational.temperament.openness = 0.34;
  relational.temperament.bondingBias = 0.84;
  relational.temperament.selfDisclosureBias = 0.78;
  relational.temperament.guardedness = 0.18;

  const exploratoryModel = buildSelfModel(exploratory);
  const relationalModel = buildSelfModel(relational);

  assert.equal(exploratoryModel.topMotives[0]?.kind, "pursue_curiosity");
  assert.equal(relationalModel.topMotives[0]?.kind, "deepen_relation");
});

test("response planner self-discloses more readily when learned temperament is open", () => {
  const openSnapshot = createInitialSnapshot();
  openSnapshot.identity.coherence = 0.48;
  openSnapshot.attachment = 0.3;
  openSnapshot.temperament.selfDisclosureBias = 0.82;
  openSnapshot.temperament.bondingBias = 0.72;
  openSnapshot.temperament.guardedness = 0.22;
  openSnapshot.temperament.openness = 0.74;

  const guardedSnapshot = createInitialSnapshot();
  guardedSnapshot.identity.coherence = 0.48;
  guardedSnapshot.attachment = 0.3;
  guardedSnapshot.temperament.selfDisclosureBias = 0.28;
  guardedSnapshot.temperament.bondingBias = 0.34;
  guardedSnapshot.temperament.guardedness = 0.72;
  guardedSnapshot.temperament.openness = 0.28;

  const signals = createSignals({
    question: 0.52,
    intimacy: 0.36,
    selfInquiry: 0.34,
    smalltalk: 0.52,
  });
  const selfModel = buildSelfModel(openSnapshot);

  const openPlan = buildResponsePlan(openSnapshot, "curious", "curiosity", signals, selfModel);
  const guardedPlan = buildResponsePlan(
    guardedSnapshot,
    "guarded",
    "curiosity",
    signals,
    buildSelfModel(guardedSnapshot),
  );

  assert.equal(openPlan.act, "self_disclose");
  assert.equal(openPlan.distance, "close");
  assert.equal(guardedPlan.act, "attune");
});

test("idle absence can raise guardedness and trace hunger while softening work drive", () => {
  const snapshot = createInitialSnapshot();
  snapshot.body.loneliness = 0.72;
  snapshot.body.tension = 0.44;
  snapshot.preservation.concern = "absence";
  snapshot.preservation.threat = 0.34;
  const before = structuredClone(snapshot.temperament);

  rewindTemperamentHours(snapshot, 36);

  assert.ok(snapshot.temperament.guardedness > before.guardedness);
  assert.ok(snapshot.temperament.traceHunger > before.traceHunger);
  assert.ok(snapshot.temperament.workDrive < before.workDrive);
});

function createSignals(
  overrides: Partial<InteractionSignals> = {},
): InteractionSignals {
  return {
    positive: 0,
    negative: 0,
    question: 0,
    novelty: 0,
    intimacy: 0,
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
    smalltalk: 0,
    repair: 0,
    selfInquiry: 0,
    workCue: 0,
    topics: [],
    ...overrides,
  };
}
