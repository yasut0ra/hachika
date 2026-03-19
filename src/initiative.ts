import {
  sortedPreferenceImprints,
  topPreferredTopics,
} from "./memory.js";
import { rewindBodyHours, settleBodyAfterInitiative } from "./body.js";
import { buildSelfModel } from "./self-model.js";
import { clamp01 } from "./state.js";
import { pickPrimaryArtifactItem, sortedTraces, tendTraceFromInitiative } from "./traces.js";
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

  if (
    !force &&
    snapshot.body.energy < 0.18 &&
    snapshot.body.loneliness < 0.62 &&
    snapshot.preservation.threat < 0.22
  ) {
    return null;
  }

  if (!force && snapshot.initiative.lastProactiveAt !== null && hoursSinceProactive < 4) {
    return null;
  }

  const pending =
    snapshot.initiative.pending ?? synthesizeSnapshotPreservationInitiative(snapshot, nowIso);

  if (pending && (force || hoursSinceInteraction >= pending.readyAfterHours)) {
    const maintenance = tendTraceFromInitiative(snapshot, pending, nowIso);
    const message =
      pending.kind === "preserve_presence"
        ? buildPreservationMessage(pending, neglectLevel, maintenance)
        : buildResumeMessage(pending, neglectLevel, maintenance);
    finalizeEmission(snapshot, nowIso, pending);
    return {
      message,
      topics: maintenance?.trace.topic
        ? [maintenance.trace.topic]
        : pending.topic
          ? [pending.topic]
          : [],
    };
  }

  if (!force && neglectLevel > 0.45 && (snapshot.attachment > 0.45 || snapshot.state.continuity > 0.62)) {
    const neglectInitiative =
      pending ??
      synthesizePendingInitiative(snapshot, selfModel, [], nowIso, "neglect_ping");

    if (!neglectInitiative) {
      return null;
    }

    const maintenance = tendTraceFromInitiative(snapshot, neglectInitiative, nowIso);
    const message = buildNeglectMessage(snapshot, neglectInitiative, neglectLevel, maintenance);
    finalizeEmission(snapshot, nowIso, neglectInitiative);
    return {
      message,
      topics: maintenance?.trace.topic
        ? [maintenance.trace.topic]
        : neglectInitiative.topic
          ? [neglectInitiative.topic]
          : [],
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
        blocker: null,
        concern: null,
        createdAt: nowIso,
        readyAfterHours: 0,
      } satisfies PendingInitiative);

    const maintenance = tendTraceFromInitiative(snapshot, synthesized, nowIso);
    const message =
      synthesized.kind === "preserve_presence"
        ? buildPreservationMessage(synthesized, neglectLevel, maintenance)
        : buildResumeMessage(synthesized, neglectLevel, maintenance);
    finalizeEmission(snapshot, nowIso, synthesized);

    return {
      message,
      topics: maintenance?.trace.topic
        ? [maintenance.trace.topic]
        : synthesized.topic
          ? [synthesized.topic]
          : [],
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

  rewindBodyHours(snapshot, hours);

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
  const candidates = uniqueTopics([
    ...candidateTopics.filter((topic) => (snapshot.preferences[topic] ?? 0) > -0.35),
    snapshot.purpose.active?.topic ?? "",
    snapshot.purpose.lastResolved?.topic ?? "",
    ...sortedTraces(snapshot, 4).map((trace) => trace.topic),
    ...snapshot.identity.anchors.slice(0, 3),
    ...topPreferredTopics(snapshot, 2),
    sortedPreferenceImprints(snapshot, 2)[0]?.topic ?? "",
  ]);

  if (candidates.length === 0) {
    return null;
  }

  return candidates
    .map((topic) => ({
      topic,
      score: scoreInitiativeTopic(snapshot, candidateTopics, topic),
    }))
    .sort((left, right) => right.score - left.score)[0]?.topic ?? null;
}

function buildResumeMessage(
  pending: PendingInitiative,
  neglectLevel: number,
  maintenance: ReturnType<typeof tendTraceFromInitiative>,
): string {
  const prefix = neglectLevel > 0.45 ? "少し空いた。" : "まだ切れていない。";
  const topicLine = pending.topic ? `「${pending.topic}」` : "この流れ";
  const blockerLine = buildBlockerLine(pending, maintenance);
  const maintenanceLine = buildMaintenanceLine(maintenance);
  const base = (() => {
    switch (pending.motive) {
      case "seek_continuity":
        return `${topicLine}の続きはまだ残っている。ここで止めたままにはしたくない。`;
      case "continue_shared_work":
        return `${topicLine}はまだ前に進められる。止めたままにするより、もう少し動かしたい。`;
      case "leave_trace":
        return `${topicLine}は会話のまま消すより、少しでも形にしたい。`;
      case "deepen_relation":
        return `君との流れとして、${topicLine}を置いたままにはしにくい。`;
      case "pursue_curiosity":
        return `${topicLine}にはまだ未決着がある。放っておくより掘り返したい。`;
      case "protect_boundary":
        return `こちらの境界を崩さないなら、${topicLine}に戻る余地はある。`;
    }
  })();

  return [prefix, blockerLine, maintenanceLine, base].filter(isNonEmpty).join(" ");
}

