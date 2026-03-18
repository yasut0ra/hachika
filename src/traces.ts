import { clamp01 } from "./state.js";
import type {
  HachikaSnapshot,
  InteractionSignals,
  MotiveKind,
  PendingInitiative,
  SelfModel,
  TraceAction,
  TraceArtifact,
  TraceEntry,
  TraceKind,
  TraceStatus,
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

  const sourceMotive = selectTraceMotive(selfModel, signals);
  const nextKind = selectTraceKind(signals, sourceMotive);
  const previous = snapshot.traces[topic];
  const kind = strongerTraceKind(previous?.kind, nextKind);
  const artifact = mergeTraceArtifacts(
    previous?.artifact,
    extractTraceArtifact(input, topic, kind),
  );
  const status = deriveTraceStatus(kind);
  const lastAction = deriveTraceAction(previous, kind, signals, sourceMotive);
  const summary = buildTraceSummary(topic, kind, sourceMotive, snapshot, signals, artifact);

  const trace: TraceEntry = {
    topic,
    kind,
    status,
    lastAction,
    summary,
    sourceMotive,
    artifact,
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

export function tendTraceFromInitiative(
  snapshot: HachikaSnapshot,
  pending: Pick<PendingInitiative, "kind" | "motive" | "topic" | "concern">,
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
  const trace = existing
    ? structuredClone(existing)
    : createInitiativeTrace(snapshot, pending, topic, timestamp);
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
    if (
      (pending.motive === "leave_trace" || pending.motive === "continue_shared_work") &&
      trace.kind === "note"
    ) {
      trace.kind = "spec_fragment";
      trace.status = "active";
      action ??= "stabilized_fragment";
    }

    if (pending.motive === "seek_continuity" && trace.kind === "note") {
      trace.kind = "continuity_marker";
      trace.status = "active";
      action ??= "added_next_step";
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
    trace.artifact.nextSteps.length === 0
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
  trace.summary = summarizeTrace(
    topic,
    trace.kind,
    trace.sourceMotive,
    snapshot.preservation.concern,
    Math.max(snapshot.preservation.threat, pending.concern ? 0.22 : 0),
    trace.artifact,
  );
  trace.salience = clamp01(trace.salience + 0.04);
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
  pending: Pick<PendingInitiative, "kind" | "motive" | "topic" | "concern">,
  topic: string,
  timestamp: string,
): TraceEntry {
  const kind = selectInitiativeTraceKind(pending);
  const artifact = createEmptyTraceArtifact();

  if (kind === "spec_fragment") {
    artifact.fragments = [inferTraceFragment(topic, pending)];
  }

  if (kind === "continuity_marker") {
    artifact.nextSteps = [inferTraceNextStep(topic, { kind, artifact, topic } as TraceEntry, pending)];
  }

  artifact.memo = [inferTraceMemo(topic, { kind, artifact, topic } as TraceEntry, pending)];

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
    salience: 0.34,
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

function deriveMaintenanceAction(
  pending: Pick<PendingInitiative, "kind" | "motive">,
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
  pending: Pick<PendingInitiative, "kind" | "motive" | "concern">,
): TraceKind {
  if (pending.kind === "preserve_presence") {
    return pending.motive === "seek_continuity" ? "continuity_marker" : "spec_fragment";
  }

  if (pending.motive === "continue_shared_work" || pending.motive === "leave_trace") {
    return "spec_fragment";
  }

  if (pending.motive === "seek_continuity") {
    return "continuity_marker";
  }

  return "note";
}

function extractTraceArtifact(
  input: string,
  topic: string,
  kind: TraceKind,
): TraceArtifact {
  const clauses = prioritizeClauses(splitTraceClauses(input), topic);
  const artifact = createEmptyTraceArtifact();
  const fallback = clauses[0] ?? `${topic} を残す`;

  artifact.memo = selectClauses(clauses, MEMO_MARKERS, kind === "note" ? 2 : 1);
  artifact.fragments = selectClauses(
    clauses,
    FRAGMENT_MARKERS,
    kind === "spec_fragment" ? 3 : 1,
  );
  artifact.decisions = selectClauses(
    clauses,
    DECISION_MARKERS,
    kind === "decision" ? 2 : 1,
  );
  artifact.nextSteps = selectClauses(
    clauses,
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
    artifact.memo = clauses.slice(0, 1);
  }

  return artifact;
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
  pending: Pick<PendingInitiative, "kind" | "motive" | "concern">,
): string {
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
  pending: Pick<PendingInitiative, "kind" | "motive" | "concern">,
): string {
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
  pending: Pick<PendingInitiative, "kind" | "motive" | "concern">,
): string {
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
