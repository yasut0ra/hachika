import assert from "node:assert/strict";
import test from "node:test";

import { createInitialSnapshot } from "./state.js";
import {
  buildProactiveDirectorPayload,
  normalizeProactiveDirective,
} from "./proactive-director.js";
import type { ProactivePlan } from "./response-planner.js";

function createRulePlan(): ProactivePlan {
  return {
    act: "leave_trace",
    stance: "measured",
    distance: "measured",
    focusTopic: "仕様の境界",
    emphasis: "maintenance",
    mentionBlocker: false,
    mentionReopen: false,
    mentionMaintenance: true,
    mentionIntent: true,
    variation: "brief",
    summary: "leave_trace/measured/measured/maintenance on 仕様の境界",
  };
}

test("normalizeProactiveDirective can parse emit and plan override", () => {
  const fallbackPlan = createRulePlan();

  const directive = normalizeProactiveDirective(
    JSON.stringify({
      emit: true,
      plan: {
        act: "continue_work",
        stance: "open",
        distance: "close",
        focusTopic: "仕様の境界",
        emphasis: "relation",
        mentionBlocker: true,
        mentionReopen: false,
        mentionMaintenance: false,
        mentionIntent: true,
        variation: "questioning",
      },
      summary: "emit/continue_work",
    }),
    fallbackPlan,
  );

  assert.ok(directive !== null);
  assert.equal(directive?.emit, true);
  assert.equal(directive?.plan?.act, "continue_work");
  assert.equal(directive?.plan?.stance, "open");
  assert.equal(directive?.plan?.variation, "questioning");
});

test("buildProactiveDirectorPayload keeps candidate topics grounded", () => {
  const previousSnapshot = createInitialSnapshot();
  const nextSnapshot = createInitialSnapshot();
  nextSnapshot.identity.anchors = ["仕様の境界", "世界", "関係"];
  nextSnapshot.purpose.active = {
    kind: "continue_shared_work",
    topic: "仕様の境界",
    summary: "仕様の境界を前に進めたい",
    confidence: 0.8,
    progress: 0.2,
    createdAt: "2026-03-29T00:00:00.000Z",
    lastUpdatedAt: "2026-03-29T00:00:00.000Z",
    turnsActive: 2,
  };

  const payload = buildProactiveDirectorPayload({
    previousSnapshot,
    nextSnapshot,
    pending: {
      kind: "resume_topic",
      reason: "continuity",
      motive: "continue_shared_work",
      topic: "仕様の境界",
      stateTopic: "仕様の境界",
      blocker: "責務分離が曖昧",
      concern: null,
      createdAt: "2026-03-29T00:00:00.000Z",
      readyAfterHours: 0,
      place: "studio",
      worldAction: "touch",
    },
    neglectLevel: 0.42,
    rulePlan: createRulePlan(),
    selection: {
      focusTopic: "仕様の境界",
      stateTopic: "仕様の境界",
      maintenanceTraceTopic: "仕様の境界",
      blocker: "責務分離が曖昧",
      place: "studio",
      worldAction: "touch",
      reopened: false,
      maintenanceAction: null,
    },
  });

  assert.ok(payload.candidateTopics.includes("仕様の境界"));
  assert.equal(payload.pending.place, "studio");
  assert.equal(payload.pending.stateTopic, "仕様の境界");
  assert.equal(payload.rulePlan.act, "leave_trace");
});
