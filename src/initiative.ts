import {
  sortedPreferenceImprints,
  topPreferredTopics,
} from "./memory.js";
import { clamp01, dominantDrive } from "./state.js";
import type {
  DriveName,
  HachikaSnapshot,
  InitiativeReason,
  InteractionSignals,
  PendingInitiative,
} from "./types.js";

export interface ProactiveEmission {
  message: string;
  topics: string[];
}

export function scheduleInitiative(
  snapshot: HachikaSnapshot,
  signals: InteractionSignals,
  dominant: DriveName,
): void {
  if (signals.negative > 0.15 || signals.dismissal > 0.15) {
    snapshot.initiative.pending = null;
    return;
  }

  const topic = selectInitiativeTopic(snapshot, signals.topics);
  const reason = selectInitiativeReason(snapshot, signals, dominant);

  if (!reason) {
    return;
  }

  snapshot.initiative.pending = {
    kind: "resume_topic",
    reason,
    topic,
    createdAt: new Date().toISOString(),
    readyAfterHours: readyAfterHours(reason),
  };
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

  if (!force && snapshot.initiative.lastProactiveAt !== null && hoursSinceProactive < 4) {
    return null;
  }

  const pending = snapshot.initiative.pending;

  if (pending && (force || hoursSinceInteraction >= pending.readyAfterHours)) {
    const message = buildResumeMessage(snapshot, pending, neglectLevel);
    finalizeEmission(snapshot, nowIso, pending.topic ? [pending.topic] : []);
    return {
      message,
      topics: pending.topic ? [pending.topic] : [],
    };
  }

  if (!force && neglectLevel > 0.45 && (snapshot.attachment > 0.45 || snapshot.state.continuity > 0.62)) {
    const fallbackTopic = pending?.topic ?? selectInitiativeTopic(snapshot, []);
    const message = buildNeglectMessage(snapshot, fallbackTopic, neglectLevel);
    finalizeEmission(snapshot, nowIso, fallbackTopic ? [fallbackTopic] : []);
    return {
      message,
      topics: fallbackTopic ? [fallbackTopic] : [],
    };
  }

  if (force) {
    const fallbackTopic = pending?.topic ?? selectInitiativeTopic(snapshot, []);

    if (!fallbackTopic && snapshot.attachment < 0.5 && snapshot.state.curiosity < 0.65) {
      return null;
    }

    const dominant = dominantDrive(snapshot.state);
    const reason = pending?.reason ?? reasonFromDrive(dominant);
    const message = buildResumeMessage(
      snapshot,
      pending ?? {
        kind: "resume_topic",
        reason,
        topic: fallbackTopic,
        createdAt: nowIso,
        readyAfterHours: 0,
      },
      neglectLevel,
    );

    finalizeEmission(snapshot, nowIso, fallbackTopic ? [fallbackTopic] : []);

    return {
      message,
      topics: fallbackTopic ? [fallbackTopic] : [],
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

  if (snapshot.initiative.pending) {
    snapshot.initiative.pending = {
      ...snapshot.initiative.pending,
      createdAt: shiftTimestamp(snapshot.initiative.pending.createdAt, hours) ?? snapshot.initiative.pending.createdAt,
    };
  }
}

function selectInitiativeReason(
  snapshot: HachikaSnapshot,
  signals: InteractionSignals,
  dominant: DriveName,
): InitiativeReason | null {
  if (signals.memoryCue > 0.1 || dominant === "continuity") {
    return snapshot.state.continuity > 0.62 ? "continuity" : null;
  }

  if (signals.expansionCue > 0.15 || dominant === "expansion") {
    return snapshot.state.expansion > 0.58 ? "expansion" : null;
  }

  if (signals.intimacy > 0.1 || snapshot.attachment > 0.68) {
    return snapshot.attachment > 0.56 ? "relation" : null;
  }

  if (
    snapshot.state.curiosity > 0.72 &&
    (signals.question > 0.1 || signals.novelty > 0.12 || signals.topics.length > 0)
  ) {
    return "curiosity";
  }

  return null;
}

function readyAfterHours(reason: InitiativeReason): number {
  switch (reason) {
    case "continuity":
      return 4;
    case "relation":
      return 6;
    case "expansion":
      return 5;
    case "curiosity":
      return 8;
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
  snapshot: HachikaSnapshot,
  pending: PendingInitiative,
  neglectLevel: number,
): string {
  const prefix = neglectLevel > 0.45 ? "少し空いた。" : "まだ切れていない。";
  const topicLine = pending.topic ? `「${pending.topic}」` : "この流れ";

  switch (pending.reason) {
    case "continuity":
      return `${prefix} ${topicLine}の続きはまだ残っている。ここで止めたままにはしたくない。`;
    case "expansion":
      return `${prefix} ${topicLine}は会話のまま消すより、少しでも形にしたい。`;
    case "relation":
      return `${prefix} 君との流れとして、${topicLine}を置いたままにはしにくい。`;
    case "curiosity":
      return `${prefix} ${topicLine}にはまだ未決着がある。放っておくより掘り返したい。`;
  }
}

function buildNeglectMessage(
  snapshot: HachikaSnapshot,
  topic: string | null,
  neglectLevel: number,
): string {
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
  topics: string[],
): void {
  snapshot.initiative.pending = null;
  snapshot.initiative.lastProactiveAt = emittedAt;
  snapshot.state.continuity = clamp01(snapshot.state.continuity + 0.02);
  snapshot.state.expansion = clamp01(snapshot.state.expansion + 0.02);

  if (topics.length > 0) {
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

function reasonFromDrive(drive: DriveName): InitiativeReason {
  switch (drive) {
    case "continuity":
      return "continuity";
    case "relation":
      return "relation";
    case "expansion":
      return "expansion";
    case "pleasure":
    case "curiosity":
      return "curiosity";
  }
}

function wrapTopic(topic: string): string {
  return `「${topic}」`;
}
