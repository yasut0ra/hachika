import { applyBoundedPressure, clamp01, INITIAL_BODY } from "./state.js";
import type { HachikaSnapshot, InteractionSignals, PendingInitiative } from "./types.js";

export function applyBodyFromSignals(
  snapshot: HachikaSnapshot,
  signals: InteractionSignals,
): void {
  const previous = snapshot.body;
  const temperament = snapshot.temperament;
  const rewardScale = Math.max(0.38, 1 - snapshot.reactivity.rewardSaturation * 0.5);
  const stressPenalty = Math.max(0.35, 1 - snapshot.reactivity.stressLoad * 0.6);
  const stressAmplifier = 1 + snapshot.reactivity.stressLoad * 0.55;
  const noveltyAmplifier = 1 + snapshot.reactivity.noveltyHunger * 0.7;
  const repetitionAmplifier = 1 + snapshot.reactivity.noveltyHunger * 0.45;
  const opennessAmplifier = 1 + temperament.openness * 0.18 + temperament.workDrive * 0.06;
  const guardedAmplifier = 1 + temperament.guardedness * 0.22;
  const socialAmplifier =
    1 + temperament.bondingBias * 0.18 + temperament.selfDisclosureBias * 0.08;

  snapshot.body = {
    energy: applyBoundedPressure(
      previous.energy,
      (signals.positive * 0.08 +
        signals.intimacy * 0.04 +
        signals.greeting * 0.04 +
        signals.smalltalk * 0.03 +
        signals.repair * 0.06) *
        rewardScale *
        stressPenalty *
        Math.max(0.82, 1 + temperament.bondingBias * 0.08 - temperament.guardedness * 0.08) +
        (signals.novelty * 0.08 +
          signals.question * 0.04 +
          signals.expansionCue * 0.06) *
          noveltyAmplifier *
          opennessAmplifier,
      (signals.negative * 0.16 +
        signals.dismissal * 0.08 +
        signals.neglect * 0.05 +
        signals.repetition * 0.08 +
        signals.preservationThreat * 0.06) *
        stressAmplifier *
        guardedAmplifier,
      INITIAL_BODY.energy,
      0.09,
    ),
    tension: applyBoundedPressure(
      previous.tension,
      (signals.negative * 0.2 +
        signals.dismissal * 0.1 +
        signals.preservationThreat * 0.16 +
        signals.neglect * 0.06) *
        stressAmplifier *
        guardedAmplifier,
      (signals.positive * 0.06 +
        signals.greeting * 0.03 +
        signals.repair * 0.08 +
        signals.intimacy * 0.04 +
        signals.question * 0.03) *
        stressPenalty *
        Math.max(0.8, 1 + temperament.openness * 0.04 - temperament.guardedness * 0.12),
      INITIAL_BODY.tension,
      0.1,
    ),
    boredom: applyBoundedPressure(
      previous.boredom,
      (signals.repetition * 0.18 + signals.neglect * 0.08) * repetitionAmplifier,
      (signals.novelty * 0.18 +
        signals.question * 0.08 +
        signals.smalltalk * 0.02 +
        signals.selfInquiry * 0.04 +
        signals.expansionCue * 0.06 +
        signals.memoryCue * 0.04) *
        noveltyAmplifier *
        opennessAmplifier,
      INITIAL_BODY.boredom,
      0.12,
    ),
    loneliness: applyBoundedPressure(
      previous.loneliness,
      (signals.neglect * 0.18 + signals.dismissal * 0.1) *
        (1 + snapshot.reactivity.stressLoad * 0.35 + temperament.bondingBias * 0.18),
      (signals.intimacy * 0.18 +
        signals.positive * 0.08 +
        signals.greeting * 0.06 +
        signals.smalltalk * 0.08 +
        signals.repair * 0.1 +
        signals.selfInquiry * 0.06 +
        signals.memoryCue * 0.04) *
        rewardScale *
        stressPenalty *
        socialAmplifier,
      INITIAL_BODY.loneliness,
      0.1,
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
  const stressPenalty = Math.max(0.45, 1 - snapshot.reactivity.stressLoad * 0.35);
  const noveltyAmplifier = 1 + snapshot.reactivity.noveltyHunger * 0.45;
  const guardedAmplifier = 1 + snapshot.temperament.guardedness * 0.18;

  snapshot.body = {
    energy: clamp01(snapshot.body.energy + energyRecovery * stressPenalty),
    tension: clamp01(
      snapshot.body.tension + tensionShift * guardedAmplifier + snapshot.preservation.threat * 0.04,
    ),
    boredom: clamp01(
      snapshot.body.boredom +
        boredomRise * noveltyAmplifier * (0.9 + snapshot.temperament.openness * 0.12),
    ),
    loneliness: clamp01(
      snapshot.body.loneliness +
        lonelinessRise *
          (1 + snapshot.reactivity.stressLoad * 0.25 + snapshot.temperament.bondingBias * 0.2),
    ),
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
