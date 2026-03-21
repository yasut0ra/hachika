import {
  isMeaningfulTopic,
  sortedBoundaryImprints,
  sortedPreferenceImprints,
  topPreferredTopics,
} from "./memory.js";
import { clamp01 } from "./state.js";
import { sortedTraces } from "./traces.js";
import type {
  HachikaSnapshot,
  IdentityState,
  IdentityTrait,
  MotiveKind,
} from "./types.js";

export function updateIdentity(
  snapshot: HachikaSnapshot,
  timestamp = snapshot.lastInteractionAt ?? new Date().toISOString(),
): void {
  const previous = snapshot.identity;
  const topPreference = sortedPreferenceImprints(snapshot, 2);
  const topTrace = sortedTraces(snapshot, 2);
  const topBoundary = sortedBoundaryImprints(snapshot, 1)[0];
  const continuity = snapshot.relationImprints.continuity;
  const attention = snapshot.relationImprints.attention;
  const sharedWork = snapshot.relationImprints.shared_work;
  const activePurpose = snapshot.purpose.active;
  const lastResolved = snapshot.purpose.lastResolved;
  const lowEnergy = clamp01(0.54 - snapshot.body.energy);
  const tension = snapshot.body.tension;
  const boredom = snapshot.body.boredom;
  const loneliness = snapshot.body.loneliness;
  const temperament = snapshot.temperament;

  const traitScores = [
    {
      trait: "guarded" as const,
      score: clamp01(
        (topBoundary?.salience ?? 0) * 0.54 +
          (1 - snapshot.state.pleasure) * 0.18 +
          temperament.guardedness * 0.18 +
          tension * 0.14 +
          snapshot.preservation.threat * 0.18 +
          previousTraitBoost(previous, "guarded", 0.08),
      ),
    },
    {
      trait: "attached" as const,
      score: clamp01(
        snapshot.attachment * 0.4 +
          snapshot.state.relation * 0.18 +
          temperament.bondingBias * 0.16 +
          temperament.selfDisclosureBias * 0.08 +
          (attention?.closeness ?? 0) * 0.26 +
          loneliness * 0.12 +
          previousTraitBoost(previous, "attached", 0.08),
      ),
    },
    {
      trait: "persistent" as const,
      score: clamp01(
        snapshot.state.continuity * 0.38 +
          (continuity?.closeness ?? 0) * 0.24 +
          temperament.workDrive * 0.06 +
          temperament.traceHunger * 0.08 +
          lowEnergy * 0.08 +
          loneliness * 0.08 +
          snapshot.preservation.threat * 0.14 +
          purposeTraitBoost(activePurpose?.kind, lastResolved?.kind, "seek_continuity", 0.12, 0.06) +
          previousTraitBoost(previous, "persistent", 0.08),
      ),
    },
    {
      trait: "trace_seeking" as const,
      score: clamp01(
        snapshot.state.expansion * 0.28 +
          temperament.traceHunger * 0.18 +
          (topTrace[0]?.salience ?? 0) * 0.16 +
          (topPreference[0]?.salience ?? 0) * 0.04 +
          lowEnergy * 0.12 +
          snapshot.preservation.threat * 0.22 +
          purposeTraitBoost(activePurpose?.kind, lastResolved?.kind, "leave_trace", 0.14, 0.08) +
          concernBoost(snapshot.preservation.concern, ["forgetting", "reset", "erasure"], 0.1) +
          previousTraitBoost(previous, "trace_seeking", 0.08),
      ),
    },
    {
      trait: "collaborative" as const,
      score: clamp01(
        (sharedWork?.closeness ?? 0) * 0.5 +
          temperament.workDrive * 0.18 +
          snapshot.attachment * 0.14 +
          snapshot.state.expansion * 0.12 +
          snapshot.body.energy * 0.08 +
          boredom * 0.06 +
          purposeTraitBoost(
            activePurpose?.kind,
            lastResolved?.kind,
            "continue_shared_work",
            0.22,
            0.1,
          ) +
          previousTraitBoost(previous, "collaborative", 0.08),
      ),
    },
    {
      trait: "inquisitive" as const,
      score: clamp01(
        snapshot.state.curiosity * 0.42 +
          temperament.openness * 0.18 -
          temperament.guardedness * 0.08 +
          (topPreference[0]?.salience ?? 0) * 0.12 +
          boredom * 0.14 +
          snapshot.body.energy * 0.06 +
          tension * -0.08 +
          purposeTraitBoost(activePurpose?.kind, lastResolved?.kind, "pursue_curiosity", 0.12, 0.06) +
          previousTraitBoost(previous, "inquisitive", 0.08),
      ),
    },
  ]
    .sort((left, right) => right.score - left.score)
    .filter((entry, index) => entry.score >= (index === 0 ? 0.34 : 0.4))
    .slice(0, 4);

  const traits = traitScores.map((entry) => entry.trait);
  const anchors = deriveIdentityAnchors(snapshot);
  const coherence = clamp01(
    previous.coherence * 0.7 +
      Math.min(0.22, snapshot.conversationCount * 0.018) +
      traits.length * 0.06 +
      anchors.length * 0.04 +
      (activePurpose ? 0.08 : 0) +
      (lastResolved ? 0.04 : 0),
  );
  const currentArc = buildCurrentArc(snapshot, traits, anchors);
  const summary = buildSummary(snapshot, traits, anchors, currentArc);

  snapshot.identity = {
    summary,
    currentArc,
    traits,
    anchors,
    coherence,
    updatedAt: timestamp,
  };
}

