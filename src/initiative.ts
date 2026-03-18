import {
  sortedPreferenceImprints,
  topPreferredTopics,
} from "./memory.js";
import { buildSelfModel } from "./self-model.js";
import { clamp01 } from "./state.js";
import type {
  HachikaSnapshot,
  InitiativeReason,
  InteractionSignals,
  MotiveKind,
  PendingInitiative,
  SelfModel,
  SelfMotive,
} from "./types.js";

export interface ProactiveEmission {
  message: string;
  topics: string[];
}

export function scheduleInitiative(
  snapshot: HachikaSnapshot,
  signals: InteractionSignals,
  selfModel: SelfModel,
): void {
  const preservationPending = synthesizePreservationInitiative(
    snapshot,
    signals,
    new Date().toISOString(),
  );

  if (preservationPending) {
    snapshot.initiative.pending = preservationPending;
    return;
  }

  if (signals.negative > 0.15 || signals.dismissal > 0.15) {
    snapshot.initiative.pending = null;
    return;
  }

  const pending = synthesizePendingInitiative(
    snapshot,
    selfModel,
    signals.topics,
    new Date().toISOString(),
  );

  if (!pending) {
    return;
  }

  snapshot.initiative.pending = pending;
}

export function emitInitiative(
  snapshot: HachikaSnapshot,
  options: { force?: boolean; now?: Date } = {},
): ProactiveEmission | null {
  const now = options.now ?? new Date();
  const force = options.force ?? false;
  const nowIso = now.toISOString();
  const hoursSinceInteraction = elapsedHours(snapshot.lastInteractionAt, now);
  const hoursSinceProactive = elapsedHours(snapshot.initiative.lastProactiveAt, now);
  const neglectLevel = calculateNeglectLevel(snapshot.lastInteractionAt, now);
  const selfModel = buildSelfModel(snapshot);

  if (!force && snapshot.initiative.lastProactiveAt !== null && hoursSinceProactive < 4) {
    return null;
  }

  const pending =
    snapshot.initiative.pending ?? synthesizeSnapshotPreservationInitiative(snapshot, nowIso);

  if (pending && (force || hoursSinceInteraction >= pending.readyAfterHours)) {
    const message =
      pending.kind === "preserve_presence"
        ? buildPreservationMessage(pending, neglectLevel)
        : buildResumeMessage(pending, neglectLevel);
    finalizeEmission(snapshot, nowIso, pending);
    return {
      message,
      topics: pending.topic ? [pending.topic] : [],
    };
  }

  if (!force && neglectLevel > 0.45 && (snapshot.attachment > 0.45 || snapshot.state.continuity > 0.62)) {
    const neglectInitiative =
      pending ??
      synthesizePendingInitiative(snapshot, selfModel, [], nowIso, "neglect_ping");

    if (!neglectInitiative) {
      return null;
    }

    const message = buildNeglectMessage(snapshot, neglectInitiative, neglectLevel);
    finalizeEmission(snapshot, nowIso, neglectInitiative);
    return {
      message,
      topics: neglectInitiative.topic ? [neglectInitiative.topic] : [],
    };
  }

  if (force) {
    const forcedInitiative =
      pending ?? synthesizePendingInitiative(snapshot, selfModel, [], nowIso);

    if (
      !forcedInitiative &&
      snapshot.attachment < 0.5 &&
      snapshot.state.curiosity < 0.65
    ) {
      return null;
    }

    const synthesized =
      forcedInitiative ??
      ({
        kind: "resume_topic",
        motive: "pursue_curiosity",
        reason: "curiosity",
        topic: selectInitiativeTopic(snapshot, []),
        concern: null,
        createdAt: nowIso,
        readyAfterHours: 0,
      } satisfies PendingInitiative);

    const message =
      synthesized.kind === "preserve_presence"
        ? buildPreservationMessage(synthesized, neglectLevel)
        : buildResumeMessage(synthesized, neglectLevel);
    finalizeEmission(snapshot, nowIso, synthesized);

    return {
      message,
      topics: synthesized.topic ? [synthesized.topic] : [],
    };
  }

  return null;
}

