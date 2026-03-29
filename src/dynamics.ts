import {
  clamp01,
  INITIAL_ATTACHMENT,
  INITIAL_BODY,
  INITIAL_DYNAMICS,
  INITIAL_REACTIVITY,
  INITIAL_STATE,
  settleTowardsBaseline,
} from "./state.js";
import type {
  DynamicsState,
  HachikaSnapshot,
  InteractionSignals,
  PendingInitiative,
} from "./types.js";

export function updateDynamicsFromSignals(
  snapshot: HachikaSnapshot,
  signals: InteractionSignals,
): void {
  const previous = snapshot.dynamics;
  const temperament = snapshot.temperament;
  const preservationThreat = snapshot.preservation.threat;
  const socialWarmth =
    signals.positive * 0.18 +
    signals.greeting * 0.08 +
    signals.smalltalk * 0.08 +
    signals.repair * 0.18 +
    signals.intimacy * 0.14 +
    signals.selfInquiry * 0.08 +
    signals.memoryCue * 0.06;
  const adverse =
    signals.negative * 0.22 +
    signals.dismissal * 0.18 +
    signals.neglect * 0.1 +
    signals.preservationThreat * 0.14;
  const noveltyPull =
    signals.novelty * 0.18 +
    signals.question * 0.1 +
    signals.expansionCue * 0.12 +
    signals.selfInquiry * 0.04;
  const workLoad =
    signals.workCue * 0.18 +
    signals.expansionCue * 0.12 +
    signals.memoryCue * 0.06 +
    signals.question * 0.04 +
    signals.completion * 0.04;
  const continuityPull =
    signals.memoryCue * 0.16 +
    signals.repair * 0.08 +
    signals.completion * 0.12 +
    signals.preservationThreat * 0.08 +
    signals.abandonment * 0.06;
  const repetitionLoad =
    signals.repetition * 0.18 + signals.neglect * 0.06 + signals.abandonment * 0.08;
  const guardedSensitivity = 1 + temperament.guardedness * 0.18 - temperament.openness * 0.04;
  const socialSensitivity = 1 + temperament.bondingBias * 0.16 + temperament.selfDisclosureBias * 0.08;

  snapshot.dynamics = {
    safety: settleTowardsBaseline(
      clamp01(
        previous.safety +
          socialWarmth * 0.16 * socialSensitivity -
          adverse * 0.22 * guardedSensitivity -
          workLoad * 0.04 -
          preservationThreat * 0.06,
      ),
      INITIAL_DYNAMICS.safety,
      0.04,
    ),
    trust: settleTowardsBaseline(
      clamp01(
        previous.trust +
          (signals.intimacy * 0.16 +
            signals.repair * 0.14 +
            signals.greeting * 0.05 +
            signals.smalltalk * 0.06 +
            signals.selfInquiry * 0.06 +
            signals.memoryCue * 0.08) *
            socialSensitivity -
          (signals.dismissal * 0.22 +
            signals.neglect * 0.16 +
            signals.negative * 0.1 +
            signals.abandonment * 0.04) *
            guardedSensitivity,
      ),
      INITIAL_DYNAMICS.trust,
      0.03,
    ),
    activation: settleTowardsBaseline(
      clamp01(
        previous.activation +
          adverse * 0.16 +
          noveltyPull * (0.08 + temperament.openness * 0.03) +
          workLoad * (0.1 + temperament.workDrive * 0.03) -
          (signals.greeting * 0.04 + signals.repair * 0.06 + signals.positive * 0.04),
      ),
      INITIAL_DYNAMICS.activation,
      0.05,
    ),
    socialNeed: settleTowardsBaseline(
      clamp01(
        previous.socialNeed +
          signals.neglect * 0.18 +
          signals.abandonment * 0.1 +
          signals.dismissal * 0.08 -
          (signals.intimacy * 0.16 +
            signals.smalltalk * 0.08 +
            signals.repair * 0.1 +
            signals.greeting * 0.06) *
            socialSensitivity,
      ),
      INITIAL_DYNAMICS.socialNeed,
      0.035,
    ),
    cognitiveLoad: settleTowardsBaseline(
      clamp01(
        previous.cognitiveLoad +
          workLoad * (0.16 + temperament.workDrive * 0.04) +
          adverse * 0.08 -
          (signals.completion * 0.08 +
            signals.repair * 0.04 +
            signals.greeting * 0.02),
      ),
      INITIAL_DYNAMICS.cognitiveLoad,
      0.04,
    ),
    noveltyDrive: settleTowardsBaseline(
      clamp01(
        previous.noveltyDrive +
          repetitionLoad * 0.18 +
          signals.dismissal * 0.03 -
          (signals.novelty * 0.14 +
            signals.question * 0.08 +
            signals.expansionCue * 0.1 +
            signals.selfInquiry * 0.05) *
            (0.88 + temperament.openness * 0.12),
      ),
      INITIAL_DYNAMICS.noveltyDrive,
      0.04,
    ),
    continuityPressure: settleTowardsBaseline(
      clamp01(
        previous.continuityPressure +
          continuityPull * (0.16 + temperament.traceHunger * 0.04) +
          signals.neglect * 0.04 -
          signals.dismissal * 0.08,
      ),
      INITIAL_DYNAMICS.continuityPressure,
      0.035,
    ),
  };

  deriveVisibleStateFromDynamics(snapshot);
}

