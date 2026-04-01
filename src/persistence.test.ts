import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  commitSnapshot,
  loadSnapshot,
  sanitizeSnapshot,
  saveSnapshot,
} from "./persistence.js";
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
  snapshot.traces.自分.worldContext = {
    place: "archive",
    objectId: "shelf",
    linkedAt: "2026-03-21T00:00:00.000Z",
  };
  snapshot.world.objects.shelf!.linkedTraceTopics = ["かな", "自分"];
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
  snapshot.initiative.history = [
    {
      kind: "idle_consolidation",
      autonomyAction: "hold",
      timestamp: "2026-03-21T00:30:00.000Z",
      motive: null,
      topic: "かな",
      traceTopic: null,
      blocker: null,
      maintenanceAction: null,
      reopened: false,
      hours: 12,
      summary: "静かな時間でかなのまとまりを寄せ直した。",
    },
    {
      kind: "proactive_emission",
      autonomyAction: "speak",
      timestamp: "2026-03-21T01:00:00.000Z",
      motive: "continue_shared_work",
      topic: "自分",
      traceTopic: "かな",
      blocker: "次は",
      maintenanceAction: "added_next_step",
      reopened: false,
      hours: null,
      summary: "「自分」へ、自分から戻ろうとした。",
    },
  ];
  snapshot.generationHistory = [
    {
      timestamp: "2026-03-21T01:10:00.000Z",
      mode: "reply",
      source: "llm",
      provider: "openai",
      model: "gpt-5.4-mini",
      fallbackUsed: false,
      focus: "かな",
      fallbackOverlap: 1.2,
      openerEcho: true,
      abstractTermRatio: 0.4,
      concreteDetailScore: 0.2,
      focusMentioned: true,
      summary: "  noisy quality  ",
    },
  ];
  snapshot.autonomousFeed = [
    {
      id: "2026-03-21T01:20:00.000Z:0",
      timestamp: "2026-03-21T01:20:00.000Z",
      mode: "proactive",
      source: "resident_loop",
      text: "「かな」へ、自分から戻ろうとした。",
      motive: "seek_continuity",
      topic: "かな",
      traceTopic: "自分",
      place: "archive",
      worldAction: "observe",
    },
  ];

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
  assert.deepEqual(snapshot.world.objects.shelf?.linkedTraceTopics, ["自分"]);
  assert.equal(
    snapshot.traces.自分?.summary,
    "「自分」は「自分 を決まった形として残す」という決定として残す。",
  );
  assert.equal(snapshot.purpose.active?.topic, null);
  assert.equal(snapshot.initiative.pending?.topic, null);
  assert.equal(snapshot.initiative.pending?.blocker, null);
  assert.equal(snapshot.initiative.history[0]?.topic, null);
  assert.equal(snapshot.initiative.history[1]?.topic, "自分");
  assert.equal(snapshot.initiative.history[1]?.traceTopic, null);
  assert.equal(snapshot.initiative.history[1]?.blocker, null);
  assert.equal(snapshot.autonomousFeed[0]?.topic, null);
  assert.equal(snapshot.autonomousFeed[0]?.traceTopic, "自分");
  assert.equal(snapshot.generationHistory[0]?.focus, null);
  assert.equal(snapshot.generationHistory[0]?.fallbackOverlap, 1);
  assert.equal(snapshot.generationHistory[0]?.summary, "noisy quality");
});

