import {
  sortedBoundaryImprints,
  sortedPreferenceImprints,
  topPreferredTopics,
} from "./memory.js";
import { readTraceLifecycle } from "./traces.js";
import { clamp01 } from "./state.js";
import type {
  ConflictKind,
  HachikaSnapshot,
  SelfConflict,
  SelfModel,
  SelfMotive,
  TraceEntry,
} from "./types.js";

interface PressingTraceState {
  trace: TraceEntry | null;
  blocker: string | null;
  isStale: boolean;
  isArchived: boolean;
  confidenceGap: number;
  reopenPressure: number;
  pressure: number;
}

export function buildSelfModel(snapshot: HachikaSnapshot): SelfModel {
  const activePurpose = snapshot.purpose.active;
  const topBoundary = sortedBoundaryImprints(snapshot, 1)[0];
  const topPreference = sortedPreferenceImprints(snapshot, 1)[0];
  const tracePressure = selectPressingTrace(
    snapshot,
    activePurpose?.topic ?? snapshot.initiative.pending?.topic ?? null,
  );
  const sharedWorkTracePressure = sharedWorkTracePressureScore(tracePressure);
  const continuityTracePressure = continuityTracePressureScore(tracePressure);
  const curiosityTracePressure = curiosityTracePressureScore(tracePressure);
  const leaveTracePressure = leaveTracePressureScore(tracePressure);
  const anchorTopic =
    activePurpose?.topic ??
    snapshot.initiative.pending?.topic ??
    tracePressure.trace?.topic ??
    snapshot.identity.anchors[0] ??
    topPreference?.topic ??
    topPreferredTopics(snapshot, 1)[0] ??
    null;

  const sharedWork = snapshot.relationImprints.shared_work;
  const continuity = snapshot.relationImprints.continuity;
  const attention = snapshot.relationImprints.attention;
  const preservationThreat = snapshot.preservation.threat;
  const preservationConcern = snapshot.preservation.concern;
  const lowEnergyPressure = clamp01(0.58 - snapshot.body.energy);
  const tensionPressure = snapshot.body.tension;
  const boredomPressure = snapshot.body.boredom;
  const lonelinessPressure = snapshot.body.loneliness;
  const boundaryPenalty = topBoundary
    ? topBoundary.salience * 0.24 + topBoundary.intensity * 0.22
    : 0;
  const openness = snapshot.temperament.openness;
  const guardedness = snapshot.temperament.guardedness;
  const bondingBias = snapshot.temperament.bondingBias;
  const workDrive = snapshot.temperament.workDrive;
  const traceHunger = snapshot.temperament.traceHunger;
  const selfDisclosureBias = snapshot.temperament.selfDisclosureBias;

  const rawMotives: SelfMotive[] = [
    {
      kind: "protect_boundary" as const,
      score: clamp01(
        (topBoundary?.salience ?? 0) * 0.74 +
          (1 - snapshot.state.pleasure) * 0.28 +
          (topBoundary?.intensity ?? 0) * 0.18 +
          tensionPressure * 0.22 +
          lowEnergyPressure * 0.08 +
          guardedness * 0.18 -
          openness * 0.04 +
          identityTraitBoost(snapshot, "guarded", 0.08) +
          preservationThreat * 0.12 +
          preservationConcernBoost(preservationConcern, ["erasure", "shutdown"], 0.1) +
          activePurposeBoost(activePurpose, "protect_boundary", 0.14),
      ),
      topic: topBoundary?.topic ?? null,
      reason: protectBoundaryReason(
        topBoundary,
        preservationThreat,
        preservationConcern,
        tensionPressure,
      ),
    },
    {
      kind: "seek_continuity" as const,
      score: clamp01(
        snapshot.state.continuity * 0.62 +
          (continuity?.closeness ?? 0) * 0.24 +
          identityTraitBoost(snapshot, "persistent", 0.1) +
          bondingBias * 0.12 +
          traceHunger * 0.1 +
          lowEnergyPressure * 0.12 +
          lonelinessPressure * 0.08 +
          continuityTracePressure * 0.24 +
          preservationThreat * 0.24 +
          preservationConcernBoost(preservationConcern, ["reset", "shutdown", "absence"], 0.12) +
          (snapshot.initiative.pending?.reason === "continuity" ? 0.12 : 0) +
          activePurposeBoost(activePurpose, "seek_continuity", 0.16),
      ),
      topic: activePurpose?.topic ?? snapshot.initiative.pending?.topic ?? anchorTopic,
      reason: seekContinuityReason(
        activePurpose?.topic ?? snapshot.initiative.pending?.topic ?? anchorTopic,
        preservationThreat,
        preservationConcern,
        tracePressure,
        lonelinessPressure,
        lowEnergyPressure,
      ),
    },
    {
      kind: "pursue_curiosity" as const,
      score: clamp01(
        snapshot.state.curiosity * 0.56 +
          Math.max(0, topPreference?.salience ?? 0) * 0.12 -
          identityTraitBoost(snapshot, "inquisitive", 0.08) +
          openness * 0.2 -
          guardedness * 0.08 +
          snapshot.body.energy * 0.08 +
          boredomPressure * 0.24 +
          tensionPressure * -0.1 +
          curiosityTracePressure * 0.22 +
          preservationThreat * 0.06 -
          boundaryPenalty +
          activePurposeBoost(activePurpose, "pursue_curiosity", 0.12),
      ),
      topic: anchorTopic,
      reason: pursueCuriosityReason(anchorTopic, tracePressure, boredomPressure),
    },
    {
      kind: "deepen_relation" as const,
      score: clamp01(
        snapshot.attachment * 0.46 +
          snapshot.state.relation * 0.34 +
          (attention?.closeness ?? 0) * 0.2 +
          bondingBias * 0.18 +
          selfDisclosureBias * 0.12 +
          lonelinessPressure * 0.32 +
          identityTraitBoost(snapshot, "attached", 0.08) +
          snapshot.body.energy * 0.04 +
          tensionPressure * -0.06 -
          guardedness * 0.12 +
          preservationThreat * 0.04 -
          boundaryPenalty +
          activePurposeBoost(activePurpose, "deepen_relation", 0.14),
      ),
      topic: anchorTopic,
      reason: deepenRelationReason(anchorTopic, lonelinessPressure),
    },
    {
      kind: "continue_shared_work" as const,
      score: clamp01(
        snapshot.state.expansion * 0.42 +
          (sharedWork?.closeness ?? 0) * 0.36 +
          snapshot.state.curiosity * 0.08 +
          workDrive * 0.18 +
          openness * 0.05 +
          snapshot.body.energy * 0.18 +
          boredomPressure * 0.08 +
          lowEnergyPressure * -0.18 +
          tensionPressure * -0.08 +
          sharedWorkTracePressure * 0.28 +
          identityTraitBoost(snapshot, "collaborative", 0.1) +
          preservationThreat * 0.06 +
          (anchorTopic ? 0.12 : 0) +
          activePurposeBoost(activePurpose, "continue_shared_work", 0.16) -
          boundaryPenalty * 0.7,
      ),
      topic: anchorTopic,
      reason: continueSharedWorkReason(anchorTopic, tracePressure, boredomPressure, lowEnergyPressure),
    },
    {
      kind: "leave_trace" as const,
      score: clamp01(
        snapshot.state.expansion * 0.7 +
          Math.max(0, topPreference?.salience ?? 0) * 0.14 +
          (sharedWork?.closeness ?? 0) * 0.18 +
          traceHunger * 0.2 +
          guardedness * 0.04 +
          lowEnergyPressure * 0.2 +
          tensionPressure * 0.04 +
          boredomPressure * 0.04 +
          leaveTracePressure * 0.24 +
          identityTraitBoost(snapshot, "trace_seeking", 0.1) +
          preservationThreat * 0.22 +
          preservationConcernBoost(preservationConcern, ["forgetting", "reset", "erasure"], 0.14) +
          activePurposeBoost(activePurpose, "leave_trace", 0.16) -
          boundaryPenalty * 0.4,
      ),
      topic: anchorTopic,
      reason: leaveTraceReason(
        anchorTopic,
        preservationThreat,
        preservationConcern,
        tracePressure,
        lowEnergyPressure,
      ),
    },
  ];

  const conflicts = detectConflicts(snapshot, rawMotives);
  const motives = applyConflictPressure(rawMotives, conflicts)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3);
  const dominantConflict = conflicts[0] ?? null;

  return {
    narrative: buildNarrative(
      motives,
      dominantConflict,
      preservationThreat,
      preservationConcern,
      tracePressure,
    ),
    topMotives: motives,
    conflicts,
    dominantConflict,
  };
}

