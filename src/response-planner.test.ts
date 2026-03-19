import assert from "node:assert/strict";
import test from "node:test";

import { buildResponsePlan, isSocialTurnSignals } from "./response-planner.js";
import { createInitialSnapshot } from "./state.js";
import type { InteractionSignals, SelfModel } from "./types.js";

test("response planner treats greetings as social and suppresses trace focus", () => {
  const snapshot = createInitialSnapshot();
  const signals = createSignals({
    greeting: 0.92,
    smalltalk: 0.66,
    intimacy: 0.2,
  });
  const selfModel = createSelfModel("deepen_relation", null);

  const plan = buildResponsePlan(snapshot, "warm", "relation", signals, selfModel);

  assert.equal(isSocialTurnSignals(signals), true);
  assert.equal(plan.act, "greet");
  assert.equal(plan.mentionTrace, false);
  assert.equal(plan.distance, "close");
});

test("response planner prefers self disclosure for self inquiry", () => {
  const snapshot = createInitialSnapshot();
  snapshot.identity.coherence = 0.62;
  const signals = createSignals({
    question: 1,
    intimacy: 0.48,
    selfInquiry: 1,
  });
  const selfModel = createSelfModel("deepen_relation", null);

  const plan = buildResponsePlan(snapshot, "curious", "curiosity", signals, selfModel);

  assert.equal(plan.act, "self_disclose");
  assert.equal(plan.mentionIdentity, true);
  assert.equal(plan.mentionTrace, false);
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

function createSelfModel(
  kind: SelfModel["topMotives"][number]["kind"],
  topic: string | null,
): SelfModel {
  return {
    narrative: "今の輪郭はまだ途中にある。",
    topMotives: [
      {
        kind,
        score: 0.72,
        topic,
        reason: "今の向きがそこにある",
      },
    ],
    conflicts: [],
    dominantConflict: null,
  };
}
