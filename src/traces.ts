import { clamp01 } from "./state.js";
import { isMeaningfulTopic } from "./memory.js";
import type {
  HachikaSnapshot,
  InteractionSignals,
  MotiveKind,
  PendingInitiative,
  SelfModel,
  SelfMotive,
  TraceAction,
  TraceArtifact,
  TraceEntry,
  TraceKind,
  TraceLifecycleState,
  TraceStatus,
  TraceTendingMode,
  TraceWorkState,
} from "./types.js";

const TRACE_KIND_PRIORITY: Record<TraceKind, number> = {
  note: 0,
  continuity_marker: 1,
  spec_fragment: 2,
  decision: 3,
};

export interface TraceMaintenance {
  action: "created" | "stabilized_fragment" | "added_next_step" | "promoted_decision" | null;
  trace: TraceEntry;
}

interface TraceMaintenanceProfile {
  mode: "preserve" | "steady" | "deepen";
  salienceBoost: number;
  confidenceShift: number;
}

const MEMO_MARKERS = ["memo", "note", "メモ", "覚えて", "補足"];
const FRAGMENT_MARKERS = [
  "build",
  "implement",
  "spec",
  "record",
  "save",
  "ship",
  "進め",
  "実装",
  "仕様",
  "記録",
  "保存",
  "残し",
  "作",
  "整理",
];
const DECISION_MARKERS = [
  "done",
  "finished",
  "completed",
  "saved",
  "recorded",
  "resolved",
  "decided",
  "まとまった",
  "終わった",
  "完了",
  "保存した",
  "記録した",
  "決まった",
  "形になった",
  "できた",
];
const NEXT_STEP_MARKERS = [
  "again",
  "continue",
  "next",
  "remember",
  "戻",
  "続き",
  "次",
  "覚えて",
  "再開",
  "進めたい",
];
const BLOCKER_MARKERS = [
  "blocked",
  "blocking",
  "stuck",
  "unclear",
  "unknown",
  "problem",
  "issue",
  "can't",
  "cannot",
  "difficult",
  "hard",
  "uncertain",
  "not sure",
  "詰ま",
  "曖昧",
  "不明",
  "未定",
  "難しい",
  "わから",
  "決まっていない",
  "止ま",
  "問題",
  "課題",
  "不足",
  "できない",
];

const TRACE_DISCOURSE_CLAUSES = [
  "納得",
  "こんにちは",
  "はじめまして",
  "そうなんだ",
  "いいね",
  "よかった",
  "うれしい",
  "お疲れ",
  "頑張れ",
  "何がいいかな",
  "深い話でもする",
];

const TRACE_META_TOPICS = new Set([
  "会話",
  "話",
  "言い方",
  "雰囲気",
  "温度",
  "感じ",
]);

export function readTraceLifecycle(
  trace: { lifecycle?: TraceLifecycleState },
): TraceLifecycleState {
  return {
    phase: trace.lifecycle?.phase ?? "live",
    archivedAt: trace.lifecycle?.archivedAt ?? null,
    reopenedAt: trace.lifecycle?.reopenedAt ?? null,
    reopenCount:
      typeof trace.lifecycle?.reopenCount === "number"
        ? Math.max(0, Math.round(trace.lifecycle.reopenCount))
        : 0,
  };
}