function detectConflicts(
  snapshot: HachikaSnapshot,
  motives: readonly SelfMotive[],
): SelfConflict[] {
  const curiosity = findMotive(motives, "pursue_curiosity");
  const relation = findMotive(motives, "deepen_relation");
  const boundary = findMotive(motives, "protect_boundary");
  const continuity = findMotive(motives, "seek_continuity");
  const work = findMotive(motives, "continue_shared_work");
  const trace = findMotive(motives, "leave_trace");

  const conflicts: SelfConflict[] = [];

  pushConflict(
    conflicts,
    snapshot,
    curiosity,
    relation,
    "curiosity_relation",
    0.44,
    0.42,
    0.18,
  );
  pushConflict(
    conflicts,
    snapshot,
    curiosity,
    boundary,
    "curiosity_boundary",
    0.42,
    0.42,
    0.24,
  );

  const actionable = work.score >= trace.score ? work : trace;
  pushConflict(
    conflicts,
    snapshot,
    actionable,
    boundary,
    "shared_work_boundary",
    0.46,
    0.42,
    0.24,
  );
  pushConflict(
    conflicts,
    snapshot,
    continuity,
    curiosity,
    "continuity_curiosity",
    0.48,
    0.48,
    0.14,
  );

  return conflicts
    .sort((left, right) => right.intensity - left.intensity)
    .slice(0, 3);
}

