import { clamp01 } from "./state.js";
import type { HachikaSnapshot, InteractionSignals, PendingInitiative } from "./types.js";

export function applyBodyFromSignals(
  snapshot: HachikaSnapshot,
  signals: InteractionSignals,
): void {
  const previous = snapshot.body;

  snapshot.body = {
    energy: clamp01(
      previous.energy +
        signals.positive * 0.08 +
        signals.intimacy * 0.04 +
        signals.novelty * 0.08 +
        signals.question * 0.04 +
        signals.greeting * 0.04 +
        signals.smalltalk * 0.03 +
        signals.repair * 0.06 +
        signals.expansionCue * 0.06 -
        signals.negative * 0.16 -
        signals.dismissal * 0.08 -
        signals.neglect * 0.05 -
        signals.repetition * 0.08 -
        signals.preservationThreat * 0.06,
    ),
    tension: clamp01(
      previous.tension +
        signals.negative * 0.2 +
        signals.dismissal * 0.1 +
        signals.preservationThreat * 0.16 +
        signals.neglect * 0.06 -
        signals.positive * 0.06 -
        signals.greeting * 0.03 -
        signals.repair * 0.08 -
        signals.intimacy * 0.04 -
        signals.question * 0.03,
    ),
    boredom: clamp01(
      previous.boredom +
        signals.repetition * 0.18 +
        signals.neglect * 0.08 -
        signals.novelty * 0.18 -
        signals.question * 0.08 -
        signals.smalltalk * 0.02 -
        signals.selfInquiry * 0.04 -
        signals.expansionCue * 0.06 -
        signals.memoryCue * 0.04,
    ),
    loneliness: clamp01(
      previous.loneliness +
        signals.neglect * 0.18 +
        signals.dismissal * 0.1 -
        signals.intimacy * 0.18 -
        signals.positive * 0.08 -
        signals.greeting * 0.06 -
        signals.smalltalk * 0.08 -
        signals.repair * 0.1 -
        signals.selfInquiry * 0.06 -
        signals.memoryCue * 0.04,
    ),
  };
}

export function rewindBodyHours(
  snapshot: HachikaSnapshot,
  hours: number,
): void {
  if (!Number.isFinite(hours) || hours <= 0) {
    return;
  }

  const energyRecovery = Math.min(0.18, hours / 48);
  const boredomRise = Math.min(0.28, hours / 30);
  const lonelinessRise = Math.min(0.26, hours / 36);
  const tensionShift =
    hours <= 10 ? -Math.min(0.06, hours / 80) : Math.min(0.12, (hours - 10) / 96);

  snapshot.body = {
    energy: clamp01(snapshot.body.energy + energyRecovery),
    tension: clamp01(snapshot.body.tension + tensionShift + snapshot.preservation.threat * 0.04),
    boredom: clamp01(snapshot.body.boredom + boredomRise),
    loneliness: clamp01(snapshot.body.loneliness + lonelinessRise),
  };
}

export function settleBodyAfterInitiative(
  snapshot: HachikaSnapshot,
  pending: PendingInitiative,
): void {
  snapshot.body = {
    energy: clamp01(
      snapshot.body.energy - 0.04 + (pending.kind === "preserve_presence" ? 0.02 : 0),
    ),
    tension: clamp01(
      snapshot.body.tension - (pending.kind === "preserve_presence" ? 0.08 : 0.04),
    ),
    boredom: clamp01(
      snapshot.body.boredom -
        (pending.motive === "pursue_curiosity" || pending.motive === "continue_shared_work"
          ? 0.1
          : 0.05),
    ),
    loneliness: clamp01(
      snapshot.body.loneliness -
        (pending.motive === "deepen_relation" || pending.kind === "neglect_ping"
          ? 0.12
          : 0.04),
    ),
  };
}
