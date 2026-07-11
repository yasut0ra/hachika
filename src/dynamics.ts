import {
  blendVisibleValue,
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

// reactivity は substrate の一部として signal から直接更新する。
// legacy 経路 (src/legacy-visible.ts) も同じ関数を使うため、移行中も両経路の reactivity は一致する。
export function updateReactivityFromSignals(
  snapshot: HachikaSnapshot,
  signals: InteractionSignals,
): HachikaSnapshot["reactivity"] {
  const mistrust = snapshot.reactivity.mistrust;
  // 敵意直後の repair は効きが浅く、繰り返して初めて元の効きに戻る
  const repairEfficiency = Math.max(0.35, 1 - mistrust * 0.55);
  const hostilitySensitization = 1 + mistrust * 0.35;

  return {
    rewardSaturation: settleTowardsBaseline(
      clamp01(
        snapshot.reactivity.rewardSaturation * 0.82 +
          signals.positive * 0.24 +
          signals.greeting * 0.04 +
          signals.smalltalk * 0.05 +
          signals.repair * 0.06 -
          signals.negative * 0.08 -
          signals.novelty * 0.05,
      ),
      INITIAL_REACTIVITY.rewardSaturation,
      0.08,
    ),
    stressLoad: settleTowardsBaseline(
      clamp01(
        snapshot.reactivity.stressLoad * 0.88 +
          (signals.negative * 0.3 + signals.dismissal * 0.18) * hostilitySensitization +
          signals.neglect * 0.08 +
          signals.preservationThreat * 0.18 -
          signals.repair * 0.08 * repairEfficiency -
          signals.positive * 0.05 * Math.max(0.5, 1 - mistrust * 0.4) -
          signals.greeting * 0.02,
      ),
      INITIAL_REACTIVITY.stressLoad,
      0.04,
    ),
    noveltyHunger: settleTowardsBaseline(
      clamp01(
        snapshot.reactivity.noveltyHunger * 0.86 +
          signals.repetition * 0.24 +
          signals.neglect * 0.06 +
          signals.smalltalk * 0.02 -
          signals.novelty * 0.18 -
          signals.question * 0.06 -
          signals.expansionCue * 0.08 -
          signals.selfInquiry * 0.04,
      ),
      INITIAL_REACTIVITY.noveltyHunger,
      0.06,
    ),
    mistrust: settleTowardsBaseline(
      clamp01(
        mistrust * 0.94 +
          (signals.negative * 0.22 +
            signals.dismissal * 0.16 +
            signals.preservationThreat * 0.1) *
            (1 + snapshot.temperament.guardedness * 0.3) -
          signals.repair * 0.07 * repairEfficiency -
          signals.intimacy * 0.03 -
          signals.positive * 0.02,
      ),
      INITIAL_REACTIVITY.mistrust,
      0.02,
    ),
  };
}

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
  // 直近の傷の記憶が残っている間、trust は温まりにくく冷えやすい
  const mistrustGate = Math.max(0.5, 1 - snapshot.reactivity.mistrust * 0.5);
  const mistrustSpike = 1 + snapshot.reactivity.mistrust * 0.3;

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
            signals.positive * 0.08 +
            signals.greeting * 0.05 +
            signals.smalltalk * 0.06 +
            signals.selfInquiry * 0.06 +
            signals.memoryCue * 0.08) *
            socialSensitivity *
            mistrustGate -
          (signals.dismissal * 0.22 +
            signals.neglect * 0.16 +
            signals.negative * 0.1 +
            signals.abandonment * 0.04) *
            guardedSensitivity *
            mistrustSpike,
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

  snapshot.reactivity = updateReactivityFromSignals(snapshot, signals);

  deriveVisibleStateFromDynamics(snapshot);
}

