import assert from "node:assert/strict";
import test from "node:test";

import { buildProactivePlan, buildResponsePlan, isSocialTurnSignals } from "./response-planner.js";
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
