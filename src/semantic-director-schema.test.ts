import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProactivePlanFromSemanticProactivePlan,
  buildSemanticProactivePlan,
  buildSemanticReplyPlanFromResponsePlan,
  buildStructuredTraceExtractionFromSemanticTraceHint,
  describeSemanticDirective,
  listDurableSemanticTopics,
  listSemanticTopics,
} from "./semantic-director-schema.js";

test("describeSemanticDirective summarizes turn semantic/state topics separately", () => {
  const summary = describeSemanticDirective({
    mode: "turn",
    subject: "hachika",
    target: "hachika_name",
    answerMode: "direct",
    relationMove: "naming",
    worldMention: "none",
    topics: [
      {
        topic: "名前",
        source: "input",
        durability: "ephemeral",
        confidence: 0.92,
      },
    ],
    behavior: {
      topicAction: "clear",
      traceAction: "suppress",
      purposeAction: "suppress",
      initiativeAction: "suppress",
      boundaryAction: "suppress",
      worldAction: "suppress",
      coolCurrentContext: false,
      directAnswer: true,
    },
    replyPlan: buildSemanticReplyPlanFromResponsePlan({
      act: "self_disclose",
      stance: "open",
      distance: "close",
      focusTopic: null,
      mentionTrace: false,
      mentionIdentity: false,
      mentionBoundary: false,
      mentionWorld: false,
      askBack: false,
      variation: "brief",
      summary: "self_disclose/open/close",
    }),
    trace: {
      topics: [],
      stateTopics: [],
      kindHint: null,
      completion: 0,
      blockers: [],
      memo: [],
      fragments: [],
      decisions: [],
      nextSteps: [],
    },
    summary: "turn/direct",
  });

  assert.match(summary, /turn/);
  assert.match(summary, /topics:名前/);
  assert.match(summary, /state:none/);
  assert.match(summary, /act:self_disclose/);
});

test("describeSemanticDirective summarizes proactive state topic and world action", () => {
  const summary = describeSemanticDirective({
    mode: "proactive",
    topics: [
      {
        topic: "仕様の境界",
        source: "trace",
        durability: "durable",
        confidence: 0.88,
      },
    ],
    proactivePlan: buildSemanticProactivePlan(
      {
        act: "continue_work",
        stance: "measured",
        distance: "measured",
        focusTopic: "仕様の境界",
        emphasis: "maintenance",
        mentionBlocker: false,
        mentionReopen: false,
        mentionMaintenance: true,
        mentionIntent: true,
        variation: "brief",
        summary: "continue_work/measured/measured/maintenance on 仕様の境界",
      },
      {
        emit: true,
        stateTopic: "仕様の境界",
        place: "studio",
        worldAction: "touch",
      },
    ),
    trace: {
      topics: ["仕様の境界"],
      stateTopics: ["仕様の境界"],
      kindHint: "spec_fragment",
      completion: 0,
      blockers: [],
      memo: [],
      fragments: [],
      decisions: [],
      nextSteps: [],
    },
    summary: "proactive/emit",
  });

  assert.match(summary, /proactive/);
  assert.match(summary, /emit/);
  assert.match(summary, /topics:仕様の境界/);
  assert.match(summary, /state:仕様の境界/);
  assert.match(summary, /@studio/);
  assert.match(summary, /\/touch/);
});

test("semantic helper projections recover legacy topic and trace shapes", () => {
  const topics = [
    {
      topic: "仕様の境界",
      source: "input" as const,
      durability: "durable" as const,
      confidence: 0.91,
    },
    {
      topic: "机",
      source: "world" as const,
      durability: "ephemeral" as const,
      confidence: 0.62,
    },
  ];

  assert.deepEqual(listSemanticTopics(topics), ["仕様の境界", "机"]);
  assert.deepEqual(listDurableSemanticTopics(topics), ["仕様の境界"]);

  const proactivePlan = buildSemanticProactivePlan(
    {
      act: "continue_work",
      stance: "measured",
      distance: "measured",
      focusTopic: "仕様の境界",
      emphasis: "maintenance",
      mentionBlocker: true,
      mentionReopen: false,
      mentionMaintenance: true,
      mentionIntent: true,
      variation: "brief",
      summary: "continue_work/measured/measured/maintenance on 仕様の境界",
    },
    {
      emit: true,
      stateTopic: "仕様の境界",
      place: "studio",
      worldAction: "touch",
    },
  );
  assert.equal(
    buildProactivePlanFromSemanticProactivePlan(proactivePlan).focusTopic,
    "仕様の境界",
  );

  const trace = buildStructuredTraceExtractionFromSemanticTraceHint({
    topics: ["仕様の境界"],
    stateTopics: ["仕様の境界"],
    kindHint: "spec_fragment",
    completion: 0.2,
    blockers: ["責務が曖昧"],
    memo: [],
    fragments: ["仕様の境界を切る"],
    decisions: [],
    nextSteps: ["候補を3つ出す"],
  });
  assert.ok(trace);
  assert.deepEqual(trace?.topics, ["仕様の境界"]);
  assert.equal(trace?.kindHint, "spec_fragment");
});