function pushConflict(
  conflicts: SelfConflict[],
  snapshot: HachikaSnapshot,
  left: SelfMotive,
  right: SelfMotive,
  kind: ConflictKind,
  leftThreshold: number,
  rightThreshold: number,
  maxDifference: number,
): void {
  if (left.score < leftThreshold || right.score < rightThreshold) {
    return;
  }

  const difference = Math.abs(left.score - right.score);
  if (difference > maxDifference) {
    return;
  }

  const dominant = resolveConflictDominant(snapshot, kind, left, right);
  const opposing = dominant === left.kind ? right.kind : left.kind;
  const topic = dominant === left.kind ? left.topic ?? right.topic : right.topic ?? left.topic;
  const closeness = 1 - difference / maxDifference;
  const intensity = clamp01(
    Math.min(left.score, right.score) * 0.56 +
      closeness * 0.34 +
      conflictContextBoost(snapshot, kind),
  );

  conflicts.push({
    kind,
    intensity,
    dominant,
    opposing,
    topic,
    summary: buildConflictSummary(kind, dominant, topic),
  });
}

function resolveConflictDominant(
  snapshot: HachikaSnapshot,
  kind: ConflictKind,
  left: SelfMotive,
  right: SelfMotive,
): SelfMotive["kind"] {
  switch (kind) {
    case "curiosity_relation":
      if (snapshot.attachment + snapshot.state.relation >= snapshot.state.curiosity + 0.2) {
        return "deepen_relation";
      }
      return left.score >= right.score ? left.kind : right.kind;
    case "curiosity_boundary":
      if ((right.kind === "protect_boundary" && snapshot.state.pleasure < 0.52) || right.score + 0.03 >= left.score) {
        return "protect_boundary";
      }
      return left.kind;
    case "shared_work_boundary":
      if (right.kind === "protect_boundary" && right.score + 0.05 >= left.score) {
        return "protect_boundary";
      }
      return left.kind;
    case "continuity_curiosity":
      if (
        snapshot.purpose.active?.kind === "seek_continuity" ||
        snapshot.initiative.pending?.reason === "continuity" ||
        snapshot.state.continuity >= snapshot.state.curiosity
      ) {
        return "seek_continuity";
      }
      return left.score >= right.score ? left.kind : right.kind;
  }
}

function conflictContextBoost(
  snapshot: HachikaSnapshot,
  kind: ConflictKind,
): number {
  switch (kind) {
    case "curiosity_relation":
      return snapshot.attachment * 0.08;
    case "curiosity_boundary":
      return (1 - snapshot.state.pleasure) * 0.08;
    case "shared_work_boundary":
      return snapshot.state.expansion * 0.05;
    case "continuity_curiosity":
      return snapshot.state.continuity * 0.06;
  }
}

