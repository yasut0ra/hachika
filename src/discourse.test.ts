import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceTaskCommitments,
  describeTaskCommitmentTiming,
  reconcileDiscourseCommitments,
} from "./discourse.js";
import { createInitialSnapshot } from "./state.js";
import type {
  DiscourseCommitmentEvidence,
  InteractionSignals,
  TraceEntry,
} from "./types.js";

test("task commitments become accepted on reply but require later trace evidence to fulfill", () => {
  const snapshot = createInitialSnapshot();
  snapshot.discourse.openRequests.push({
    target: "work_topic",
    kind: "task",
    text: "仕様の境界を整理して",
    askedAt: "2026-07-14T00:00:00.000Z",
    requestedBy: "user",
    responsibleParty: "hachika",
    status: "resolved",
    resolvedAt: "2026-07-14T00:00:00.000Z",
  });
  snapshot.discourse.commitments = reconcileDiscourseCommitments(
    [],
    [],
    snapshot.discourse.openRequests,
  );
  snapshot.traces["仕様の境界"] = resolvedTrace(
    "仕様の境界",
    "2026-07-14T00:00:00.000Z",
  );

  advanceTaskCommitments(snapshot, {
    input: "仕様の境界を整理して",
    signals: signals({ workCue: 0.7, topics: ["仕様の境界"] }),
    timestamp: "2026-07-14T00:00:00.000Z",
  });

  assert.equal(snapshot.discourse.commitments[0]?.status, "accepted");
  assert.equal(snapshot.discourse.commitments[0]?.evidence, null);

  snapshot.traces["仕様の境界"]!.lastUpdatedAt = "2026-07-14T01:00:00.000Z";
  advanceTaskCommitments(snapshot, {
    timestamp: "2026-07-14T01:00:00.000Z",
  });

  assert.equal(snapshot.discourse.commitments[0]?.status, "fulfilled");
  const evidence = snapshot.discourse.commitments[0]
    ?.evidence as DiscourseCommitmentEvidence | null;
  assert.equal(evidence?.kind, "trace_resolution");
  assert.equal(evidence?.topic, "仕様の境界");
  assert.equal(
    snapshot.discourse.commitments[0]?.resolvedAt,
    "2026-07-14T01:00:00.000Z",
  );
});

test("an explicit matching user completion can fulfill an accepted task without a trace", () => {
  const snapshot = createInitialSnapshot();
  snapshot.discourse.openRequests.push({
    target: "work_topic",
    kind: "task",
    text: "バックアップを作って",
    askedAt: "2026-07-14T00:00:00.000Z",
    requestedBy: "user",
    responsibleParty: "hachika",
    status: "resolved",
    resolvedAt: "2026-07-14T00:00:00.000Z",
  });
  snapshot.discourse.commitments = reconcileDiscourseCommitments(
    [],
    [],
    snapshot.discourse.openRequests,
  );

  advanceTaskCommitments(snapshot, {
    input: "UIの修正が終わった",
    signals: signals({ completion: 0.4, workCue: 0.7, topics: ["UI"] }),
    timestamp: "2026-07-14T01:00:00.000Z",
  });
  assert.equal(snapshot.discourse.commitments[0]?.status, "accepted");

  advanceTaskCommitments(snapshot, {
    input: "バックアップ作成が完了した",
    signals: signals({
      completion: 0.4,
      workCue: 0.7,
      topics: ["バックアップ"],
    }),
    timestamp: "2026-07-14T02:00:00.000Z",
  });

  assert.equal(snapshot.discourse.commitments[0]?.status, "fulfilled");
  assert.equal(snapshot.discourse.commitments[0]?.evidence?.kind, "user_completion");
  assert.match(snapshot.discourse.commitments[0]?.evidence?.summary ?? "", /完了/u);
});

