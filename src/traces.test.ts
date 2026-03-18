import assert from "node:assert/strict";
import test from "node:test";

import { createInitialSnapshot } from "./state.js";
import { tendTraceFromInitiative } from "./traces.js";
import type { HachikaSnapshot, TraceEntry } from "./types.js";

test("trace maintenance can promote a fulfilled topic into a decision", () => {
  const snapshot = createTraceSnapshot({
    topic: "設計",
    kind: "spec_fragment",
    status: "active",
    lastAction: "expanded",
    summary: "「設計」は「API を分ける」という断片として残す。",
    sourceMotive: "continue_shared_work",
    artifact: {
      memo: ["設計の断片を残す"],
      fragments: ["API を分ける"],
      decisions: [],
      nextSteps: [],
    },
    work: {
      focus: "API を分ける",
      confidence: 0.62,
      blockers: ["責務分割が未定"],
      staleAt: "2026-03-20T00:30:00.000Z",
    },
    salience: 0.72,
    mentions: 2,
    createdAt: "2026-03-19T00:00:00.000Z",
    lastUpdatedAt: "2026-03-19T00:30:00.000Z",
  });

  snapshot.purpose.lastResolved = {
    kind: "continue_shared_work",
    topic: "設計",
    summary: "設計をまとめたい。",
    confidence: 0.82,
    progress: 1,
    createdAt: "2026-03-19T00:00:00.000Z",
    lastUpdatedAt: "2026-03-19T00:30:00.000Z",
    turnsActive: 3,
    outcome: "fulfilled",
    resolution: "設計は記録としてまとまった。",
    resolvedAt: "2026-03-19T01:00:00.000Z",
  };

  const maintenance = tendTraceFromInitiative(
    snapshot,
    {
      kind: "resume_topic",
      motive: "leave_trace",
      topic: "設計",
      concern: null,
    },
    "2026-03-19T01:30:00.000Z",
  );

  assert.ok(maintenance !== null);
  assert.equal(maintenance?.action, "promoted_decision");
  assert.equal(snapshot.traces.設計?.kind, "decision");
  assert.ok((snapshot.traces.設計?.artifact.decisions.length ?? 0) > 0);
  assert.equal(snapshot.traces.設計?.work.blockers.length, 0);
  assert.equal(snapshot.traces.設計?.work.staleAt, null);
  assert.match(snapshot.traces.設計?.summary ?? "", /決定|まとまった/);
});

function createTraceSnapshot(trace: TraceEntry): HachikaSnapshot {
  const snapshot = createInitialSnapshot();
  snapshot.traces[trace.topic] = trace;
  snapshot.lastInteractionAt = trace.lastUpdatedAt;
  return snapshot;
}
