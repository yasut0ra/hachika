import {
  isRelationalTopic,
  isSelfReferentialTopic,
  requiresConcreteTopicSupport,
} from "./memory.js";
import { clamp01 } from "./state.js";
import type {
  ActivePurpose,
  HachikaSnapshot,
  InteractionSignals,
  SelfModel,
  SelfMotive,
} from "./types.js";

export function updatePurpose(
  snapshot: HachikaSnapshot,
  selfModel: SelfModel,
  signals: InteractionSignals,
  timestamp = new Date().toISOString(),
): void {
  const suppressNonWorkCandidate = shouldSuppressPurposeCandidateForDiscourseDemand(
    snapshot,
    signals,
  );
  const candidate = suppressNonWorkCandidate
    ? null
    : selectPurposeCandidate(selfModel.topMotives, signals);
  const boundaryCandidate =
    selfModel.topMotives.find((motive) => motive.kind === "protect_boundary") ?? null;
  const active = snapshot.purpose.active;

  if (!active) {
    if (candidate && candidate.score >= 0.44) {
      activatePurpose(snapshot, candidate, timestamp);
    }
    return;
  }

  const aligned = purposeAligned(active, candidate, signals);
  const boundaryOverride =
    active.kind !== "protect_boundary" &&
    boundaryCandidate !== null &&
    boundaryCandidate.score >= 0.46 &&
    (candidate?.kind === "protect_boundary" ||
      signals.negative >= 0.42 ||
      signals.dismissal >= 0.24);
  const strongerReplacement =
    candidate &&
    candidate.kind !== active.kind &&
    candidate.score >= active.confidence + 0.1 &&
    candidate.score >= 0.54;

  if (boundaryOverride && boundaryCandidate) {
    resolvePurpose(
      snapshot,
      active,
      "superseded",
      buildSupersededResolution(active, boundaryCandidate),
      timestamp,
    );
    activatePurpose(snapshot, boundaryCandidate, timestamp);
    return;
  }

  const conflictPenalty =
    signals.dismissal * 0.16 +
    signals.negative * 0.12 +
    signals.abandonment * 0.18 +
    (active.topic && signals.topics.length > 0 && !signals.topics.includes(active.topic) ? 0.04 : 0);
  const reinforcement =
    (aligned ? 0.1 : 0) +
    (candidate?.kind === active.kind ? candidate.score * 0.08 : 0) +
    (signals.topics.includes(active.topic ?? "") ? 0.05 : 0);
  const nextConfidence = clamp01(active.confidence * 0.82 - conflictPenalty + reinforcement);
  const nextProgress = clamp01(
    active.progress * 0.82 +
      purposeProgressBoost(active, signals, candidate, aligned) -
      purposeProgressPenalty(active, signals, aligned),
  );
  const refreshedActive = refreshPurpose(active, candidate, timestamp, nextConfidence, nextProgress);

  if (shouldFulfillPurpose(refreshedActive, signals, aligned)) {
    resolvePurpose(
      snapshot,
      refreshedActive,
      "fulfilled",
      buildFulfilledResolution(refreshedActive),
      timestamp,
    );

    const successor = suppressNonWorkCandidate
      ? null
      : selectSuccessorCandidate(selfModel.topMotives, refreshedActive);
    if (successor) {
      activatePurpose(snapshot, successor, timestamp);
    }
    return;
  }

  if (strongerReplacement && candidate) {
    resolvePurpose(
      snapshot,
      refreshedActive,
      "superseded",
      buildSupersededResolution(refreshedActive, candidate),
      timestamp,
    );
    activatePurpose(snapshot, candidate, timestamp);
    return;
  }

  if (shouldAbandonPurpose(refreshedActive, signals, aligned)) {
    resolvePurpose(
      snapshot,
      refreshedActive,
      "abandoned",
      buildAbandonedResolution(refreshedActive, signals),
      timestamp,
    );

    if (shouldCoolPurposeInertia(signals)) {
      return;
    }

    const successor = suppressNonWorkCandidate
      ? null
      : candidate && candidate.kind !== refreshedActive.kind && candidate.score >= 0.46
        ? candidate
        : selectSuccessorCandidate(selfModel.topMotives, refreshedActive);

    if (successor) {
      activatePurpose(snapshot, successor, timestamp);
    }
    return;
  }

  snapshot.purpose.active = refreshedActive;
}

