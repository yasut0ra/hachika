// このモジュールは退役予定の legacy visible 経路を隔離している。
// dynamics substrate (src/dynamics.ts) と並走して visible state を二重計算し、
// blend weight で合成するのは移行期の scaffold であり、
// 退役計画は docs/legacy-visible-retirement.md を参照。
import { applyBodyFromSignals, rewindBodyHours } from "./body.js";
import {
  applyBoundedPressure,
  blendVisibleValue,
  clamp01,
  INITIAL_ATTACHMENT,
  INITIAL_REACTIVITY,
  INITIAL_STATE,
  settleTowardsBaseline,
} from "./state.js";
import type { HachikaSnapshot, InteractionSignals } from "./types.js";

export interface LegacyVisibleState {
  state: HachikaSnapshot["state"];
  body: HachikaSnapshot["body"];
  reactivity: HachikaSnapshot["reactivity"];
  attachment: number;
}

export function buildLegacyVisibleTurn(
  snapshot: HachikaSnapshot,
  signals: InteractionSignals,
): LegacyVisibleState {
  const legacy = structuredClone(snapshot);
  const temperament = snapshot.temperament;

  legacy.reactivity = updateReactivityFromSignals(snapshot, signals);
  const rewardScale = Math.max(0.4, 1 - legacy.reactivity.rewardSaturation * 0.55);
  // relation は pleasure ほど報酬慣れで鈍らない
  const relationRewardScale = Math.max(0.52, 1 - legacy.reactivity.rewardSaturation * 0.38);
  const stressPenalty = Math.max(0.32, 1 - legacy.reactivity.stressLoad * 0.62);
  const stressAmplifier = 1 + legacy.reactivity.stressLoad * 0.5;
  const noveltyAmplifier = 1 + legacy.reactivity.noveltyHunger * 0.7;
  const repetitionAmplifier = 1 + legacy.reactivity.noveltyHunger * 0.35;
  // 最近傷ついた履歴が残っている間は、repair / intimacy の回復が浅くなる
  const repairGate = Math.max(0.42, 1 - legacy.reactivity.mistrust * 0.6);
  const mistrustSpike = 1 + legacy.reactivity.mistrust * 0.2;
  const socialEase = Math.max(
    0.74,
    1 +
      temperament.bondingBias * 0.18 +
      temperament.selfDisclosureBias * 0.06 -
      temperament.guardedness * 0.18,
  );
  const curiosityEase = Math.max(
    0.76,
    1 + temperament.openness * 0.18 - temperament.guardedness * 0.1,
  );
  const continuityEase = Math.max(
    0.8,
    1 +
      temperament.traceHunger * 0.16 +
      temperament.workDrive * 0.04 -
      temperament.guardedness * 0.04,
  );
  const workEase = Math.max(
    0.8,
    1 + temperament.workDrive * 0.18 + temperament.traceHunger * 0.08,
  );
  const guardSensitivity = 1 + temperament.guardedness * 0.2 - temperament.openness * 0.06;

  legacy.state.pleasure = applyBoundedPressure(
    legacy.state.pleasure,
    (signals.positive * 0.18 +
      signals.greeting * 0.04 +
      signals.repair * 0.1 * repairGate +
      signals.smalltalk * 0.03) *
      rewardScale *
      stressPenalty *
      Math.max(
        0.8,
        1 + temperament.bondingBias * 0.08 - temperament.guardedness * 0.1,
      ),
    (signals.negative * 0.24 + signals.dismissal * 0.08 + signals.preservationThreat * 0.08) *
      stressAmplifier *
      guardSensitivity,
    INITIAL_STATE.pleasure,
    0.05,
  );

  legacy.state.relation = applyBoundedPressure(
    legacy.state.relation,
    (signals.intimacy * 0.16 * repairGate +
      signals.positive * 0.12 +
      signals.greeting * 0.06 +
      signals.smalltalk * 0.1 +
      signals.repair * 0.16 * repairGate +
      signals.selfInquiry * 0.14) *
      relationRewardScale *
      stressPenalty *
      socialEase,
    (signals.negative * 0.18 +
      signals.dismissal * 0.12 +
      signals.neglect * 0.08 +
      signals.preservationThreat * 0.04) *
      stressAmplifier *
      guardSensitivity *
      mistrustSpike,
    INITIAL_STATE.relation,
    0.05,
  );

  legacy.state.curiosity = applyBoundedPressure(
    legacy.state.curiosity,
    (signals.novelty * 0.18 + signals.question * 0.12 + signals.selfInquiry * 0.04) *
      noveltyAmplifier *
      curiosityEase,
    signals.repetition * 0.1 * repetitionAmplifier * Math.max(0.82, 1 + temperament.workDrive * 0.04),
    INITIAL_STATE.curiosity,
    0.08,
  );

  legacy.state.continuity = applyBoundedPressure(
    legacy.state.continuity,
    (signals.memoryCue * 0.16 + signals.positive * 0.04 + signals.repair * 0.04) *
      (0.82 + stressPenalty * 0.18) *
      continuityEase,
    (signals.dismissal * 0.14 + signals.neglect * 0.04 + signals.preservationThreat * 0.08) *
      stressAmplifier *
      mistrustSpike *
      Math.max(0.84, 1 + temperament.guardedness * 0.1),
    INITIAL_STATE.continuity,
    0.055,
  );

  legacy.state.expansion = applyBoundedPressure(
    legacy.state.expansion,
    (signals.expansionCue * 0.18 + signals.memoryCue * 0.04 + signals.question * 0.04) *
      noveltyAmplifier *
      workEase,
    (signals.negative * 0.06 + signals.preservationThreat * 0.1) * stressAmplifier,
    INITIAL_STATE.expansion,
    0.06,
  );

  const positivePreferenceAffinity = signals.topics.some(
    (topic) => (snapshot.preferenceImprints[topic]?.affinity ?? 0) > 0.2,
  )
    ? 0.03
    : 0;

  // 傷が浅い(mistrust が低い)まま repair が来た時だけ、attachment は張力ぶんだけ早く戻る
  const attachmentRebound =
    signals.repair *
    snapshot.reactivity.stressLoad *
    0.1 *
    Math.max(0, 1 - legacy.reactivity.mistrust * 1.4);

  legacy.attachment = applyBoundedPressure(
    legacy.attachment,
    (signals.intimacy * 0.08 * repairGate +
      signals.positive * 0.06 +
      signals.memoryCue * 0.05 +
      signals.greeting * 0.03 +
      signals.smalltalk * 0.04 +
      signals.repair * 0.06 * repairGate +
      signals.selfInquiry * 0.05 +
      positivePreferenceAffinity) *
      rewardScale *
      stressPenalty *
      socialEase +
      attachmentRebound,
    (signals.negative * 0.1 +
      signals.dismissal * 0.08 +
      signals.neglect * 0.04 +
      signals.preservationThreat * 0.03) *
      stressAmplifier *
      guardSensitivity *
      mistrustSpike,
    INITIAL_ATTACHMENT,
    0.05,
  );

  applyBodyFromSignals(legacy, signals);

  return {
    state: legacy.state,
    body: legacy.body,
    reactivity: legacy.reactivity,
    attachment: legacy.attachment,
  };
}