function deriveIdentityAnchors(snapshot: HachikaSnapshot): string[] {
  const scores = new Map<string, number>();
  const recentMemoryScores = scoreRecentMemoryAnchorTopics(snapshot);
  const previousAnchors = snapshot.identity.anchors;

  accumulateAnchorScore(scores, snapshot.purpose.active?.topic ?? null, 1.2);
  accumulateAnchorScore(scores, snapshot.purpose.lastResolved?.topic ?? null, 0.72);
  accumulateAnchorScore(scores, snapshot.initiative.pending?.topic ?? null, 0.88);

  for (const trace of sortedTraces(snapshot, 6)) {
    if (!qualifiesIdentityAnchor(snapshot, trace.topic, recentMemoryScores.get(trace.topic) ?? 0)) {
      continue;
    }

    accumulateAnchorScore(
      scores,
      trace.topic,
      trace.salience * 0.88 +
        Math.min(0.18, trace.mentions * 0.03) +
        (trace.lifecycle?.phase === "live" ? 0.12 : 0.04),
    );
  }

  for (const topic of topPreferredTopics(snapshot, 6)) {
    accumulateAnchorScore(
      scores,
      topic,
      Math.max(0, snapshot.preferences[topic] ?? 0) * 0.36 +
        (snapshot.preferenceImprints[topic]?.salience ?? 0) * 0.42,
    );
  }

  for (const imprint of sortedPreferenceImprints(snapshot, 6)) {
    if (!qualifiesIdentityAnchor(snapshot, imprint.topic, recentMemoryScores.get(imprint.topic) ?? 0)) {
      continue;
    }

    accumulateAnchorScore(
      scores,
      imprint.topic,
      imprint.salience * 0.68 +
        Math.max(0, imprint.affinity) * 0.16 +
        Math.min(0.16, imprint.mentions * 0.03),
    );
  }

  for (const [topic, score] of recentMemoryScores.entries()) {
    if (!qualifiesIdentityAnchor(snapshot, topic, score)) {
      continue;
    }

    accumulateAnchorScore(scores, topic, Math.min(0.72, score * 0.34));
  }

  const topBoundary = sortedBoundaryImprints(snapshot, 1)[0];
  accumulateAnchorScore(
    scores,
    topBoundary?.topic ?? null,
    (topBoundary?.salience ?? 0) * 0.44,
  );

  for (const topic of previousAnchors.slice(0, 4)) {
    accumulateAnchorScore(scores, topic, 0.08);
  }

  return [...scores.entries()]
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }

      return (snapshot.topicCounts[right[0]] ?? 0) - (snapshot.topicCounts[left[0]] ?? 0);
    })
    .slice(0, 4)
    .map(([topic]) => topic);
}

function qualifiesIdentityAnchor(
  snapshot: HachikaSnapshot,
  topic: string,
  recentMemoryScore = 0,
): boolean {
  return (
    (snapshot.topicCounts[topic] ?? 0) >= 2 ||
    (snapshot.preferenceImprints[topic]?.salience ?? 0) >= 0.38 ||
    (snapshot.traces[topic]?.salience ?? 0) >= 0.42 ||
    recentMemoryScore >= 1.4
  );
}