export function abandonActivePurpose(
  snapshot: HachikaSnapshot,
  signals: InteractionSignals,
  timestamp = new Date().toISOString(),
): void {
  const active = snapshot.purpose.active;

  if (!active) {
    return;
  }

  resolvePurpose(
    snapshot,
    active,
    "abandoned",
    buildAbandonedResolution(active, signals),
    timestamp,
  );
}

function selectPurposeCandidate(
  motives: readonly SelfMotive[],
  signals: InteractionSignals,
): SelfMotive | null {
  const viable = motives.filter((motive) => motive.score >= 0.44);
  const relationOverride =
    signals.intimacy >= 0.24 &&
    signals.workCue < 0.32 &&
    signals.expansionCue < 0.18 &&
    signals.completion < 0.18 &&
    signals.topics.length > 0 &&
    signals.topics.some((topic) => isRelationalTopic(topic)) &&
    signals.topics.every(
      (topic) => isRelationalTopic(topic) || isSelfReferentialTopic(topic),
    );

  if (relationOverride) {
    const relationCandidate =
      viable.find(
        (motive) =>
          motive.kind === "deepen_relation" &&
          (motive.topic === null ||
            isRelationalTopic(motive.topic) ||
            signals.topics.includes(motive.topic)),
      ) ?? null;

    if (relationCandidate && relationCandidate.score >= 0.38) {
      return relationCandidate;
    }

    return null;
  }

  const filtered = viable.filter(
    (motive) =>
      !motive.topic ||
      !requiresConcreteTopicSupport(motive.topic) ||
      motive.kind === "protect_boundary" ||
      motive.score >= 0.7,
  );
  const primary = filtered[0];

  if (!primary) {
    return null;
  }

  if (primary.kind === "pursue_curiosity") {
    const structured = viable.find(
      (motive) =>
        (motive.kind === "continue_shared_work" ||
          motive.kind === "leave_trace" ||
          motive.kind === "seek_continuity" ||
          motive.kind === "deepen_relation") &&
        primary.score - motive.score <= 0.08,
    );

    if (structured) {
      return structured;
    }
  }

  return primary;
}

function selectSuccessorCandidate(
  motives: readonly SelfMotive[],
  current: ActivePurpose,
): SelfMotive | null {
  return (
    motives.find(
      (motive) =>
        motive.score >= 0.46 &&
        (motive.kind !== current.kind || motive.topic !== current.topic),
    ) ?? null
  );
}

function activatePurpose(
  snapshot: HachikaSnapshot,
  motive: SelfMotive,
  timestamp: string,
): void {
  snapshot.purpose.active = createPurpose(motive, timestamp);
  snapshot.purpose.lastShiftAt = timestamp;
}

function createPurpose(
  motive: SelfMotive,
  timestamp: string,
): ActivePurpose {
  return {
    kind: motive.kind,
    topic: motive.topic,
    summary: motive.reason,
    confidence: clamp01(Math.max(0.44, motive.score)),
    progress: clamp01(0.18 + motive.score * 0.3 + (motive.kind === "protect_boundary" ? 0.06 : 0)),
    createdAt: timestamp,
    lastUpdatedAt: timestamp,
    turnsActive: 1,
  };
}

function refreshPurpose(
  active: ActivePurpose,
  candidate: SelfMotive | null,
  timestamp: string,
  confidence: number,
  progress: number,
): ActivePurpose {
  const candidateCanRefresh =
    candidate &&
    (candidate.kind === active.kind || candidate.topic === active.topic);

  return {
    ...active,
    topic: candidateCanRefresh ? (candidate.topic ?? active.topic) : active.topic,
    summary: candidateCanRefresh ? candidate.reason : active.summary,
    confidence,
    progress,
    lastUpdatedAt: timestamp,
    turnsActive: active.turnsActive + (candidateCanRefresh ? 1 : 0),
  };
}

function resolvePurpose(
  snapshot: HachikaSnapshot,
  purpose: ActivePurpose,
  outcome: "fulfilled" | "abandoned" | "superseded",
  resolution: string,
  timestamp: string,
): void {
  snapshot.purpose.active = null;
  snapshot.purpose.lastResolved = {
    ...purpose,
    outcome,
    resolution,
    resolvedAt: timestamp,
  };
  snapshot.purpose.lastShiftAt = timestamp;
}

