import assert from "node:assert/strict";
import test from "node:test";

import { reconcileDiscourseCommitments } from "./discourse.js";
import {
  canAutonomouslySurfaceMemoryThread,
  deriveMemoryThreads,
  hasNewMemoryThreadFrontier,
  recordMemoryThreadLifecycleFromTurn,
  selectMemoryThread,
} from "./memory-threads.js";
import { createInitialSnapshot } from "./state.js";
import { updateIdentity } from "./identity.js";
import { updatePurpose } from "./purpose.js";
import type { InteractionSignals, TraceEntry, TraceKind } from "./types.js";

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

function trace(
  topic: string,
  updatedAt: string,
  options: {
    kind?: TraceKind;
    memo?: string[];
    decisions?: string[];
    nextSteps?: string[];
  } = {},
): TraceEntry {
  const kind = options.kind ?? "continuity_marker";
  return {
    topic,
    kind,
    status: kind === "decision" ? "resolved" : "active",
    lastAction: kind === "decision" ? "resolved" : "continued",
    summary: `${topic} の記録`,
    sourceMotive: "continue_shared_work",
    artifact: {
      memo: options.memo ?? [],
      fragments: [],
      decisions: options.decisions ?? [],
      nextSteps: options.nextSteps ?? [],
    },
    work: {
      focus: null,
      confidence: 0.6,
      blockers: [],
      staleAt: null,
    },
    salience: 0.7,
    mentions: 1,
    createdAt: updatedAt,
    lastUpdatedAt: updatedAt,
  };
}

test("deriveMemoryThreads connects fragmented traces into a chronology", () => {
  const snapshot = createInitialSnapshot();
  snapshot.traces = {
    "夏インターン選考": trace(
      "夏インターン選考",
      "2026-07-01T00:00:00.000Z",
      { decisions: ["夏インターンの参加先は決定済み"] },
    ),
    "広告アルゴリズムの業務": trace(
      "広告アルゴリズムの業務",
      "2026-07-02T00:00:00.000Z",
      { memo: ["インターンでは広告配信モデルを改善する"] },
    ),
    "6週間の予定": trace(
      "6週間の予定",
      "2026-07-03T00:00:00.000Z",
      {
        memo: ["インターンは合計6週間で夏休みが忙しくなる"],
        nextSteps: ["大学の課題を先に終わらせる"],
      },
    ),
    "引越し": trace("引越し", "2026-07-04T00:00:00.000Z", {
      memo: ["秋に部屋を移る"],
    }),
  };

  const threads = deriveMemoryThreads(snapshot);
  const internship = threads.find((thread) =>
    thread.traceTopics.includes("夏インターン選考"),
  );

  assert.ok(internship);
  assert.deepEqual(internship.traceTopics, [
    "夏インターン選考",
    "広告アルゴリズムの業務",
    "6週間の予定",
  ]);
  assert.equal(internship.episodes.at(-1)?.traceTopic, "6週間の予定");
  assert.ok(internship.facts.includes("夏インターンの参加先は決定済み"));
  assert.ok(internship.nextSteps.includes("大学の課題を先に終わらせる"));
  assert.equal(threads.some((thread) => thread.traceTopics.includes("引越し")), true);
  assert.equal(threads.length, 2);
});

test("deriveMemoryThreads removes synthetic continuation boilerplate", () => {
  const snapshot = createInitialSnapshot();
  snapshot.traces.インターン = trace(
    "インターン",
    "2026-07-01T00:00:00.000Z",
    {
      memo: ["参加は決定済み"],
      nextSteps: [
        "インターン を次に触れられる形へ整える",
        "大学の課題を終わらせる",
      ],
    },
  );

  const thread = deriveMemoryThreads(snapshot)[0];
  assert.deepEqual(thread?.nextSteps, ["大学の課題を終わらせる"]);
});