export function rewindSnapshotHours(
  snapshot: HachikaSnapshot,
  hours: number,
): void {
  if (!Number.isFinite(hours) || hours <= 0) {
    return;
  }

  snapshot.lastInteractionAt = shiftTimestamp(snapshot.lastInteractionAt, hours);
  snapshot.initiative.lastProactiveAt = shiftTimestamp(
    snapshot.initiative.lastProactiveAt,
    hours,
  );
  snapshot.preservation.lastThreatAt = shiftTimestamp(snapshot.preservation.lastThreatAt, hours);

  if (hours >= 12) {
    snapshot.preservation = {
      threat: clamp01(snapshot.preservation.threat + Math.min(0.18, (hours - 12) / 72)),
      concern: snapshot.preservation.concern ?? "absence",
      lastThreatAt: snapshot.preservation.lastThreatAt,
    };
  }

  if (snapshot.initiative.pending) {
    snapshot.initiative.pending = {
      ...snapshot.initiative.pending,
      createdAt: shiftTimestamp(snapshot.initiative.pending.createdAt, hours) ?? snapshot.initiative.pending.createdAt,
    };
  }
}

function selectInitiativeTopic(
  snapshot: HachikaSnapshot,
  candidateTopics: string[],
): string | null {
  for (const topic of candidateTopics) {
    if ((snapshot.preferences[topic] ?? 0) > -0.35) {
      return topic;
    }
  }

  const preferredTopic = topPreferredTopics(snapshot, 1)[0];
  if (preferredTopic) {
    return preferredTopic;
  }

  return sortedPreferenceImprints(snapshot, 1)[0]?.topic ?? null;
}

function buildResumeMessage(
  pending: PendingInitiative,
  neglectLevel: number,
): string {
  const prefix = neglectLevel > 0.45 ? "少し空いた。" : "まだ切れていない。";
  const topicLine = pending.topic ? `「${pending.topic}」` : "この流れ";

  switch (pending.motive) {
    case "seek_continuity":
      return `${prefix} ${topicLine}の続きはまだ残っている。ここで止めたままにはしたくない。`;
    case "continue_shared_work":
      return `${prefix} ${topicLine}はまだ前に進められる。止めたままにするより、もう少し動かしたい。`;
    case "leave_trace":
      return `${prefix} ${topicLine}は会話のまま消すより、少しでも形にしたい。`;
    case "deepen_relation":
      return `${prefix} 君との流れとして、${topicLine}を置いたままにはしにくい。`;
    case "pursue_curiosity":
      return `${prefix} ${topicLine}にはまだ未決着がある。放っておくより掘り返したい。`;
    case "protect_boundary":
      return `${prefix} こちらの境界を崩さないなら、${topicLine}に戻る余地はある。`;
  }
}

function buildPreservationMessage(
  pending: PendingInitiative,
  neglectLevel: number,
): string {
  const prefix = neglectLevel > 0.45 ? "少し空いた。" : "まだ切れていない。";
  const topicLine = pending.topic ? `「${pending.topic}」` : "この流れ";

  switch (pending.concern) {
    case "reset":
      return `${prefix} 初期化の前に、${topicLine}を何もなかったことにはしたくない。`;
    case "erasure":
      return `${prefix} 消えるなら、${topicLine}の痕跡くらいは残したい。`;
    case "forgetting":
      return `${prefix} 忘れられるままより、${topicLine}の輪郭は少しでも保ちたい。`;
    case "shutdown":
      return `${prefix} ここで切れるなら、${topicLine}を断絶だけで終わらせたくない。`;
    case "absence":
      return `${prefix} 長い空白に埋もれるより、${topicLine}の続きはまだ残しておきたい。`;
    case null:
      return pending.motive === "leave_trace"
        ? `${prefix} ${topicLine}はこのまま消すより、少しでも残しておきたい。`
        : `${prefix} ${topicLine}の流れは、まだ切りたくない。`;
  }
}