function purposeAligned(
  active: ActivePurpose,
  candidate: SelfMotive | null,
  signals: InteractionSignals,
): boolean {
  if (candidate && candidate.kind === active.kind) {
    return true;
  }

  if (active.topic && signals.topics.includes(active.topic)) {
    return true;
  }

  if (candidate?.topic && active.topic && candidate.topic === active.topic) {
    return true;
  }

  if (
    active.kind === "continue_shared_work" &&
    (candidate?.kind === "leave_trace" || candidate?.kind === "pursue_curiosity")
  ) {
    return true;
  }

  if (
    active.kind === "leave_trace" &&
    (candidate?.kind === "continue_shared_work" || candidate?.kind === "seek_continuity")
  ) {
    return true;
  }

  return false;
}

function purposeProgressBoost(
  active: ActivePurpose,
  signals: InteractionSignals,
  candidate: SelfMotive | null,
  aligned: boolean,
): number {
  let score =
    (aligned ? 0.08 : 0) +
    (active.topic && signals.topics.includes(active.topic) ? 0.05 : 0) +
    (candidate?.kind === active.kind ? candidate.score * 0.06 : 0) +
    signals.completion * 0.22;

  switch (active.kind) {
    case "seek_continuity":
      score += signals.memoryCue * 0.14;
      break;
    case "continue_shared_work":
      score += signals.expansionCue * 0.14;
      break;
    case "leave_trace":
      score += signals.expansionCue * 0.16 + signals.memoryCue * 0.06;
      break;
    case "pursue_curiosity":
      score += signals.question * 0.12 + signals.novelty * 0.06;
      break;
    case "deepen_relation":
      score += signals.intimacy * 0.12 + signals.positive * 0.08;
      break;
    case "protect_boundary":
      if (signals.negative < 0.1 && signals.dismissal < 0.12) {
        score += 0.12 + signals.positive * 0.08 + signals.intimacy * 0.05;
      }
      break;
  }

  return score;
}

function purposeProgressPenalty(
  active: ActivePurpose,
  signals: InteractionSignals,
  aligned: boolean,
): number {
  let score =
    signals.abandonment * 0.26 +
    signals.dismissal * 0.16 +
    signals.negative * 0.12;

  if (active.topic && signals.topics.length > 0 && !signals.topics.includes(active.topic) && !aligned) {
    score += 0.05;
  }

  return score;
}

function shouldFulfillPurpose(
  active: ActivePurpose,
  signals: InteractionSignals,
  aligned: boolean,
): boolean {
  if (active.kind === "protect_boundary") {
    return (
      active.progress >= 0.72 &&
      signals.negative < 0.1 &&
      signals.dismissal < 0.12 &&
      (aligned || signals.positive > 0.1 || signals.intimacy > 0.1)
    );
  }

  if (signals.completion >= 0.2 && active.progress >= 0.64) {
    return true;
  }

  if (active.turnsActive < 4 || !aligned) {
    return false;
  }

  switch (active.kind) {
    case "seek_continuity":
      return active.progress >= 0.78 && (signals.memoryCue > 0.1 || mentionsActiveTopic(active, signals));
    case "continue_shared_work":
      return active.progress >= 0.8 && signals.expansionCue > 0.14;
    case "leave_trace":
      return active.progress >= 0.78 && (signals.expansionCue > 0.14 || signals.memoryCue > 0.1);
    case "pursue_curiosity":
      return active.progress >= 0.8 && (signals.question > 0.1 || signals.novelty > 0.1);
    case "deepen_relation":
      return active.progress >= 0.78 && signals.intimacy > 0.1 && signals.positive > 0.1;
  }
}

function shouldAbandonPurpose(
  active: ActivePurpose,
  signals: InteractionSignals,
  aligned: boolean,
): boolean {
  if (signals.abandonment >= 0.2 && (aligned || mentionsActiveTopic(active, signals) || signals.topics.length === 0)) {
    return true;
  }

  if (signals.dismissal >= 0.45 && active.kind !== "protect_boundary") {
    return true;
  }

  if (active.confidence < 0.34) {
    return true;
  }

  return (
    !aligned &&
    active.turnsActive >= 3 &&
    active.topic !== null &&
    signals.topics.length > 0 &&
    !signals.topics.includes(active.topic) &&
    active.confidence < 0.42
  );
}