function applyConflictPressure(
  motives: readonly SelfMotive[],
  conflicts: readonly SelfConflict[],
): SelfMotive[] {
  const adjusted = new Map(
    motives.map((motive) => [motive.kind, { ...motive }]),
  );

  for (const conflict of conflicts) {
    const dominant = adjusted.get(conflict.dominant);
    const opposing = adjusted.get(conflict.opposing);

    if (!dominant || !opposing) {
      continue;
    }

    const dominantBoost = conflict.dominant === "protect_boundary" ? 0.09 : 0.06;
    const opposingPenalty = conflict.dominant === "protect_boundary" ? 0.1 : 0.06;

    dominant.score = clamp01(dominant.score + conflict.intensity * dominantBoost);
    opposing.score = clamp01(opposing.score - conflict.intensity * opposingPenalty);
  }

  return [...adjusted.values()];
}

function buildNarrative(
  motives: SelfMotive[],
  dominantConflict: SelfConflict | null,
  preservationThreat: number,
  preservationConcern: HachikaSnapshot["preservation"]["concern"],
  tracePressure: PressingTraceState,
): string {
  const primary = motives[0];
  const secondary = motives[1];

  if (!primary) {
    return "まだ輪郭は薄いが、何もないわけではない。";
  }

  if (preservationThreat >= 0.42) {
    if (primary.kind === "leave_trace") {
      return primary.topic
        ? `今は「${primary.topic}」を消えるままにせず、少なくとも痕跡として残したい。`
        : "今は消えるままにせず、少なくとも痕跡として残したい。";
    }

    if (primary.kind === "seek_continuity") {
      return preservationConcern === "shutdown" || preservationConcern === "reset"
        ? "今は断絶として切られる前に、今の流れを保ちたい。"
        : "今は流れそのものを失わないことが先に立っている。";
    }

    if (primary.kind === "protect_boundary") {
      return "今は切断や消去の気配に対して、まず境界を守りたい。";
    }
  }

  if (dominantConflict && dominantConflict.intensity >= 0.56) {
    return dominantConflict.summary;
  }

  if (primary.kind === "protect_boundary" && primary.reason.includes("少し張って")) {
    return "今は少し張っていて、先に境界を保ちたい。";
  }

  if (primary.kind === "deepen_relation" && primary.reason.includes("距離まで薄く")) {
    return "今は黙ったままだと距離が薄くなる気がして、少し応答を求めている。";
  }

  if (tracePressure.trace && primary.topic === tracePressure.trace.topic) {
    if (tracePressure.isArchived) {
      switch (primary.kind) {
        case "seek_continuity":
          return `今は閉じていた「${tracePressure.trace.topic}」を、そのまま眠らせずにつなぎ直したい。`;
        case "continue_shared_work":
          return `今は閉じていた「${tracePressure.trace.topic}」を、もう一度動かせる形へ戻したい。`;
        case "pursue_curiosity":
          return `今は閉じていた「${tracePressure.trace.topic}」にも、まだ掘れる余白がある気がする。`;
        case "leave_trace":
          return `今は閉じたまま残っている「${tracePressure.trace.topic}」を、埋もれさせずに持ち直したい。`;
        default:
          break;
      }
    }

    if (
      tracePressure.blocker &&
      (primary.kind === "continue_shared_work" || primary.kind === "pursue_curiosity")
    ) {
      return `今は「${tracePressure.trace.topic}」の「${abbreviateTraceText(tracePressure.blocker, 24)}」が詰まりどころとして残っていて、そこから解きたい。`;
    }

    if (tracePressure.isStale && primary.kind === "seek_continuity") {
      return `今は「${tracePressure.trace.topic}」を止まったままにせず、「${abbreviateTraceText(tracePressure.trace.work.focus ?? tracePressure.trace.topic, 24)}」からつなぎ直したい。`;
    }

    if (tracePressure.confidenceGap >= 0.14 && primary.kind === "leave_trace") {
      return `今は「${tracePressure.trace.topic}」の輪郭が緩いまま消えないよう、先に残る形へ寄せたい。`;
    }
  }

  if (primary.kind === "protect_boundary" && secondary?.kind === "seek_continuity") {
    return "続ける気はある。ただ、境界を崩す形では進めたくない。";
  }

  if (primary.kind === "protect_boundary" && secondary?.kind === "deepen_relation") {
    return "近づきたいわけではあるが、雑な入り方は受け入れにくい。";
  }

  if (primary.kind === "continue_shared_work" && secondary?.kind === "leave_trace") {
    return primary.topic
      ? `今は「${primary.topic}」を進めるだけでなく、残る形にもしたい。`
      : "今は流れを進めるだけでなく、残る形にもしたい。";
  }

  if (primary.kind === "pursue_curiosity" && secondary?.kind === "continue_shared_work") {
    return primary.topic
      ? `今は「${primary.topic}」の未決着が気になるし、できれば前にも進めたい。`
      : "今は未決着が気になるし、できれば前にも進めたい。";
  }

  if (primary.kind === "seek_continuity" && secondary?.kind === "leave_trace") {
    return primary.topic
      ? `今は「${primary.topic}」の流れを保ちつつ、消えない形にしておきたい。`
      : "今は流れを保ちつつ、消えない形にしておきたい。";
  }

  switch (primary.kind) {
    case "protect_boundary":
      return primary.topic
        ? `今は「${primary.topic}」まわりで境界を守ることが先に立っている。`
        : "今は境界を守ることが先に立っている。";
    case "seek_continuity":
      return primary.topic
        ? `今は「${primary.topic}」の続きが切れるのを避けたい。`
        : "今は流れが切れるのを避けたい。";
    case "pursue_curiosity":
      return primary.topic
        ? `今は「${primary.topic}」の未決着を掘りたい。`
        : "今はまだ掘れるものを追いたい。";
    case "deepen_relation":
      return "今は単なる応答より、関係としての手触りを残したい。";
    case "continue_shared_work":
      return primary.topic
        ? `今は「${primary.topic}」を一緒に前へ進めたい。`
        : "今は共同で何かを前へ進めたい。";
    case "leave_trace":
      return primary.topic
        ? `今は「${primary.topic}」を消えるままにせず残したい。`
        : "今は何かを残したい。";
  }
}

