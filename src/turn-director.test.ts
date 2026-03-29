import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRuleTurnDirective,
  normalizeTurnDirective,
} from "./turn-director.js";
import { createInitialSnapshot } from "./state.js";
import type { InteractionSignals } from "./types.js";

test("rule turn directive resolves Hachika name questions as direct self referent turns", () => {
  const snapshot = createInitialSnapshot();
  const directive = buildRuleTurnDirective(
    snapshot,
    "あなたの名前は？",
    createSignals({
      question: 0.82,
      intimacy: 0.42,
      topics: ["名前"],
    }),
  );

  assert.equal(directive.subject, "hachika");
  assert.equal(directive.target, "hachika_name");
  assert.equal(directive.answerMode, "direct");
  assert.equal(directive.relationMove, "naming");
  assert.equal(directive.behavior.traceAction, "suppress");
  assert.equal(directive.behavior.worldAction, "suppress");
  assert.deepEqual(directive.topics, []);
  assert.deepEqual(directive.stateTopics, []);
});

test("rule turn directive resolves user naming questions without hardening work state", () => {
  const snapshot = createInitialSnapshot();
  const directive = buildRuleTurnDirective(
    snapshot,
    "私の名前、覚えてる？",
    createSignals({
      question: 0.74,
      intimacy: 0.4,
      memoryCue: 0.3,
      topics: ["名前"],
    }),
  );

  assert.equal(directive.subject, "user");
  assert.equal(directive.target, "user_name");
  assert.equal(directive.answerMode, "direct");
  assert.equal(directive.behavior.traceAction, "suppress");
  assert.equal(directive.behavior.purposeAction, "suppress");
  assert.equal(directive.behavior.directAnswer, true);
});

test("normalizeTurnDirective keeps fallback shape and parses turn semantics", () => {
  const fallback = buildRuleTurnDirective(
    createInitialSnapshot(),
    "仕様の境界が曖昧だ。",
    createSignals({
      workCue: 0.62,
      topics: ["仕様の境界"],
    }),
  );

  const normalized = normalizeTurnDirective(
    JSON.stringify({
      subject: "hachika",
      target: "hachika_profile",
      answerMode: "direct",
      relationMove: "attune",
      worldMention: "light",
      topics: ["存在"],
      behavior: {
        traceAction: "suppress",
        directAnswer: true,
      },
      plan: {
        act: "self_disclose",
        stance: "open",
        distance: "close",
        focusTopic: null,
        mentionTrace: false,
        mentionIdentity: true,
        mentionBoundary: false,
        mentionWorld: false,
        askBack: false,
        variation: "textured",
      },
      trace: {
        topics: ["仕様の境界"],
        kindHint: "spec_fragment",
        completion: 0.1,
        blockers: ["責務が未定"],
        nextSteps: ["境界を切る"],
      },
    }),
    fallback,
  );

  assert.equal(normalized?.subject, "hachika");
  assert.equal(normalized?.target, "hachika_profile");
  assert.equal(normalized?.answerMode, "direct");
  assert.equal(normalized?.worldMention, "light");
  assert.equal(normalized?.behavior.traceAction, "suppress");
  assert.equal(normalized?.behavior.directAnswer, true);
  assert.equal(normalized?.responsePlan?.act, "self_disclose");
  assert.equal(normalized?.responsePlan?.mentionIdentity, true);
  assert.equal(normalized?.responsePlan?.summary, "self_disclose/open/close");
  assert.deepEqual(normalized?.topics, []);
  assert.deepEqual(normalized?.stateTopics, []);
  assert.equal(normalized?.traceExtraction, null);
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
