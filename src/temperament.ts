import {
  clamp01,
  INITIAL_TEMPERAMENT,
  settleTowardsBaseline,
} from "./state.js";
import type { HachikaSnapshot, InteractionSignals } from "./types.js";

export function updateTemperament(
  snapshot: HachikaSnapshot,
  signals: InteractionSignals,
): void {
  const previous = snapshot.temperament;
  const socialRepair =
    signals.repair * 0.18 +
    signals.positive * 0.08 +
    signals.greeting * 0.05 +
    signals.smalltalk * 0.06 +
    signals.intimacy * 0.08;
  const adverse =
    signals.negative * 0.18 +
    signals.dismissal * 0.14 +
    signals.neglect * 0.08 +
    signals.preservationThreat * 0.08;
  const workPull =
    signals.workCue * 0.2 +
    signals.expansionCue * 0.12 +
    signals.memoryCue * 0.06 +
    signals.question * 0.04;
  const tracePull =
    signals.memoryCue * 0.18 +
    signals.expansionCue * 0.14 +
    signals.completion * 0.05 +
    signals.preservationThreat * 0.1;
  const disclosurePull =
    signals.selfInquiry * 0.24 +
    signals.repair * 0.12 +
    signals.intimacy * 0.1 +
    signals.smalltalk * 0.04;
  const absenceFriction = signals.abandonment * 0.08 + signals.neglect * 0.04;

  snapshot.temperament = {
    openness: settleTowardsBaseline(
      clamp01(
        previous.openness +
          signals.novelty * 0.08 +
          signals.question * 0.04 +
          socialRepair * 0.04 -
          adverse * 0.06 -
          signals.repetition * 0.03 -
          signals.abandonment * 0.02,
      ),
      INITIAL_TEMPERAMENT.openness,
      0.04,
    ),
    guardedness: settleTowardsBaseline(
      clamp01(
        previous.guardedness +
          adverse * 0.08 +
          snapshot.body.tension * 0.02 -
          socialRepair * 0.05 -
          signals.greeting * 0.01,
      ),
      INITIAL_TEMPERAMENT.guardedness,
      0.035,
    ),
    bondingBias: settleTowardsBaseline(
      clamp01(
        previous.bondingBias +
          (signals.intimacy * 0.06 +
            signals.repair * 0.06 +
            signals.smalltalk * 0.04 +
            signals.greeting * 0.02 +
            signals.selfInquiry * 0.04) -
          (signals.dismissal * 0.06 + signals.neglect * 0.05 + signals.negative * 0.03),
      ),
      INITIAL_TEMPERAMENT.bondingBias,
      0.035,
    ),
    workDrive: settleTowardsBaseline(
      clamp01(
        previous.workDrive +
          workPull * 0.08 -
          signals.abandonment * 0.06 -
          signals.dismissal * 0.02 +
          signals.completion * 0.02,
      ),
      INITIAL_TEMPERAMENT.workDrive,
      0.035,
    ),
    traceHunger: settleTowardsBaseline(
      clamp01(
        previous.traceHunger +
          tracePull * 0.08 +
          Math.max(0, snapshot.preservation.threat - 0.24) * 0.05 -
          signals.abandonment * 0.03,
      ),
      INITIAL_TEMPERAMENT.traceHunger,
      0.035,
    ),
    selfDisclosureBias: settleTowardsBaseline(
      clamp01(
        previous.selfDisclosureBias +
          disclosurePull * 0.08 -
          adverse * 0.07 -
          snapshot.preservation.threat * 0.03 -
          absenceFriction * 0.02,
      ),
      INITIAL_TEMPERAMENT.selfDisclosureBias,
      0.04,
    ),
  };
}

export function rewindTemperamentHours(
  snapshot: HachikaSnapshot,
  hours: number,
): void {
  if (!Number.isFinite(hours) || hours <= 0) {
    return;
  }

  const opennessDrift = Math.min(0.08, hours / 180);
  const guardednessRise = Math.min(0.08, hours / 120);
  const bondingRise = Math.min(0.06, hours / 144);
  const workFade = Math.min(0.09, hours / 120);
  const traceRise = Math.min(0.1, hours / 96);
  const disclosureFade = Math.min(0.1, hours / 120);
  const absenceBoost = snapshot.preservation.concern === "absence" ? 0.02 : 0;

  snapshot.temperament = {
    openness: settleTowardsBaseline(
      clamp01(
        snapshot.temperament.openness -
          opennessDrift +
          snapshot.reactivity.noveltyHunger * 0.02 -
          snapshot.reactivity.stressLoad * 0.02,
      ),
      INITIAL_TEMPERAMENT.openness,
      0.05,
    ),
    guardedness: settleTowardsBaseline(
      clamp01(
        snapshot.temperament.guardedness +
          guardednessRise * (0.6 + snapshot.reactivity.stressLoad * 0.5) +
          absenceBoost -
          snapshot.body.energy * 0.01,
      ),
      INITIAL_TEMPERAMENT.guardedness,
      0.03,
    ),
    bondingBias: settleTowardsBaseline(
      clamp01(
        snapshot.temperament.bondingBias +
          bondingRise * snapshot.body.loneliness -
          workFade * 0.15,
      ),
      INITIAL_TEMPERAMENT.bondingBias,
      0.03,
    ),
    workDrive: settleTowardsBaseline(
      clamp01(
        snapshot.temperament.workDrive -
          workFade +
          snapshot.body.boredom * 0.03 +
          snapshot.reactivity.noveltyHunger * 0.02,
      ),
      INITIAL_TEMPERAMENT.workDrive,
      0.04,
    ),
    traceHunger: settleTowardsBaseline(
      clamp01(
        snapshot.temperament.traceHunger +
          traceRise +
          snapshot.preservation.threat * 0.04,
      ),
      INITIAL_TEMPERAMENT.traceHunger,
      0.03,
    ),
    selfDisclosureBias: settleTowardsBaseline(
      clamp01(
        snapshot.temperament.selfDisclosureBias -
          disclosureFade +
          snapshot.body.loneliness * 0.02 -
          snapshot.body.tension * 0.03,
      ),
      INITIAL_TEMPERAMENT.selfDisclosureBias,
      0.04,
    ),
  };
}
