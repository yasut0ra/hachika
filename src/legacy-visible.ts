// このモジュールは退役予定の legacy visible 経路を隔離している。
// dynamics substrate (src/dynamics.ts) と並走して visible state を二重計算し、
// blend weight で合成するのは移行期の scaffold であり、
// 退役計画は docs/legacy-visible-retirement.md を参照。
import { applyBodyFromSignals, rewindBodyHours } from "./body.js";
import { updateReactivityFromSignals } from "./dynamics.js";
import {
  applyBoundedPressure,
  blendVisibleValue,
  clamp01,
  INITIAL_ATTACHMENT,
  INITIAL_STATE,
} from "./state.js";
import type { HachikaSnapshot, InteractionSignals } from "./types.js";

// legacy 経路の寄与を一括で減衰させるダイヤル。
// 1.0 で従来挙動、0 で dynamics 経路のみ。退役は docs/legacy-visible-retirement.md の Phase 3 を参照。
let legacyBlendScale = resolveLegacyBlendScale(process.env.HACHIKA_LEGACY_BLEND_SCALE);

export function setLegacyBlendScale(scale: number): void {
  legacyBlendScale = clamp01(scale);
}

export function getLegacyBlendScale(): number {
  return legacyBlendScale;
}

function resolveLegacyBlendScale(raw: string | undefined): number {
  if (raw === undefined) {
    return 1;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? clamp01(parsed) : 1;
}

function legacyWeight(weight: number): number {
  return weight * legacyBlendScale;
}

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
    continuity: blendVisibleValue(snapshot.state.continuity, legacy.state.continuity, legacyWeight(0.62)),
    pleasure: blendVisibleValue(snapshot.state.pleasure, legacy.state.pleasure, legacyWeight(0.7)),
    curiosity: blendVisibleValue(snapshot.state.curiosity, legacy.state.curiosity, legacyWeight(0.68)),
    relation: blendVisibleValue(snapshot.state.relation, legacy.state.relation, legacyWeight(0.72)),
    expansion: blendVisibleValue(snapshot.state.expansion, legacy.state.expansion, legacyWeight(0.64)),
  };
  snapshot.body = {
    energy: blendVisibleValue(snapshot.body.energy, legacy.body.energy, legacyWeight(0.74)),
    tension: blendVisibleValue(snapshot.body.tension, legacy.body.tension, legacyWeight(0.74)),
    boredom: blendVisibleValue(snapshot.body.boredom, legacy.body.boredom, legacyWeight(0.78)),
    loneliness: blendVisibleValue(snapshot.body.loneliness, legacy.body.loneliness, legacyWeight(0.78)),
  };
  // reactivity は substrate (updateReactivityFromSignals) が唯一の更新元になったため、ここでは混ぜない
  snapshot.attachment = clamp01(
    blendVisibleValue(snapshot.attachment, legacy.attachment, legacyWeight(0.74)) +
      positivePreferenceAffinity,
  );
}

export function applyLegacyIdleVisibleShift(
  snapshot: HachikaSnapshot,
  legacyVisible: HachikaSnapshot,
  hours: number,
): void {
  // reactivity の idle ドリフトは substrate (rewindReactivityHours) が担うため、ここでは body だけを扱う。
  // body の感度計算にはドリフト済みの reactivity を使う
  legacyVisible.reactivity = { ...snapshot.reactivity };
  rewindBodyHours(legacyVisible, hours);

  snapshot.body = {
    energy: blendVisibleValue(snapshot.body.energy, legacyVisible.body.energy, legacyWeight(0.8)),
    tension: blendVisibleValue(snapshot.body.tension, legacyVisible.body.tension, legacyWeight(0.8)),
    boredom: blendVisibleValue(snapshot.body.boredom, legacyVisible.body.boredom, legacyWeight(0.84)),
    loneliness: blendVisibleValue(
      snapshot.body.loneliness,
      legacyVisible.body.loneliness,
      legacyWeight(0.84),
    ),
  };
}