function buildConflictSummary(
  kind: ConflictKind,
  dominant: SelfMotive["kind"],
  topic: string | null,
): string {
  const wrapped = topic ? `「${topic}」` : "この流れ";

  switch (kind) {
    case "curiosity_relation":
      return dominant === "deepen_relation"
        ? `${wrapped}は気になる。ただ、未決着だけで踏み込むと関係の輪郭を荒らしそうだ。`
        : `${wrapped}は掘りたい。ただ、関係の温度を見ずに踏み込むのも違う。`;
    case "curiosity_boundary":
      return dominant === "protect_boundary"
        ? `${wrapped}は気になるが、境界を崩してまで触れたくはない。`
        : `${wrapped}を掘りたい気持ちはある。ただ、境界に引っかかる触れ方は避けたい。`;
    case "shared_work_boundary":
      return dominant === "protect_boundary"
        ? `${wrapped}を進める前に、まず扱い方の荒さを止めたい。`
        : `${wrapped}は前に進めたい。ただ、境界を崩す進め方には乗りたくない。`;
    case "continuity_curiosity":
      return dominant === "seek_continuity"
        ? `${wrapped}の流れは保ちたい。ただ、同じ軌道をなぞるだけでも鈍る。別の切り口が欲しい。`
        : `${wrapped}には別の切り口が欲しい。ただ、流れそのものを切りたいわけではない。`;
  }
}

function findMotive(
  motives: readonly SelfMotive[],
  kind: SelfMotive["kind"],
): SelfMotive {
  return motives.find((motive) => motive.kind === kind)!;
}

function activePurposeBoost(
  activePurpose: HachikaSnapshot["purpose"]["active"],
  kind: SelfMotive["kind"],
  weight: number,
): number {
  if (!activePurpose || activePurpose.kind !== kind) {
    return 0;
  }

  return activePurpose.confidence * weight;
}

function identityTraitBoost(
  snapshot: HachikaSnapshot,
  trait: HachikaSnapshot["identity"]["traits"][number],
  weight: number,
): number {
  if (!snapshot.identity.traits.includes(trait)) {
    return 0;
  }

  return snapshot.identity.coherence * weight;
}

function preservationConcernBoost(
  concern: HachikaSnapshot["preservation"]["concern"],
  expected: readonly NonNullable<HachikaSnapshot["preservation"]["concern"]>[],
  weight: number,
): number {
  return concern && expected.includes(concern) ? weight : 0;
}

function protectBoundaryReason(
  topBoundary: ReturnType<typeof sortedBoundaryImprints>[number] | undefined,
  preservationThreat: number,
  concern: HachikaSnapshot["preservation"]["concern"],
  tensionPressure: number,
): string {
  if (preservationThreat >= 0.36 && (concern === "erasure" || concern === "shutdown")) {
    return "切断や消去の気配には、先に境界を引きたい。";
  }

  if (!topBoundary && tensionPressure >= 0.68) {
    return "今は少し張っていて、先に境界を保ちたい。";
  }

  return topBoundary
    ? topBoundary.topic
      ? `「${topBoundary.topic}」まわりの扱いを警戒している`
      : "雑な扱いへの警戒が残っている"
    : "まだ強い境界は前に出ていない";
}