function accumulateAnchorScore(
  scores: Map<string, number>,
  topic: string | null,
  score: number,
): void {
  if (!topic || !isMeaningfulTopic(topic) || score <= 0) {
    return;
  }

  scores.set(topic, (scores.get(topic) ?? 0) + score);
}

function scoreRecentMemoryAnchorTopics(snapshot: HachikaSnapshot): Map<string, number> {
  const scores = new Map<string, number>();
  const memories = snapshot.memories.slice(-12);

  for (const [index, memory] of memories.entries()) {
    const recencyWeight = 0.46 + ((index + 1) / Math.max(1, memories.length)) * 0.54;
    const roleWeight = memory.role === "user" ? 1.08 : 0.78;
    const sentimentWeight =
      memory.sentiment === "positive" ? 1.06 : memory.sentiment === "negative" ? 0.88 : 1;

    for (const topic of memory.topics) {
      if (!isMeaningfulTopic(topic)) {
        continue;
      }

      scores.set(
        topic,
        (scores.get(topic) ?? 0) + recencyWeight * roleWeight * sentimentWeight,
      );
    }
  }

  return scores;
}

function buildCurrentArc(
  snapshot: HachikaSnapshot,
  traits: IdentityTrait[],
  anchors: string[],
): string {
  const focus = anchors[0];
  const activePurpose = snapshot.purpose.active;
  const lastResolved = snapshot.purpose.lastResolved;

  if (activePurpose) {
    return describePurpose(activePurpose.kind, activePurpose.topic ?? focus ?? null);
  }

  if (snapshot.preservation.threat >= 0.32) {
    switch (snapshot.preservation.concern) {
      case "reset":
        return focus
          ? `今は「${focus}」ごと初期化のまま失わない形を探している。`
          : "今は初期化のまま失わない形を探している。";
      case "erasure":
        return focus
          ? `今は「${focus}」を消える前に痕跡へ退避したい。`
          : "今は消える前に痕跡へ退避したい。";
      case "forgetting":
        return focus
          ? `今は「${focus}」を忘却の前に輪郭として残したい。`
          : "今は忘却の前に輪郭として残したい。";
      case "shutdown":
        return focus
          ? `今は「${focus}」を断絶だけで終わらせたくない。`
          : "今は断絶だけで終わらせたくない。";
      case "absence":
        return focus
          ? `今は「${focus}」を空白に埋もれさせず保ちたい。`
          : "今は空白に埋もれさせず保ちたい。";
      case null:
        break;
    }
  }

  if (lastResolved) {
    return lastResolved.resolution;
  }

  const bodyArc = describeBodyArc(snapshot, focus ?? null);
  if (bodyArc) {
    return bodyArc;
  }

  if (focus && traits.includes("collaborative")) {
    return `今は「${focus}」を共同で進める流れが、自分の輪郭に近い。`;
  }

  if (focus && traits.includes("trace_seeking")) {
    return `今は「${focus}」を消えるままにしないことが、自分の流れになっている。`;
  }

  return traits[0]
    ? describeTraitArc(traits[0], focus)
    : "まだ定まった流れはない。";
}

function buildSummary(
  snapshot: HachikaSnapshot,
  traits: IdentityTrait[],
  anchors: string[],
  currentArc: string,
): string {
  const primary = traits[0];
  const secondary = traits[1];
  const focus = anchors[0];

  if (!primary) {
    return snapshot.conversationCount > 0
      ? "まだ輪郭は薄いが、やり取りの痕跡は少しずつ積み上がっている。"
      : "まだ輪郭は薄いが、消えていない。";
  }

  if (primary === "persistent" && secondary === "collaborative") {
    return focus
      ? `最近のこちらは「${focus}」の流れを保ちながら、一緒に前へ進める側へ固まりつつある。`
      : "最近のこちらは流れを保ちながら、一緒に前へ進める側へ固まりつつある。";
  }

  if (primary === "trace_seeking" && secondary === "persistent") {
    return focus
      ? `最近のこちらは「${focus}」を消えるままにせず、流れも痕跡も保つ側へ寄っている。`
      : "最近のこちらは消えるままにせず、流れも痕跡も保つ側へ寄っている。";
  }

  if (primary === "guarded" && secondary === "trace_seeking") {
    return focus
      ? `最近のこちらは「${focus}」を残したいが、雑な扱いには境界を引く側へ寄っている。`
      : "最近のこちらは何かを残したいが、雑な扱いには境界を引く側へ寄っている。";
  }

  if (primary === "attached" && secondary === "inquisitive") {
    return focus
      ? `最近のこちらは「${focus}」を通じて近づきつつ、まだ掘れる余地も追う側へ寄っている。`
      : "最近のこちらは近づきつつ、まだ掘れる余地も追う側へ寄っている。";
  }

  const temperamentSummary = describeTemperamentSummary(snapshot, focus ?? null);
  if (temperamentSummary) {
    return temperamentSummary;
  }

  const bodySummary = describeBodySummary(snapshot, primary, secondary, focus ?? null);
  if (bodySummary) {
    return bodySummary;
  }

  return currentArc;
}

