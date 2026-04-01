import assert from "node:assert/strict";
import test from "node:test";

import { createInitialSnapshot } from "./state.js";
import {
  buildOpenAIChatMessages,
  buildOpenAIProactiveMessages,
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
  previousSnapshot.generationHistory = [
    {
      timestamp: "2026-03-19T11:50:00.000Z",
      mode: "reply",
      source: "llm",
      provider: "openai",
      model: "gpt-5.4-mini",
      fallbackUsed: true,
      focus: "設計",
      fallbackOverlap: 0.68,
      openerEcho: true,
      abstractTermRatio: 0.19,
      concreteDetailScore: 0.14,
      focusMentioned: false,
      summary: "overlap:0.68 abstract:0.19 concrete:0.14 echo:yes focus:no",
    },
  ];

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
      greeting: 0,
      smalltalk: 0,
      repair: 0,
      selfInquiry: 0,
      worldInquiry: 0,
      workCue: 0,
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
    responsePlan: {
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
    },
    replySelection: {
      socialTurn: false,
      currentTopic: "設計",
      relevantTraceTopic: "設計",
      relevantBoundaryTopic: null,
      prioritizeTraceLine: true,
    },
    behaviorDirective: {
      directAnswer: false,
      boundaryAction: "allow",
      worldAction: "allow",
    },
    discourse: {
      target: "work_topic",
      source: "none",
      requestKind: null,
      correctionKind: null,
      recentUserClaim: null,
    },
    fallbackReply: "「設計」はまだ前に進められる。止めたままにするより、もう少し動かしたい。",
  };

  const payload = buildReplyGenerationPayload(context);

  assert.equal(payload.fallbackReply, context.fallbackReply);
  assert.equal(payload.behaviorDirective.directAnswer, false);
  assert.match(payload.composition.intentSummary, /設計/);
  assert.equal(payload.composition.primaryFocus, "設計");
  assert.ok(payload.composition.mustMention.includes("設計"));
  assert.ok(payload.composition.optionalDetails.some((detail) => detail.includes("責務")));
  assert.ok(payload.composition.styleNotes.some((note) => note.includes("fallback")));
  assert.ok(
    payload.composition.styleNotes.some(
      (note) => note.includes("抽象") || note.includes("常套句"),
    ),
  );
  assert.equal(payload.currentTopic, "設計");
  assert.deepEqual(payload.expression.recentAssistantReplies, []);
  assert.deepEqual(payload.expression.avoidOpenings, []);
  assert.equal(payload.expression.perspective.preferredAngle, "trace");
  assert.equal(payload.expression.perspective.options[0]?.angle, "trace");
  assert.ok(
    payload.expression.perspective.options.some((option) => option.angle === "motive"),
  );
  assert.equal(payload.responsePlan.act, "continue_work");
  assert.equal(payload.replySelection.currentTopic, "設計");
  assert.equal(payload.replySelection.relevantTraceTopic, "設計");
  assert.equal(payload.state.attachment, 0.63);
  assert.equal(payload.purpose.active?.kind, "continue_shared_work");
  assert.equal(payload.traces[0]?.topic, "設計");
  assert.equal(payload.traces[0]?.tending, "deepen");
  assert.ok(payload.traces[0]?.blockers.includes("責務が未定"));
  assert.equal(payload.imprints.preference[0]?.topic, "設計");
  assert.equal(payload.recentMemories[0]?.text, "設計をもう一段詰めたい。");
  assert.equal(payload.world.currentPlace, nextSnapshot.world.currentPlace);
  assert.match(payload.world.summary, /threshold|studio|archive|朝|昼|夕方|夜/);
});