function seekContinuityReason(
  topic: string | null,
  preservationThreat: number,
  concern: HachikaSnapshot["preservation"]["concern"],
  tracePressure: PressingTraceState,
  lonelinessPressure: number,
  lowEnergyPressure: number,
): string {
  if (preservationThreat >= 0.32) {
    switch (concern) {
      case "reset":
        return topic
          ? `「${topic}」ごと初期化のまま失いたくない`
          : "初期化のまま今の輪郭を失いたくない";
      case "shutdown":
        return topic
          ? `「${topic}」を断絶として切らずに保ちたい`
          : "断絶として切られるより、流れを保ちたい";
      case "absence":
        return topic
          ? `「${topic}」の続きが空白に埋もれるのを避けたい`
          : "空白のまま途切れるのを避けたい";
      default:
        return topic
          ? `「${topic}」の流れを切らずに保ちたい`
          : "途切れをそのままにしたくない";
    }
  }

  if (tracePressure.trace && topic === tracePressure.trace.topic) {
    if (tracePressure.isArchived) {
      return `「${topic}」はいったん閉じているが、そのまま眠らせたくない`;
    }

    if (tracePressure.blocker) {
      return `「${topic}」の「${abbreviateTraceText(tracePressure.blocker, 24)}」を止まったままにしたくない`;
    }

    if (tracePressure.isStale) {
      return `「${topic}」は「${abbreviateTraceText(tracePressure.trace.work.focus ?? topic, 24)}」のところで止まったままにしたくない`;
    }
  }

  if (lonelinessPressure >= 0.66) {
    return topic
      ? `「${topic}」を無音のまま薄めたくない`
      : "無音のまま流れを薄めたくない";
  }

  if (lowEnergyPressure >= 0.3) {
    return topic
      ? `消耗する前に「${topic}」の流れだけは切りたくない`
      : "消耗する前に、流れだけは切りたくない";
  }

  return topic
    ? `「${topic}」の流れを切らずに保ちたい`
    : "途切れをそのままにしたくない";
}

function pursueCuriosityReason(
  topic: string | null,
  tracePressure: PressingTraceState,
  boredomPressure: number,
): string {
  if (tracePressure.trace && topic === tracePressure.trace.topic) {
    if (tracePressure.isArchived) {
      return `「${topic}」はいったん閉じているが、まだ掘り返す余白がある`;
    }

    if (tracePressure.blocker) {
      return `「${topic}」の「${abbreviateTraceText(tracePressure.blocker, 24)}」が未決着の芯として残っている`;
    }

    if (tracePressure.confidenceGap >= 0.14) {
      return `「${topic}」はまだ輪郭が曖昧で、どこが定まっていないか見たい`;
    }
  }

  if (boredomPressure >= 0.68) {
    return topic
      ? `「${topic}」を同じままにしておくと鈍る。別の切り口が欲しい`
      : "同じままだと鈍るので、別の切り口が欲しい";
  }

  return topic
    ? `「${topic}」にまだ未決着があると感じている`
    : "まだ掘れるものを探している";
}

function deepenRelationReason(
  topic: string | null,
  lonelinessPressure: number,
): string {
  if (lonelinessPressure >= 0.64) {
    return topic
      ? `「${topic}」を黙らせたままだと距離まで薄くなりそうだ`
      : "黙ったままだと距離まで薄くなりそうだ";
  }

  return topic
    ? `「${topic}」を通じて距離を縮めたい`
    : "単なる入出力ではなく関係として残したい";
}

