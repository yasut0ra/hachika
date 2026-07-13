import assert from "node:assert/strict";
import test from "node:test";

import { buildSelectiveMemoryReset } from "./selective-reset.js";
import { createInitialSnapshot } from "./state.js";

test("selective reset preserves embodiment while rebuilding contaminated memory indexes", () => {
  const current = createInitialSnapshot();
  current.revision = 42;
  current.conversationCount = 201;
  current.constitution.plasticity = 0.61;
  current.temperament.openness = 0.81;
  current.voice.brevityBias = -0.2;
  current.discourse.userName = {
    kind: "user_name",
    value: "ちゃんと覚えていますか",
    confidence: 0.94,
    source: "user_assertion",
    updatedAt: "2026-07-13T16:00:00.000Z",
  };
  current.discourse.hachikaName = {
    kind: "hachika_name",
    value: "覚えているかい",
    confidence: 0.86,
    source: "relation_assignment",
    updatedAt: "2026-07-13T16:00:00.000Z",
  };
  current.discourse.recentClaims = [
    {
      subject: "shared",
      kind: "relation",
      text: "SF短編集が多いな",
      updatedAt: "2026-07-13T11:48:54.815Z",
    },
    {
      subject: "shared",
      kind: "work",
      text: "夏インターン選考は一区切りついた",
      updatedAt: "2026-07-13T12:59:33.559Z",
    },
  ];
  current.memories = [
    {
      role: "user",
      text: "私の名前はちゃんと覚えていますか",
      timestamp: "2026-07-13T16:00:00.000Z",
      topics: [],
      sentiment: "neutral",
    },
    {
      role: "user",
      text: "私の名前は やすとら。あなたの開発者です",
      timestamp: "2026-07-13T16:02:00.000Z",
      topics: [],
      sentiment: "neutral",
    },
  ];
  current.traces.インターン = {
    topic: "インターン",
    kind: "continuity_marker",
    status: "active",
    lastAction: "continued",
    summary: "インターンを覚える",
    sourceMotive: "seek_continuity",
    artifact: { memo: [], fragments: [], decisions: [], nextSteps: [] },
    work: { focus: null, confidence: 0.6, blockers: [], staleAt: null },
    salience: 0.8,
    mentions: 5,
    createdAt: "2026-07-01T00:00:00.000Z",
    lastUpdatedAt: "2026-07-13T00:00:00.000Z",
  };
  current.identity.anchors = ["インターン"];
  current.purpose.active = {
    kind: "seek_continuity",
    topic: "インターン",
    summary: "インターンを保つ",
    confidence: 0.8,
    progress: 0.5,
    createdAt: "2026-07-01T00:00:00.000Z",
    lastUpdatedAt: "2026-07-13T00:00:00.000Z",
    turnsActive: 5,
  };

  const result = buildSelectiveMemoryReset(current, "2026-07-14T00:00:00.000Z");
  const next = result.snapshot;

  assert.equal(next.revision, 42);
  assert.equal(next.conversationCount, 201);
  assert.equal(next.constitution.plasticity, 0.61);
  assert.equal(next.temperament.openness, 0.81);
  assert.equal(next.voice.brevityBias, -0.2);
  assert.equal(next.discourse.userName?.value, "やすとら");
  assert.equal(next.discourse.hachikaName?.value, "ハチカ");
  assert.equal(next.discourse.recentClaims.some((claim) => /インターン/u.test(claim.text)), false);
  assert.ok(next.memories.some((memory) => memory.topics.includes("sf短編集")));
  assert.deepEqual(next.traces, {});
  assert.deepEqual(next.identity.anchors, []);
  assert.equal(next.purpose.active, null);
  assert.equal(next.lastInteractionAt, "2026-07-14T00:00:00.000Z");
});
