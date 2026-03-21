import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { loadSnapshot, sanitizeSnapshot, saveSnapshot } from "./persistence.js";
import { createInitialSnapshot } from "./state.js";
import type { TraceEntry } from "./types.js";

test("sanitizeSnapshot removes low-information topics and repairs polluted traces", () => {
  const snapshot = createInitialSnapshot();
  snapshot.preferences = {
    自分: 0.62,
    かな: 0.31,
    納得: 0.18,
  };
  snapshot.topicCounts = {
    自分: 4,
    かな: 2,
    まずは: 1,
  };
  snapshot.memories = [
    {
      role: "user",
      text: "何がいいかな",
      timestamp: "2026-03-21T00:00:00.000Z",
      topics: ["かな", "自分", "納得"],
      sentiment: "neutral",
    },
  ];
  snapshot.preferenceImprints = {
    自分: {
      topic: "自分",
      salience: 0.7,
      affinity: 0.3,
      mentions: 3,
      firstSeenAt: "2026-03-20T00:00:00.000Z",
      lastSeenAt: "2026-03-21T00:00:00.000Z",
    },
    納得: {
      topic: "納得",
      salience: 0.6,
      affinity: 0.1,
      mentions: 2,
      firstSeenAt: "2026-03-20T00:00:00.000Z",
      lastSeenAt: "2026-03-21T00:00:00.000Z",
    },
  };
  snapshot.identity.anchors = ["自分", "かな", "まずは"];
  snapshot.traces.自分 = pollutedTrace("自分");
  snapshot.traces.かな = pollutedTrace("かな");
  snapshot.purpose.active = {
    kind: "continue_shared_work",
    topic: "かな",
    summary: "かな を進めたい。",
    confidence: 0.68,
    progress: 0.22,
    createdAt: "2026-03-21T00:00:00.000Z",
    lastUpdatedAt: "2026-03-21T00:00:00.000Z",
    turnsActive: 2,
  };
  snapshot.initiative.pending = {
    kind: "resume_topic",
    reason: "continuity",
    motive: "seek_continuity",
    topic: "かな",
    blocker: "次は",
    concern: null,
    createdAt: "2026-03-21T00:00:00.000Z",
    readyAfterHours: 4,
  };

  sanitizeSnapshot(snapshot);

  assert.deepEqual(Object.keys(snapshot.preferences), ["自分"]);
  assert.deepEqual(Object.keys(snapshot.topicCounts), ["自分"]);
  assert.deepEqual(snapshot.memories[0]?.topics, ["自分"]);
  assert.deepEqual(Object.keys(snapshot.preferenceImprints), ["自分"]);
  assert.deepEqual(snapshot.identity.anchors, ["自分"]);
  assert.equal(snapshot.traces.かな, undefined);
  assert.deepEqual(snapshot.traces.自分?.artifact.decisions, ["自分 を決まった形として残す"]);
  assert.deepEqual(snapshot.traces.自分?.artifact.nextSteps, []);
  assert.equal(snapshot.traces.自分?.work.focus, "自分 を決まった形として残す");
  assert.equal(
    snapshot.traces.自分?.summary,
    "「自分」は「自分 を決まった形として残す」という決定として残す。",
  );
  assert.equal(snapshot.purpose.active?.topic, null);
  assert.equal(snapshot.initiative.pending?.topic, null);
  assert.equal(snapshot.initiative.pending?.blocker, null);
});

test("loadSnapshot and saveSnapshot apply sanitation to persisted files", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "hachika-persistence-"));
  const filePath = join(tempDir, "snapshot.json");

  try {
    await writeFile(
      filePath,
      `${JSON.stringify({
        version: 15,
        state: createInitialSnapshot().state,
        body: createInitialSnapshot().body,
        attachment: 0.4,
        preferences: {
          自分: 0.44,
          かな: 0.33,
        },
        topicCounts: {
          自分: 2,
          かな: 1,
        },
        memories: [
          {
            role: "user",
            text: "何がいいかな",
            timestamp: "2026-03-21T00:00:00.000Z",
            topics: ["かな", "自分"],
            sentiment: "neutral",
          },
        ],
        preferenceImprints: {},
        boundaryImprints: {},
        relationImprints: {},
        preservation: createInitialSnapshot().preservation,
        identity: {
          ...createInitialSnapshot().identity,
          anchors: ["かな", "自分"],
        },
        traces: {
          かな: pollutedTrace("かな"),
        },
        purpose: createInitialSnapshot().purpose,
        initiative: createInitialSnapshot().initiative,
        lastInteractionAt: null,
        conversationCount: 1,
      }, null, 2)}\n`,
      "utf8",
    );

    const loaded = await loadSnapshot(filePath);

    assert.equal(loaded.preferences.かな, undefined);
    assert.deepEqual(loaded.memories[0]?.topics, ["自分"]);
    assert.deepEqual(loaded.identity.anchors, ["自分"]);
    assert.equal(loaded.traces.かな, undefined);
    assert.deepEqual(loaded.temperament, createInitialSnapshot().temperament);

    await saveSnapshot(filePath, loaded);
    const raw = await readFile(filePath, "utf8");

    assert.doesNotMatch(raw, /"かな"/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("sanitizeSnapshot keeps consolidated memories normalized", () => {
  const snapshot = createInitialSnapshot();
  snapshot.memories = [
    {
      role: "hachika",
      text: "「海辺」は前のやり取りからまとまった流れとして残っている。",
      timestamp: "2026-03-21T00:00:00.000Z",
      topics: ["海辺", "かな"],
      sentiment: "positive",
      kind: "consolidated",
      weight: 3,
    },
    {
      role: "user",
      text: "何がいいかな",
      timestamp: "2026-03-21T01:00:00.000Z",
      topics: ["かな"],
      sentiment: "neutral",
    },
  ];

  sanitizeSnapshot(snapshot);

  assert.equal(snapshot.memories[0]?.kind, "consolidated");
  assert.equal(snapshot.memories[0]?.weight, 3);
  assert.deepEqual(snapshot.memories[0]?.topics, ["海辺"]);
  assert.equal(snapshot.memories[1]?.kind, "turn");
  assert.equal(snapshot.memories[1]?.weight, 1);
});

function pollutedTrace(topic: string): TraceEntry {
  return {
    topic,
    kind: "decision",
    status: "resolved",
    lastAction: "expanded",
    summary: `「${topic}」は「ちゃんと芯は持てそうだね」という決定として残す。`,
    sourceMotive: "continue_shared_work",
    artifact: {
      memo: ["何がいいかな"],
      fragments: ["深い話でもする"],
      decisions: ["納得", "ちゃんと芯は持てそうだね"],
      nextSteps: ["次は"],
    },
    work: {
      focus: "ちゃんと芯は持てそうだね",
      confidence: 1,
      blockers: ["何がいいかな"],
      staleAt: "2026-03-21T02:00:00.000Z",
    },
    lifecycle: {
      phase: "live",
      archivedAt: null,
      reopenedAt: null,
      reopenCount: 0,
    },
    salience: 0.92,
    mentions: 6,
    createdAt: "2026-03-21T00:00:00.000Z",
    lastUpdatedAt: "2026-03-21T01:00:00.000Z",
  };
}