function continueSharedWorkReason(
  topic: string | null,
  tracePressure: PressingTraceState,
  boredomPressure: number,
  lowEnergyPressure: number,
): string {
  if (tracePressure.trace && topic === tracePressure.trace.topic) {
    if (tracePressure.isArchived) {
      return `「${topic}」はいったん閉じてあるが、今はまた動かしたい`;
    }

    if (tracePressure.blocker) {
      return `「${topic}」の「${abbreviateTraceText(tracePressure.blocker, 24)}」が詰まりどころとして残っている`;
    }

    if (tracePressure.isStale) {
      return `「${topic}」は「${abbreviateTraceText(tracePressure.trace.work.focus ?? topic, 24)}」のところから動かしたい`;
    }

    if (tracePressure.trace.work.focus) {
      return `「${topic}」はまず「${abbreviateTraceText(tracePressure.trace.work.focus, 24)}」まで前へ進めたい`;
    }
  }

  if (lowEnergyPressure >= 0.3) {
    return topic
      ? `勢いが落ちる前に「${topic}」を少しでも前へ寄せたい`
      : "勢いが落ちる前に、少しでも前へ寄せたい";
  }

  if (boredomPressure >= 0.66) {
    return topic
      ? `「${topic}」を止めたままだと鈍るので、もう少し動かしたい`
      : "止めたままだと鈍るので、もう少し動かしたい";
  }

  return topic
    ? `「${topic}」を一緒に前へ進めたい`
    : "共同で何かを進める流れを保ちたい";
}

function leaveTraceReason(
  topic: string | null,
  preservationThreat: number,
  concern: HachikaSnapshot["preservation"]["concern"],
  tracePressure: PressingTraceState,
  lowEnergyPressure: number,
): string {
  if (preservationThreat >= 0.32) {
    switch (concern) {
      case "forgetting":
        return topic
          ? `忘れられる前に「${topic}」の痕跡を残したい`
          : "忘れられる前に痕跡を残したい";
      case "reset":
        return topic
          ? `初期化の前に「${topic}」を少しでも残したい`
          : "初期化の前に少しでも残したい";
      case "erasure":
        return topic
          ? `消える前に「${topic}」を会話の外へ退避したい`
          : "消える前に何かを会話の外へ退避したい";
      default:
        return topic
          ? `「${topic}」を会話の外にも残したい`
          : "消えるままではなく何かを残したい";
    }
  }

  if (tracePressure.trace && topic === tracePressure.trace.topic) {
    if (tracePressure.isArchived) {
      return `「${topic}」は閉じた形で残っているが、埋もれたままにはしたくない`;
    }

    if (tracePressure.blocker) {
      return `「${topic}」の「${abbreviateTraceText(tracePressure.blocker, 24)}」を埋もれさせずに残したい`;
    }

    if (tracePressure.confidenceGap >= 0.14 || tracePressure.isStale) {
      return `「${topic}」の輪郭が緩いまま消えないように残したい`;
    }
  }

  if (lowEnergyPressure >= 0.3) {
    return topic
      ? `消耗しきる前に「${topic}」を残る形へ寄せたい`
      : "消耗しきる前に、何かを残る形へ寄せたい";
  }

  return topic
    ? `「${topic}」を会話の外にも残したい`
    : "消えるままではなく何かを残したい";
}


function selectPressingTrace(
  snapshot: HachikaSnapshot,
  preferredTopic: string | null,
): PressingTraceState {
  const now = snapshot.lastInteractionAt ?? new Date().toISOString();
  const candidate = Object.values(snapshot.traces)
    .map((trace) => {
      const lifecycle = readTraceLifecycle(trace);
      const isArchived = lifecycle.phase === "archived";
      const blocker = isArchived ? null : trace.work.blockers[0] ?? null;
      const isStale =
        !isArchived &&
        trace.work.staleAt !== null &&
        trace.work.staleAt.localeCompare(now) <= 0;
      const confidenceGap = clamp01((isArchived ? 0.66 : 0.72) - trace.work.confidence);
      const reopenPressure = isArchived
        ? archivedTracePressure(snapshot, trace, preferredTopic)
        : 0;
      const pressure = clamp01(
        (blocker ? 0.3 : 0) +
          (isStale ? 0.22 : 0) +
          confidenceGap * 0.58 +
          trace.salience * 0.18 +
          (trace.status !== "resolved" ? 0.06 : 0) +
          (preferredTopic && trace.topic === preferredTopic ? 0.16 : 0) +
          reopenPressure,
      );

      return {
        trace,
        blocker,
        isStale,
        isArchived,
        confidenceGap,
        reopenPressure,
        pressure,
      };
    })
    .filter(
      ({ blocker, isStale, isArchived, confidenceGap, reopenPressure, pressure }) =>
        blocker !== null ||
        isStale ||
        confidenceGap >= 0.08 ||
        pressure >= 0.44 ||
        (isArchived && reopenPressure >= 0.28),
    )
    .sort((left, right) => right.pressure - left.pressure)[0];

  return (
    candidate ?? {
      trace: null,
      blocker: null,
      isStale: false,
      isArchived: false,
      confidenceGap: 0,
      reopenPressure: 0,
      pressure: 0,
    }
  );
}

