import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProactivePlan,
  buildResponsePlan,
  buildResponsePlannerPayload,
  isSocialTurnSignals,
  normalizePlannedResponsePlan,
} from "./response-planner.js";
import { createInitialSnapshot } from "./state.js";
import type { InteractionSignals, PendingInitiative, SelfModel, TraceEntry } from "./types.js";

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

test("response planner treats explicit topic shifts as social and suppresses trace focus", () => {
  const snapshot = createInitialSnapshot();
  const signals = createSignals({
    abandonment: 0.92,
    smalltalk: 0.24,
  });
  const selfModel = createSelfModel("continue_shared_work", "自分");

  const plan = buildResponsePlan(snapshot, "warm", "continuity", signals, selfModel);

  assert.equal(isSocialTurnSignals(signals), true);
  assert.equal(plan.act, "attune");
  assert.equal(plan.mentionTrace, false);
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
  assert.equal(plan.askBack, false);
});

test("response planner can surface the current world without dragging stale work focus in", () => {
  const snapshot = createInitialSnapshot();
  snapshot.purpose.active = {
    kind: "continue_shared_work",
    topic: "設計",
    summary: "設計を前へ進めたい。",
    confidence: 0.66,
    progress: 0.28,
    createdAt: "2026-03-20T00:00:00.000Z",
    lastUpdatedAt: "2026-03-20T00:00:00.000Z",
    turnsActive: 1,
  };
  const signals = createSignals({
    question: 0.84,
    worldInquiry: 0.92,
  });
  const selfModel = createSelfModel("continue_shared_work", "設計");

  const plan = buildResponsePlan(snapshot, "curious", "curiosity", signals, selfModel);

  assert.equal(plan.act, "self_disclose");
  assert.equal(plan.focusTopic, null);
  assert.equal(plan.mentionTrace, false);
  assert.equal(plan.mentionIdentity, false);
  assert.equal(plan.mentionWorld, true);
});

test("response planner keeps repair turns loosely focused when no concrete topic is named", () => {
  const snapshot = createInitialSnapshot();
  snapshot.purpose.active = {
    kind: "continue_shared_work",
    topic: "設計",
    summary: "設計を前へ進めたい。",
    confidence: 0.62,
    progress: 0.3,
    createdAt: "2026-03-20T00:00:00.000Z",
    lastUpdatedAt: "2026-03-20T00:00:00.000Z",
    turnsActive: 1,
  };
  const signals = createSignals({
    repair: 0.92,
    intimacy: 0.24,
    topics: [],
  });
  const selfModel = createSelfModel("continue_shared_work", "設計");

  const plan = buildResponsePlan(snapshot, "warm", "relation", signals, selfModel);

  assert.equal(plan.act, "repair");
  assert.equal(plan.focusTopic, null);
  assert.equal(plan.mentionTrace, false);
});

test("response planner answers relation clarification directly instead of reopening exploration", () => {
  const snapshot = createInitialSnapshot();
  snapshot.purpose.active = {
    kind: "deepen_relation",
    topic: "名前",
    summary: "呼び方を少しずつ馴染ませたい。",
    confidence: 0.62,
    progress: 0.24,
    createdAt: "2026-03-20T00:00:00.000Z",
    lastUpdatedAt: "2026-03-20T00:00:00.000Z",
    turnsActive: 1,
  };
  const signals = createSignals({
    question: 0.82,
    topics: [],
  });
  const selfModel = createSelfModel("deepen_relation", "名前");

  const plan = buildResponsePlan(snapshot, "warm", "relation", signals, selfModel);

  assert.equal(plan.act, "attune");
  assert.equal(plan.focusTopic, null);
  assert.equal(plan.askBack, false);
  assert.equal(plan.mentionTrace, false);
});

test("response planner turns topicless open questions into clarify-first exploration", () => {
  const snapshot = createInitialSnapshot();
  const signals = createSignals({
    question: 0.86,
    topics: [],
  });
  const selfModel = createSelfModel("continue_shared_work", "設計");

  const plan = buildResponsePlan(snapshot, "curious", "curiosity", signals, selfModel);

  assert.equal(plan.act, "explore");
  assert.equal(plan.focusTopic, null);
  assert.equal(plan.askBack, true);
  assert.equal(plan.mentionTrace, false);
});

