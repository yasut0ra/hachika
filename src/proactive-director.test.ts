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
      topics: ["仕様の境界"],
      stateTopics: ["仕様の境界"],
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
    ["仕様の境界"],
    ["仕様の境界"],
  );

  assert.ok(directive !== null);
  assert.equal(directive?.emit, true);
  assert.equal(directive?.plan?.act, "continue_work");
  assert.equal(directive?.plan?.stance, "open");
  assert.equal(directive?.plan?.variation, "questioning");
  assert.deepEqual(directive?.topics, ["仕様の境界"]);
  assert.deepEqual(directive?.stateTopics, ["仕様の境界"]);
  assert.equal(directive?.semantic?.mode, "proactive");
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
  nextSnapshot.lastInteractionAt = "2026-03-29T01:00:00.000Z";
  nextSnapshot.traces["仕様の境界"] = {
    topic: "仕様の境界",
    kind: "spec_fragment",
    status: "active",
    lastAction: "continued",
    summary: "仕様の境界は責務分離の途中にある。",
    sourceMotive: "continue_shared_work",
    artifact: {
      memo: ["仕様の境界を整理する"],
      fragments: ["責務を分離する"],
      decisions: [],
      nextSteps: ["公開APIを決める"],
    },
    work: {
      focus: "責務分離",
      confidence: 0.6,
      blockers: ["責務分離が曖昧"],
      staleAt: null,
    },
    salience: 0.7,
    mentions: 2,
    createdAt: "2026-03-29T00:00:00.000Z",
    lastUpdatedAt: "2026-03-29T01:00:00.000Z",
  };
  nextSnapshot.initiative.history.push({
    kind: "proactive_emission",
    autonomyAction: "speak",
    timestamp: "2026-03-29T02:00:00.000Z",
    motive: "continue_shared_work",
    topic: "仕様の境界",
    traceTopic: "仕様の境界",
    blocker: "責務分離が曖昧",
    place: "studio",
    worldAction: "touch",
    maintenanceAction: null,
    reopened: false,
    hours: null,
    summary: "仕様の境界へ触れ直した。",
  });
  nextSnapshot.discourse.commitments.push({
    owner: "hachika",
    kind: "task",
    source: "request",
    sourceAskedAt: "2026-03-29T00:00:00.000Z",
    target: "work_topic",
    text: "仕様の境界を整理して",
    status: "accepted",
    createdAt: "2026-03-29T00:00:00.000Z",
    acceptedAt: "2026-03-29T00:05:00.000Z",
    resolvedAt: null,
    evidence: null,
  });

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
  assert.equal(payload.recentOutward.length, 1);
  assert.equal(payload.recentOutward[0]?.motive, "continue_shared_work");
  assert.equal(payload.userInteractedSinceLastOutward, false);
  assert.equal(payload.memoryThread?.traceTopics[0], "仕様の境界");
  assert.deepEqual(payload.memoryThread?.nextSteps, ["公開APIを決める"]);
  assert.equal(payload.discourse.openHachikaCommitments[0]?.status, "accepted");
  assert.equal(payload.discourse.openHachikaCommitments[0]?.kind, "task");
});

test("normalizeProactiveDirective can parse semantic-director v2 proactive contract", () => {
  const directive = normalizeProactiveDirective(
    JSON.stringify({
      mode: "proactive",
      topics: [
        {
          topic: "仕様の境界",
          source: "trace",
          durability: "durable",
          confidence: 0.93,
        },
        {
          topic: "机",
          source: "world",
          durability: "ephemeral",
          confidence: 0.56,
        },
      ],
      proactivePlan: {
        emit: true,
        act: "continue_work",
        stance: "open",
        distance: "close",
        focusTopic: "仕様の境界",
        stateTopic: "仕様の境界",
        emphasis: "maintenance",
        mentionBlocker: true,
        mentionReopen: false,
        mentionMaintenance: true,
        mentionIntent: true,
        variation: "questioning",
        place: "studio",
        worldAction: "touch",
      },
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
      summary: "proactive/continue_work",
    }),
    createRulePlan(),
    ["仕様の境界"],
    ["仕様の境界"],
  );

  assert.ok(directive);
  assert.equal(directive?.semantic?.mode, "proactive");
  assert.equal(directive?.emit, true);
  assert.equal(directive?.plan?.act, "continue_work");
  assert.equal(directive?.plan?.stance, "open");
  assert.deepEqual(directive?.topics, ["仕様の境界", "机"]);
  assert.deepEqual(directive?.stateTopics, ["仕様の境界"]);
  assert.equal(directive?.semantic?.proactivePlan.place, "studio");
  assert.equal(directive?.semantic?.proactivePlan.worldAction, "touch");
});
