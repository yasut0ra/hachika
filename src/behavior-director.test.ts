import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRuleBehaviorDirective,
  normalizeBehaviorDirective,
} from "./behavior-director.js";
import { createInitialSnapshot } from "./state.js";
import type { InteractionSignals } from "./types.js";

test("rule behavior directive keeps naming turns relational without hardening trace state", () => {
  const snapshot = createInitialSnapshot();
  const signals = createSignals({
    intimacy: 0.5,
    memoryCue: 0.5,
    topics: ["名前", "ハチカ"],
  });

  const directive = buildRuleBehaviorDirective(snapshot, signals, null, null);

  assert.equal(directive.topicAction, "keep");
  assert.equal(directive.traceAction, "suppress");
  assert.equal(directive.purposeAction, "allow");
  assert.equal(directive.initiativeAction, "suppress");
  assert.equal(directive.coolCurrentContext, false);
});

test("rule behavior directive cools explicit topic shifts", () => {
  const snapshot = createInitialSnapshot();
  const signals = createSignals({
    abandonment: 0.92,
    question: 0.34,
  });

  const directive = buildRuleBehaviorDirective(snapshot, signals, null, null);

  assert.equal(directive.topicAction, "clear");
  assert.equal(directive.traceAction, "suppress");
  assert.equal(directive.purposeAction, "suppress");
  assert.equal(directive.initiativeAction, "suppress");
  assert.equal(directive.coolCurrentContext, true);
  assert.equal(directive.directAnswer, true);
});

test("normalizeBehaviorDirective keeps fallback fields when llm output is partial", () => {
  const normalized = normalizeBehaviorDirective(
    JSON.stringify({
      traceAction: "suppress",
      directAnswer: true,
    }),
    {
      topicAction: "keep",
      traceAction: "allow",
      purposeAction: "allow",
      initiativeAction: "allow",
      coolCurrentContext: false,
      directAnswer: false,
      summary: "fallback",
    },
  );

  assert.equal(normalized?.topicAction, "keep");
  assert.equal(normalized?.traceAction, "suppress");
  assert.equal(normalized?.purposeAction, "allow");
  assert.equal(normalized?.initiativeAction, "allow");
  assert.equal(normalized?.coolCurrentContext, false);
  assert.equal(normalized?.directAnswer, true);
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