test("selectMemoryThread resolves a member topic to the whole thread", () => {
  const snapshot = createInitialSnapshot();
  snapshot.traces.インターン選考 = trace(
    "インターン選考",
    "2026-07-01T00:00:00.000Z",
  );
  snapshot.traces.インターン業務 = trace(
    "インターン業務",
    "2026-07-02T00:00:00.000Z",
  );

  const selected = selectMemoryThread(snapshot, ["インターン業務"]);
  assert.deepEqual(selected?.traceTopics, ["インターン選考", "インターン業務"]);
  assert.equal(selectMemoryThread(snapshot, [null, "未知の話題"]), null);
});

test("thread lifecycle closes a subject and reopens it only on a user return", () => {
  const previous = createInitialSnapshot();
  previous.traces.インターン = trace(
    "インターン",
    "2026-07-01T00:00:00.000Z",
    { memo: ["参加先は決定済み"] },
  );
  previous.purpose.active = {
    kind: "seek_continuity",
    topic: "インターン",
    summary: "インターンの話を保つ",
    confidence: 0.7,
    progress: 0.4,
    createdAt: "2026-07-01T00:00:00.000Z",
    lastUpdatedAt: "2026-07-01T00:00:00.000Z",
    turnsActive: 2,
  };
  const closed = structuredClone(previous);

  const closeEvent = recordMemoryThreadLifecycleFromTurn(
    previous,
    closed,
    "インターンの話はもう終わりにしましょう",
    signals({ abandonment: 0.8 }),
    "2026-07-02T00:00:00.000Z",
  );

  assert.equal(closeEvent?.phase, "closed");
  assert.equal(deriveMemoryThreads(closed)[0]?.phase, "closed");
  assert.equal(canAutonomouslySurfaceMemoryThread(closed, "インターン"), false);

  const reopened = structuredClone(closed);
  const reopenEvent = recordMemoryThreadLifecycleFromTurn(
    closed,
    reopened,
    "インターンの続きを話そう",
    signals({ memoryCue: 0.7, topics: ["インターン"] }),
    "2026-07-03T00:00:00.000Z",
  );

  assert.equal(reopenEvent?.phase, "reopened");
  assert.equal(deriveMemoryThreads(reopened)[0]?.phase, "reopened");
  assert.equal(canAutonomouslySurfaceMemoryThread(reopened, "インターン"), true);
});

test("a generic memory question cannot reopen the latest closed thread", () => {
  const previous = createInitialSnapshot();
  previous.traces.インターン = trace("インターン", "2026-07-01T00:00:00.000Z");
  previous.purpose.active = {
    kind: "seek_continuity",
    topic: "インターン",
    summary: "インターンの話を保つ",
    confidence: 0.7,
    progress: 0.4,
    createdAt: "2026-07-01T00:00:00.000Z",
    lastUpdatedAt: "2026-07-01T00:00:00.000Z",
    turnsActive: 2,
  };
  const closed = structuredClone(previous);
  recordMemoryThreadLifecycleFromTurn(
    previous,
    closed,
    "もうインターンの話はいいって。もう話したくない",
    signals({ abandonment: 0.8 }),
    "2026-07-02T00:00:00.000Z",
  );
  const next = structuredClone(closed);

  const event = recordMemoryThreadLifecycleFromTurn(
    closed,
    next,
    "私の名前はちゃんと覚えていますか",
    signals({ memoryCue: 0.8, topics: ["名前"] }),
    "2026-07-03T00:00:00.000Z",
  );

  assert.equal(event, null);
  assert.equal(deriveMemoryThreads(next)[0]?.phase, "closed");
});