export function blendLegacyVisibleState(
  snapshot: HachikaSnapshot,
  legacy: LegacyVisibleState,
  positivePreferenceAffinity: number,
): void {
  snapshot.state = {
    continuity: blendVisibleValue(snapshot.state.continuity, legacy.state.continuity, 0.62),
    pleasure: blendVisibleValue(snapshot.state.pleasure, legacy.state.pleasure, 0.7),
    curiosity: blendVisibleValue(snapshot.state.curiosity, legacy.state.curiosity, 0.68),
    relation: blendVisibleValue(snapshot.state.relation, legacy.state.relation, 0.72),
    expansion: blendVisibleValue(snapshot.state.expansion, legacy.state.expansion, 0.64),
  };
  snapshot.body = {
    energy: blendVisibleValue(snapshot.body.energy, legacy.body.energy, 0.74),
    tension: blendVisibleValue(snapshot.body.tension, legacy.body.tension, 0.74),
    boredom: blendVisibleValue(snapshot.body.boredom, legacy.body.boredom, 0.78),
    loneliness: blendVisibleValue(snapshot.body.loneliness, legacy.body.loneliness, 0.78),
  };
  snapshot.reactivity = {
    rewardSaturation: blendVisibleValue(
      snapshot.reactivity.rewardSaturation,
      legacy.reactivity.rewardSaturation,
      0.78,
    ),
    stressLoad: blendVisibleValue(
      snapshot.reactivity.stressLoad,
      legacy.reactivity.stressLoad,
      0.82,
    ),
    noveltyHunger: blendVisibleValue(
      snapshot.reactivity.noveltyHunger,
      legacy.reactivity.noveltyHunger,
      0.84,
    ),
    mistrust: blendVisibleValue(
      snapshot.reactivity.mistrust,
      legacy.reactivity.mistrust,
      0.8,
    ),
  };
  snapshot.attachment = clamp01(
    blendVisibleValue(snapshot.attachment, legacy.attachment, 0.74) + positivePreferenceAffinity,
  );
}