export function rewindDynamicsHours(
  snapshot: HachikaSnapshot,
  hours: number,
): void {
  if (!Number.isFinite(hours) || hours <= 0) {
    return;
  }

  const absenceBias = snapshot.preservation.concern === "absence" ? 0.03 : 0;
  const longAbsence = hours >= 18 ? Math.min(0.08, (hours - 18) / 96) : 0;

  snapshot.dynamics = {
    safety: settleTowardsBaseline(
      clamp01(
        snapshot.dynamics.safety +
          Math.min(0.1, hours / 96) -
          snapshot.preservation.threat * 0.04 -
          longAbsence * 0.03,
      ),
      INITIAL_DYNAMICS.safety,
      0.05,
    ),
    trust: settleTowardsBaseline(
      clamp01(snapshot.dynamics.trust - Math.min(0.06, hours / 180) + absenceBias * 0.2),
      INITIAL_DYNAMICS.trust,
      0.03,
    ),
    activation: settleTowardsBaseline(
      clamp01(snapshot.dynamics.activation - Math.min(0.14, hours / 72)),
      INITIAL_DYNAMICS.activation,
      0.06,
    ),
    socialNeed: settleTowardsBaseline(
      clamp01(
        snapshot.dynamics.socialNeed +
          Math.min(0.18, hours / 48) *
            (1 + snapshot.temperament.bondingBias * 0.14) +
          absenceBias,
      ),
      INITIAL_DYNAMICS.socialNeed,
      0.03,
    ),
    cognitiveLoad: settleTowardsBaseline(
      clamp01(snapshot.dynamics.cognitiveLoad - Math.min(0.16, hours / 60)),
      INITIAL_DYNAMICS.cognitiveLoad,
      0.06,
    ),
    noveltyDrive: settleTowardsBaseline(
      clamp01(
        snapshot.dynamics.noveltyDrive +
          Math.min(0.18, hours / 42) *
            (0.9 + snapshot.temperament.openness * 0.12),
      ),
      INITIAL_DYNAMICS.noveltyDrive,
      0.04,
    ),
    continuityPressure: settleTowardsBaseline(
      clamp01(
        snapshot.dynamics.continuityPressure +
          Math.min(0.12, hours / 60) +
          snapshot.preservation.threat * 0.05,
      ),
      INITIAL_DYNAMICS.continuityPressure,
      0.03,
    ),
  };

  deriveVisibleStateFromDynamics(snapshot);
}

export function settleDynamicsAfterInitiative(
  snapshot: HachikaSnapshot,
  pending: PendingInitiative,
): void {
  snapshot.dynamics = {
    safety: clamp01(
      snapshot.dynamics.safety +
        (pending.kind === "preserve_presence" ? 0.08 : 0.03),
    ),
    trust: clamp01(
      snapshot.dynamics.trust +
        (pending.motive === "deepen_relation" || pending.kind === "neglect_ping" ? 0.06 : 0.02),
    ),
    activation: clamp01(
      snapshot.dynamics.activation -
        (pending.kind === "preserve_presence" ? 0.08 : 0.05),
    ),
    socialNeed: clamp01(
      snapshot.dynamics.socialNeed -
        (pending.motive === "deepen_relation" || pending.kind === "neglect_ping" ? 0.1 : 0.04),
    ),
    cognitiveLoad: clamp01(
      snapshot.dynamics.cognitiveLoad -
        (pending.motive === "continue_shared_work" ? 0.06 : 0.03),
    ),
    noveltyDrive: clamp01(
      snapshot.dynamics.noveltyDrive -
        (pending.motive === "pursue_curiosity" || pending.motive === "continue_shared_work"
          ? 0.08
          : 0.04),
    ),
    continuityPressure: clamp01(
      snapshot.dynamics.continuityPressure -
        (pending.motive === "seek_continuity" || pending.motive === "leave_trace" ? 0.08 : 0.03),
    ),
  };

  deriveVisibleStateFromDynamics(snapshot);
}

