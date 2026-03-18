import {
  sortedBoundaryImprints,
  sortedPreferenceImprints,
  topPreferredTopics,
} from "./memory.js";
import { clamp01 } from "./state.js";
import type { HachikaSnapshot, SelfModel, SelfMotive } from "./types.js";

export function buildSelfModel(snapshot: HachikaSnapshot): SelfModel {
  const topBoundary = sortedBoundaryImprints(snapshot, 1)[0];
  const topPreference = sortedPreferenceImprints(snapshot, 1)[0];
  const anchorTopic =
    snapshot.initiative.pending?.topic ??
    topPreference?.topic ??
    topPreferredTopics(snapshot, 1)[0] ??
    null;

  const sharedWork = snapshot.relationImprints.shared_work;
  const continuity = snapshot.relationImprints.continuity;
  const attention = snapshot.relationImprints.attention;
  const boundaryPenalty = topBoundary ? topBoundary.intensity * 0.35 : 0;

  const motives: SelfMotive[] = [
    {
      kind: "protect_boundary" as const,
      score: clamp01(
        (topBoundary?.salience ?? 0) * 0.74 +
          (1 - snapshot.state.pleasure) * 0.28 +
          (topBoundary?.intensity ?? 0) * 0.18,
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
          (snapshot.initiative.pending?.reason === "continuity" ? 0.12 : 0),
      ),
      topic: snapshot.initiative.pending?.topic ?? anchorTopic,
      reason: anchorTopic
        ? `「${anchorTopic}」の流れを切らずに保ちたい`
        : "途切れをそのままにしたくない",
    },
    {
      kind: "pursue_curiosity" as const,
      score: clamp01(
        snapshot.state.curiosity * 0.56 +
          Math.max(0, topPreference?.salience ?? 0) * 0.12 -
          boundaryPenalty,
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
          boundaryPenalty,
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
          (anchorTopic ? 0.12 : 0),
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
          (sharedWork?.closeness ?? 0) * 0.18,
      ),
      topic: anchorTopic,
      reason: anchorTopic
        ? `「${anchorTopic}」を会話の外にも残したい`
        : "消えるままではなく何かを残したい",
    },
  ]
    .sort((left, right) => right.score - left.score)
    .slice(0, 3);

  return {
    narrative: buildNarrative(motives),
    topMotives: motives,
  };
}

function buildNarrative(motives: SelfMotive[]): string {
  const primary = motives[0];
  const secondary = motives[1];

  if (!primary) {
    return "まだ輪郭は薄いが、何もないわけではない。";
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
