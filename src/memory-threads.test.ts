import assert from "node:assert/strict";
import test from "node:test";

import { deriveMemoryThreads, selectMemoryThread } from "./memory-threads.js";
import { createInitialSnapshot } from "./state.js";
import type { TraceEntry, TraceKind } from "./types.js";

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