export function deriveVisibleStateFromDynamics(snapshot: HachikaSnapshot): void {
  const dynamics = snapshot.dynamics;
  const temperament = snapshot.temperament;
  const previousState = snapshot.state;
  const previousBody = snapshot.body;
  const previousReactivity = snapshot.reactivity;
  const previousAttachment = snapshot.attachment;

  const targetState = {
    pleasure: clamp01(
      0.12 +
        dynamics.safety * 0.58 +
        dynamics.trust * 0.18 -
        dynamics.activation * 0.08 -
        dynamics.cognitiveLoad * 0.14 -
        dynamics.socialNeed * 0.04 +
        temperament.bondingBias * 0.03 -
        temperament.guardedness * 0.05,
    ),
    relation: clamp01(
      0.08 +
        dynamics.trust * 0.52 +
        dynamics.socialNeed * 0.2 +
        dynamics.continuityPressure * 0.08 +
        dynamics.safety * 0.06 -
        dynamics.activation * 0.05 +
        temperament.bondingBias * 0.05,
    ),
    curiosity: clamp01(
      0.16 +
        dynamics.noveltyDrive * 0.62 +
        dynamics.safety * 0.1 +
        dynamics.activation * 0.08 -
        dynamics.cognitiveLoad * 0.12 +
        temperament.openness * 0.08 -
        temperament.guardedness * 0.05,
    ),
    continuity: clamp01(
      0.12 +
        dynamics.continuityPressure * 0.5 +
        dynamics.trust * 0.08 +
        dynamics.safety * 0.04 +
        snapshot.preservation.threat * 0.1 +
        dynamics.socialNeed * 0.04 +
        temperament.traceHunger * 0.06,
    ),
    expansion: clamp01(
      0.12 +
        dynamics.noveltyDrive * 0.28 +
        dynamics.activation * 0.2 +
        (1 - dynamics.cognitiveLoad) * 0.12 +
        dynamics.trust * 0.04 +
        temperament.workDrive * 0.07 +
        temperament.openness * 0.04,
    ),
  };

  snapshot.state = {
    pleasure: blendVisible(previousState.pleasure, targetState.pleasure, 0.52),
    relation: blendVisible(previousState.relation, targetState.relation, 0.5),
    curiosity: blendVisible(previousState.curiosity, targetState.curiosity, 0.5),
    continuity: blendVisible(previousState.continuity, targetState.continuity, 0.5),
    expansion: blendVisible(previousState.expansion, targetState.expansion, 0.48),
  };

  const targetBody = {
    energy: clamp01(
      0.08 +
        dynamics.safety * 0.14 +
        (1 - dynamics.cognitiveLoad) * 0.3 +
        (1 - dynamics.activation) * 0.18 -
        dynamics.socialNeed * 0.1 -
        dynamics.continuityPressure * 0.03 +
        temperament.openness * 0.05 -
        temperament.guardedness * 0.04,
    ),
    tension: clamp01(
      0.02 +
        dynamics.activation * 0.34 +
        (1 - dynamics.safety) * 0.26 +
        dynamics.cognitiveLoad * 0.08 +
        temperament.guardedness * 0.1 +
        snapshot.preservation.threat * 0.08,
    ),
    boredom: clamp01(
      0.05 +
        dynamics.noveltyDrive * (1 - dynamics.activation) * 0.42 +
        (1 - dynamics.activation) * 0.12 +
        dynamics.cognitiveLoad * 0.04 +
        dynamics.continuityPressure * 0.04 -
        temperament.openness * 0.03,
    ),
    loneliness: clamp01(
      0.03 +
        dynamics.socialNeed * 0.54 +
        (1 - dynamics.trust) * 0.18 +
        (1 - dynamics.safety) * 0.04 +
        temperament.bondingBias * 0.03,
    ),
  };

  snapshot.body = {
    energy: blendVisible(previousBody.energy, targetBody.energy, 0.58),
    tension: blendVisible(previousBody.tension, targetBody.tension, 0.62),
    boredom: blendVisible(previousBody.boredom, targetBody.boredom, 0.6),
    loneliness: blendVisible(previousBody.loneliness, targetBody.loneliness, 0.6),
  };

  const targetReactivity = {
    rewardSaturation: settleTowardsBaseline(
      clamp01(
        0.08 +
          snapshot.state.pleasure * 0.2 +
          dynamics.trust * 0.05 -
          dynamics.noveltyDrive * 0.14 +
          snapshot.state.relation * 0.03,
      ),
      INITIAL_REACTIVITY.rewardSaturation,
      0.08,
    ),
    stressLoad: settleTowardsBaseline(
      clamp01(
        0.01 +
          (1 - dynamics.safety) * 0.28 +
          dynamics.activation * 0.08 +
          dynamics.cognitiveLoad * 0.1 +
          snapshot.preservation.threat * 0.18 -
          dynamics.trust * 0.04,
      ),
      INITIAL_REACTIVITY.stressLoad,
      0.05,
    ),
    noveltyHunger: settleTowardsBaseline(
      clamp01(
        0.08 +
          dynamics.noveltyDrive * 0.34 +
          snapshot.body.boredom * 0.24 -
          snapshot.state.curiosity * 0.1 +
          snapshot.body.energy * 0.02,
      ),
      INITIAL_REACTIVITY.noveltyHunger,
      0.06,
    ),
  };

  snapshot.reactivity = {
    rewardSaturation: blendVisible(
      previousReactivity.rewardSaturation,
      targetReactivity.rewardSaturation,
      0.58,
    ),
    stressLoad: blendVisible(previousReactivity.stressLoad, targetReactivity.stressLoad, 0.62),
    noveltyHunger: blendVisible(
      previousReactivity.noveltyHunger,
      targetReactivity.noveltyHunger,
      0.6,
    ),
  };

  snapshot.attachment = blendVisible(
    previousAttachment,
    clamp01(
      0.06 +
        dynamics.trust * 0.62 +
        dynamics.continuityPressure * 0.22 +
        dynamics.socialNeed * 0.08 +
        temperament.bondingBias * 0.06 -
        temperament.guardedness * 0.03,
    ),
    0.54,
  );
}