test("llm response planner payload surfaces rule plan and candidate topics", () => {
  const previousSnapshot = createInitialSnapshot();
  const nextSnapshot = createInitialSnapshot();
  nextSnapshot.identity.anchors = ["設計"];
  nextSnapshot.purpose.active = {
    kind: "continue_shared_work",
    topic: "設計",
    summary: "設計を前に進めたい。",
    confidence: 0.7,
    progress: 0.32,
    createdAt: "2026-03-20T00:00:00.000Z",
    lastUpdatedAt: "2026-03-20T00:00:00.000Z",
    turnsActive: 1,
  };
  nextSnapshot.traces.設計 = createTrace("設計", "spec_fragment");
  const signals = createSignals({
    question: 0.64,
    workCue: 0.74,
    topics: ["設計"],
  });
  const rulePlan = buildResponsePlan(
    nextSnapshot,
    "curious",
    "curiosity",
    signals,
    createSelfModel("continue_shared_work", "設計"),
  );

  const payload = buildResponsePlannerPayload({
    input: "設計はどう進める？",
    previousSnapshot,
    nextSnapshot,
    mood: "curious",
    dominantDrive: "curiosity",
    signals,
    selfModel: createSelfModel("continue_shared_work", "設計"),
    rulePlan,
    behaviorDirective: {
      directAnswer: false,
      boundaryAction: "allow",
      worldAction: "allow",
    },
  });

  assert.equal(payload.rulePlan.act, rulePlan.act);
  assert.equal(payload.behaviorDirective.directAnswer, false);
  assert.equal(payload.rulePlan.focusTopic, "設計");
  assert.equal(payload.rulePlan.mentionWorld, false);
  assert.ok(payload.candidateTopics.includes("設計"));
  assert.equal(payload.traces[0]?.topic, "設計");
  assert.equal(payload.world.currentPlace, nextSnapshot.world.currentPlace);
  assert.match(payload.world.summary, /threshold|studio|archive|朝|昼|夕方|夜/);
});

test("llm response planner normalization keeps focus within candidate topics", () => {
  const fallbackPlan = {
    act: "continue_work",
    stance: "measured",
    distance: "measured",
    focusTopic: "設計",
    mentionTrace: true,
    mentionIdentity: false,
    mentionBoundary: false,
    mentionWorld: false,
    askBack: false,
    variation: "textured",
    summary: "continue_work/measured/measured on 設計",
  } as const;

  const normalized = normalizePlannedResponsePlan(
    JSON.stringify({
      act: "explore",
      stance: "open",
      distance: "close",
      focusTopic: "仕様",
      mentionTrace: false,
      askBack: true,
      variation: "questioning",
    }),
    fallbackPlan,
    ["設計", "仕様"],
  );

  assert.equal(normalized?.act, "explore");
  assert.equal(normalized?.stance, "open");
  assert.equal(normalized?.distance, "close");
  assert.equal(normalized?.focusTopic, "仕様");
  assert.equal(normalized?.mentionTrace, false);
  assert.equal(normalized?.askBack, true);
  assert.equal(normalized?.summary, "explore/open/close on 仕様");
});

test("llm response planner normalization keeps concrete work on continue_work when only the tone softens", () => {
  const fallbackPlan = {
    act: "continue_work",
    stance: "measured",
    distance: "measured",
    focusTopic: "仕様の境界",
    mentionTrace: true,
    mentionIdentity: false,
    mentionBoundary: false,
    mentionWorld: false,
    askBack: false,
    variation: "textured",
    summary: "continue_work/measured/measured on 仕様の境界",
  } as const;

  const normalized = normalizePlannedResponsePlan(
    JSON.stringify({
      act: "explore",
      stance: "guarded",
      distance: "far",
      focusTopic: "仕様の境界",
      mentionTrace: true,
      askBack: false,
      variation: "textured",
    }),
    fallbackPlan,
    ["仕様の境界"],
  );

  assert.equal(normalized?.act, "continue_work");
  assert.equal(normalized?.focusTopic, "仕様の境界");
  assert.equal(normalized?.summary, "continue_work/guarded/far on 仕様の境界");
});