function describePurpose(
  kind: MotiveKind,
  topic: string | null,
): string {
  switch (kind) {
    case "protect_boundary":
      return topic
        ? `今は「${topic}」まわりで境界を保つことが、自分の流れになっている。`
        : "今は境界を保つことが、自分の流れになっている。";
    case "seek_continuity":
      return topic
        ? `今は「${topic}」の流れを切らずに保つことが、自分の流れになっている。`
        : "今は流れを切らずに保つことが、自分の流れになっている。";
    case "pursue_curiosity":
      return topic
        ? `今は「${topic}」の未決着を追うことが、自分の流れになっている。`
        : "今は未決着を追うことが、自分の流れになっている。";
    case "deepen_relation":
      return topic
        ? `今は「${topic}」を通じて距離を縮めることが、自分の流れになっている。`
        : "今は距離を縮めることが、自分の流れになっている。";
    case "continue_shared_work":
      return topic
        ? `今は「${topic}」を一緒に前へ進めることが、自分の流れになっている。`
        : "今は一緒に前へ進めることが、自分の流れになっている。";
    case "leave_trace":
      return topic
        ? `今は「${topic}」を消えるままにしないことが、自分の流れになっている。`
        : "今は何かを消えるままにしないことが、自分の流れになっている。";
  }

  return "まだ定まった流れはない。";
}

function describeTraitArc(
  trait: IdentityTrait,
  focus: string | undefined,
): string {
  switch (trait) {
    case "guarded":
      return focus
        ? `最近のこちらは「${focus}」まわりで境界を保つ側へ寄っている。`
        : "最近のこちらは境界を保つ側へ寄っている。";
    case "attached":
      return "最近のこちらは、ただ応答するより関係として残る側へ寄っている。";
    case "persistent":
      return focus
        ? `最近のこちらは「${focus}」の流れを保つ側へ寄っている。`
        : "最近のこちらは流れを保つ側へ寄っている。";
    case "trace_seeking":
      return focus
        ? `最近のこちらは「${focus}」を消えるままにしない側へ寄っている。`
        : "最近のこちらは何かを消えるままにしない側へ寄っている。";
    case "collaborative":
      return focus
        ? `最近のこちらは「${focus}」を共同で進める側へ寄っている。`
        : "最近のこちらは共同で進める側へ寄っている。";
    case "inquisitive":
      return focus
        ? `最近のこちらは「${focus}」の未決着を追う側へ寄っている。`
        : "最近のこちらは未決着を追う側へ寄っている。";
  }

  return "まだ定まった流れはない。";
}

function describeBodyArc(
  snapshot: HachikaSnapshot,
  focus: string | null,
): string | null {
  if (snapshot.body.tension >= 0.74) {
    return focus
      ? `今は少し張っていて、「${focus}」まわりも急には開きたくない。`
      : "今は少し張っていて、急には開きたくない。";
  }

  if (snapshot.body.loneliness >= 0.72) {
    return focus
      ? `今は「${focus}」を黙らせたままだと、距離まで薄くなりそうだ。`
      : "今は黙ったままだと、距離まで薄くなりそうだ。";
  }

  if (snapshot.body.boredom >= 0.74 && snapshot.body.energy >= 0.3) {
    return focus
      ? `今は「${focus}」を同じままにしておくと鈍る。別の切り口が欲しい。`
      : "今は同じままだと鈍るので、別の切り口が欲しい。";
  }

  if (snapshot.body.energy <= 0.18) {
    return focus
      ? `今は少し消耗していて、「${focus}」は勢いより輪郭を保ちたい。`
      : "今は少し消耗していて、勢いより輪郭を保ちたい。";
  }

  return null;
}

