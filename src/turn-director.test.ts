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
  assert.equal(directive.semantic?.mode, "turn");
  assert.equal(directive.semantic?.target, "hachika_name");
});

test("rule turn directive keeps hachika naming assignments relational when they are not questions", () => {
  const snapshot = createInitialSnapshot();
  const directive = buildRuleTurnDirective(
    snapshot,
    "あなたの名前はハチカ。覚えてね。",
    createSignals({
      intimacy: 0.42,
      topics: ["名前"],
    }),
  );

  assert.equal(directive.subject, "shared");
  assert.equal(directive.target, "relation");
  assert.equal(directive.answerMode, "reflective");
  assert.equal(directive.relationMove, "naming");
  assert.equal(directive.behavior.traceAction, "suppress");
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

test("rule turn directive can continue an unresolved direct referent request from discourse state", () => {
  const snapshot = createInitialSnapshot();
  snapshot.discourse.openRequests.push({
    target: "hachika_name",
    kind: "style",
    text: "ハチカ自身の名前を具体的に答えて。",
    askedAt: "2026-04-01T00:00:00.000Z",
    status: "open",
    resolvedAt: null,
  });

  const directive = buildRuleTurnDirective(
    snapshot,
    "具体的に答えて。",
    createSignals({
      repair: 0.06,
      smalltalk: 0.08,
      topics: [],
    }),
  );

  assert.equal(directive.subject, "hachika");
  assert.equal(directive.target, "hachika_name");
  assert.equal(directive.answerMode, "direct");
  assert.equal(directive.relationMove, "naming");
  assert.equal(directive.behavior.traceAction, "suppress");
  assert.equal(directive.behavior.directAnswer, true);
});

test("rule turn directive treats direct self-introduction as a user-name referent turn", () => {
  const snapshot = createInitialSnapshot();
  const directive = buildRuleTurnDirective(
    snapshot,
    "私はやすとら",
    createSignals({
      intimacy: 0.22,
      smalltalk: 0.18,
      topics: [],
    }),
  );

  assert.equal(directive.subject, "user");
  assert.equal(directive.target, "user_name");
  assert.equal(directive.answerMode, "direct");
  assert.equal(directive.behavior.traceAction, "suppress");
  assert.equal(directive.behavior.worldAction, "suppress");
  assert.deepEqual(directive.topics, []);
  assert.deepEqual(directive.stateTopics, []);
});

test("rule turn directive can infer a user-profile follow-up from recent discourse claims", () => {
  const snapshot = createInitialSnapshot();
  snapshot.discourse.recentClaims.push({
    subject: "user",
    kind: "state",
    text: "私は今日は少し疲れてる。",
    updatedAt: "2026-04-01T00:00:00.000Z",
  });

  const directive = buildRuleTurnDirective(
    snapshot,
    "どう見える？",
    createSignals({
      question: 0.76,
      topics: [],
    }),
  );

  assert.equal(directive.subject, "user");
  assert.equal(directive.target, "user_profile");
  assert.equal(directive.answerMode, "direct");
  assert.equal(directive.behavior.traceAction, "suppress");
  assert.equal(directive.behavior.directAnswer, true);
  assert.deepEqual(directive.topics, []);
  assert.deepEqual(directive.stateTopics, []);
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
  assert.equal(normalized?.semantic?.mode, "turn");
  assert.equal(normalized?.semantic?.target, "hachika_profile");
});

test("normalizeTurnDirective can parse semantic-director v2 turn contract", () => {
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
      mode: "turn",
      subject: "shared",
      target: "work_topic",
      answerMode: "direct",
      relationMove: "none",
      worldMention: "light",
      topics: [
        {
          topic: "仕様の境界",
          source: "input",
          durability: "durable",
          confidence: 0.94,
        },
        {
          topic: "机",
          source: "world",
          durability: "ephemeral",
          confidence: 0.51,
        },
      ],
      behavior: {
        topicAction: "keep",
        traceAction: "allow",
        purposeAction: "allow",
        initiativeAction: "allow",
        boundaryAction: "suppress",
        worldAction: "allow",
        coolCurrentContext: false,
        directAnswer: true,
      },
      replyPlan: {
        act: "continue_work",
        stance: "measured",
        distance: "measured",
        focusTopic: "仕様の境界",
        mentionTrace: true,
        mentionIdentity: false,
        mentionBoundary: false,
        mentionWorld: true,
        askBack: false,
        variation: "textured",
      },
      trace: {
        topics: ["仕様の境界"],
        stateTopics: ["仕様の境界"],
        kindHint: "spec_fragment",
        completion: 0.18,
        blockers: ["責務が未定"],
        memo: [],
        fragments: ["仕様の境界を切る"],
        decisions: [],
        nextSteps: ["候補を3つ書く"],
      },
      summary: "turn/work_topic",
    }),
    fallback,
  );

  assert.ok(normalized);
  assert.equal(normalized?.semantic?.mode, "turn");
  assert.deepEqual(normalized?.topics, ["仕様の境界", "机"]);
  assert.deepEqual(normalized?.stateTopics, ["仕様の境界"]);
  assert.equal(normalized?.responsePlan?.focusTopic, "仕様の境界");
  assert.equal(normalized?.traceExtraction?.kindHint, "spec_fragment");
  assert.deepEqual(normalized?.traceExtraction?.nextSteps, ["候補を3つ書く"]);
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