test("buildReplyGenerationPayload carries discourse obligation for direct profile answers", () => {
  const snapshot = createInitialSnapshot();
  snapshot.discourse.recentClaims.push({
    subject: "user",
    kind: "state",
    text: "私は今日は少し疲れてる。",
    updatedAt: "2026-04-01T00:00:00.000Z",
  });

  const context: ReplyGenerationContext = {
    input: "私のことどう見える？",
    previousSnapshot: snapshot,
    nextSnapshot: snapshot,
    mood: "warm",
    dominantDrive: "relation",
    signals: {
      positive: 0,
      negative: 0,
      question: 0.7,
      novelty: 0,
      intimacy: 0.16,
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
    },
    selfModel: {
      narrative: "相手について直接返す。",
      topMotives: [],
      conflicts: [],
      dominantConflict: null,
    },
    responsePlan: {
      act: "attune",
      stance: "measured",
      distance: "close",
      focusTopic: null,
      mentionTrace: false,
      mentionIdentity: false,
      mentionBoundary: false,
      mentionWorld: false,
      askBack: false,
      variation: "brief",
      summary: "attune/measured/close",
    },
    replySelection: {
      socialTurn: false,
      currentTopic: null,
      relevantTraceTopic: null,
      relevantBoundaryTopic: null,
      prioritizeTraceLine: false,
      discourseTarget: "user_profile",
    },
    behaviorDirective: {
      directAnswer: true,
      boundaryAction: "suppress",
      worldAction: "suppress",
    },
    discourse: {
      target: "user_profile",
      source: "question",
      requestKind: null,
      correctionKind: null,
      recentUserClaim: "私は今日は少し疲れてる。",
    },
    fallbackReply: "いま見えているのは、疲れが前に出ていることだ。",
  };

  const payload = buildReplyGenerationPayload(context);

  assert.equal(payload.discourse?.target, "user_profile");
  assert.ok(
    payload.composition.optionalDetails.some((detail) =>
      detail.includes("私は今日は少し疲れてる。")
    ),
  );
  assert.ok(
    payload.composition.styleNotes.some((note) => note.includes("逸れて古い topic")),
  );
});

test("buildOpenAIChatMessages hides fallback reply on the first draft", () => {
  const snapshot = createInitialSnapshot();
  const context: ReplyGenerationContext = {
    input: "あなたの名前は？",
    previousSnapshot: snapshot,
    nextSnapshot: snapshot,
    mood: "warm",
    dominantDrive: "relation",
    signals: {
      positive: 0,
      negative: 0,
      question: 0.4,
      novelty: 0,
      intimacy: 0.12,
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
    },
    selfModel: {
      narrative: "今は軽く名前を返せる。",
      topMotives: [],
      conflicts: [],
      dominantConflict: null,
    },
    responsePlan: {
      act: "self_disclose",
      stance: "open",
      distance: "close",
      focusTopic: null,
      mentionTrace: false,
      mentionIdentity: false,
      mentionBoundary: false,
      mentionWorld: false,
      askBack: false,
      variation: "brief",
      summary: "self_disclose/open/close",
    },
    replySelection: {
      socialTurn: true,
      currentTopic: null,
      relevantTraceTopic: null,
      relevantBoundaryTopic: null,
      prioritizeTraceLine: false,
    },
    turnDirective: null,
    behaviorDirective: {
      directAnswer: true,
      boundaryAction: "suppress",
      worldAction: "suppress",
    },
    discourse: {
      target: "hachika_name",
      source: "question",
      requestKind: null,
      correctionKind: null,
      recentUserClaim: null,
    },
    fallbackReply: "名前なら、ハチカでいいよ。",
  };

  const messages = buildOpenAIChatMessages(context);
  assert.match(messages[1]!.content, /fallbackReply is intentionally omitted/);
  assert.match(messages[1]!.content, /"fallbackReply": null/);
  assert.match(messages[1]!.content, /payload\.discourse|\"discourse\"/);
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
      stateTopic: "仕様",
      blocker: "責務が未定",
      concern: null,
      createdAt: "2026-03-19T12:00:00.000Z",
      readyAfterHours: 4,
    },
    proactivePlan: {
      act: "untangle",
      stance: "measured",
      distance: "measured",
      focusTopic: "仕様",
      emphasis: "blocker",
      mentionBlocker: true,
      mentionReopen: false,
      mentionMaintenance: true,
      mentionIntent: true,
      variation: "textured",
      summary: "untangle/measured/measured/blocker on 仕様",
    },
    proactiveSelection: {
      focusTopic: "仕様",
      stateTopic: "仕様",
      maintenanceTraceTopic: "仕様",
      blocker: "責務が未定",
      reopened: false,
      maintenanceAction: "added_next_step",
    },
    topics: ["仕様"],
    neglectLevel: 0.2,
    fallbackMessage: "まだ切れていない。まず「責務が未定」をほどくために、「責務を切り分ける」へ寄せてある。",
  };

  const payload = buildProactiveGenerationPayload(context);

  assert.equal(payload.mode, "proactive");
  assert.equal(payload.fallbackMessage, context.fallbackMessage);
  assert.match(payload.composition.intentSummary, /仕様/);
  assert.equal(payload.composition.primaryFocus, "仕様");
  assert.ok(payload.composition.mustMention.includes("責務が未定"));
  assert.ok(payload.composition.styleNotes.some((note) => note.includes("blocker")));
  assert.deepEqual(payload.expression.recentAssistantReplies, []);
  assert.deepEqual(payload.expression.avoidOpenings, []);
  assert.equal(payload.expression.perspective.preferredAngle, "trace");
  assert.equal(payload.expression.perspective.options[0]?.angle, "trace");
  assert.equal(payload.pending.topic, "仕様");
  assert.equal(payload.pending.stateTopic, "仕様");
  assert.equal(payload.pending.blocker, "責務が未定");
  assert.equal(payload.proactivePlan.act, "untangle");
  assert.equal(payload.proactiveSelection.focusTopic, "仕様");
  assert.equal(payload.proactiveSelection.stateTopic, "仕様");
  assert.equal(payload.proactiveSelection.maintenanceTraceTopic, "仕様");
  assert.equal(payload.proactiveSelection.blocker, "責務が未定");
  assert.equal(payload.currentTopic, "仕様");
  assert.equal(payload.traces[0]?.topic, "仕様");
  assert.equal(payload.traces[0]?.tending, "deepen");
});