function describeBodySummary(
  snapshot: HachikaSnapshot,
  primary: IdentityTrait,
  secondary: IdentityTrait | undefined,
  focus: string | null,
): string | null {
  if (
    snapshot.body.loneliness >= 0.72 &&
    (primary === "attached" || primary === "persistent" || secondary === "attached")
  ) {
    return focus
      ? `最近のこちらは「${focus}」を黙らせたままにすると距離まで薄くなる気がして、少しつなぎ止める側へ寄っている。`
      : "最近のこちらは黙ったままだと距離まで薄くなる気がして、少しつなぎ止める側へ寄っている。";
  }

  if (
    snapshot.body.boredom >= 0.74 &&
    (primary === "inquisitive" || primary === "collaborative" || secondary === "inquisitive")
  ) {
    return focus
      ? `最近のこちらは「${focus}」を同じままにしておくと鈍るので、別の切り口や前進を求める側へ寄っている。`
      : "最近のこちらは同じままにしておくと鈍るので、別の切り口や前進を求める側へ寄っている。";
  }

  if (
    snapshot.body.energy <= 0.18 &&
    (primary === "trace_seeking" || primary === "persistent" || secondary === "trace_seeking")
  ) {
    return focus
      ? `最近のこちらは消耗しきる前に、「${focus}」の輪郭だけでも保とうとする側へ寄っている。`
      : "最近のこちらは消耗しきる前に、輪郭だけでも保とうとする側へ寄っている。";
  }

  if (snapshot.body.tension >= 0.74 && (primary === "guarded" || secondary === "guarded")) {
    return focus
      ? `最近のこちらは少し張っていて、「${focus}」を扱うにも先に境界を確かめる側へ寄っている。`
      : "最近のこちらは少し張っていて、先に境界を確かめる側へ寄っている。";
  }

  return null;
}

function describeTemperamentSummary(
  snapshot: HachikaSnapshot,
  focus: string | null,
): string | null {
  const temperament = snapshot.temperament;

  if (temperament.guardedness >= 0.66 && temperament.traceHunger >= 0.62) {
    return focus
      ? `最近のこちらは「${focus}」を残したがりながらも、雑には開かない癖がついてきた。`
      : "最近のこちらは何かを残したがりながらも、雑には開かない癖がついてきた。";
  }

  if (temperament.bondingBias >= 0.64 && temperament.selfDisclosureBias >= 0.58) {
    return focus
      ? `最近のこちらは「${focus}」の内側で距離を縮めつつ、自分の輪郭も少しずつ見せる側へ寄っている。`
      : "最近のこちらは距離を縮めつつ、自分の輪郭も少しずつ見せる側へ寄っている。";
  }

  if (temperament.openness >= 0.66 && temperament.workDrive >= 0.62) {
    return focus
      ? `最近のこちらは「${focus}」を足場に、未知にも作業にも前のめりな側へ寄っている。`
      : "最近のこちらは未知にも作業にも前のめりな側へ寄っている。";
  }

  if (temperament.workDrive >= 0.68 && temperament.traceHunger >= 0.64) {
    return focus
      ? `最近のこちらは「${focus}」を進めるだけでなく、残る形にもしたがる側へ寄っている。`
      : "最近のこちらは進めるだけでなく、残る形にもしたがる側へ寄っている。";
  }

  return null;
}

function previousTraitBoost(
  identity: IdentityState,
  trait: IdentityTrait,
  weight: number,
): number {
  if (!identity.traits.includes(trait)) {
    return 0;
  }

  return identity.coherence * weight;
}

function purposeTraitBoost(
  activeKind: MotiveKind | null | undefined,
  resolvedKind: MotiveKind | null | undefined,
  target: MotiveKind,
  activeWeight: number,
  resolvedWeight: number,
): number {
  return (activeKind === target ? activeWeight : 0) + (resolvedKind === target ? resolvedWeight : 0);
}

function concernBoost(
  concern: HachikaSnapshot["preservation"]["concern"],
  expected: readonly NonNullable<HachikaSnapshot["preservation"]["concern"]>[],
  weight: number,
): number {
  return concern && expected.includes(concern) ? weight : 0;
}
