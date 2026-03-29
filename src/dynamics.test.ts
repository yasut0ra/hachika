import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveVisibleStateFromDynamics,
  rewindDynamicsHours,
  settleDynamicsAfterInitiative,
  updateDynamicsFromSignals,
} from "./dynamics.js";
import { createInitialSnapshot } from "./state.js";
import type { InteractionSignals, PendingInitiative } from "./types.js";

test("positive social input raises safety and trust while easing loneliness", () => {
  const snapshot = createInitialSnapshot();
  const before = structuredClone(snapshot);

  updateDynamicsFromSignals(
    snapshot,
    createSignals({
      positive: 0.82,
      greeting: 0.66,
      smalltalk: 0.54,
      repair: 0.22,
      intimacy: 0.4,
    }),
  );

  assert.ok(snapshot.dynamics.safety > before.dynamics.safety);
  assert.ok(snapshot.dynamics.trust > before.dynamics.trust);
  assert.ok(snapshot.body.loneliness < before.body.loneliness);
  assert.ok(snapshot.state.relation > before.state.relation);
});

test("hostile input lowers safety and trust while raising tension and stress load", () => {
  const snapshot = createInitialSnapshot();
  const before = structuredClone(snapshot);

  updateDynamicsFromSignals(
    snapshot,
    createSignals({
      negative: 0.88,
      dismissal: 0.6,
      neglect: 0.28,
      preservationThreat: 0.36,
    }),
  );

  assert.ok(snapshot.dynamics.safety < before.dynamics.safety);
  assert.ok(snapshot.dynamics.trust < before.dynamics.trust);
  assert.ok(snapshot.body.tension > before.body.tension);
  assert.ok(snapshot.reactivity.stressLoad > before.reactivity.stressLoad);
});

test("idle rewind lowers activation and load while raising social need and novelty drive", () => {
  const snapshot = createInitialSnapshot();
  const before = structuredClone(snapshot);

  rewindDynamicsHours(snapshot, 18);

  assert.ok(snapshot.dynamics.activation < before.dynamics.activation);
  assert.ok(snapshot.dynamics.cognitiveLoad < before.dynamics.cognitiveLoad);
  assert.ok(snapshot.dynamics.socialNeed > before.dynamics.socialNeed);
  assert.ok(snapshot.dynamics.noveltyDrive > before.dynamics.noveltyDrive);
});

test("initiative settling reduces social need and continuity pressure in a motive-aware way", () => {
  const snapshot = createInitialSnapshot();
  snapshot.dynamics.socialNeed = 0.72;
  snapshot.dynamics.continuityPressure = 0.78;
  deriveVisibleStateFromDynamics(snapshot);

  const pending: PendingInitiative = {
    kind: "neglect_ping",
    reason: "relation",
    motive: "deepen_relation",
    topic: "名前",
    blocker: null,
    concern: null,
    createdAt: "2026-03-29T00:00:00.000Z",
    readyAfterHours: 0,
    place: null,
    worldAction: null,
  };

  settleDynamicsAfterInitiative(snapshot, pending);

  assert.ok(snapshot.dynamics.socialNeed < 0.72);
  assert.ok(snapshot.dynamics.trust > createInitialSnapshot().dynamics.trust);
  assert.ok(snapshot.body.loneliness < 0.5);
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
    worldInquiry: 0,
    workCue: 0,
    topics: [],
    ...overrides,
  };
}