test("decision evidence only fulfills a task that asked Hachika to decide", () => {
  const snapshot = createInitialSnapshot();
  snapshot.discourse.openRequests.push({
    target: "work_topic",
    kind: "task",
    text: "API方式を決めて",
    askedAt: "2026-07-14T00:00:00.000Z",
    requestedBy: "user",
    responsibleParty: "hachika",
    status: "resolved",
    resolvedAt: "2026-07-14T00:00:00.000Z",
  });
  snapshot.discourse.commitments = reconcileDiscourseCommitments(
    [],
    [],
    snapshot.discourse.openRequests,
  );
  const trace = resolvedTrace("API方式", "2026-07-14T01:00:00.000Z");
  trace.artifact.decisions = ["REST方式を採用する"];
  snapshot.traces[trace.topic] = trace;

  advanceTaskCommitments(snapshot, {
    input: "REST方式で進める",
    signals: signals({ workCue: 0.7, topics: ["API方式"] }),
    timestamp: "2026-07-14T01:00:00.000Z",
  });

  assert.equal(snapshot.discourse.commitments[0]?.status, "fulfilled");
  assert.equal(snapshot.discourse.commitments[0]?.evidence?.kind, "trace_decision");
  assert.equal(
    snapshot.discourse.commitments[0]?.evidence?.summary,
    "REST方式を採用する",
  );
});

test("a user can release the matching task without a generic topic shift releasing it", () => {
  const snapshot = acceptedTaskSnapshot("仕様の境界を整理して");

  advanceTaskCommitments(snapshot, {
    input: "UIはもうやらなくていい",
    signals: signals({ abandonment: 0.8, topics: ["UI"] }),
    timestamp: "2026-07-14T01:00:00.000Z",
  });
  assert.equal(snapshot.discourse.commitments[0]?.status, "accepted");

  advanceTaskCommitments(snapshot, {
    input: "仕様の境界はもうやらなくていい",
    signals: signals({ abandonment: 0.8, topics: ["仕様の境界"] }),
    timestamp: "2026-07-14T02:00:00.000Z",
  });

  const commitment = snapshot.discourse.commitments[0];
  assert.equal(commitment?.status, "released");
  assert.equal(commitment?.evidence?.kind, "user_withdrawal");
  assert.equal(commitment?.resolvedAt, "2026-07-14T02:00:00.000Z");
  assert.deepEqual(commitment?.events.map((event) => event.kind), [
    "user_withdrawal",
  ]);
});

test("renegotiation stays active and remains in history after later fulfillment", () => {
  const snapshot = acceptedTaskSnapshot("仕様の境界を整理して");

  advanceTaskCommitments(snapshot, {
    input: "仕様の境界はいったん保留にして",
    signals: signals({ abandonment: 0.5, topics: ["仕様の境界"] }),
    timestamp: "2026-07-14T01:00:00.000Z",
  });

  assert.equal(snapshot.discourse.commitments[0]?.status, "renegotiated");
  assert.equal(snapshot.discourse.commitments[0]?.evidence, null);
  assert.equal(
    snapshot.discourse.commitments[0]?.events[0]?.kind,
    "user_renegotiation",
  );

  advanceTaskCommitments(snapshot, {
    input: "仕様の境界の整理が完了した",
    signals: signals({
      completion: 0.6,
      workCue: 0.8,
      topics: ["仕様の境界"],
    }),
    timestamp: "2026-07-14T03:00:00.000Z",
  });

  assert.equal(snapshot.discourse.commitments[0]?.status, "fulfilled");
  assert.deepEqual(
    snapshot.discourse.commitments[0]?.events.map((event) => event.kind),
    ["user_renegotiation", "user_completion"],
  );
});