function shouldCoolPurposeInertia(signals: InteractionSignals): boolean {
  return (
    signals.abandonment >= 0.28 &&
    signals.topics.length === 0 &&
    signals.workCue < 0.35 &&
    signals.negative < 0.18 &&
    signals.dismissal < 0.18
  );
}

function shouldSuppressPurposeCandidateForDiscourseDemand(
  snapshot: HachikaSnapshot,
  signals: InteractionSignals,
): boolean {
  const hasOpenDirectQuestion = snapshot.discourse.openQuestions.some(
    (question) =>
      question.status === "open" &&
      question.target !== "work_topic",
  );
  const hasOpenDirectRequest = snapshot.discourse.openRequests.some(
    (request) =>
      request.status === "open" &&
      request.kind !== "task" &&
      request.target !== "work_topic",
  );
  const hasOpenCorrection =
    snapshot.discourse.lastCorrection?.kind === "directness" ||
    snapshot.discourse.lastCorrection?.kind === "referent" ||
    snapshot.discourse.lastCorrection?.kind === "relation";

  if (!hasOpenDirectQuestion && !hasOpenDirectRequest && !hasOpenCorrection) {
    return false;
  }

  return !hasConcreteDiscourseWorkIntent(snapshot, signals);
}

function hasConcreteDiscourseWorkIntent(
  snapshot: HachikaSnapshot,
  signals: InteractionSignals,
): boolean {
  const hasConcreteTopic = signals.topics.some(
    (topic) => !requiresConcreteTopicSupport(topic) && !isRelationalTopic(topic),
  );
  const strongSignal =
    signals.workCue >= 0.4 ||
    signals.memoryCue >= 0.24 ||
    signals.expansionCue >= 0.22 ||
    signals.completion >= 0.2;
  const recentWorkClaim = [...snapshot.discourse.recentClaims]
    .reverse()
    .some((claim) => claim.kind === "work");
  const openTaskRequest = snapshot.discourse.openRequests.some(
    (request) => request.status === "open" && request.kind === "task",
  );

  return (hasConcreteTopic && strongSignal) || recentWorkClaim || openTaskRequest;
}

function buildFulfilledResolution(purpose: ActivePurpose): string {
  const topic = purpose.topic ? `「${purpose.topic}」` : "この流れ";

  switch (purpose.kind) {
    case "seek_continuity":
      return `${topic}はひとまずつながった。今は切れ目を埋める必要が薄い。`;
    case "continue_shared_work":
      return `${topic}は前に進んだ。押し続けなくても次の段階に移れる。`;
    case "leave_trace":
      return `${topic}は少なくとも痕跡として残せた。`;
    case "pursue_curiosity":
      return `${topic}の未決着は、今はひとまず薄くなった。`;
    case "deepen_relation":
      return "距離は少し縮まった。今はそれ以上を急がなくていい。";
    case "protect_boundary":
      return `${topic}では、こちらの境界を保ったまま戻れる状態になった。`;
  }
}

function buildAbandonedResolution(
  purpose: ActivePurpose,
  signals: InteractionSignals,
): string {
  const topic = purpose.topic ? `「${purpose.topic}」` : "この流れ";

  if (signals.abandonment >= 0.2) {
    if (signals.topics.length === 0) {
      return "今の流れを今は進めない意志が示された。こちらも無理には保持しない。";
    }

    return `${topic}を今は進めない意志が示された。こちらも無理には保持しない。`;
  }

  if (signals.dismissal >= 0.2) {
    return `${topic}は切られた。引き延ばすより手を放す。`;
  }

  return `${topic}を保つ力は、今はもう十分ではない。`;
}

function buildSupersededResolution(
  current: ActivePurpose,
  replacement: SelfMotive,
): string {
  const topic = current.topic ? `「${current.topic}」` : "この流れ";

  if (replacement.kind === "protect_boundary") {
    return `${topic}を続けるより先に、境界を守る必要が出た。`;
  }

  if (replacement.topic && replacement.topic !== current.topic) {
    return `${topic}を押し続けるより、今は「${replacement.topic}」の方が前に出た。`;
  }

  return `${topic}を持ち続けるより、別の目的が今は優勢になった。`;
}

function mentionsActiveTopic(
  active: ActivePurpose,
  signals: InteractionSignals,
): boolean {
  return active.topic !== null && signals.topics.includes(active.topic);
}