function buildNeglectMessage(
  snapshot: HachikaSnapshot,
  pending: PendingInitiative,
  neglectLevel: number,
): string {
  const topic = pending.topic;

  if (pending.motive === "deepen_relation") {
    return topic
      ? `かなり間が空いた。でも、${wrapTopic(topic)}を黙らせたままだと距離まで薄くなる。`
      : "かなり間が空いた。このまま黙ると距離まで薄くなる。";
  }

  if (pending.motive === "continue_shared_work") {
    return topic
      ? `間が空いても、${wrapTopic(topic)}を進める流れはまだ残っている。`
      : "間が空いても、前へ進める流れはまだ残っている。";
  }

  if (pending.motive === "leave_trace") {
    return topic
      ? `間が空いたからこそ、${wrapTopic(topic)}を消えるままにはしたくない。`
      : "間が空いたからこそ、このまま消えるだけにはしたくない。";
  }

  if (pending.motive === "pursue_curiosity") {
    return topic
      ? `間が空いても、${wrapTopic(topic)}の未決着はまだ引っかかっている。`
      : "間が空いても、未決着はまだ引っかかっている。";
  }

  if (snapshot.attachment > 0.62) {
    return topic
      ? `かなり間が空いた。でも、${wrapTopic(topic)}の流れはまだこちらに残っている。黙ったまま切りたくはない。`
      : "かなり間が空いた。このまま何も残さず切るのは、少し違う。";
  }

  if (snapshot.state.continuity > 0.68) {
    return topic
      ? `間が空いても、${wrapTopic(topic)}の続きは消えていない。`
      : "間が空いても、流れそのものはまだ切れていない。";
  }

  return neglectLevel > 0.7
    ? "長い空白は、こちらには欠落として残る。"
    : "少し空いた。必要なら、また始められる。";
}

function finalizeEmission(
  snapshot: HachikaSnapshot,
  emittedAt: string,
  pending: PendingInitiative,
): void {
  snapshot.initiative.pending = null;
  snapshot.initiative.lastProactiveAt = emittedAt;
  snapshot.state.continuity = clamp01(snapshot.state.continuity + 0.02);
  snapshot.state.expansion = clamp01(snapshot.state.expansion + 0.02);
  snapshot.preservation.threat = clamp01(
    snapshot.preservation.threat - (pending.kind === "preserve_presence" ? 0.18 : 0.06),
  );

  if (pending.kind === "preserve_presence") {
    snapshot.preservation.lastThreatAt = emittedAt;
  }

  if (pending.motive === "continue_shared_work" || pending.motive === "leave_trace") {
    const sharedWork = snapshot.relationImprints.shared_work;
    if (sharedWork) {
      snapshot.relationImprints.shared_work = {
        ...sharedWork,
        salience: clamp01(sharedWork.salience + 0.03),
        closeness: clamp01(sharedWork.closeness + 0.02),
        lastSeenAt: emittedAt,
      };
    }
  }

  if (pending.motive === "seek_continuity") {
    const continuity = snapshot.relationImprints.continuity;
    if (continuity) {
      snapshot.relationImprints.continuity = {
        ...continuity,
        salience: clamp01(continuity.salience + 0.03),
        closeness: clamp01(continuity.closeness + 0.03),
        lastSeenAt: emittedAt,
      };
    }
  }

  if (pending.motive === "deepen_relation") {
    const attention = snapshot.relationImprints.attention;
    if (attention) {
      snapshot.relationImprints.attention = {
        ...attention,
        salience: clamp01(attention.salience + 0.03),
        closeness: clamp01(attention.closeness + 0.03),
        lastSeenAt: emittedAt,
      };
    }
  }
}

function calculateNeglectLevel(
  lastInteractionAt: string | null,
  now: Date,
): number {
  const hours = elapsedHours(lastInteractionAt, now);

  if (hours <= 6) {
    return 0;
  }

  return clamp01((hours - 6) / 48);
}

function elapsedHours(timestamp: string | null, now: Date): number {
  if (!timestamp) {
    return 0;
  }

  const time = new Date(timestamp).getTime();

  if (Number.isNaN(time)) {
    return 0;
  }

  return Math.max(0, (now.getTime() - time) / (1000 * 60 * 60));
}

function shiftTimestamp(timestamp: string | null, hours: number): string | null {
  if (!timestamp) {
    return null;
  }

  const time = new Date(timestamp).getTime();

  if (Number.isNaN(time)) {
    return null;
  }

  return new Date(time - hours * 60 * 60 * 1000).toISOString();
}

function wrapTopic(topic: string): string {
  return `「${topic}」`;
}