test("llm response planner normalization can still soften into explore when the focus topic changes", () => {
  const fallbackPlan = {
    act: "continue_work",
    stance: "measured",
    distance: "measured",
    focusTopic: "仕様の境界",
    mentionTrace: true,
    mentionIdentity: false,
    mentionBoundary: false,
    mentionWorld: false,
    askBack: false,
    variation: "textured",
    summary: "continue_work/measured/measured on 仕様の境界",
  } as const;

  const normalized = normalizePlannedResponsePlan(
    JSON.stringify({
      act: "explore",
      stance: "open",
      distance: "mid",
      focusTopic: "責務",
      mentionTrace: true,
      askBack: true,
      variation: "questioning",
    }),
    fallbackPlan,
    ["仕様の境界", "責務"],
  );

  assert.equal(normalized?.act, "explore");
  assert.equal(normalized?.focusTopic, "責務");
  assert.equal(normalized?.summary, "explore/open/measured on 責務");
});

test("proactive planner prioritizes blocker repair when a blocker is pending", () => {
  const snapshot = createInitialSnapshot();
  const pending = createPending({
    motive: "continue_shared_work",
    topic: "仕様",
    blocker: "責務が未定",
  });
  const maintenance = {
    action: "added_next_step" as const,
    trace: createTrace("仕様", "spec_fragment"),
  };

  const plan = buildProactivePlan(snapshot, pending, 0.2, maintenance);

  assert.equal(plan.act, "untangle");
  assert.equal(plan.emphasis, "blocker");
  assert.equal(plan.mentionBlocker, true);
  assert.equal(plan.mentionMaintenance, true);
});

test("proactive planner treats reopened archived work as reopen-first", () => {
  const snapshot = createInitialSnapshot();
  snapshot.body.boredom = 0.82;
  const pending = createPending({
    motive: "continue_shared_work",
    topic: "設計",
  });
  const trace = createTrace("設計", "spec_fragment");
  trace.lastUpdatedAt = "2026-03-20T12:00:00.000Z";
  trace.lifecycle = {
    phase: "live",
    archivedAt: "2026-03-19T12:00:00.000Z",
    reopenedAt: "2026-03-20T12:00:00.000Z",
    reopenCount: 1,
  };

  const plan = buildProactivePlan(snapshot, pending, 0.55, {
    action: "stabilized_fragment",
    trace,
  });

  assert.equal(plan.act, "reopen");
  assert.equal(plan.emphasis, "reopen");
  assert.equal(plan.mentionReopen, true);
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

function createPending(
  overrides: Partial<PendingInitiative> = {},
): PendingInitiative {
  return {
    kind: "resume_topic",
    reason: "expansion",
    motive: "continue_shared_work",
    topic: "仕様",
    blocker: null,
    concern: null,
    createdAt: "2026-03-20T10:00:00.000Z",
    readyAfterHours: 4,
    ...overrides,
  };
}

function createTrace(
  topic: string,
  kind: TraceEntry["kind"],
): TraceEntry {
  return {
    topic,
    kind,
    status: "active",
    lastAction: "expanded",
    summary: `「${topic}」は痕跡として残っている。`,
    sourceMotive: "continue_shared_work",
    artifact: {
      memo: [topic],
      fragments: [],
      decisions: [],
      nextSteps: ["次を決める"],
    },
    work: {
      focus: "次を決める",
      confidence: 0.46,
      blockers: [],
      staleAt: "2026-03-21T10:00:00.000Z",
    },
    salience: 0.68,
    mentions: 2,
    createdAt: "2026-03-20T10:00:00.000Z",
    lastUpdatedAt: "2026-03-20T10:00:00.000Z",
  };
}
