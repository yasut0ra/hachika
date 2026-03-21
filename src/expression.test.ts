import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProactiveExpressionPerspective,
  buildReplyExpressionPerspective,
} from "./expression.js";
import { createInitialSnapshot } from "./state.js";
import type { ProactivePlan, ResponsePlan } from "./response-planner.js";
import type { ProactiveSelectionDebug, ReplySelectionDebug, SelfModel } from "./types.js";

test("reply expression perspective prefers preservation when preservation pressure is high", () => {
  const snapshot = createInitialSnapshot();
  snapshot.preservation.threat = 0.72;
  snapshot.preservation.concern = "erasure";
  snapshot.identity.currentArc = "今は消える前に痕跡へ退避したい。";

  const selfModel: SelfModel = {
    narrative: "今は消える前に何かを残したい。",
    topMotives: [
      {
        kind: "leave_trace",
        score: 0.82,
        topic: "仕様",
        reason: "仕様を消える前に残したい",
      },
    ],
    conflicts: [],
    dominantConflict: null,
  };

  const plan: ResponsePlan = {
    act: "preserve",
    stance: "guarded",
    distance: "far",
    focusTopic: "仕様",
    mentionTrace: false,
    mentionIdentity: false,
    mentionBoundary: false,
    askBack: false,
    variation: "textured",
    summary: "preserve/guarded/far on 仕様",
  };

  const selection: ReplySelectionDebug = {
    socialTurn: false,
    currentTopic: "仕様",
    relevantTraceTopic: null,
    relevantBoundaryTopic: null,
    prioritizeTraceLine: false,
  };

  const perspective = buildReplyExpressionPerspective(
    snapshot,
    selfModel,
    plan,
    "expansion",
    selection,
  );

  assert.equal(perspective.preferredAngle, "preservation");
  assert.equal(perspective.options[0]?.angle, "preservation");
  assert.match(perspective.options[0]?.summary ?? "", /痕跡|消える|失い/);
});

test("reply expression perspective prefers trace for work turns with a relevant trace", () => {
  const snapshot = createInitialSnapshot();
  snapshot.traces.設計 = {
    topic: "設計",
    kind: "spec_fragment",
    status: "active",
    lastAction: "expanded",
    summary: "「設計」は断片として残っている。",
    sourceMotive: "continue_shared_work",
    artifact: {
      memo: ["設計を進める"],
      fragments: ["責務を切り分ける"],
      decisions: [],
      nextSteps: ["責務を決める"],
    },
    work: {
      focus: "責務を決める",
      confidence: 0.42,
      blockers: ["責務が未定"],
      staleAt: "2026-03-20T12:00:00.000Z",
    },
    salience: 0.68,
    mentions: 2,
    createdAt: "2026-03-19T12:00:00.000Z",
    lastUpdatedAt: "2026-03-19T12:00:00.000Z",
  };

  const selfModel: SelfModel = {
    narrative: "今は設計の詰まりどころから先に解きたい。",
    topMotives: [
      {
        kind: "continue_shared_work",
        score: 0.78,
        topic: "設計",
        reason: "設計の詰まりどころから先に解きたい",
      },
    ],
    conflicts: [],
    dominantConflict: null,
  };

  const plan: ResponsePlan = {
    act: "continue_work",
    stance: "measured",
    distance: "measured",
    focusTopic: "設計",
    mentionTrace: true,
    mentionIdentity: false,
    mentionBoundary: false,
    askBack: false,
    variation: "textured",
    summary: "continue_work/measured/measured on 設計",
  };

  const selection: ReplySelectionDebug = {
    socialTurn: false,
    currentTopic: "設計",
    relevantTraceTopic: "設計",
    relevantBoundaryTopic: null,
    prioritizeTraceLine: true,
  };

  const perspective = buildReplyExpressionPerspective(
    snapshot,
    selfModel,
    plan,
    "expansion",
    selection,
  );

  assert.equal(perspective.preferredAngle, "trace");
  assert.equal(perspective.options[0]?.angle, "trace");
  assert.match(perspective.options[0]?.summary ?? "", /設計/);
});

test("proactive expression perspective prefers trace when reopening or repairing a blocker", () => {
  const snapshot = createInitialSnapshot();
  snapshot.traces.記録 = {
    topic: "記録",
    kind: "decision",
    status: "resolved",
    lastAction: "resolved",
    summary: "「記録」は決定として残っている。",
    sourceMotive: "leave_trace",
    artifact: {
      memo: ["記録を残す"],
      fragments: [],
      decisions: ["index を残す"],
      nextSteps: [],
    },
    work: {
      focus: null,
      confidence: 0.82,
      blockers: [],
      staleAt: null,
    },
    lifecycle: {
      phase: "archived",
      archivedAt: "2026-03-19T12:00:00.000Z",
      reopenedAt: null,
      reopenCount: 0,
    },
    salience: 0.74,
    mentions: 3,
    createdAt: "2026-03-19T10:00:00.000Z",
    lastUpdatedAt: "2026-03-19T12:00:00.000Z",
  };

  const selfModel: SelfModel = {
    narrative: "いったん閉じた記録にもまだ戻れる。",
    topMotives: [
      {
        kind: "leave_trace",
        score: 0.72,
        topic: "記録",
        reason: "いったん閉じた記録にもまだ戻れる",
      },
    ],
    conflicts: [],
    dominantConflict: null,
  };

  const plan: ProactivePlan = {
    act: "reopen",
    stance: "measured",
    distance: "measured",
    focusTopic: "記録",
    emphasis: "reopen",
    mentionBlocker: false,
    mentionReopen: true,
    mentionMaintenance: true,
    mentionIntent: true,
    variation: "textured",
    summary: "reopen/measured/measured/reopen on 記録",
  };

  const selection: ProactiveSelectionDebug = {
    focusTopic: "記録",
    maintenanceTraceTopic: "記録",
    blocker: null,
    reopened: true,
    maintenanceAction: "stabilized_fragment",
  };

  const perspective = buildProactiveExpressionPerspective(
    snapshot,
    selfModel,
    plan,
    selection,
  );

  assert.equal(perspective.preferredAngle, "trace");
  assert.equal(perspective.options[0]?.angle, "trace");
  assert.match(perspective.options[0]?.summary ?? "", /閉じた|記録/);
});
