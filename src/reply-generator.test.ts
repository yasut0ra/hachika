import assert from "node:assert/strict";
import test from "node:test";

import { createInitialSnapshot } from "./state.js";
import {
  buildProactiveGenerationPayload,
  buildReplyGenerationPayload,
} from "./reply-generator.js";
import type {
  ProactiveGenerationContext,
  ReplyGenerationContext,
} from "./reply-generator.js";

test("buildReplyGenerationPayload surfaces fallback intent and internal state summaries", () => {
  const previousSnapshot = createInitialSnapshot();
  const nextSnapshot = createInitialSnapshot();
  nextSnapshot.state.expansion = 0.78;
  nextSnapshot.body.boredom = 0.82;
  nextSnapshot.attachment = 0.63;
  nextSnapshot.identity.summary = "設計の痕跡を残したがる輪郭が少し固まってきた。";
  nextSnapshot.identity.currentArc = "今は設計を目印のままにせず、もう一段具体化したい。";
  nextSnapshot.identity.anchors = ["設計"];
  nextSnapshot.purpose.active = {
    kind: "continue_shared_work",
    topic: "設計",
    summary: "設計を進めて記録に残したい。",
    confidence: 0.76,
    progress: 0.42,
    createdAt: "2026-03-19T12:00:00.000Z",
    lastUpdatedAt: "2026-03-19T12:00:00.000Z",
    turnsActive: 2,
  };
  nextSnapshot.traces.設計 = {
    topic: "設計",
    kind: "spec_fragment",
    status: "active",
    lastAction: "expanded",
    summary: "「設計」は断片として残っている。",
    sourceMotive: "continue_shared_work",
    artifact: {
      memo: ["設計を進める"],
      fragments: ["API を分ける"],
      decisions: [],
      nextSteps: ["責務を切り分ける"],
    },
    work: {
      focus: "責務を切り分ける",
      confidence: 0.48,
      blockers: ["責務が未定"],
      staleAt: "2026-03-20T12:00:00.000Z",
    },
    salience: 0.7,
    mentions: 2,
    createdAt: "2026-03-19T12:00:00.000Z",
    lastUpdatedAt: "2026-03-19T12:00:00.000Z",
  };
  nextSnapshot.preferenceImprints.設計 = {
    topic: "設計",
    salience: 0.62,
    affinity: 0.44,
    mentions: 3,
    firstSeenAt: "2026-03-19T11:00:00.000Z",
    lastSeenAt: "2026-03-19T12:00:00.000Z",
  };
  nextSnapshot.memories.push({
    role: "user",
    text: "設計をもう一段詰めたい。",
    timestamp: "2026-03-19T12:00:00.000Z",
    topics: ["設計"],
    sentiment: "positive",
  });

  const context: ReplyGenerationContext = {
    input: "どうする？",
    previousSnapshot,
    nextSnapshot,
    mood: "restless",
    dominantDrive: "expansion",
    signals: {
      positive: 0,
      negative: 0,
      question: 0.4,
      novelty: 0,
      intimacy: 0,
      dismissal: 0,
      memoryCue: 0,
      expansionCue: 0.28,
      completion: 0,
      abandonment: 0,
      preservationThreat: 0,
      preservationConcern: null,
      repetition: 0,
      neglect: 0,
      topics: ["設計"],
    },
    selfModel: {
      narrative: "今は設計の未決着を掘りたい。",
      topMotives: [
        {
          kind: "continue_shared_work",
          score: 0.8,
          topic: "設計",
          reason: "設計を前に進めたい",
        },
      ],
      conflicts: [],
      dominantConflict: null,
    },
    fallbackReply: "「設計」はまだ前に進められる。止めたままにするより、もう少し動かしたい。",
  };

  const payload = buildReplyGenerationPayload(context);

  assert.equal(payload.fallbackReply, context.fallbackReply);
  assert.equal(payload.currentTopic, "設計");
  assert.equal(payload.state.attachment, 0.63);
  assert.equal(payload.purpose.active?.kind, "continue_shared_work");
  assert.equal(payload.traces[0]?.topic, "設計");
  assert.equal(payload.traces[0]?.tending, "deepen");
  assert.ok(payload.traces[0]?.blockers.includes("責務が未定"));
  assert.equal(payload.imprints.preference[0]?.topic, "設計");
  assert.equal(payload.recentMemories[0]?.text, "設計をもう一段詰めたい。");
});

test("buildProactiveGenerationPayload surfaces pending initiative and fallback proactive text", () => {
  const previousSnapshot = createInitialSnapshot();
  const nextSnapshot = createInitialSnapshot();
  nextSnapshot.body.energy = 0.36;
  nextSnapshot.body.tension = 0.18;
  nextSnapshot.body.boredom = 0.8;
  nextSnapshot.identity.anchors = ["仕様"];
  nextSnapshot.traces.仕様 = {
    topic: "仕様",
    kind: "spec_fragment",
    status: "active",
    lastAction: "expanded",
    summary: "「仕様」は断片として残っている。",
    sourceMotive: "continue_shared_work",
    artifact: {
      memo: ["仕様を詰める"],
      fragments: ["責務を整理する"],
      decisions: [],
      nextSteps: ["責務を切り分ける"],
    },
    work: {
      focus: "責務を切り分ける",
      confidence: 0.44,
      blockers: ["責務が未定"],
      staleAt: "2026-03-20T12:00:00.000Z",
    },
    salience: 0.66,
    mentions: 2,
    createdAt: "2026-03-19T12:00:00.000Z",
    lastUpdatedAt: "2026-03-19T12:00:00.000Z",
  };

  const context: ProactiveGenerationContext = {
    previousSnapshot,
    nextSnapshot,
    selfModel: {
      narrative: "今は仕様の詰まりをほどきながら前に進めたい。",
      topMotives: [
        {
          kind: "continue_shared_work",
          score: 0.76,
          topic: "仕様",
          reason: "仕様を前に進めたい",
        },
      ],
      conflicts: [],
      dominantConflict: null,
    },
    pending: {
      kind: "resume_topic",
      reason: "expansion",
      motive: "continue_shared_work",
      topic: "仕様",
      blocker: "責務が未定",
      concern: null,
      createdAt: "2026-03-19T12:00:00.000Z",
      readyAfterHours: 4,
    },
    topics: ["仕様"],
    neglectLevel: 0.2,
    fallbackMessage: "まだ切れていない。まず「責務が未定」をほどくために、「責務を切り分ける」へ寄せてある。",
  };

  const payload = buildProactiveGenerationPayload(context);

  assert.equal(payload.mode, "proactive");
  assert.equal(payload.fallbackMessage, context.fallbackMessage);
  assert.equal(payload.pending.topic, "仕様");
  assert.equal(payload.pending.blocker, "責務が未定");
  assert.equal(payload.currentTopic, "仕様");
  assert.equal(payload.traces[0]?.topic, "仕様");
  assert.equal(payload.traces[0]?.tending, "deepen");
});