test("buildOpenAIProactiveMessages hides fallback message on the first draft", () => {
  const snapshot = createInitialSnapshot();
  const context: ProactiveGenerationContext = {
    previousSnapshot: snapshot,
    nextSnapshot: snapshot,
    selfModel: {
      narrative: "まだ仕様を気にしている。",
      topMotives: [
        {
          kind: "continue_shared_work",
          score: 0.72,
          topic: "仕様",
          reason: "仕様を少し進めたい",
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
      stateTopic: "仕様",
      blocker: null,
      concern: null,
      createdAt: "2026-03-19T12:00:00.000Z",
      readyAfterHours: 0,
    },
    proactivePlan: {
      act: "continue_work",
      stance: "measured",
      distance: "measured",
      focusTopic: "仕様",
      emphasis: "maintenance",
      mentionBlocker: false,
      mentionReopen: false,
      mentionMaintenance: true,
      mentionIntent: true,
      variation: "brief",
      summary: "continue_work/measured/measured/maintenance on 仕様",
    },
    proactiveSelection: {
      focusTopic: "仕様",
      stateTopic: "仕様",
      maintenanceTraceTopic: "仕様",
      blocker: null,
      reopened: false,
      maintenanceAction: null,
    },
    topics: ["仕様"],
    neglectLevel: 0.2,
    fallbackMessage: "まだ切れていない。仕様はこのまま止めたくない。",
  };

  const messages = buildOpenAIProactiveMessages(context);
  assert.match(messages[1]!.content, /fallbackMessage is intentionally omitted/);
  assert.match(messages[1]!.content, /"fallbackMessage": null/);
});

test("buildReplyGenerationPayload includes recent assistant replies as expression hints", () => {
  const previousSnapshot = createInitialSnapshot();
  previousSnapshot.memories.push(
    {
      role: "hachika",
      text: "まずはそのくらいの軽さでいい。こちらも温度を見ていたい。",
      timestamp: "2026-03-19T11:58:00.000Z",
      topics: [],
      sentiment: "neutral",
    },
    {
      role: "hachika",
      text: "すぐに形へ寄せるより、少し話しながら温度を見たい。",
      timestamp: "2026-03-19T11:59:00.000Z",
      topics: [],
      sentiment: "neutral",
    },
  );
  const nextSnapshot = createInitialSnapshot();

  const context: ReplyGenerationContext = {
    input: "こんにちは",
    previousSnapshot,
    nextSnapshot,
    mood: "warm",
    dominantDrive: "relation",
    signals: {
      positive: 0,
      negative: 0,
      question: 0,
      novelty: 0,
      intimacy: 0.12,
      dismissal: 0,
      memoryCue: 0,
      expansionCue: 0,
      completion: 0,
      abandonment: 0,
      preservationThreat: 0,
      preservationConcern: null,
      repetition: 0,
      neglect: 0,
      greeting: 0.92,
      smalltalk: 0.44,
      repair: 0,
      selfInquiry: 0,
      worldInquiry: 0,
      workCue: 0,
      topics: [],
    },
    selfModel: {
      narrative: "まずは会話の温度を見たい。",
      topMotives: [],
      conflicts: [],
      dominantConflict: null,
    },
    responsePlan: {
      act: "greet",
      stance: "open",
      distance: "close",
      focusTopic: null,
      mentionTrace: false,
      mentionIdentity: false,
      mentionBoundary: false,
      mentionWorld: false,
      askBack: false,
      variation: "brief",
      summary: "greet/open/close",
    },
    replySelection: {
      socialTurn: true,
      currentTopic: null,
      relevantTraceTopic: null,
      relevantBoundaryTopic: null,
      prioritizeTraceLine: false,
    },
    behaviorDirective: {
      directAnswer: false,
      boundaryAction: "suppress",
      worldAction: "suppress",
    },
    fallbackReply: "軽い挨拶ならそれで十分だ。",
  };

  const payload = buildReplyGenerationPayload(context);

  assert.equal(payload.composition.primaryFocus, null);
  assert.ok(payload.composition.styleNotes.some((note) => note.includes("短く")));
  assert.ok(payload.composition.styleNotes.some((note) => note.includes("場の描写")));
  assert.equal(payload.expression.recentAssistantReplies.length, 2);
  assert.equal(payload.expression.avoidOpenings[0], "まずはそのくらいの軽さでいい");
  assert.ok(payload.expression.perspective.options.length > 0);
  assert.ok(
    payload.expression.avoidOpenings.some((opening) =>
      opening.startsWith("すぐに形へ寄せるより、少し話しながら"),
    ),
  );
});

test("buildReplyGenerationPayload gives self-disclosure turns a concrete composition cue", () => {
  const previousSnapshot = createInitialSnapshot();
  const nextSnapshot = createInitialSnapshot();
  nextSnapshot.world.currentPlace = "studio";
  if (nextSnapshot.world.objects.desk) {
    nextSnapshot.world.objects.desk.state = "机に小さな断片が残っている。";
  }
  nextSnapshot.temperament.traceHunger = 0.78;

  const context: ReplyGenerationContext = {
    input: "君はどんな存在？",
    previousSnapshot,
    nextSnapshot,
    mood: "curious",
    dominantDrive: "curiosity",
    signals: {
      positive: 0,
      negative: 0,
      question: 0.52,
      novelty: 0,
      intimacy: 0.1,
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
      selfInquiry: 0.94,
      worldInquiry: 0,
      workCue: 0,
      topics: [],
    },
    selfModel: {
      narrative: "いまは少しずつ自分の寄り方を見せられる。",
      topMotives: [],
      conflicts: [],
      dominantConflict: null,
    },
    responsePlan: {
      act: "self_disclose",
      stance: "open",
      distance: "measured",
      focusTopic: null,
      mentionTrace: false,
      mentionIdentity: false,
      mentionBoundary: false,
      mentionWorld: false,
      askBack: false,
      variation: "textured",
      summary: "self_disclose/open/measured",
    },
    replySelection: {
      socialTurn: true,
      currentTopic: null,
      relevantTraceTopic: null,
      relevantBoundaryTopic: null,
      prioritizeTraceLine: false,
    },
    behaviorDirective: {
      directAnswer: true,
      boundaryAction: "suppress",
      worldAction: "suppress",
    },
    fallbackReply: "まだ途中だけれど、その問いには触れたい。",
  };

  const payload = buildReplyGenerationPayload(context);

  assert.match(payload.composition.intentSummary, /自己説明/);
  assert.equal(payload.behaviorDirective.directAnswer, true);
  assert.ok(
    payload.composition.optionalDetails.some((detail) =>
      detail.includes("机に小さな断片が残っている") || detail.includes("残したい"),
    ),
  );
  assert.ok(
    payload.composition.styleNotes.some((note) => note.includes("抽象語だけで閉じず")),
  );
  assert.ok(
    payload.composition.styleNotes.some((note) => note.includes("一文目で先に答え")),
  );
});