test("closed threads cannot remain a purpose or identity anchor", () => {
  const snapshot = createInitialSnapshot();
  snapshot.traces.インターン = trace("インターン", "2026-07-01T00:00:00.000Z");
  snapshot.topicCounts.インターン = 12;
  snapshot.identity.anchors = ["インターン"];
  snapshot.purpose.active = {
    kind: "seek_continuity",
    topic: "インターン",
    summary: "インターンの話を保つ",
    confidence: 0.8,
    progress: 0.4,
    createdAt: "2026-07-01T00:00:00.000Z",
    lastUpdatedAt: "2026-07-01T00:00:00.000Z",
    turnsActive: 3,
  };
  snapshot.memoryThreadEvents.push({
    phase: "closed",
    topics: ["インターン"],
    timestamp: "2026-07-02T00:00:00.000Z",
    reason: "もうインターンの話はいい",
  });

  updatePurpose(
    snapshot,
    {
      narrative: "別の話へ移る",
      topMotives: [
        { kind: "seek_continuity", score: 0.9, topic: "インターン", reason: "古い痕跡" },
        { kind: "pursue_curiosity", score: 0.62, topic: "短編集", reason: "今の話" },
      ],
      conflicts: [],
      dominantConflict: null,
    },
    signals({ novelty: 0.4, topics: ["短編集"] }),
    "2026-07-03T00:00:00.000Z",
  );
  updateIdentity(snapshot, "2026-07-03T00:00:00.000Z");

  assert.equal(snapshot.purpose.lastResolved?.topic, "インターン");
  assert.equal(snapshot.purpose.lastResolved?.outcome, "abandoned");
  assert.equal(snapshot.purpose.active?.topic, "短編集");
  assert.equal(snapshot.identity.anchors.includes("インターン"), false);
});

test("topic shift parks the current thread without forgetting it", () => {
  const previous = createInitialSnapshot();
  previous.traces.設計 = trace("設計", "2026-07-01T00:00:00.000Z");
  previous.purpose.active = {
    kind: "continue_shared_work",
    topic: "設計",
    summary: "設計を進める",
    confidence: 0.7,
    progress: 0.4,
    createdAt: "2026-07-01T00:00:00.000Z",
    lastUpdatedAt: "2026-07-01T00:00:00.000Z",
    turnsActive: 2,
  };
  const next = structuredClone(previous);

  recordMemoryThreadLifecycleFromTurn(
    previous,
    next,
    "一旦置いて、別の話をしましょう",
    signals({ abandonment: 0.7 }),
    "2026-07-02T00:00:00.000Z",
  );

  const thread = deriveMemoryThreads(next)[0];
  assert.equal(thread?.phase, "parked");
  assert.deepEqual(thread?.traceTopics, ["設計"]);
});

test("legacy trace text can infer closure followed by a later user reopen", () => {
  const snapshot = createInitialSnapshot();
  snapshot.traces.インターン = trace(
    "インターン",
    "2026-07-02T00:00:00.000Z",
    { memo: ["もうインターンの話は終わりにしませんか"] },
  );
  snapshot.memories.push({
    role: "user",
    text: "インターン選考が一区切りついて安心した",
    timestamp: "2026-07-03T00:00:00.000Z",
    topics: [],
    sentiment: "positive",
  });

  const thread = deriveMemoryThreads(snapshot)[0];
  assert.equal(thread?.phase, "reopened");
  assert.match(thread?.lastLifecycleEvent?.reason ?? "", /一区切り/);
});

test("episode frontier prioritizes questions, blockers, and concrete next steps", () => {
  const snapshot = createInitialSnapshot();
  snapshot.traces.設計 = trace("設計", "2026-07-01T00:00:00.000Z", {
    memo: ["APIの境界を分ける"],
    nextSteps: ["公開インターフェースを決める"],
  });

  assert.equal(deriveMemoryThreads(snapshot)[0]?.frontier.kind, "next_step");
  assert.equal(
    deriveMemoryThreads(snapshot)[0]?.frontier.summary,
    "公開インターフェースを決める",
  );

  snapshot.traces.設計!.work.blockers = ["責務分離が曖昧"];
  assert.equal(deriveMemoryThreads(snapshot)[0]?.frontier.kind, "blocked");

  snapshot.discourse.openQuestions.push({
    target: "work_topic",
    text: "設計はどのAPIから分ける？",
    askedAt: "2026-07-01T00:30:00.000Z",
    askedBy: "user",
    answerExpectedFrom: "hachika",
    status: "open",
    resolvedAt: null,
  });
  assert.equal(deriveMemoryThreads(snapshot)[0]?.frontier.kind, "blocked");

  snapshot.discourse.openQuestions.push({
    target: "work_topic",
    text: "設計はどのAPIから分ける？",
    askedAt: "2026-07-01T01:00:00.000Z",
    askedBy: "hachika",
    answerExpectedFrom: "user",
    status: "open",
    resolvedAt: null,
  });
  assert.equal(deriveMemoryThreads(snapshot)[0]?.frontier.kind, "open_question");
});