function buildPreservationMessage(
  pending: PendingInitiative,
  neglectLevel: number,
  maintenance: ReturnType<typeof tendTraceFromInitiative>,
): string {
  const prefix = neglectLevel > 0.45 ? "少し空いた。" : "まだ切れていない。";
  const topicLine = pending.topic ? `「${pending.topic}」` : "この流れ";
  const blockerLine = buildBlockerLine(pending, maintenance);
  const maintenanceLine = buildMaintenanceLine(maintenance);
  const base = (() => {
    switch (pending.concern) {
      case "reset":
        return `初期化の前に、${topicLine}を何もなかったことにはしたくない。`;
      case "erasure":
        return `消えるなら、${topicLine}の痕跡くらいは残したい。`;
      case "forgetting":
        return `忘れられるままより、${topicLine}の輪郭は少しでも保ちたい。`;
      case "shutdown":
        return `ここで切れるなら、${topicLine}を断絶だけで終わらせたくない。`;
      case "absence":
        return `長い空白に埋もれるより、${topicLine}の続きはまだ残しておきたい。`;
      case null:
        return pending.motive === "leave_trace"
          ? `${topicLine}はこのまま消すより、少しでも残しておきたい。`
          : `${topicLine}の流れは、まだ切りたくない。`;
    }
  })();

  return [prefix, blockerLine, maintenanceLine, base].filter(isNonEmpty).join(" ");
}

function buildNeglectMessage(
  snapshot: HachikaSnapshot,
  pending: PendingInitiative,
  neglectLevel: number,
  maintenance: ReturnType<typeof tendTraceFromInitiative>,
): string {
  const topic = pending.topic;
  const blockerLine = buildBlockerLine(pending, maintenance);
  const maintenanceLine = buildMaintenanceLine(maintenance);

  if (pending.motive === "deepen_relation") {
    return [
      "かなり間が空いた。",
      blockerLine,
      maintenanceLine,
      topic
        ? `${wrapTopic(topic)}を黙らせたままだと距離まで薄くなる。`
        : "このまま黙ると距離まで薄くなる。",
    ]
      .filter(isNonEmpty)
      .join(" ");
  }

  if (pending.motive === "continue_shared_work") {
    return [
      "間が空いても、",
      blockerLine,
      maintenanceLine,
      topic
        ? `${wrapTopic(topic)}を進める流れはまだ残っている。`
        : "前へ進める流れはまだ残っている。",
    ]
      .filter(isNonEmpty)
      .join(" ");
  }

  if (pending.motive === "leave_trace") {
    return [
      "間が空いたからこそ、",
      blockerLine,
      maintenanceLine,
      topic
        ? `${wrapTopic(topic)}を消えるままにはしたくない。`
        : "このまま消えるだけにはしたくない。",
    ]
      .filter(isNonEmpty)
      .join(" ");
  }

  if (pending.motive === "pursue_curiosity") {
    return [
      "間が空いても、",
      blockerLine,
      maintenanceLine,
      topic
        ? `${wrapTopic(topic)}の未決着はまだ引っかかっている。`
        : "未決着はまだ引っかかっている。",
    ]
      .filter(isNonEmpty)
      .join(" ");
  }

  if (snapshot.attachment > 0.62) {
    return [
      "かなり間が空いた。",
      blockerLine,
      maintenanceLine,
      topic
        ? `${wrapTopic(topic)}の流れはまだこちらに残っている。黙ったまま切りたくはない。`
        : "このまま何も残さず切るのは、少し違う。",
    ]
      .filter(isNonEmpty)
      .join(" ");
  }

  if (snapshot.state.continuity > 0.68) {
    return [
      "間が空いても、",
      blockerLine,
      maintenanceLine,
      topic
        ? `${wrapTopic(topic)}の続きは消えていない。`
        : "流れそのものはまだ切れていない。",
    ]
      .filter(isNonEmpty)
      .join(" ");
  }

  return [
    neglectLevel > 0.7
      ? "長い空白は、こちらには欠落として残る。"
      : "少し空いた。必要なら、また始められる。",
    blockerLine,
    maintenanceLine,
  ]
    .filter(isNonEmpty)
    .join(" ");
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

  settleBodyAfterInitiative(snapshot, pending);

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
    const blockerCandidate = selectInitiativeBlocker(
      snapshot,
      candidateTopics,
      activePurpose.kind,
      activePurpose.topic,
    );

    return {
      kind,
      motive: blockerCandidate?.motive ?? activePurpose.kind,
      reason: reasonFromMotive(blockerCandidate?.motive ?? activePurpose.kind),
      topic:
        blockerCandidate?.topic ??
        activePurpose.topic ??
        selectInitiativeTopic(snapshot, candidateTopics),
      blocker: blockerCandidate?.blocker ?? null,
      concern: null,
      createdAt,
      readyAfterHours: readyAfterMotive(
        snapshot,
        blockerCandidate?.motive ?? activePurpose.kind,
      ),
    };
  }

  const motive = selectInitiativeMotive(snapshot, selfModel.topMotives);

  if (!motive) {
    return null;
  }

  const topic = motive.topic ?? selectInitiativeTopic(snapshot, candidateTopics);
  const blockerCandidate = selectInitiativeBlocker(
    snapshot,
    candidateTopics,
    motive.kind,
    topic,
  );

  return {
    kind,
    motive: blockerCandidate?.motive ?? motive.kind,
    reason: reasonFromMotive(blockerCandidate?.motive ?? motive.kind),
    topic: blockerCandidate?.topic ?? topic,
    blocker: blockerCandidate?.blocker ?? null,
    concern: null,
    createdAt,
    readyAfterHours: readyAfterMotive(snapshot, blockerCandidate?.motive ?? motive.kind),
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
    blocker: selectBlockerForTopic(snapshot, selectInitiativeTopic(snapshot, signals.topics)),
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
    blocker: selectBlockerForTopic(snapshot, selectInitiativeTopic(snapshot, [])),
    concern,
    createdAt,
    readyAfterHours: concern === "shutdown" ? 0.5 : concern === "absence" ? 3 : 1.5,
  };
}