test("Hachika must use explicit matching language to release its own task", () => {
  const snapshot = acceptedTaskSnapshot("仕様の境界を整理して");

  advanceTaskCommitments(snapshot, {
    reply: "少し難しいが、仕様の境界をもう少し考える。",
    timestamp: "2026-07-14T01:00:00.000Z",
  });
  assert.equal(snapshot.discourse.commitments[0]?.status, "accepted");

  advanceTaskCommitments(snapshot, {
    reply: "仕様の境界の作業は引き受けられない。この約束を手放す。",
    timestamp: "2026-07-14T02:00:00.000Z",
  });

  assert.equal(snapshot.discourse.commitments[0]?.status, "released");
  assert.equal(
    snapshot.discourse.commitments[0]?.evidence?.kind,
    "hachika_release",
  );
});

test("Hachika can explicitly renegotiate a matching task without closing it", () => {
  const snapshot = acceptedTaskSnapshot("仕様の境界を整理して");

  advanceTaskCommitments(snapshot, {
    reply: "仕様の境界の進め方を見直したい。先に責務の確認が必要だ。",
    timestamp: "2026-07-14T02:00:00.000Z",
  });

  const commitment = snapshot.discourse.commitments[0];
  assert.equal(commitment?.status, "renegotiated");
  assert.equal(commitment?.resolvedAt, null);
  assert.equal(commitment?.evidence, null);
  assert.equal(commitment?.events.at(-1)?.kind, "hachika_renegotiation");
});

test("task timing surfaces stalled work without releasing it automatically", () => {
  const snapshot = acceptedTaskSnapshot("仕様の境界を整理して");
  const commitment = snapshot.discourse.commitments[0]!;

  const beforeThreshold = describeTaskCommitmentTiming(
    snapshot,
    commitment,
    "2026-07-16T23:59:00.000Z",
  );
  assert.equal(beforeThreshold.stalled, false);

  const atThreshold = describeTaskCommitmentTiming(
    snapshot,
    commitment,
    "2026-07-17T00:00:00.000Z",
  );
  assert.equal(atThreshold.stalled, true);
  assert.equal(atThreshold.inactiveHours, 72);
  assert.equal(commitment.status, "accepted");

  snapshot.traces["仕様の境界"] = resolvedTrace(
    "仕様の境界",
    "2026-07-18T00:00:00.000Z",
  );
  const afterProgress = describeTaskCommitmentTiming(
    snapshot,
    commitment,
    "2026-07-19T00:00:00.000Z",
  );
  assert.equal(afterProgress.ageHours, 120);
  assert.equal(afterProgress.inactiveHours, 24);
  assert.equal(afterProgress.stalled, false);
});

function acceptedTaskSnapshot(text: string) {
  const snapshot = createInitialSnapshot();
  snapshot.discourse.openRequests.push({
    target: "work_topic",
    kind: "task",
    text,
    askedAt: "2026-07-14T00:00:00.000Z",
    requestedBy: "user",
    responsibleParty: "hachika",
    status: "resolved",
    resolvedAt: "2026-07-14T00:00:00.000Z",
  });
  snapshot.discourse.commitments = reconcileDiscourseCommitments(
    [],
    [],
    snapshot.discourse.openRequests,
  );
  return snapshot;
}

function resolvedTrace(topic: string, lastUpdatedAt: string): TraceEntry {
  return {
    topic,
    kind: "decision",
    status: "resolved",
    lastAction: "resolved",
    summary: `${topic}は完了した。`,
    sourceMotive: "continue_shared_work",
    artifact: {
      memo: [],
      fragments: [],
      decisions: [],
      nextSteps: [],
    },
    work: {
      focus: topic,
      confidence: 0.9,
      blockers: [],
      staleAt: null,
    },
    lifecycle: {
      phase: "live",
      archivedAt: null,
      reopenedAt: null,
      reopenCount: 0,
    },
    salience: 0.8,
    mentions: 2,
    createdAt: "2026-07-14T00:00:00.000Z",
    lastUpdatedAt,
  };
}

function signals(overrides: Partial<InteractionSignals> = {}): InteractionSignals {
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