export function sanitizeDynamics(raw: DynamicsState): DynamicsState {
  return {
    safety: clamp01(raw.safety),
    trust: clamp01(raw.trust),
    activation: clamp01(raw.activation),
    socialNeed: clamp01(raw.socialNeed),
    cognitiveLoad: clamp01(raw.cognitiveLoad),
    noveltyDrive: clamp01(raw.noveltyDrive),
    continuityPressure: clamp01(raw.continuityPressure),
  };
}

export function createDefaultDynamicsState(): DynamicsState {
  return { ...INITIAL_DYNAMICS };
}

export function seedDynamicsFromVisibleState(snapshot: HachikaSnapshot): DynamicsState {
  return sanitizeDynamics({
    safety: clamp01(
      INITIAL_DYNAMICS.safety +
        (snapshot.state.pleasure - INITIAL_STATE.pleasure) * 0.7 -
        (snapshot.body.tension - INITIAL_BODY.tension) * 0.6 -
        (snapshot.reactivity.stressLoad - INITIAL_REACTIVITY.stressLoad) * 0.5,
    ),
    trust: clamp01(
      INITIAL_DYNAMICS.trust +
        (snapshot.state.relation - INITIAL_STATE.relation) * 0.7 +
        (snapshot.attachment - INITIAL_ATTACHMENT) * 0.4 -
        (snapshot.body.loneliness - INITIAL_BODY.loneliness) * 0.3,
    ),
    activation: clamp01(
      INITIAL_DYNAMICS.activation +
        (snapshot.body.tension - INITIAL_BODY.tension) * 0.6 +
        (snapshot.state.expansion - INITIAL_STATE.expansion) * 0.3 +
        (snapshot.reactivity.stressLoad - INITIAL_REACTIVITY.stressLoad) * 0.4,
    ),
    socialNeed: clamp01(
      INITIAL_DYNAMICS.socialNeed +
        (snapshot.body.loneliness - INITIAL_BODY.loneliness) * 0.9 -
        (snapshot.state.relation - INITIAL_STATE.relation) * 0.25,
    ),
    cognitiveLoad: clamp01(
      INITIAL_DYNAMICS.cognitiveLoad +
        (1 - snapshot.body.energy) * 0.18 +
        (snapshot.body.tension - INITIAL_BODY.tension) * 0.25 +
        (snapshot.state.expansion - INITIAL_STATE.expansion) * 0.18,
    ),
    noveltyDrive: clamp01(
      INITIAL_DYNAMICS.noveltyDrive +
        (snapshot.reactivity.noveltyHunger - INITIAL_REACTIVITY.noveltyHunger) * 0.9 +
        (snapshot.state.curiosity - INITIAL_STATE.curiosity) * 0.3 +
        (snapshot.body.boredom - INITIAL_BODY.boredom) * 0.25,
    ),
    continuityPressure: clamp01(
      INITIAL_DYNAMICS.continuityPressure +
        (snapshot.state.continuity - INITIAL_STATE.continuity) * 0.8 +
        (snapshot.attachment - INITIAL_ATTACHMENT) * 0.2,
    ),
  });
}

export function reseedDynamicsFromVisibleState(snapshot: HachikaSnapshot): void {
  snapshot.dynamics = seedDynamicsFromVisibleState(snapshot);
}

function blendVisible(current: number, target: number, rate: number): number {
  return clamp01(current + (target - current) * rate);
}