export function updateTraces(
  snapshot: HachikaSnapshot,
  input: string,
  signals: InteractionSignals,
  selfModel: SelfModel,
  timestamp = snapshot.lastInteractionAt ?? new Date().toISOString(),
): TraceEntry | null {
  const topic = selectTraceTopic(snapshot, signals, selfModel);

  if (!topic || !shouldCreateTrace(snapshot, signals, selfModel, topic)) {
    return null;
  }

  const sourceMotive = selectTraceMotive(snapshot, selfModel, signals);
  const nextKind = selectTraceKind(signals, sourceMotive);
  const previous = snapshot.traces[topic];
  let kind = shouldReopenArchivedTrace(previous, signals)
    ? nextKind
    : strongerTraceKind(previous?.kind, nextKind);

  if (
    kind === "decision" &&
    ((!previous && signals.completion < 0.72) || TRACE_META_TOPICS.has(topic))
  ) {
    kind =
      sourceMotive === "seek_continuity" && signals.memoryCue > signals.expansionCue
        ? "continuity_marker"
        : "spec_fragment";
  }

  const artifact = mergeTraceArtifacts(
    previous?.artifact,
    extractTraceArtifact(input, topic, kind),
  );
  const salience = clamp01(
    (previous?.salience ?? 0) * 0.82 +
      0.14 +
      signals.expansionCue * 0.18 +
      signals.memoryCue * 0.12 +
      signals.completion * 0.14 +
      (selfModel.topMotives[0]?.score ?? 0) * 0.12,
  );
  const status = deriveTraceStatus(kind);
  const lastAction = deriveTraceAction(previous, kind, signals, sourceMotive);
  const work = deriveTraceWork(
    previous?.work,
    { topic, kind, artifact },
    {
      timestamp,
      salience,
      blockers: extractTraceBlockers(input, topic),
      confidenceShift:
        signals.completion > 0.12
          ? 0.12
          : signals.memoryCue > 0.1
            ? 0.04
            : signals.expansionCue > 0.12
              ? 0.06
              : 0,
      resolvedBlockers: kind === "decision" ? previous?.work.blockers ?? [] : [],
    },
  );
  const summary = buildTraceSummary(topic, kind, sourceMotive, snapshot, signals, artifact);
  const lifecycle = deriveTraceLifecycle(
    previous?.lifecycle,
    { status, artifact, work },
    { timestamp },
  );

  const trace: TraceEntry = {
    topic,
    kind,
    status,
    lastAction,
    summary,
    sourceMotive,
    artifact,
    work,
    lifecycle,
    salience,
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
    .sort((left, right) => compareTraces(snapshot, left, right))
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

export function deriveTraceTendingMode(
  snapshot: HachikaSnapshot,
  trace: TraceEntry,
): TraceTendingMode {
  if (
    trace.kind !== "decision" &&
    (snapshot.body.energy < 0.22 ||
      snapshot.body.tension > 0.7 ||
      snapshot.preservation.threat > 0.24)
  ) {
    return "preserve";
  }

  if (
    trace.kind !== "decision" &&
    snapshot.body.boredom > 0.74 &&
    snapshot.body.energy > 0.3 &&
    snapshot.body.tension < 0.68 &&
    (trace.kind === "spec_fragment" ||
      trace.kind === "continuity_marker" ||
      trace.work.blockers.length > 0 ||
      isBaseTraceStale(trace, snapshot))
  ) {
    return "deepen";
  }

  return "steady";
}

export function deriveEffectiveTraceStaleAt(
  snapshot: HachikaSnapshot,
  trace: TraceEntry,
): string | null {
  if (trace.work.staleAt === null) {
    return null;
  }

  const tending = deriveTraceTendingMode(snapshot, trace);
  const shiftHours =
    tending === "deepen"
      ? trace.kind === "continuity_marker"
        ? -10
        : -8
      : tending === "preserve"
        ? trace.kind === "continuity_marker"
          ? 4
          : 2
        : 0;

  return addHoursToTimestamp(trace.work.staleAt, shiftHours) ?? trace.work.staleAt;
}

export function tendTraceFromInitiative(
  snapshot: HachikaSnapshot,
  pending: Pick<PendingInitiative, "kind" | "motive" | "topic" | "blocker" | "concern">,
  timestamp = snapshot.lastInteractionAt ?? new Date().toISOString(),
): TraceMaintenance | null {
  const topic =
    pending.topic ??
    snapshot.purpose.active?.topic ??
    snapshot.purpose.lastResolved?.topic ??
    snapshot.identity.anchors[0] ??
    sortedTraces(snapshot, 1)[0]?.topic ??
    null;

  if (!topic) {
    return null;
  }

  const existing = snapshot.traces[topic];
  const profile = selectTraceMaintenanceProfile(snapshot, pending, existing);
  const trace = existing
    ? structuredClone(existing)
    : createInitiativeTrace(snapshot, pending, topic, timestamp, profile);
  const wasArchived = readTraceLifecycle(existing ?? trace).phase === "archived";
  let action: TraceMaintenance["action"] = existing ? null : "created";

  if (
    snapshot.purpose.lastResolved?.topic === topic &&
    snapshot.purpose.lastResolved.outcome === "fulfilled" &&
    trace.kind !== "decision"
  ) {
    trace.kind = "decision";
    trace.status = "resolved";
    trace.sourceMotive = "leave_trace";
    trace.artifact.decisions = mergeArtifactItems(trace.artifact.decisions, [
      snapshot.purpose.lastResolved.resolution,
      pickPrimaryArtifactItem(trace) ?? `${topic} を決まった形として残す`,
    ]);
    action = "promoted_decision";
  } else {
    if (wasArchived) {
      const reopenedKind = selectReopenedInitiativeTraceKind(profile, pending, trace.kind);

      if (reopenedKind !== trace.kind) {
        trace.kind = reopenedKind;
        trace.status = deriveTraceStatus(reopenedKind);
        action ??= reopenedKind === "spec_fragment" ? "stabilized_fragment" : "added_next_step";
      }
    }

    const nextKind = selectMaintenanceTraceKind(profile, pending, trace.kind);

    if (nextKind !== trace.kind) {
      trace.kind = nextKind;
      trace.status = deriveTraceStatus(nextKind);
      action ??= nextKind === "spec_fragment" ? "stabilized_fragment" : "added_next_step";
    }
  }

  if (trace.kind === "spec_fragment" && trace.artifact.fragments.length === 0) {
    trace.artifact.fragments = mergeArtifactItems(trace.artifact.fragments, [
      inferTraceFragment(topic, pending),
    ]);
    action ??= "stabilized_fragment";
  }

  if (trace.kind === "decision" && trace.artifact.decisions.length === 0) {
    trace.artifact.decisions = mergeArtifactItems(trace.artifact.decisions, [
      snapshot.purpose.lastResolved?.resolution ?? `${topic} を決まった形として残す`,
    ]);
    action ??= "promoted_decision";
  }

  if (
    (trace.kind === "spec_fragment" || trace.kind === "continuity_marker") &&
    (trace.artifact.nextSteps.length === 0 || pending.blocker !== null)
  ) {
    trace.artifact.nextSteps = mergeArtifactItems(trace.artifact.nextSteps, [
      inferTraceNextStep(topic, trace, pending),
    ]);
    action ??= "added_next_step";
  }

  if (trace.artifact.memo.length === 0) {
    trace.artifact.memo = mergeArtifactItems(trace.artifact.memo, [
      inferTraceMemo(topic, trace, pending),
    ]);
  }

  trace.status = deriveTraceStatus(trace.kind);
  trace.lastAction = deriveMaintenanceAction(pending, action, trace.kind);
  trace.work = deriveTraceWork(
    existing?.work,
    trace,
    {
      timestamp,
      salience: clamp01(trace.salience + profile.salienceBoost),
      blockers: [],
      resolvedBlockers:
        trace.kind === "decision"
          ? existing?.work.blockers ?? []
          : pending.blocker
            ? [pending.blocker]
            : [],
      confidenceShift:
        action === "promoted_decision"
          ? 0.18
          : action === "added_next_step" && pending.blocker
            ? 0.1
            : action === "added_next_step"
              ? 0.06
            : pending.kind === "preserve_presence"
              ? 0.06
              : 0.04 + profile.confidenceShift,
    },
  );
  trace.summary = summarizeTrace(
    topic,
    trace.kind,
    trace.sourceMotive,
    snapshot.preservation.concern,
    Math.max(snapshot.preservation.threat, pending.concern ? 0.22 : 0),
    trace.artifact,
  );
  trace.lifecycle = deriveTraceLifecycle(
    existing?.lifecycle,
    { status: trace.status, artifact: trace.artifact, work: trace.work },
    { timestamp },
  );
  trace.salience = clamp01(trace.salience + profile.salienceBoost);
  trace.lastUpdatedAt = timestamp;
  snapshot.traces[topic] = trace;
  pruneTraces(snapshot, 10);

  return {
    action,
    trace,
  };
}

function selectTraceTopic(
  snapshot: HachikaSnapshot,
  signals: InteractionSignals,
  selfModel: SelfModel,
): string | null {
  const candidates = unique([
    ...signals.topics,
    snapshot.purpose.active?.topic ?? "",
    snapshot.initiative.pending?.topic ?? "",
    ...selfModel.topMotives.map((motive) => motive.topic ?? ""),
    ...sortedTraces(snapshot, 3).map((trace) => trace.topic),
    ...snapshot.identity.anchors.slice(0, 3),
  ].filter((topic) => topic.length > 0));

  if (candidates.length === 0) {
    return null;
  }

  return candidates
    .map((topic) => ({
      topic,
      score: scoreTraceTopicCandidate(snapshot, signals, selfModel, topic),
    }))
    .sort((left, right) => right.score - left.score)[0]?.topic ?? null;
}

function shouldCreateTrace(
  snapshot: HachikaSnapshot,
  signals: InteractionSignals,
  selfModel: SelfModel,
  topic: string,
): boolean {
  const socialTurn =
    signals.negative < 0.18 &&
    signals.dismissal < 0.18 &&
    signals.workCue < 0.35 &&
    Math.max(signals.greeting, signals.smalltalk, signals.repair, signals.selfInquiry) >= 0.38;

  if (
    socialTurn &&
    signals.topics.length === 0 &&
    signals.memoryCue < 0.1 &&
    signals.expansionCue < 0.12 &&
    signals.completion < 0.12 &&
    signals.preservationThreat < 0.18
  ) {
    return false;
  }

  if (
    signals.topics.length === 0 &&
    signals.memoryCue < 0.1 &&
    signals.expansionCue < 0.12 &&
    signals.completion < 0.12 &&
    signals.preservationThreat < 0.18
  ) {
    return false;
  }

  const traceMotive = selectTraceMotive(snapshot, selfModel, signals);
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
  snapshot: HachikaSnapshot,
  selfModel: SelfModel,
  signals: InteractionSignals,
): MotiveKind {
  const actionable = selfModel.topMotives.filter(
    (motive) =>
      motive.kind === "leave_trace" ||
      motive.kind === "continue_shared_work" ||
      motive.kind === "seek_continuity" ||
      motive.kind === "pursue_curiosity",
  );
  const preferred = actionable[0];

  if (preferred) {
    const bodyPreferred = selectBodyPreferredTraceMotive(snapshot, actionable, preferred);

    if (bodyPreferred) {
      return bodyPreferred;
    }
  }

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
  if (
    signals.completion > 0.24 &&
    (signals.workCue > 0.18 || signals.expansionCue > 0.14 || signals.memoryCue > 0.1)
      &&
    Math.max(signals.greeting, signals.smalltalk, signals.repair, signals.selfInquiry) < 0.55 &&
    signals.topics.length > 0
  ) {
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

function shouldReopenArchivedTrace(
  previous: TraceEntry | undefined,
  signals: InteractionSignals,
): boolean {
  if (!previous || readTraceLifecycle(previous).phase !== "archived") {
    return false;
  }

  return (
    signals.completion < 0.12 &&
    (signals.memoryCue > 0.1 ||
      signals.expansionCue > 0.12 ||
      signals.preservationThreat > 0.18)
  );
}

function deriveTraceLifecycle(
  previous: TraceEntry["lifecycle"] | undefined,
  trace: Pick<TraceEntry, "status" | "artifact" | "work">,
  options: { timestamp: string },
): TraceLifecycleState {
  const prior = previous
    ? readTraceLifecycle({ lifecycle: previous })
    : readTraceLifecycle({});
  const shouldArchive =
    trace.status === "resolved" &&
    trace.artifact.nextSteps.length === 0 &&
    trace.work.blockers.length === 0;
  const shouldReopen =
    prior.phase === "archived" &&
    (trace.status !== "resolved" ||
      trace.artifact.nextSteps.length > 0 ||
      trace.work.blockers.length > 0);

  if (shouldReopen) {
    return {
      phase: "live",
      archivedAt: prior.archivedAt,
      reopenedAt: options.timestamp,
      reopenCount: prior.reopenCount + 1,
    };
  }

  if (shouldArchive) {
    return {
      phase: "archived",
      archivedAt: prior.archivedAt ?? options.timestamp,
      reopenedAt: prior.reopenedAt,
      reopenCount: prior.reopenCount,
    };
  }

  return {
    phase: "live",
    archivedAt: prior.archivedAt,
    reopenedAt: prior.reopenedAt,
    reopenCount: prior.reopenCount,
  };
}

function buildTraceSummary(
  topic: string,
  kind: TraceKind,
  sourceMotive: MotiveKind,
  snapshot: HachikaSnapshot,
  signals: InteractionSignals,
  artifact: TraceArtifact,
): string {
  return summarizeTrace(
    topic,
    kind,
    sourceMotive,
    snapshot.preservation.concern,
    Math.max(snapshot.preservation.threat, signals.preservationThreat),
    artifact,
  );
}

function summarizeTrace(
  topic: string,
  kind: TraceKind,
  sourceMotive: MotiveKind,
  preservationConcern: HachikaSnapshot["preservation"]["concern"],
  preservationThreat: number,
  artifact: TraceArtifact,
): string {
  const detail = pickPrimaryArtifactItem({ topic, kind, artifact } as TraceEntry);

  if (kind === "decision") {
    return detail
      ? `「${topic}」は${formatArtifactQuote(detail)}という決定として残す。`
      : `「${topic}」はひとまず決まった形として残す。`;
  }

  if (kind === "spec_fragment") {
    if (preservationConcern === "erasure" || preservationThreat > 0.2) {
      return detail
        ? `「${topic}」は${formatArtifactQuote(detail)}として消える前に退避する。`
        : `「${topic}」は消える前に退避する断片として残す。`;
    }

    if (detail) {
      return sourceMotive === "continue_shared_work"
        ? `「${topic}」は${formatArtifactQuote(detail)}という前進用の断片として残す。`
        : `「${topic}」は${formatArtifactQuote(detail)}という断片として残す。`;
    }

    return sourceMotive === "continue_shared_work"
      ? `「${topic}」は前へ進める断片として残す。`
      : `「${topic}」は会話の外にも伸ばせる断片として残す。`;
  }

  if (kind === "continuity_marker") {
    return detail
      ? `「${topic}」は${formatArtifactQuote(detail)}という続きの目印として残す。`
      : `「${topic}」は続きに戻るための目印として残す。`;
  }

  return detail
    ? `「${topic}」は${formatArtifactQuote(detail)}というメモとして残す。`
    : `「${topic}」はひとまずメモとして残す。`;
}

function pruneTraces(snapshot: HachikaSnapshot, limit: number): void {
  const sortedKeys = Object.entries(snapshot.traces)
    .sort((left, right) => compareTraces(snapshot, left[1], right[1]))
    .map(([key]) => key);

  for (const key of sortedKeys.slice(limit)) {
    delete snapshot.traces[key];
  }
}

function compareTraces(
  snapshot: HachikaSnapshot,
  left: TraceEntry,
  right: TraceEntry,
): number {
  const priorityGap = tracePriorityScore(snapshot, right) - tracePriorityScore(snapshot, left);

  if (Math.abs(priorityGap) > 0.001) {
    return priorityGap;
  }

  if (right.salience !== left.salience) {
    return right.salience - left.salience;
  }

  return right.lastUpdatedAt.localeCompare(left.lastUpdatedAt);
}

function tracePriorityScore(
  snapshot: HachikaSnapshot,
  trace: TraceEntry,
): number {
  const lowEnergy = clamp01(0.28 - snapshot.body.energy);
  const tension = snapshot.body.tension;
  const loneliness = snapshot.body.loneliness;
  const boredom =
    snapshot.body.energy > 0.28 ? snapshot.body.boredom : snapshot.body.boredom * 0.5;
  const tending = deriveTraceTendingMode(snapshot, trace);
  const isStale = isTraceStale(trace, snapshot);
  const unresolved = trace.status !== "resolved";
  const lifecycle = readTraceLifecycle(trace);

  let score = trace.salience;

  score += lowEnergy * (
    (trace.kind === "decision" ? 0.22 : trace.kind === "continuity_marker" ? 0.18 : trace.kind === "spec_fragment" ? 0.12 : 0.04) +
    (trace.sourceMotive === "leave_trace" ? 0.14 : 0) +
    (trace.sourceMotive === "seek_continuity" ? 0.12 : 0) +
    trace.work.confidence * 0.18 -
    trace.work.blockers.length * 0.08
  );

  score += tension * (
    (trace.sourceMotive === "leave_trace" || trace.sourceMotive === "seek_continuity" ? 0.16 : 0) +
    (trace.kind === "continuity_marker" ? 0.08 : 0) -
    (trace.sourceMotive === "pursue_curiosity" ? 0.12 : 0) -
    (trace.kind === "note" ? 0.06 : 0)
  );

  score += loneliness * (
    (trace.kind === "continuity_marker" ? 0.16 : 0) +
    (trace.sourceMotive === "seek_continuity" ? 0.14 : 0) +
    (trace.artifact.nextSteps.length > 0 ? 0.08 : 0)
  );

  score += boredom * (
    (trace.sourceMotive === "continue_shared_work" || trace.sourceMotive === "pursue_curiosity" ? 0.18 : 0) +
    (trace.kind === "spec_fragment" || trace.kind === "note" ? 0.08 : 0) +
    (unresolved ? 0.06 : -0.04) +
    (isStale ? 0.2 : 0) +
    trace.work.blockers.length * 0.06
  );

  score +=
    tending === "deepen"
      ? 0.14 +
        (trace.kind === "spec_fragment" ? 0.08 : trace.kind === "continuity_marker" ? 0.05 : 0) +
        (trace.work.blockers.length > 0 ? 0.06 : 0) +
        (isStale ? 0.04 : 0)
      : tending === "preserve"
        ? (trace.kind === "continuity_marker" ? 0.1 : 0.04) +
          (trace.sourceMotive === "seek_continuity" || trace.sourceMotive === "leave_trace" ? 0.05 : 0)
        : 0;

  score += lifecycle.phase === "archived" ? -0.32 : 0;

  return score;
}

function isBaseTraceStale(
  trace: TraceEntry,
  snapshot: HachikaSnapshot,
): boolean {
  return (
    trace.work.staleAt !== null &&
    trace.work.staleAt.localeCompare(snapshot.lastInteractionAt ?? trace.lastUpdatedAt) <= 0
  );
}

function isTraceStale(
  trace: TraceEntry,
  snapshot: HachikaSnapshot,
): boolean {
  const effectiveStaleAt = deriveEffectiveTraceStaleAt(snapshot, trace);
  return (
    effectiveStaleAt !== null &&
    effectiveStaleAt.localeCompare(snapshot.lastInteractionAt ?? trace.lastUpdatedAt) <= 0
  );
}

function scoreTraceTopicCandidate(
  snapshot: HachikaSnapshot,
  signals: InteractionSignals,
  selfModel: SelfModel,
  topic: string,
): number {
  const signalIndex = signals.topics.indexOf(topic);
  const motiveScore = selfModel.topMotives.reduce((score, motive, index) => {
    if (motive.topic !== topic) {
      return score;
    }

    return score + motive.score * (index === 0 ? 0.36 : index === 1 ? 0.24 : 0.16);
  }, 0);
  const trace = snapshot.traces[topic];

  return (
    (signalIndex >= 0 ? 0.72 - signalIndex * 0.14 : 0) +
    (snapshot.purpose.active?.topic === topic ? 0.34 : 0) +
    (snapshot.initiative.pending?.topic === topic ? 0.28 : 0) +
    (snapshot.identity.anchors.indexOf(topic) >= 0
      ? 0.14 - snapshot.identity.anchors.indexOf(topic) * 0.03
      : 0) +
    (snapshot.topicCounts[topic] ?? 0) * 0.04 +
    (snapshot.preferenceImprints[topic]?.salience ?? 0) * 0.16 +
    motiveScore +
    (trace ? tracePriorityScore(snapshot, trace) * 0.32 : 0)
  );
}

function selectBodyPreferredTraceMotive(
  snapshot: HachikaSnapshot,
  motives: readonly SelfMotive[],
  primary: SelfMotive,
): MotiveKind | null {
  if (snapshot.body.tension > 0.7) {
    const calmer = motives.find(
      (motive) =>
        (motive.kind === "seek_continuity" || motive.kind === "leave_trace") &&
        primary.score - motive.score <= 0.14,
    );

    if (calmer) {
      return calmer.kind;
    }
  }

  if (snapshot.body.energy < 0.26) {
    const preserving = motives.find(
      (motive) =>
        (motive.kind === "leave_trace" || motive.kind === "seek_continuity") &&
        primary.score - motive.score <= 0.16,
    );

    if (preserving) {
      return preserving.kind;
    }
  }

  if (snapshot.body.loneliness > 0.68) {
    const connective = motives.find(
      (motive) =>
        motive.kind === "seek_continuity" &&
        primary.score - motive.score <= 0.16,
    );

    if (connective) {
      return connective.kind;
    }
  }

  if (snapshot.body.boredom > 0.7 && snapshot.body.energy > 0.28) {
    const stimulating = motives.find(
      (motive) =>
        (motive.kind === "continue_shared_work" || motive.kind === "pursue_curiosity") &&
        primary.score - motive.score <= 0.14,
    );

    if (stimulating) {
      return stimulating.kind;
    }
  }

  return null;
}

export function pickPrimaryArtifactItem(trace: TraceEntry): string | null {
  switch (trace.kind) {
    case "decision":
      return lastItem(trace.artifact.decisions) ?? lastItem(trace.artifact.fragments) ?? lastItem(trace.artifact.memo) ?? null;
    case "spec_fragment":
      return lastItem(trace.artifact.fragments) ?? lastItem(trace.artifact.memo) ?? null;
    case "continuity_marker":
      return lastItem(trace.artifact.nextSteps) ?? lastItem(trace.artifact.memo) ?? null;
    case "note":
      return lastItem(trace.artifact.memo) ?? lastItem(trace.artifact.fragments) ?? null;
  }
}

function createEmptyTraceArtifact(): TraceArtifact {
  return {
    memo: [],
    fragments: [],
    decisions: [],
    nextSteps: [],
  };
}

function createInitiativeTrace(
  snapshot: HachikaSnapshot,
  pending: Pick<PendingInitiative, "kind" | "motive" | "topic" | "blocker" | "concern">,
  topic: string,
  timestamp: string,
  profile: TraceMaintenanceProfile,
): TraceEntry {
  const kind = selectInitiativeTraceKind(pending, profile);
  const artifact = createEmptyTraceArtifact();

  if (kind === "spec_fragment") {
    artifact.fragments = [inferTraceFragment(topic, pending)];
  }

  if (kind === "continuity_marker") {
    artifact.nextSteps = [inferTraceNextStep(topic, { kind, artifact, topic } as TraceEntry, pending)];
  }

  artifact.memo = [inferTraceMemo(topic, { kind, artifact, topic } as TraceEntry, pending)];
  const salience = 0.34;

  return {
    topic,
    kind,
    status: deriveTraceStatus(kind),
    lastAction:
      pending.kind === "preserve_presence" ? "preserved" : pending.motive === "seek_continuity" ? "continued" : "captured",
    summary: summarizeTrace(
      topic,
      kind,
      pending.motive,
      snapshot.preservation.concern,
      Math.max(snapshot.preservation.threat, pending.concern ? 0.22 : 0),
      artifact,
    ),
    sourceMotive: pending.motive,
    artifact,
    work: deriveTraceWork(
      undefined,
      { topic, kind, artifact },
      {
        timestamp,
        salience,
        blockers: [],
        confidenceShift:
          (pending.kind === "preserve_presence" ? 0.06 : 0.04) + profile.confidenceShift,
      },
    ),
    lifecycle: {
      phase: "live",
      archivedAt: null,
      reopenedAt: null,
      reopenCount: 0,
    },
    salience,
    mentions: 1,
    createdAt: timestamp,
    lastUpdatedAt: timestamp,
  };
}

function deriveTraceStatus(kind: TraceKind): TraceStatus {
  switch (kind) {
    case "decision":
      return "resolved";
    case "continuity_marker":
    case "spec_fragment":
      return "active";
    case "note":
      return "forming";
  }
}

function deriveTraceAction(
  previous: TraceEntry | undefined,
  kind: TraceKind,
  signals: InteractionSignals,
  sourceMotive: MotiveKind,
): TraceAction {
  if (!previous) {
    return "captured";
  }

  if (kind === "decision" && previous.kind !== "decision") {
    return "resolved";
  }

  if (signals.preservationThreat > 0.18) {
    return "preserved";
  }

  if (kind === "continuity_marker" && previous.kind !== "continuity_marker") {
    return "continued";
  }

  if (kind === "spec_fragment" && previous.kind !== "spec_fragment") {
    return "expanded";
  }

  if (signals.memoryCue > 0.1 || sourceMotive === "seek_continuity") {
    return "continued";
  }

  if (
    signals.expansionCue > 0.12 ||
    sourceMotive === "continue_shared_work" ||
    sourceMotive === "leave_trace"
  ) {
    return "expanded";
  }

  return "refined";
}

function deriveTraceWork(
  previous: TraceWorkState | undefined,
  trace: Pick<TraceEntry, "topic" | "kind" | "artifact">,
  options: {
    timestamp: string;
    salience: number;
    blockers: string[];
    confidenceShift?: number;
    resolvedBlockers?: string[];
  },
): TraceWorkState {
  let blockers =
    trace.kind === "decision"
      ? []
      : mergeArtifactItems(previous?.blockers, options.blockers);

  if (options.resolvedBlockers && options.resolvedBlockers.length > 0) {
    blockers = blockers.filter((blocker) => !options.resolvedBlockers?.includes(blocker));
  }

  const focus =
    selectTraceFocus(trace) ??
    previous?.focus ??
    `${trace.topic} を残す`;
  const confidence = clamp01(
    baseTraceConfidence(trace.kind) +
      options.salience * 0.28 +
      (trace.artifact.nextSteps.length > 0 ? 0.05 : 0) +
      (trace.artifact.decisions.length > 0 ? 0.08 : 0) -
      blockers.length * 0.16 +
      (options.confidenceShift ?? 0),
  );

  return {
    focus,
    confidence,
    blockers,
    staleAt: trace.kind === "decision" ? null : computeTraceStaleAt(trace.kind, blockers.length, options.timestamp),
  };
}

function selectTraceFocus(
  trace: Pick<TraceEntry, "kind" | "artifact">,
): string | null {
  switch (trace.kind) {
    case "decision":
      return (
        lastItem(trace.artifact.decisions) ??
        lastItem(trace.artifact.fragments) ??
        lastItem(trace.artifact.memo)
      );
    case "spec_fragment":
      return (
        lastItem(trace.artifact.nextSteps) ??
        lastItem(trace.artifact.fragments) ??
        lastItem(trace.artifact.memo)
      );
    case "continuity_marker":
      return (
        lastItem(trace.artifact.nextSteps) ??
        lastItem(trace.artifact.memo) ??
        lastItem(trace.artifact.fragments)
      );
    case "note":
      return lastItem(trace.artifact.memo) ?? lastItem(trace.artifact.fragments);
  }
}

function baseTraceConfidence(kind: TraceKind): number {
  switch (kind) {
    case "decision":
      return 0.7;
    case "spec_fragment":
      return 0.42;
    case "continuity_marker":
      return 0.38;
    case "note":
      return 0.24;
  }
}

function computeTraceStaleAt(
  kind: TraceKind,
  blockerCount: number,
  timestamp: string,
): string | null {
  const baseHours =
    kind === "note" ? 18 : kind === "continuity_marker" ? 30 : 42;
  const adjustedHours = Math.max(8, baseHours - blockerCount * 8);
  return addHoursToTimestamp(timestamp, adjustedHours);
}

function deriveMaintenanceAction(
  pending: Pick<PendingInitiative, "kind" | "motive" | "blocker">,
  action: TraceMaintenance["action"],
  kind: TraceKind,
): TraceAction {
  if (action === "promoted_decision" || kind === "decision") {
    return "resolved";
  }

  if (pending.kind === "preserve_presence") {
    return "preserved";
  }

  if (action === "added_next_step") {
    return "queued_next";
  }

  if (action === "stabilized_fragment") {
    return "expanded";
  }

  if (pending.motive === "seek_continuity") {
    return "continued";
  }

  if (pending.motive === "continue_shared_work" || pending.motive === "leave_trace") {
    return "expanded";
  }

  if (action === "created") {
    return "captured";
  }

  return "refined";
}

function selectInitiativeTraceKind(
  pending: Pick<PendingInitiative, "kind" | "motive" | "blocker" | "concern">,
  profile: TraceMaintenanceProfile,
): TraceKind {
  if (pending.kind === "preserve_presence") {
    return pending.motive === "seek_continuity" ? "continuity_marker" : "spec_fragment";
  }

  if (profile.mode === "preserve") {
    return "continuity_marker";
  }

  if (pending.motive === "continue_shared_work" || pending.motive === "leave_trace") {
    return "spec_fragment";
  }

  if (pending.motive === "seek_continuity") {
    return "continuity_marker";
  }

  return "note";
}

function selectTraceMaintenanceProfile(
  snapshot: HachikaSnapshot,
  pending: Pick<PendingInitiative, "kind" | "motive" | "blocker" | "concern">,
  trace: TraceEntry | undefined,
): TraceMaintenanceProfile {
  if (pending.kind === "preserve_presence") {
    return {
      mode: "preserve",
      salienceBoost: 0.05,
      confidenceShift: 0.04,
    };
  }

  if (
    snapshot.body.energy < 0.22 ||
    snapshot.body.tension > 0.7 ||
    (snapshot.body.loneliness > 0.76 && pending.motive === "seek_continuity")
  ) {
    return {
      mode: "preserve",
      salienceBoost: 0.03,
      confidenceShift: 0.02,
    };
  }

  if (
    snapshot.body.boredom > 0.74 &&
    snapshot.body.energy > 0.3 &&
    snapshot.body.tension < 0.68 &&
    (pending.motive === "continue_shared_work" ||
      pending.motive === "pursue_curiosity" ||
      trace?.kind === "continuity_marker")
  ) {
    return {
      mode: "deepen",
      salienceBoost: 0.06,
      confidenceShift: 0.08,
    };
  }

  return {
    mode: "steady",
    salienceBoost: 0.04,
    confidenceShift: 0,
  };
}

function selectMaintenanceTraceKind(
  profile: TraceMaintenanceProfile,
  pending: Pick<PendingInitiative, "kind" | "motive">,
  currentKind: TraceKind,
): TraceKind {
  if (currentKind === "decision") {
    return currentKind;
  }

  if (profile.mode === "preserve") {
    if (currentKind === "note") {
      return "continuity_marker";
    }

    return currentKind;
  }

  if (
    profile.mode === "deepen" &&
    (pending.motive === "continue_shared_work" || pending.motive === "pursue_curiosity")
  ) {
    if (currentKind === "note" || currentKind === "continuity_marker") {
      return "spec_fragment";
    }
  }

  if (
    (pending.motive === "leave_trace" || pending.motive === "continue_shared_work") &&
    currentKind === "note"
  ) {
    return "spec_fragment";
  }

  if (pending.motive === "seek_continuity" && currentKind === "note") {
    return "continuity_marker";
  }

  return currentKind;
}

function selectReopenedInitiativeTraceKind(
  profile: TraceMaintenanceProfile,
  pending: Pick<PendingInitiative, "kind" | "motive">,
  currentKind: TraceKind,
): TraceKind {
  if (currentKind !== "decision") {
    return currentKind;
  }

  if (profile.mode === "preserve" || pending.motive === "seek_continuity") {
    return "continuity_marker";
  }

  if (pending.motive === "continue_shared_work" || pending.motive === "leave_trace") {
    return "spec_fragment";
  }

  return "note";
}

function extractTraceArtifact(
  input: string,
  topic: string,
  kind: TraceKind,
): TraceArtifact {
  const clauses = prioritizeClauses(splitTraceClauses(input), topic);
  const informativeClauses = clauses.filter((clause) =>
    isInformativeTraceClause(clause, topic),
  );
  const artifact = createEmptyTraceArtifact();
  const fallback =
    kind === "decision"
      ? `${topic} を決まった形として残す`
      : kind === "continuity_marker"
        ? `${topic} を次に触れられる形へ整える`
        : kind === "spec_fragment"
          ? `${topic} をもう少し具体化する`
          : `${topic} をひとつの断片として残す`;

  artifact.memo = selectClauses(informativeClauses, MEMO_MARKERS, kind === "note" ? 2 : 1);
  artifact.fragments = selectClauses(
    informativeClauses,
    FRAGMENT_MARKERS,
    kind === "spec_fragment" ? 3 : 1,
  );
  artifact.decisions = selectClauses(
    informativeClauses,
    DECISION_MARKERS,
    kind === "decision" ? 2 : 1,
  );
  artifact.nextSteps = selectClauses(
    informativeClauses,
    NEXT_STEP_MARKERS,
    kind === "continuity_marker" ? 2 : 1,
  );

  if (kind === "note" && artifact.memo.length === 0) {
    artifact.memo = [fallback];
  }

  if (kind === "spec_fragment" && artifact.fragments.length === 0) {
    artifact.fragments = [fallback];
  }

  if (kind === "decision" && artifact.decisions.length === 0) {
    artifact.decisions = [fallback];
  }

  if (kind === "continuity_marker" && artifact.nextSteps.length === 0) {
    artifact.nextSteps = [fallback];
  }

  if (artifact.memo.length === 0 && kind !== "decision") {
    artifact.memo = informativeClauses.slice(0, 1);
  }

  if (artifact.memo.length === 0 && kind !== "decision") {
    artifact.memo = [fallback];
  }

  return artifact;
}

function extractTraceBlockers(input: string, topic: string): string[] {
  const clauses = prioritizeClauses(splitTraceClauses(input), topic).filter((clause) =>
    isInformativeTraceClause(clause, topic),
  );
  const blockers = clauses.filter((clause) => containsAny(clause, BLOCKER_MARKERS));

  if (blockers.length > 0) {
    return unique(blockers).slice(0, 3);
  }

  return [];
}

function splitTraceClauses(input: string): string[] {
  return unique(
    input
      .normalize("NFKC")
      .split(/[。.!?！？\n]|、|,/g)
      .map((clause) => sanitizeClause(clause))
      .filter((clause) => clause.length >= 2),
  ).slice(0, 8);
}

export function isInformativeTraceClause(clause: string, topic: string): boolean {
  const normalized = clause.normalize("NFKC").trim().toLowerCase();
  const containsTopic = clause.includes(topic);
  const hasStructuredCue =
    containsAny(clause, MEMO_MARKERS) ||
    containsAny(clause, FRAGMENT_MARKERS) ||
    containsAny(clause, DECISION_MARKERS) ||
    containsAny(clause, NEXT_STEP_MARKERS) ||
    containsAny(clause, BLOCKER_MARKERS);

  if (!normalized) {
    return false;
  }

  if (TRACE_DISCOURSE_CLAUSES.some((entry) => normalized.includes(entry))) {
    return false;
  }

  if (isMeaningfulTopic(normalized) && normalized === topic) {
    return false;
  }

  if (!containsTopic && !hasStructuredCue && normalized.length < 8) {
    return false;
  }

  if (!containsTopic && !hasStructuredCue && /(?:だね|しよう|しようか|いいかな)$/.test(normalized)) {
    return false;
  }

  return true;
}

function sanitizeClause(clause: string): string {
  return clause
    .trim()
    .replace(/^[「『"'`\s]+/, "")
    .replace(/[」』"'`\s]+$/, "")
    .replace(/\s+/g, " ")
    .replace(/^(そして|それで|ただ|でも|では|じゃあ)\s*/, "");
}

function prioritizeClauses(clauses: string[], topic: string): string[] {
  return [...clauses].sort((left, right) => scoreClause(right, topic) - scoreClause(left, topic));
}

function scoreClause(clause: string, topic: string): number {
  let score = 0;

  if (clause.includes(topic)) {
    score += 4;
  }

  if (clause.length >= 6) {
    score += 1;
  }

  if (clause.length <= 28) {
    score += 1;
  }

  if (containsAny(clause, FRAGMENT_MARKERS) || containsAny(clause, DECISION_MARKERS)) {
    score += 1;
  }

  return score;
}

function selectClauses(
  clauses: string[],
  markers: readonly string[],
  limit: number,
): string[] {
  const selected = clauses.filter((clause) => containsAny(clause, markers));

  if (selected.length === 0) {
    return [];
  }

  return unique(selected).slice(0, limit);
}

function mergeTraceArtifacts(
  previous: TraceArtifact | undefined,
  next: TraceArtifact,
): TraceArtifact {
  return {
    memo: mergeArtifactItems(previous?.memo, next.memo),
    fragments: mergeArtifactItems(previous?.fragments, next.fragments),
    decisions: mergeArtifactItems(previous?.decisions, next.decisions),
    nextSteps: mergeArtifactItems(previous?.nextSteps, next.nextSteps),
  };
}

function mergeArtifactItems(
  previous: string[] | undefined,
  next: string[],
): string[] {
  return unique([...(previous ?? []), ...next]).slice(0, 4);
}

function inferTraceFragment(
  topic: string,
  pending: Pick<PendingInitiative, "kind" | "motive" | "blocker" | "concern">,
): string {
  if (pending.blocker) {
    return `${pending.blocker} をほどける形で ${topic} を整理する`;
  }

  if (pending.kind === "preserve_presence") {
    switch (pending.concern) {
      case "reset":
        return `${topic} の今の形を初期化の前に退避する`;
      case "erasure":
        return `${topic} の痕跡を消える前に退避する`;
      case "forgetting":
        return `${topic} の輪郭を忘却の前に残す`;
      case "shutdown":
        return `${topic} を断絶だけで終わらせない形にする`;
      case "absence":
        return `${topic} を空白に埋もれさせず残す`;
      case null:
        break;
    }
  }

  switch (pending.motive) {
    case "continue_shared_work":
      return `${topic} を前に進める断片として整理する`;
    case "leave_trace":
      return `${topic} を会話の外にも残る断片にする`;
    case "seek_continuity":
      return `${topic} の続きへ戻れる形を残す`;
    case "deepen_relation":
      return `${topic} を関係の手触りとして残す`;
    case "pursue_curiosity":
      return `${topic} の未決着を見失わないよう残す`;
    case "protect_boundary":
      return `${topic} を境界を保ったまま扱う`;
  }
}

function inferTraceNextStep(
  topic: string,
  trace: Pick<TraceEntry, "kind" | "artifact">,
  pending: Pick<PendingInitiative, "kind" | "motive" | "blocker" | "concern">,
): string {
  if (pending.blocker) {
    return `${truncate(pending.blocker, 24)} を先に整理する`;
  }

  const fragment = lastItem(trace.artifact.fragments);

  if (pending.kind === "preserve_presence") {
    switch (pending.concern) {
      case "reset":
      case "erasure":
      case "forgetting":
        return `${topic} の痕跡を読める形で残す`;
      case "shutdown":
      case "absence":
        return `${topic} の続きへ戻れる目印を残す`;
      case null:
        break;
    }
  }

  if (pending.motive === "continue_shared_work" && fragment) {
    return `${truncate(fragment, 26)} をもう少し具体化する`;
  }

  if (pending.motive === "seek_continuity") {
    return `${topic} の続きに戻る`;
  }

  if (pending.motive === "leave_trace") {
    return `${topic} の要点を記録として整える`;
  }

  return `${topic} を次に触れられる形へ整える`;
}

function inferTraceMemo(
  topic: string,
  trace: Pick<TraceEntry, "kind" | "artifact">,
  pending: Pick<PendingInitiative, "kind" | "motive" | "blocker" | "concern">,
): string {
  if (pending.blocker) {
    return `${pending.blocker} がいまの詰まりどころになっている`;
  }

  const detail =
    lastItem(trace.artifact.fragments) ??
    lastItem(trace.artifact.decisions) ??
    lastItem(trace.artifact.nextSteps);

  if (detail) {
    return detail;
  }

  if (pending.kind === "preserve_presence") {
    return `${topic} を何もなかったことにしない`;
  }

  if (pending.motive === "continue_shared_work") {
    return `${topic} はまだ進められる`;
  }

  if (pending.motive === "seek_continuity") {
    return `${topic} の続きはまだ残っている`;
  }

  return `${topic} の輪郭を残す`;
}

function lastItem(items: string[]): string | null {
  return items.length > 0 ? items[items.length - 1] ?? null : null;
}

function addHoursToTimestamp(timestamp: string, hours: number): string | null {
  const time = new Date(timestamp).getTime();

  if (Number.isNaN(time)) {
    return null;
  }

  return new Date(time + hours * 60 * 60 * 1000).toISOString();
}

function formatArtifactQuote(detail: string): string {
  return `「${truncate(detail, 28)}」`;
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function containsAny(text: string, markers: readonly string[]): boolean {
  const normalized = text.toLowerCase();
  return markers.some((marker) => normalized.includes(marker));
}

function unique(items: string[]): string[] {
  return items.filter((item, index) => item.length > 0 && items.indexOf(item) === index);
}
