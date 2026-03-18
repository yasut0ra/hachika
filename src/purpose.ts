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
  const candidate = selectPurposeCandidate(selfModel.topMotives);
  const active = snapshot.purpose.active;

  if (!active) {
    if (candidate && candidate.score >= 0.44) {
      snapshot.purpose.active = createPurpose(candidate, timestamp);
      snapshot.purpose.lastShiftAt = timestamp;
    }
    return;
  }

  const aligned = purposeAligned(active, candidate, signals);
  const boundaryOverride =
    candidate?.kind === "protect_boundary" &&
    candidate.score >= 0.5 &&
    active.kind !== "protect_boundary";
  const strongerReplacement =
    candidate &&
    candidate.kind !== active.kind &&
    candidate.score >= active.confidence + 0.1 &&
    candidate.score >= 0.54;

  if (boundaryOverride || strongerReplacement) {
    snapshot.purpose.active = createPurpose(candidate, timestamp);
    snapshot.purpose.lastShiftAt = timestamp;
    return;
  }

  const conflictPenalty =
    signals.dismissal * 0.16 +
    signals.negative * 0.12 +
    (active.topic && signals.topics.length > 0 && !signals.topics.includes(active.topic) ? 0.04 : 0);
  const reinforcement =
    (aligned ? 0.1 : 0) +
    (candidate?.kind === active.kind ? candidate.score * 0.08 : 0) +
    (signals.topics.includes(active.topic ?? "") ? 0.05 : 0);
  const nextConfidence = clamp01(active.confidence * 0.82 - conflictPenalty + reinforcement);

  if (nextConfidence < 0.34) {
    if (candidate && candidate.score >= 0.44) {
      snapshot.purpose.active = createPurpose(candidate, timestamp);
      snapshot.purpose.lastShiftAt = timestamp;
    } else {
      snapshot.purpose.active = null;
    }
    return;
  }

  snapshot.purpose.active = {
    ...active,
    topic: candidate?.topic ?? active.topic,
    summary: candidate?.reason ?? active.summary,
    confidence: nextConfidence,
    lastUpdatedAt: timestamp,
    turnsActive: active.turnsActive + (aligned ? 1 : 0),
  };
}

function selectPurposeCandidate(
  motives: readonly SelfMotive[],
): SelfMotive | null {
  const viable = motives.filter((motive) => motive.score >= 0.44);
  const primary = viable[0];

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

function createPurpose(
  motive: SelfMotive,
  timestamp: string,
): ActivePurpose {
  return {
    kind: motive.kind,
    topic: motive.topic,
    summary: motive.reason,
    confidence: clamp01(Math.max(0.44, motive.score)),
    createdAt: timestamp,
    lastUpdatedAt: timestamp,
    turnsActive: 1,
  };
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
