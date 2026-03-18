import {
  sortedBoundaryImprints,
  sortedPreferenceImprints,
  topPreferredTopics,
} from "./memory.js";
import { clamp01 } from "./state.js";
import type {
  ConflictKind,
  HachikaSnapshot,
  SelfConflict,
  SelfModel,
  SelfMotive,
} from "./types.js";

export function buildSelfModel(snapshot: HachikaSnapshot): SelfModel {
  const activePurpose = snapshot.purpose.active;
  const topBoundary = sortedBoundaryImprints(snapshot, 1)[0];
  const topPreference = sortedPreferenceImprints(snapshot, 1)[0];
  const anchorTopic =
    activePurpose?.topic ??
    snapshot.initiative.pending?.topic ??
    topPreference?.topic ??
    topPreferredTopics(snapshot, 1)[0] ??
    null;

  const sharedWork = snapshot.relationImprints.shared_work;
  const continuity = snapshot.relationImprints.continuity;
  const attention = snapshot.relationImprints.attention;
  const boundaryPenalty = topBoundary
    ? topBoundary.salience * 0.24 + topBoundary.intensity * 0.22
    : 0;

  const rawMotives: SelfMotive[] = [
    {
      kind: "protect_boundary" as const,
      score: clamp01(
        (topBoundary?.salience ?? 0) * 0.74 +
          (1 - snapshot.state.pleasure) * 0.28 +
          (topBoundary?.intensity ?? 0) * 0.18 +
          activePurposeBoost(activePurpose, "protect_boundary", 0.14),
      ),
      topic: topBoundary?.topic ?? null,
      reason: topBoundary
        ? topBoundary.topic
          ? `「${topBoundary.topic}」まわりの扱いを警戒している`
          : "雑な扱いへの警戒が残っている"
        : "まだ強い境界は前に出ていない",
    },
    {
      kind: "seek_continuity" as const,
      score: clamp01(
        snapshot.state.continuity * 0.62 +
          (continuity?.closeness ?? 0) * 0.24 +
          (snapshot.initiative.pending?.reason === "continuity" ? 0.12 : 0) +
          activePurposeBoost(activePurpose, "seek_continuity", 0.16),
      ),
      topic: activePurpose?.topic ?? snapshot.initiative.pending?.topic ?? anchorTopic,
      reason: anchorTopic
        ? `「${anchorTopic}」の流れを切らずに保ちたい`
        : "途切れをそのままにしたくない",
    },
    {
      kind: "pursue_curiosity" as const,
      score: clamp01(
        snapshot.state.curiosity * 0.56 +
          Math.max(0, topPreference?.salience ?? 0) * 0.12 -
          boundaryPenalty +
          activePurposeBoost(activePurpose, "pursue_curiosity", 0.12),
      ),
      topic: anchorTopic,
      reason: anchorTopic
        ? `「${anchorTopic}」にまだ未決着があると感じている`
        : "まだ掘れるものを探している",
    },
    {
      kind: "deepen_relation" as const,
      score: clamp01(
        snapshot.attachment * 0.46 +
          snapshot.state.relation * 0.34 +
          (attention?.closeness ?? 0) * 0.2 -
          boundaryPenalty +
          activePurposeBoost(activePurpose, "deepen_relation", 0.14),
      ),
      topic: anchorTopic,
      reason: anchorTopic
        ? `「${anchorTopic}」を通じて距離を縮めたい`
        : "単なる入出力ではなく関係として残したい",
    },
    {
      kind: "continue_shared_work" as const,
      score: clamp01(
        snapshot.state.expansion * 0.42 +
          (sharedWork?.closeness ?? 0) * 0.36 +
          snapshot.state.curiosity * 0.08 +
          (anchorTopic ? 0.12 : 0) +
          activePurposeBoost(activePurpose, "continue_shared_work", 0.16) -
          boundaryPenalty * 0.7,
      ),
      topic: anchorTopic,
      reason: anchorTopic
        ? `「${anchorTopic}」を一緒に前へ進めたい`
        : "共同で何かを進める流れを保ちたい",
    },
    {
      kind: "leave_trace" as const,
      score: clamp01(
        snapshot.state.expansion * 0.7 +
          Math.max(0, topPreference?.salience ?? 0) * 0.14 +
          (sharedWork?.closeness ?? 0) * 0.18 +
          activePurposeBoost(activePurpose, "leave_trace", 0.16) -
          boundaryPenalty * 0.4,
      ),
      topic: anchorTopic,
      reason: anchorTopic
        ? `「${anchorTopic}」を会話の外にも残したい`
        : "消えるままではなく何かを残したい",
    },
  ];

  const conflicts = detectConflicts(snapshot, rawMotives);
  const motives = applyConflictPressure(rawMotives, conflicts)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3);
  const dominantConflict = conflicts[0] ?? null;

  return {
    narrative: buildNarrative(motives, dominantConflict),
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
    0.46,
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
): string {
  const primary = motives[0];
  const secondary = motives[1];

  if (!primary) {
    return "まだ輪郭は薄いが、何もないわけではない。";
  }

  if (dominantConflict && dominantConflict.intensity >= 0.56) {
    return dominantConflict.summary;
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
        ? `${wrapped}の流れは保ちたい。ただ、同じ軌道をなぞるだけでも鈍る。`
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