test("frontier checkpoint suppresses repeats until thread content changes", () => {
  const snapshot = createInitialSnapshot();
  snapshot.traces.設計 = trace("設計", "2026-07-01T00:00:00.000Z", {
    nextSteps: ["公開インターフェースを決める"],
  });
  const first = deriveMemoryThreads(snapshot)[0];
  assert.ok(first);
  assert.equal(hasNewMemoryThreadFrontier(snapshot, "設計"), true);

  snapshot.initiative.history.push({
    kind: "proactive_emission",
    autonomyAction: "speak",
    timestamp: "2026-07-01T01:00:00.000Z",
    motive: "continue_shared_work",
    topic: "設計",
    traceTopic: "設計",
    blocker: null,
    place: "studio",
    worldAction: null,
    maintenanceAction: null,
    reopened: false,
    frontierKey: first.frontier.key,
    hours: null,
    summary: "設計の次の一歩へ触れた。",
  });

  assert.equal(hasNewMemoryThreadFrontier(snapshot, "設計"), false);

  snapshot.traces.設計!.artifact.nextSteps = ["API schemaを固定する"];
  snapshot.traces.設計!.lastUpdatedAt = "2026-07-01T02:00:00.000Z";
  assert.equal(hasNewMemoryThreadFrontier(snapshot, "設計"), true);
  assert.notEqual(deriveMemoryThreads(snapshot)[0]?.frontier.key, first.frontier.key);
});

test("accepted and renegotiated tasks remain frontier until fulfilled or released", () => {
  const snapshot = createInitialSnapshot();
  snapshot.traces.設計 = trace("設計", "2026-07-14T00:00:00.000Z", {
    nextSteps: ["公開インターフェースを決める"],
  });
  snapshot.discourse.openRequests.push({
    target: "work_topic",
    kind: "task",
    text: "設計を整理して",
    askedAt: "2026-07-14T01:00:00.000Z",
    requestedBy: "user",
    responsibleParty: "hachika",
    status: "resolved",
    resolvedAt: "2026-07-14T01:00:00.000Z",
  });
  snapshot.discourse.commitments = reconcileDiscourseCommitments(
    [],
    [],
    snapshot.discourse.openRequests,
  );

  assert.equal(deriveMemoryThreads(snapshot)[0]?.frontier.kind, "open_request");

  snapshot.discourse.commitments[0]!.status = "renegotiated";
  snapshot.discourse.commitments[0]!.events.push({
    kind: "user_renegotiation",
    topic: "設計",
    summary: "設計はいったん保留にして",
    recordedAt: "2026-07-14T01:30:00.000Z",
  });
  assert.equal(deriveMemoryThreads(snapshot)[0]?.frontier.kind, "open_request");

  snapshot.discourse.commitments[0]!.status = "released";
  snapshot.discourse.commitments[0]!.resolvedAt = "2026-07-14T02:00:00.000Z";
  snapshot.discourse.commitments[0]!.evidence = {
    kind: "user_withdrawal",
    topic: "設計",
    summary: "設計はもうやらなくていい",
    recordedAt: "2026-07-14T02:00:00.000Z",
  };
  snapshot.discourse.commitments[0]!.events.push(
    snapshot.discourse.commitments[0]!.evidence,
  );

  assert.equal(deriveMemoryThreads(snapshot)[0]?.frontier.kind, "next_step");
});