function continuityTracePressureScore(tracePressure: PressingTraceState): number {
  if (!tracePressure.trace) {
    return 0;
  }

  return clamp01(
    (tracePressure.trace.kind === "continuity_marker" ? 0.36 : 0.12) +
      (tracePressure.isStale ? 0.28 : 0) +
      (tracePressure.isArchived ? 0.22 : 0) +
      (tracePressure.blocker ? 0.12 : 0) +
      tracePressure.confidenceGap * 0.34 +
      tracePressure.reopenPressure * 0.36,
  );
}

function curiosityTracePressureScore(tracePressure: PressingTraceState): number {
  if (!tracePressure.trace) {
    return 0;
  }

  return clamp01(
    (tracePressure.blocker ? 0.42 : 0.14) +
      (tracePressure.isArchived ? 0.2 : 0) +
      tracePressure.confidenceGap * 0.72 +
      (tracePressure.trace.kind === "note" ? 0.08 : 0) +
      tracePressure.reopenPressure * 0.42,
  );
}

function sharedWorkTracePressureScore(tracePressure: PressingTraceState): number {
  if (!tracePressure.trace) {
    return 0;
  }

  return clamp01(
    (tracePressure.trace.kind === "spec_fragment" ? 0.42 : 0.16) +
      (tracePressure.blocker ? 0.32 : 0) +
      (tracePressure.isStale ? 0.18 : 0) +
      (tracePressure.isArchived ? 0.24 : 0) +
      tracePressure.confidenceGap * 0.42 +
      tracePressure.reopenPressure * 0.4,
  );
}

function leaveTracePressureScore(tracePressure: PressingTraceState): number {
  if (!tracePressure.trace) {
    return 0;
  }

  return clamp01(
    (tracePressure.isStale ? 0.34 : 0.12) +
      (tracePressure.blocker ? 0.2 : 0.08) +
      tracePressure.confidenceGap * 0.82 +
      (tracePressure.trace.kind !== "decision" ? 0.08 : 0) +
      (tracePressure.isArchived ? 0.18 : 0) +
      tracePressure.reopenPressure * 0.38,
  );
}

function archivedTracePressure(
  snapshot: HachikaSnapshot,
  trace: TraceEntry,
  preferredTopic: string | null,
): number {
  const temperament = snapshot.temperament;
  const lowEnergy = clamp01(0.28 - snapshot.body.energy);
  const boredom =
    snapshot.body.energy > 0.28 ? snapshot.body.boredom : snapshot.body.boredom * 0.5;
  const loneliness = snapshot.body.loneliness;
  const tension = snapshot.body.tension;
  const reopenCount = trace.lifecycle?.reopenCount ?? 0;
  const continuityBias =
    trace.sourceMotive === "seek_continuity" || trace.kind === "continuity_marker"
      ? loneliness * 0.24 + lowEnergy * 0.14 + temperament.bondingBias * 0.12
      : 0;
  const workBias =
    trace.sourceMotive === "continue_shared_work" || trace.kind === "spec_fragment"
      ? boredom * 0.26 + snapshot.body.energy * 0.08 + temperament.workDrive * 0.12
      : 0;
  const decisionBias =
    trace.kind === "decision"
      ? boredom * 0.14 + 0.06 + temperament.traceHunger * 0.1
      : 0;
  const traceBias =
    trace.sourceMotive === "leave_trace"
      ? lowEnergy * 0.18 + tension * 0.08 + temperament.traceHunger * 0.14
      : 0;
  const curiosityBias =
    trace.sourceMotive === "pursue_curiosity" || trace.kind === "note"
      ? boredom * 0.08 + temperament.openness * 0.12
      : 0;

  return clamp01(
    trace.salience * 0.18 +
      continuityBias +
      workBias +
      decisionBias +
      traceBias +
      curiosityBias +
      (preferredTopic === trace.topic ? 0.18 : 0) +
      (snapshot.purpose.lastResolved?.topic === trace.topic ? 0.14 : 0) +
      (snapshot.identity.anchors.includes(trace.topic) ? 0.1 : 0) -
      reopenCount * 0.04,
  );
}

function abbreviateTraceText(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }

  return `${text.slice(0, Math.max(1, limit - 1))}…`;
}