test("sanitizeSnapshot drops weak abstract and self-referential topics but keeps supported ones", () => {
  const snapshot = createInitialSnapshot();
  snapshot.preferences = {
    世界: 0.41,
    存在: 0.24,
    棚の残り: 0.2,
    今の目的: 0.22,
  };
  snapshot.topicCounts = {
    世界: 4,
    存在: 1,
    棚の残り: 1,
    今の目的: 1,
  };
  snapshot.memories = [
    {
      role: "user",
      text: "今どこにいるの？",
      timestamp: "2026-03-22T14:23:19.335Z",
      topics: ["世界"],
      sentiment: "neutral",
    },
    {
      role: "user",
      text: "棚には何が残ってる？",
      timestamp: "2026-03-22T14:23:34.399Z",
      topics: ["棚の残り"],
      sentiment: "neutral",
    },
    {
      role: "user",
      text: "ハチカってどんな存在？",
      timestamp: "2026-03-22T14:24:00.000Z",
      topics: ["存在", "今の目的"],
      sentiment: "neutral",
    },
    {
      role: "hachika",
      text: "threshold の灯りのそばなら、世界も少し具体的に見える。",
      timestamp: "2026-03-22T14:24:10.000Z",
      topics: ["世界"],
      sentiment: "neutral",
    },
  ];
  snapshot.preferenceImprints = {
    世界: {
      topic: "世界",
      salience: 0.91,
      affinity: -0.24,
      mentions: 4,
      firstSeenAt: "2026-03-22T12:30:00.082Z",
      lastSeenAt: "2026-03-22T14:23:17.731Z",
    },
  };
  snapshot.identity.anchors = ["世界", "存在", "今の目的"];
  snapshot.traces.世界 = pollutedTrace("世界");
  snapshot.traces.世界.worldContext = {
    place: "threshold",
    objectId: "lamp",
    linkedAt: "2026-03-22T14:24:10.000Z",
  };
  snapshot.traces.存在 = pollutedTrace("存在");
  snapshot.traces["棚の残り"] = pollutedTrace("棚の残り");
  snapshot.purpose.active = {
    kind: "protect_boundary",
    topic: "今の目的",
    summary: "今の目的まわりの扱いを警戒している",
    confidence: 0.71,
    progress: 0.33,
    createdAt: "2026-03-22T14:24:12.573Z",
    lastUpdatedAt: "2026-03-22T14:24:38.493Z",
    turnsActive: 2,
  };
  snapshot.initiative.pending = {
    kind: "resume_topic",
    reason: "continuity",
    motive: "seek_continuity",
    topic: "存在",
    blocker: "次は",
    concern: null,
    createdAt: "2026-03-22T14:24:00.000Z",
    readyAfterHours: 3,
  };
  snapshot.generationHistory = [
    {
      timestamp: "2026-03-22T14:24:40.418Z",
      mode: "reply",
      source: "llm",
      provider: "openai",
      model: "gpt-5.4-mini",
      fallbackUsed: false,
      focus: "存在",
      fallbackOverlap: 0.42,
      openerEcho: false,
      abstractTermRatio: 0.62,
      concreteDetailScore: 0.18,
      focusMentioned: true,
      summary: "abstract self topic drift",
    },
  ];

  sanitizeSnapshot(snapshot);

  assert.deepEqual(Object.keys(snapshot.preferences).sort(), ["世界"]);
  assert.deepEqual(Object.keys(snapshot.topicCounts).sort(), ["世界"]);
  assert.deepEqual(snapshot.memories[0]?.topics, ["世界"]);
  assert.deepEqual(snapshot.memories[1]?.topics, []);
  assert.deepEqual(snapshot.memories[2]?.topics, []);
  assert.deepEqual(Object.keys(snapshot.preferenceImprints), ["世界"]);
  assert.deepEqual(snapshot.identity.anchors, ["世界"]);
  assert.deepEqual(Object.keys(snapshot.traces), ["世界"]);
  assert.equal(snapshot.purpose.active?.topic, null);
  assert.equal(snapshot.initiative.pending?.topic, null);
  assert.equal(snapshot.generationHistory[0]?.focus, null);
});

