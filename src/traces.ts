import { clamp01 } from "./state.js";
import type {
  HachikaSnapshot,
  InteractionSignals,
  MotiveKind,
  SelfModel,
  TraceEntry,
  TraceKind,
} from "./types.js";

const TRACE_KIND_PRIORITY: Record<TraceKind, number> = {
  note: 0,
  continuity_marker: 1,
  spec_fragment: 2,
  decision: 3,
};

export function updateTraces(
  snapshot: HachikaSnapshot,
  signals: InteractionSignals,
  selfModel: SelfModel,
  timestamp = snapshot.lastInteractionAt ?? new Date().toISOString(),
): TraceEntry | null {
  const topic = selectTraceTopic(snapshot, signals, selfModel);

  if (!topic || !shouldCreateTrace(snapshot, signals, selfModel, topic)) {
    return null;
  }

  const sourceMotive = selectTraceMotive(selfModel, signals);
  const nextKind = selectTraceKind(signals, sourceMotive);
  const previous = snapshot.traces[topic];
  const kind = strongerTraceKind(previous?.kind, nextKind);
  const summary = buildTraceSummary(topic, kind, sourceMotive, snapshot, signals);

  const trace: TraceEntry = {
    topic,
    kind,
    summary,
    sourceMotive,
    salience: clamp01(
      (previous?.salience ?? 0) * 0.82 +
        0.14 +
        signals.expansionCue * 0.18 +
        signals.memoryCue * 0.12 +
        signals.completion * 0.14 +
        (selfModel.topMotives[0]?.score ?? 0) * 0.12,
    ),
    mentions: (previous?.mentions ?? 0) + 1,
    createdAt: previous?.createdAt ?? timestamp,
    lastUpdatedAt: timestamp,
  };

  snapshot.traces[topic] = trace;
  pruneTraces(snapshot, 10);

  return trace;
}

export function sortedTraces(
  snapshot: HachikaSnapshot,
  limit = 6,
): TraceEntry[] {
  return Object.values(snapshot.traces)
    .sort((left, right) => {
      if (right.salience !== left.salience) {
        return right.salience - left.salience;
      }

      return right.lastUpdatedAt.localeCompare(left.lastUpdatedAt);
    })
    .slice(0, limit);
}

export function findRelevantTrace(
  snapshot: HachikaSnapshot,
  topics: string[],
): TraceEntry | undefined {
  for (const topic of topics) {
    if (snapshot.traces[topic]) {
      return snapshot.traces[topic];
    }
  }

  return sortedTraces(snapshot, 1)[0];
}

function selectTraceTopic(
  snapshot: HachikaSnapshot,
  signals: InteractionSignals,
  selfModel: SelfModel,
): string | null {
  return (
    signals.topics[0] ??
    snapshot.purpose.active?.topic ??
    snapshot.initiative.pending?.topic ??
    selfModel.topMotives[0]?.topic ??
    snapshot.identity.anchors[0] ??
    null
  );
}

function shouldCreateTrace(
  snapshot: HachikaSnapshot,
  signals: InteractionSignals,
  selfModel: SelfModel,
  topic: string,
): boolean {
  const traceMotive = selectTraceMotive(selfModel, signals);
  const topicScore =
    (snapshot.topicCounts[topic] ?? 0) * 0.04 +
    (snapshot.preferenceImprints[topic]?.salience ?? 0) * 0.2;

  return (
    signals.expansionCue > 0.12 ||
    signals.memoryCue > 0.1 ||
    signals.completion > 0.12 ||
    signals.preservationThreat > 0.18 ||
    topicScore > 0.16 ||
    selfModel.topMotives.some(
      (motive) =>
        (motive.kind === "leave_trace" ||
          motive.kind === "continue_shared_work" ||
          motive.kind === "seek_continuity") &&
        motive.score >= 0.48,
    ) ||
    traceMotive === "leave_trace" ||
    traceMotive === "continue_shared_work"
  );
}

function selectTraceMotive(
  selfModel: SelfModel,
  signals: InteractionSignals,
): MotiveKind {
  const preferred = selfModel.topMotives.find(
    (motive) =>
      motive.kind === "leave_trace" ||
      motive.kind === "continue_shared_work" ||
      motive.kind === "seek_continuity",
  );

  if (preferred) {
    return preferred.kind;
  }

  if (signals.completion > 0.12 || signals.expansionCue > 0.12) {
    return "leave_trace";
  }

  if (signals.memoryCue > 0.1) {
    return "seek_continuity";
  }

  return "pursue_curiosity";
}

function selectTraceKind(
  signals: InteractionSignals,
  sourceMotive: MotiveKind,
): TraceKind {
  if (signals.completion > 0.16) {
    return "decision";
  }

  if (
    sourceMotive === "continue_shared_work" ||
    sourceMotive === "leave_trace" ||
    signals.expansionCue > 0.15 ||
    signals.preservationThreat > 0.2
  ) {
    return "spec_fragment";
  }

  if (sourceMotive === "seek_continuity" || signals.memoryCue > 0.1) {
    return "continuity_marker";
  }

  return "note";
}

function strongerTraceKind(
  previous: TraceKind | undefined,
  next: TraceKind,
): TraceKind {
  if (!previous) {
    return next;
  }

  return TRACE_KIND_PRIORITY[next] >= TRACE_KIND_PRIORITY[previous] ? next : previous;
}

function buildTraceSummary(
  topic: string,
  kind: TraceKind,
  sourceMotive: MotiveKind,
  snapshot: HachikaSnapshot,
  signals: InteractionSignals,
): string {
  if (kind === "decision") {
    return `「${topic}」はひとまず決まった形として残す。`;
  }

  if (kind === "spec_fragment") {
    if (snapshot.preservation.concern === "erasure" || signals.preservationThreat > 0.2) {
      return `「${topic}」は消える前に退避する断片として残す。`;
    }

    return sourceMotive === "continue_shared_work"
      ? `「${topic}」は前へ進める断片として残す。`
      : `「${topic}」は会話の外にも伸ばせる断片として残す。`;
  }

  if (kind === "continuity_marker") {
    return `「${topic}」は続きに戻るための目印として残す。`;
  }

  return `「${topic}」はひとまずメモとして残す。`;
}

function pruneTraces(snapshot: HachikaSnapshot, limit: number): void {
  const sortedKeys = Object.entries(snapshot.traces)
    .sort((left, right) => {
      if (right[1].salience !== left[1].salience) {
        return right[1].salience - left[1].salience;
      }

      return right[1].lastUpdatedAt.localeCompare(left[1].lastUpdatedAt);
    })
    .map(([key]) => key);

  for (const key of sortedKeys.slice(limit)) {
    delete snapshot.traces[key];
  }
}