// idle 中の reactivity ドリフトも substrate として直接適用する
export function rewindReactivityHours(
  snapshot: HachikaSnapshot,
  hours: number,
): void {
  if (!Number.isFinite(hours) || hours <= 0) {
    return;
  }

  // 傷の記憶が残っている間は、放置してもストレスが抜けにくい
  const mistrustLinger = snapshot.reactivity.mistrust;

  snapshot.reactivity = {
    rewardSaturation: settleTowardsBaseline(
      clamp01(snapshot.reactivity.rewardSaturation - Math.min(0.24, hours / 36)),
      INITIAL_REACTIVITY.rewardSaturation,
      0.12,
    ),
    stressLoad: settleTowardsBaseline(
      clamp01(
        snapshot.reactivity.stressLoad -
          Math.min(0.14, hours / 72) * Math.max(0.5, 1 - mistrustLinger * 0.45) +
          (hours >= 20 ? Math.min(0.06, (hours - 20) / 120) : 0),
      ),
      INITIAL_REACTIVITY.stressLoad,
      0.05,
    ),
    noveltyHunger: settleTowardsBaseline(
      clamp01(snapshot.reactivity.noveltyHunger + Math.min(0.22, hours / 30)),
      INITIAL_REACTIVITY.noveltyHunger,
      0.04,
    ),
    mistrust: settleTowardsBaseline(
      clamp01(mistrustLinger - Math.min(0.05, hours / 200)),
      INITIAL_REACTIVITY.mistrust,
      0.02,
    ),
  };
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
  // 傷ついた直後の放置は安心の回復が浅く、trust の冷え方が速い
  const mistrustLinger = snapshot.reactivity.mistrust;
  const stressLinger = snapshot.reactivity.stressLoad;

  snapshot.dynamics = {
    safety: settleTowardsBaseline(
      clamp01(
        snapshot.dynamics.safety +
          Math.min(0.1, hours / 96) * Math.max(0.5, 1 - mistrustLinger * 0.35) -
          snapshot.preservation.threat * 0.04 -
          longAbsence * 0.03,
      ),
      INITIAL_DYNAMICS.safety,
      0.05,
    ),
    trust: settleTowardsBaseline(
      clamp01(
        snapshot.dynamics.trust -
          Math.min(0.06, hours / 180) * (1 + mistrustLinger * 0.5) +
          absenceBias * 0.2,
      ),
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
          Math.min(0.12, hours / 60) *
            (1 + stressLinger * 0.3 + mistrustLinger * 0.25) +
          snapshot.preservation.threat * 0.05,
      ),
      INITIAL_DYNAMICS.continuityPressure,
      0.03,
    ),
  };

  rewindReactivityHours(snapshot, hours);
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
    pleasure: blendWithHeadroom(previousState.pleasure, targetState.pleasure, 0.52),
    relation: blendWithHeadroom(previousState.relation, targetState.relation, 0.5),
    curiosity: blendWithHeadroom(previousState.curiosity, targetState.curiosity, 0.5),
    continuity: blendWithHeadroom(previousState.continuity, targetState.continuity, 0.5),
    expansion: blendWithHeadroom(previousState.expansion, targetState.expansion, 0.48),
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
    energy: blendWithHeadroom(previousBody.energy, targetBody.energy, 0.58),
    tension: blendWithHeadroom(previousBody.tension, targetBody.tension, 0.62),
    boredom: blendWithHeadroom(previousBody.boredom, targetBody.boredom, 0.6),
    loneliness: blendWithHeadroom(previousBody.loneliness, targetBody.loneliness, 0.6),
  };

  // reactivity は signal 直結の substrate 更新 (updateReactivityFromSignals) と
  // idle shift 側で管理するため、ここでは導出しない
  snapshot.attachment = blendWithHeadroom(
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

// applyBoundedPressure と同じ思想で、極値に近い側へ動くほどブレンドが鈍る。
// headroom 0.5 (中央) で 1.0 に正規化してあるため、中庸域の動きは変えない
function blendWithHeadroom(current: number, target: number, rate: number): number {
  const room = target > current ? 1 - current : current;
  const damping = (0.4 + room * 0.6) / 0.7;
  return blendVisibleValue(current, target, Math.min(1, rate * damping));
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
        (snapshot.body.loneliness - INITIAL_BODY.loneliness) * 0.3 -
        (snapshot.reactivity.mistrust - INITIAL_REACTIVITY.mistrust) * 0.3,
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