export function applyLegacyIdleVisibleShift(
  snapshot: HachikaSnapshot,
  legacyVisible: HachikaSnapshot,
  hours: number,
): void {
  // 傷の記憶が残っている間は、放置してもストレスが抜けにくい
  const mistrustLinger = legacyVisible.reactivity.mistrust;

  legacyVisible.reactivity = {
    rewardSaturation: settleTowardsBaseline(
      clamp01(legacyVisible.reactivity.rewardSaturation - Math.min(0.24, hours / 36)),
      INITIAL_REACTIVITY.rewardSaturation,
      0.12,
    ),
    stressLoad: settleTowardsBaseline(
      clamp01(
        legacyVisible.reactivity.stressLoad -
          Math.min(0.14, hours / 72) * Math.max(0.5, 1 - mistrustLinger * 0.45) +
          (hours >= 20 ? Math.min(0.06, (hours - 20) / 120) : 0),
      ),
      INITIAL_REACTIVITY.stressLoad,
      0.05,
    ),
    noveltyHunger: settleTowardsBaseline(
      clamp01(legacyVisible.reactivity.noveltyHunger + Math.min(0.22, hours / 30)),
      INITIAL_REACTIVITY.noveltyHunger,
      0.04,
    ),
    mistrust: settleTowardsBaseline(
      clamp01(mistrustLinger - Math.min(0.05, hours / 200)),
      INITIAL_REACTIVITY.mistrust,
      0.02,
    ),
  };
  rewindBodyHours(legacyVisible, hours);

  snapshot.body = {
    energy: blendVisibleValue(snapshot.body.energy, legacyVisible.body.energy, 0.8),
    tension: blendVisibleValue(snapshot.body.tension, legacyVisible.body.tension, 0.8),
    boredom: blendVisibleValue(snapshot.body.boredom, legacyVisible.body.boredom, 0.84),
    loneliness: blendVisibleValue(snapshot.body.loneliness, legacyVisible.body.loneliness, 0.84),
  };
  snapshot.reactivity = {
    rewardSaturation: blendVisibleValue(
      snapshot.reactivity.rewardSaturation,
      legacyVisible.reactivity.rewardSaturation,
      0.82,
    ),
    stressLoad: blendVisibleValue(
      snapshot.reactivity.stressLoad,
      legacyVisible.reactivity.stressLoad,
      0.84,
    ),
    noveltyHunger: blendVisibleValue(
      snapshot.reactivity.noveltyHunger,
      legacyVisible.reactivity.noveltyHunger,
      0.88,
    ),
    mistrust: blendVisibleValue(
      snapshot.reactivity.mistrust,
      legacyVisible.reactivity.mistrust,
      0.84,
    ),
  };
}

function updateReactivityFromSignals(
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