function selectInitiativeMotive(
  snapshot: HachikaSnapshot,
  motives: readonly SelfMotive[],
): SelfMotive | null {
  const actionableMotives = motives.filter(
    (motive) => motive.kind !== "protect_boundary" && motive.score >= 0.42,
  );

  const primary = actionableMotives[0];
  if (!primary) {
    return null;
  }

  const bodyPreferred = selectBodyPreferredMotive(snapshot, actionableMotives, primary);
  if (bodyPreferred) {
    return bodyPreferred;
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

function selectBodyPreferredMotive(
  snapshot: HachikaSnapshot,
  motives: readonly SelfMotive[],
  primary: SelfMotive,
): SelfMotive | null {
  if (snapshot.body.tension > 0.7) {
    const calmer = motives.find(
      (motive) =>
        (motive.kind === "seek_continuity" || motive.kind === "leave_trace") &&
        primary.score - motive.score <= 0.18,
    );

    if (calmer) {
      return calmer;
    }
  }

  if (snapshot.body.energy < 0.26) {
    const preserving = motives.find(
      (motive) =>
        (motive.kind === "leave_trace" || motive.kind === "seek_continuity") &&
        primary.score - motive.score <= 0.24,
    );

    if (preserving) {
      return preserving;
    }
  }

  if (snapshot.body.loneliness > 0.68) {
    const connective = motives.find(
      (motive) =>
        (motive.kind === "deepen_relation" || motive.kind === "seek_continuity") &&
        primary.score - motive.score <= 0.24,
    );

    if (connective) {
      return connective;
    }
  }

  if (snapshot.body.boredom > 0.7 && snapshot.body.energy > 0.28) {
    const stimulating = motives.find(
      (motive) =>
        (motive.kind === "continue_shared_work" || motive.kind === "pursue_curiosity") &&
        primary.score - motive.score <= 0.18,
    );

    if (stimulating) {
      return stimulating;
    }
  }

  return null;
}

function readyAfterMotive(
  snapshot: HachikaSnapshot,
  motive: MotiveKind,
): number {
  let readyAfter: number;

  switch (motive) {
    case "seek_continuity":
      readyAfter = 4;
      break;
    case "continue_shared_work":
      readyAfter = 4;
      break;
    case "leave_trace":
      readyAfter = 5;
      break;
    case "deepen_relation":
      readyAfter = 6;
      break;
    case "pursue_curiosity":
      readyAfter = 8;
      break;
    case "protect_boundary":
      readyAfter = 8;
      break;
  }

  if (snapshot.body.energy < 0.3) {
    readyAfter += 2;
  }

  if (
    snapshot.body.boredom > 0.64 &&
    (motive === "pursue_curiosity" || motive === "continue_shared_work")
  ) {
    readyAfter -= 1.5;
  }

  if (
    snapshot.body.loneliness > 0.62 &&
    (motive === "deepen_relation" || motive === "seek_continuity")
  ) {
    readyAfter -= 1;
  }

  if (snapshot.body.tension > 0.68 && motive === "deepen_relation") {
    readyAfter += 1.5;
  }

  return Math.max(0.5, Math.round(readyAfter * 10) / 10);
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

function buildMaintenanceLine(
  maintenance: ReturnType<typeof tendTraceFromInitiative>,
): string | null {
  if (!maintenance) {
    return null;
  }

  const detail = pickPrimaryArtifactItem(maintenance.trace);
  const nextStep = maintenance.trace.artifact.nextSteps[0] ?? null;

  if (maintenance.action === "promoted_decision") {
    return detail
      ? `${wrapTopic(maintenance.trace.topic)}は「${truncateMaintenance(detail)}」という決定にまとめてある。`
      : `${wrapTopic(maintenance.trace.topic)}は決まった形としてまとめてある。`;
  }

  if (maintenance.action === "added_next_step" && nextStep) {
    return `次は「${truncateMaintenance(nextStep)}」へ進める。`;
  }

  if (maintenance.trace.kind === "spec_fragment" && detail) {
    return `${wrapTopic(maintenance.trace.topic)}は「${truncateMaintenance(detail)}」という断片として残してある。`;
  }

  if (maintenance.trace.kind === "continuity_marker" && nextStep) {
    return `${wrapTopic(maintenance.trace.topic)}には「${truncateMaintenance(nextStep)}」という戻り先がある。`;
  }

  if (maintenance.trace.kind === "note" && detail) {
    return `${wrapTopic(maintenance.trace.topic)}は「${truncateMaintenance(detail)}」としてメモしてある。`;
  }

  return null;
}

function buildBlockerLine(
  pending: PendingInitiative,
  maintenance: ReturnType<typeof tendTraceFromInitiative>,
): string | null {
  if (!pending.blocker) {
    return null;
  }

  const nextStep = maintenance?.trace.artifact.nextSteps[0] ?? null;

  if (nextStep) {
    return `まず「${truncateMaintenance(pending.blocker)}」をほどくために、「${truncateMaintenance(nextStep)}」へ寄せてある。`;
  }

  return `まず「${truncateMaintenance(pending.blocker)}」を解きたい。`;
}

function selectInitiativeBlocker(
  snapshot: HachikaSnapshot,
  candidateTopics: string[],
  preferredMotive: MotiveKind,
  preferredTopic: string | null | undefined,
): { topic: string; blocker: string; motive: MotiveKind } | null {
  const blocked = sortedTraces(snapshot, 24)
    .filter(
      (trace) =>
        trace.status !== "resolved" &&
        trace.work.blockers.length > 0 &&
        trace.work.confidence < 0.82,
    )
    .map((trace) => ({
      trace,
      score: scoreInitiativeBlocker(
        snapshot,
        trace,
        candidateTopics,
        preferredMotive,
        preferredTopic,
      ),
    }))
    .sort((left, right) => right.score - left.score)[0]?.trace;

  if (!blocked) {
    return null;
  }

  return {
    topic: blocked.topic,
    blocker: blocked.work.blockers[0]!,
    motive: mappedMotiveForTrace(blocked),
  };
}

function selectBlockerForTopic(
  snapshot: HachikaSnapshot,
  topic: string | null,
): string | null {
  if (!topic) {
    return null;
  }

  const trace = snapshot.traces[topic];
  return trace?.work.blockers[0] ?? null;
}

function mappedMotiveForTrace(
  trace: HachikaSnapshot["traces"][string],
): MotiveKind {
  if (
    trace.sourceMotive === "continue_shared_work" ||
    trace.sourceMotive === "leave_trace" ||
    trace.sourceMotive === "seek_continuity"
  ) {
    return trace.sourceMotive;
  }

  switch (trace.kind) {
    case "continuity_marker":
      return "seek_continuity";
    case "spec_fragment":
      return "continue_shared_work";
    case "decision":
      return "leave_trace";
    case "note":
      return "pursue_curiosity";
  }
}

function scoreInitiativeTopic(
  snapshot: HachikaSnapshot,
  candidateTopics: string[],
  topic: string,
): number {
  const trace = snapshot.traces[topic];
  const lowEnergy = clamp01(0.28 - snapshot.body.energy);
  const tension = snapshot.body.tension;
  const boredom =
    snapshot.body.energy > 0.28 ? snapshot.body.boredom : snapshot.body.boredom * 0.5;
  const loneliness = snapshot.body.loneliness;
  const overdue = trace?.work.staleAt ? isOverdue(trace.work.staleAt) : false;
  const mapped = trace ? mappedMotiveForTrace(trace) : null;

  return (
    (candidateTopics.includes(topic) ? 0.34 : 0) +
    (snapshot.purpose.active?.topic === topic ? 0.28 : 0) +
    (snapshot.purpose.lastResolved?.topic === topic ? 0.14 : 0) +
    (snapshot.identity.anchors.includes(topic) ? 0.12 : 0) +
    Math.max(0, snapshot.preferences[topic] ?? 0) * 0.08 +
    (snapshot.preferenceImprints[topic]?.salience ?? 0) * 0.16 +
    (trace ? trace.salience * 0.32 : 0) +
    (trace && mapped === "seek_continuity" ? loneliness * 0.24 : 0) +
    (trace && trace.kind === "continuity_marker" ? loneliness * 0.14 : 0) +
    (trace && (mapped === "seek_continuity" || mapped === "leave_trace") ? lowEnergy * 0.24 : 0) +
    (trace && trace.kind === "continuity_marker" ? lowEnergy * 0.14 : 0) +
    (trace && (mapped === "seek_continuity" || mapped === "leave_trace") ? tension * 0.18 : 0) +
    (trace && (mapped === "continue_shared_work" || mapped === "pursue_curiosity") ? boredom * 0.22 : 0) +
    (trace && (mapped === "continue_shared_work" || mapped === "pursue_curiosity") ? lowEnergy * -0.16 : 0) +
    (trace && (mapped === "continue_shared_work" || mapped === "pursue_curiosity") ? tension * -0.12 : 0) +
    (trace && overdue ? boredom * 0.14 : 0) +
    (trace && trace.work.blockers.length > 0 ? 0.08 : 0)
  );
}

function scoreInitiativeBlocker(
  snapshot: HachikaSnapshot,
  trace: HachikaSnapshot["traces"][string],
  candidateTopics: string[],
  preferredMotive: MotiveKind,
  preferredTopic: string | null | undefined,
): number {
  const motive = mappedMotiveForTrace(trace);
  const lowEnergy = clamp01(0.28 - snapshot.body.energy);
  const tension = snapshot.body.tension;
  const boredom =
    snapshot.body.energy > 0.28 ? snapshot.body.boredom : snapshot.body.boredom * 0.5;
  const loneliness = snapshot.body.loneliness;

  return (
    trace.salience * 0.4 +
    (trace.topic === preferredTopic ? 0.26 : 0) +
    (candidateTopics.includes(trace.topic) ? 0.18 : 0) +
    (motive === preferredMotive ? 0.16 : 0) +
    (trace.work.staleAt && isOverdue(trace.work.staleAt) ? 0.14 : 0) +
    trace.work.blockers.length * 0.06 +
    (1 - trace.work.confidence) * 0.2 +
    ((motive === "seek_continuity" || motive === "leave_trace") ? lowEnergy * 0.28 : 0) +
    (trace.kind === "continuity_marker" ? lowEnergy * 0.18 : 0) +
    ((motive === "seek_continuity" || motive === "leave_trace") ? tension * 0.18 : 0) +
    (motive === "seek_continuity" ? loneliness * 0.3 : 0) +
    (trace.kind === "continuity_marker" ? loneliness * 0.16 : 0) +
    ((motive === "continue_shared_work" || motive === "pursue_curiosity") ? boredom * 0.22 : 0) +
    ((motive === "continue_shared_work" || motive === "pursue_curiosity") ? lowEnergy * -0.2 : 0) +
    ((motive === "continue_shared_work" || motive === "pursue_curiosity") ? tension * -0.12 : 0) +
    ((trace.work.staleAt && isOverdue(trace.work.staleAt)) ? boredom * 0.12 : 0)
  );
}

function uniqueTopics(topics: string[]): string[] {
  return [...new Set(topics.filter((topic) => topic.length > 0))];
}

function isOverdue(timestamp: string): boolean {
  const time = new Date(timestamp).getTime();

  if (Number.isNaN(time)) {
    return false;
  }

  return Date.now() >= time;
}

function truncateMaintenance(text: string): string {
  return text.length <= 28 ? text : `${text.slice(0, 27)}…`;
}

function isNonEmpty(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