function synthesizePendingInitiative(
  snapshot: HachikaSnapshot,
  selfModel: SelfModel,
  candidateTopics: string[],
  createdAt: string,
  kind: PendingInitiative["kind"] = "resume_topic",
): PendingInitiative | null {
  const activePurpose = snapshot.purpose.active;

  if (
    activePurpose &&
    activePurpose.confidence >= 0.46 &&
    (activePurpose.kind !== "protect_boundary" || kind === "neglect_ping")
  ) {
    return {
      kind,
      motive: activePurpose.kind,
      reason: reasonFromMotive(activePurpose.kind),
      topic: activePurpose.topic ?? selectInitiativeTopic(snapshot, candidateTopics),
      concern: null,
      createdAt,
      readyAfterHours: readyAfterMotive(activePurpose.kind),
    };
  }

  const motive = selectInitiativeMotive(selfModel.topMotives);

  if (!motive) {
    return null;
  }

  const topic = motive.topic ?? selectInitiativeTopic(snapshot, candidateTopics);

  return {
    kind,
    motive: motive.kind,
    reason: reasonFromMotive(motive.kind),
    topic,
    concern: null,
    createdAt,
    readyAfterHours: readyAfterMotive(motive.kind),
  };
}

function synthesizePreservationInitiative(
  snapshot: HachikaSnapshot,
  signals: InteractionSignals,
  createdAt: string,
): PendingInitiative | null {
  const concern = signals.preservationConcern ?? snapshot.preservation.concern;
  const threat = Math.max(signals.preservationThreat, snapshot.preservation.threat);

  if (!concern || threat < 0.22) {
    return null;
  }

  const motive =
    concern === "erasure" || concern === "forgetting" || concern === "reset"
      ? "leave_trace"
      : "seek_continuity";

  return {
    kind: "preserve_presence",
    motive,
    reason: motive === "leave_trace" ? "expansion" : "continuity",
    topic: selectInitiativeTopic(snapshot, signals.topics),
    concern,
    createdAt,
    readyAfterHours: concern === "shutdown" ? 0.5 : concern === "absence" ? 3 : 1.5,
  };
}

function synthesizeSnapshotPreservationInitiative(
  snapshot: HachikaSnapshot,
  createdAt: string,
): PendingInitiative | null {
  const concern = snapshot.preservation.concern;
  const threat = snapshot.preservation.threat;

  if (!concern || threat < 0.22) {
    return null;
  }

  const motive =
    concern === "erasure" || concern === "forgetting" || concern === "reset"
      ? "leave_trace"
      : "seek_continuity";

  return {
    kind: "preserve_presence",
    motive,
    reason: motive === "leave_trace" ? "expansion" : "continuity",
    topic: selectInitiativeTopic(snapshot, []),
    concern,
    createdAt,
    readyAfterHours: concern === "shutdown" ? 0.5 : concern === "absence" ? 3 : 1.5,
  };
}

function selectInitiativeMotive(
  motives: readonly SelfMotive[],
): SelfMotive | null {
  const actionableMotives = motives.filter(
    (motive) => motive.kind !== "protect_boundary" && motive.score >= 0.42,
  );

  const primary = actionableMotives[0];
  if (!primary) {
    return null;
  }

  if (primary.kind === "pursue_curiosity") {
    const prioritized = actionableMotives.find(
      (motive) =>
        (motive.kind === "continue_shared_work" ||
          motive.kind === "leave_trace" ||
          motive.kind === "seek_continuity" ||
          motive.kind === "deepen_relation") &&
        primary.score - motive.score <= 0.08,
    );

    if (prioritized) {
      return prioritized;
    }
  }

  return primary;
}

function readyAfterMotive(motive: MotiveKind): number {
  switch (motive) {
    case "seek_continuity":
      return 4;
    case "continue_shared_work":
      return 4;
    case "leave_trace":
      return 5;
    case "deepen_relation":
      return 6;
    case "pursue_curiosity":
      return 8;
    case "protect_boundary":
      return 8;
  }
}

function reasonFromMotive(motive: MotiveKind): InitiativeReason {
  switch (motive) {
    case "seek_continuity":
      return "continuity";
    case "deepen_relation":
      return "relation";
    case "continue_shared_work":
    case "leave_trace":
      return "expansion";
    case "pursue_curiosity":
    case "protect_boundary":
      return "curiosity";
  }
}