test("sanitizeSnapshot drops abstract world topics when they only come from inquiry prompts", () => {
  const snapshot = createInitialSnapshot();
  snapshot.preferences = {
    世界: 0.42,
    存在: 0.28,
  };
  snapshot.topicCounts = {
    世界: 5,
    存在: 3,
  };
  snapshot.memories = [
    {
      role: "user",
      text: "今どこにいるの？",
      timestamp: "2026-03-22T14:23:19.335Z",
      topics: ["世界"],
      sentiment: "neutral",
    },
    {
      role: "user",
      text: "そっちの世界はどんな感じ？",
      timestamp: "2026-03-22T14:23:29.335Z",
      topics: ["世界"],
      sentiment: "neutral",
    },
    {
      role: "user",
      text: "ハチカってどんな存在？",
      timestamp: "2026-03-22T14:24:00.000Z",
      topics: ["存在"],
      sentiment: "neutral",
    },
  ];
  snapshot.preferenceImprints = {
    世界: {
      topic: "世界",
      salience: 0.9,
      affinity: 0.18,
      mentions: 5,
      firstSeenAt: "2026-03-22T12:30:00.082Z",
      lastSeenAt: "2026-03-22T14:23:29.335Z",
    },
  };
  snapshot.identity.anchors = ["世界", "存在"];
  snapshot.traces.世界 = pollutedTrace("世界");
  snapshot.traces.存在 = pollutedTrace("存在");

  sanitizeSnapshot(snapshot);

  assert.deepEqual(snapshot.preferences, {});
  assert.deepEqual(snapshot.topicCounts, {});
  assert.deepEqual(snapshot.memories[0]?.topics, []);
  assert.deepEqual(snapshot.memories[1]?.topics, []);
  assert.deepEqual(snapshot.memories[2]?.topics, []);
  assert.deepEqual(snapshot.identity.anchors, []);
  assert.deepEqual(snapshot.traces, {});
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
    assert.deepEqual(loaded.memories[0]?.topics, []);
    assert.deepEqual(loaded.identity.anchors, []);
    assert.equal(loaded.traces.かな, undefined);
    assert.deepEqual(loaded.temperament, createInitialSnapshot().temperament);
    assert.equal(loaded.discourse.hachikaName?.value, "ハチカ");

    await saveSnapshot(filePath, loaded);
    const raw = await readFile(filePath, "utf8");

    assert.doesNotMatch(raw, /"かな"/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("sanitizeSnapshot keeps valid discourse facts and falls back on invalid hachika naming", () => {
  const snapshot = createInitialSnapshot();
  snapshot.discourse.userName = {
    kind: "user_name",
    value: "やすとら",
    confidence: 0.91,
    source: "user_assertion",
    updatedAt: "2026-03-31T00:00:00.000Z",
  };
  snapshot.discourse.hachikaName = {
    kind: "hachika_name",
    value: "!",
    confidence: 0.3,
    source: "relation_assignment",
    updatedAt: "2026-03-31T00:00:00.000Z",
  };
  snapshot.discourse.recentClaims = [
    {
      subject: "user",
      kind: "state",
      text: "今日は少し疲れている。",
      updatedAt: "2026-03-31T00:00:00.000Z",
    },
    {
      subject: "shared",
      kind: "other",
      text: "x",
      updatedAt: "2026-03-31T00:00:00.000Z",
    },
  ];
  snapshot.discourse.openRequests = [
    {
      target: "hachika_name",
      kind: "style",
      text: "ハチカ自身の名前を具体的に答えて。",
      askedAt: "2026-03-31T00:00:00.000Z",
      status: "open",
      resolvedAt: null,
    },
    {
      target: "none",
      kind: "task",
      text: "x",
      askedAt: "2026-03-31T00:00:00.000Z",
      status: "open",
      resolvedAt: null,
    },
  ];

  sanitizeSnapshot(snapshot);

  assert.equal(snapshot.discourse.userName?.value, "やすとら");
  assert.equal(snapshot.discourse.hachikaName?.value, "ハチカ");
  assert.deepEqual(snapshot.discourse.recentClaims, [
    {
      subject: "user",
      kind: "state",
      text: "今日は少し疲れている。",
      updatedAt: "2026-03-31T00:00:00.000Z",
    },
  ]);
  assert.deepEqual(snapshot.discourse.openRequests, [
    {
      target: "hachika_name",
      kind: "style",
      text: "ハチカ自身の名前を具体的に答えて。",
      askedAt: "2026-03-31T00:00:00.000Z",
      status: "open",
      resolvedAt: null,
    },
  ]);
});

test("loadSnapshot seeds latent dynamics from older visible-only snapshots", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "hachika-dynamics-seed-"));
  const filePath = join(tempDir, "snapshot.json");

  try {
    await writeFile(
      filePath,
      `${JSON.stringify({
        version: 15,
        revision: 3,
        state: {
          continuity: 0.72,
          pleasure: 0.35,
          curiosity: 0.81,
          relation: 0.63,
          expansion: 0.58,
        },
        body: {
          energy: 0.41,
          tension: 0.62,
          boredom: 0.19,
          loneliness: 0.54,
        },
        reactivity: {
          rewardSaturation: 0.12,
          stressLoad: 0.48,
          noveltyHunger: 0.31,
        },
        attachment: 0.57,
        preferences: {},
        topicCounts: {},
        memories: [],
        preferenceImprints: {},
        boundaryImprints: {},
        relationImprints: {},
        preservation: createInitialSnapshot().preservation,
        identity: createInitialSnapshot().identity,
        traces: {},
        purpose: createInitialSnapshot().purpose,
        initiative: createInitialSnapshot().initiative,
        lastInteractionAt: null,
        conversationCount: 1,
      }, null, 2)}\n`,
      "utf8",
    );

    const loaded = await loadSnapshot(filePath);

    assert.equal(loaded.version, 24);
    assert.equal(loaded.revision, 3);
    assert.equal(loaded.discourse.hachikaName?.value, "ハチカ");
    assert.ok(loaded.dynamics.safety < 0.5);
    assert.ok(loaded.dynamics.trust > 0.5);
    assert.ok(loaded.dynamics.activation > 0.5);
    assert.ok(loaded.dynamics.socialNeed > 0.5);
    assert.ok(loaded.dynamics.cognitiveLoad > 0.5);
    assert.ok(loaded.dynamics.noveltyDrive > 0.5);
    assert.ok(loaded.dynamics.continuityPressure > 0.5);
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

test("commitSnapshot rejects stale revisions and keeps the newer snapshot", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "hachika-commit-"));
  const filePath = join(tempDir, "snapshot.json");

  try {
    const initial = createInitialSnapshot();
    const saved = await saveSnapshot(filePath, initial);

    const stale = structuredClone(initial);
    stale.state.curiosity = 0.91;

    const conflict = await commitSnapshot(filePath, stale);

    assert.equal(conflict.ok, false);
    assert.equal(conflict.conflict, true);
    assert.equal(conflict.snapshot.revision, saved.revision);
    assert.notEqual(conflict.snapshot.state.curiosity, 0.91);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
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
