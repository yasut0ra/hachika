import { openingSignature, recentAssistantOpenings } from "./expression.js";
import { topicsLooselyMatch } from "./memory.js";
import type { GenerationHistoryEntry, HachikaSnapshot } from "./types.js";

const segmenter = new Intl.Segmenter("ja", { granularity: "word" });

const ABSTRACT_TERMS = new Set([
  "境界",
  "静けさ",
  "流れ",
  "輪郭",
  "向き",
  "気配",
  "距離",
  "温度",
  "感じ",
  "扱い",
  "内面",
  "関係",
  "痕跡",
  "存在",
  "世界",
  "目的",
  "手触り",
  "足場",
  "内側",
  "外側",
  "あり方",
]);

const CONCRETE_TERMS = new Set([
  "threshold",
  "studio",
  "archive",
  "棚",
  "机",
  "灯り",
  "ランプ",
  "desk",
  "shelf",
  "lamp",
  "責務",
  "未定",
  "曖昧",
  "仕様",
  "設計",
  "断片",
  "nextstep",
]);

export interface GeneratedTextQuality {
  fallbackOverlap: number;
  openerEcho: boolean;
  abstractTermRatio: number;
  concreteDetailScore: number;
  focusMentioned: boolean | null;
  summary: string;
}

export interface RecentGenerationQualitySummary {
  count: number;
  fallbackRate: number;
  overlap: number;
  abstractRatio: number;
  concreteDetail: number;
  openerEchoRate: number;
  focusMentionRate: number | null;
  styleNotes: string[];
}

export interface GenerationRetryDecision {
  shouldRetry: boolean;
  notes: string[];
}

export function evaluateGeneratedTextQuality(options: {
  text: string;
  fallbackText: string;
  previousSnapshot: HachikaSnapshot;
  primaryFocus?: string | null;
}): GeneratedTextQuality {
  const textTokens = tokenize(options.text);
  const fallbackTokens = tokenize(options.fallbackText);
  const textSet = new Set(textTokens);
  const fallbackSet = new Set(fallbackTokens);
  const overlapCount = [...textSet].filter((token) => fallbackSet.has(token)).length;
  const overlapBase = Math.max(1, fallbackSet.size);
  const fallbackOverlap = roundQuality(overlapCount / overlapBase);
  const openerEcho = recentAssistantOpenings(options.previousSnapshot, 3).includes(
    openingSignature(options.text),
  );
  const abstractCount = textTokens.filter((token) => ABSTRACT_TERMS.has(token)).length;
  const abstractTermRatio = roundQuality(
    textTokens.length === 0 ? 0 : abstractCount / textTokens.length,
  );
  const concreteCount = textTokens.filter((token) => CONCRETE_TERMS.has(token)).length;
  const quotedCount = (options.text.match(/「[^」]+」/g) ?? []).length;
  const concreteDetailScore = roundQuality(
    Math.min(1, concreteCount * 0.22 + quotedCount * 0.18),
  );
  const focusMentioned =
    options.primaryFocus && options.primaryFocus.trim().length > 0
      ? options.text.includes(options.primaryFocus) ||
        textTokens.some((token) => topicsLooselyMatch(token, options.primaryFocus))
      : null;

  return {
    fallbackOverlap,
    openerEcho,
    abstractTermRatio,
    concreteDetailScore,
    focusMentioned,
    summary: [
      `overlap:${fallbackOverlap.toFixed(2)}`,
      `abstract:${abstractTermRatio.toFixed(2)}`,
      `concrete:${concreteDetailScore.toFixed(2)}`,
      `echo:${openerEcho ? "yes" : "no"}`,
      focusMentioned === null ? "focus:n/a" : `focus:${focusMentioned ? "yes" : "no"}`,
    ].join(" "),
  };
}

export function summarizeRecentGenerationQuality(
  snapshot: HachikaSnapshot,
  limit = 6,
): RecentGenerationQualitySummary {
  const history = snapshot.generationHistory.slice(-Math.max(1, limit));
  const focusSamples = history.filter((entry) => entry.focusMentioned !== null);
  const fallbackRate = averageHistoryMetric(history, (entry) => (entry.fallbackUsed ? 1 : 0));
  const overlap = averageHistoryMetric(history, (entry) => entry.fallbackOverlap);
  const abstractRatio = averageHistoryMetric(history, (entry) => entry.abstractTermRatio);
  const concreteDetail = averageHistoryMetric(history, (entry) => entry.concreteDetailScore);
  const openerEchoRate = averageHistoryMetric(history, (entry) => (entry.openerEcho ? 1 : 0));
  const focusMentionRate =
    focusSamples.length === 0
      ? null
      : averageHistoryMetric(focusSamples, (entry) => (entry.focusMentioned ? 1 : 0));

  return {
    count: history.length,
    fallbackRate,
    overlap,
    abstractRatio,
    concreteDetail,
    openerEchoRate,
    focusMentionRate,
    styleNotes: deriveHistoryStyleNotes({
      count: history.length,
      fallbackRate,
      overlap,
      abstractRatio,
      concreteDetail,
      openerEchoRate,
      focusMentionRate,
    }),
  };
}

export function scoreGeneratedTextQuality(
  quality: GeneratedTextQuality,
): number {
  const focusScore =
    quality.focusMentioned === null ? 0.11 : quality.focusMentioned ? 0.11 : 0;
  const openerScore = quality.openerEcho ? 0 : 0.11;

  return roundQuality(
    (1 - quality.fallbackOverlap) * 0.28 +
      (1 - quality.abstractTermRatio) * 0.22 +
      quality.concreteDetailScore * 0.28 +
      focusScore +
      openerScore,
  );
}

export function decideGenerationRetry(options: {
  quality: GeneratedTextQuality;
  primaryFocus?: string | null;
  mode: "reply" | "proactive";
  socialTurn?: boolean;
}): GenerationRetryDecision {
  const notes: string[] = [];
  const { quality } = options;

  if (quality.fallbackOverlap >= 0.72) {
    notes.push("前回は fallback の構文に寄りすぎたので、今回は文の骨格を組み直す");
  }

  if (quality.openerEcho) {
    notes.push("前回と出だしが近いので、今回は切り出しを変える");
  }

  if (quality.abstractTermRatio >= 0.18 && quality.concreteDetailScore <= 0.28) {
    notes.push("前回は抽象的すぎたので、今回は場所・物・作業・次の一歩のどれかを一つ具体的に入れる");
  }

  if (
    options.primaryFocus &&
    quality.focusMentioned === false &&
    !options.socialTurn
  ) {
    notes.push("primary focus は一度だけ自然に明示する");
  }

  if (
    options.socialTurn &&
    quality.abstractTermRatio >= 0.14 &&
    quality.concreteDetailScore <= 0.24
  ) {
    notes.push("社会的な返答では抽象的な自己説明より、近づき方や温度を具体的に言う");
  }

  if (options.mode === "proactive" && quality.concreteDetailScore <= 0.22) {
    notes.push("能動発話では動機か場所か対象を一つ具体的に入れる");
  }

  return {
    shouldRetry: notes.length > 0,
    notes,
  };
}

function tokenize(text: string): string[] {
  return [...segmenter.segment(text)]
    .filter((segment) => segment.isWordLike)
    .map((segment) => normalizeToken(segment.segment))
    .filter((token): token is string => Boolean(token));
}

function normalizeToken(token: string): string | null {
  const normalized = token.normalize("NFKC").trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  if (normalized.length === 1 && !/[a-z0-9]/.test(normalized)) {
    return null;
  }

  return normalized;
}

function roundQuality(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function averageHistoryMetric(
  entries: GenerationHistoryEntry[],
  read: (entry: GenerationHistoryEntry) => number,
): number {
  if (entries.length === 0) {
    return 0;
  }

  return roundQuality(entries.reduce((sum, entry) => sum + read(entry), 0) / entries.length);
}

function deriveHistoryStyleNotes(
  summary: Omit<RecentGenerationQualitySummary, "styleNotes">,
): string[] {
  if (summary.count === 0) {
    return [];
  }

  const notes: string[] = [];

  if (summary.overlap >= 0.58 || summary.fallbackRate >= 0.45) {
    notes.push("最近は fallback 依存が強いので、今回は構文を借りすぎない");
  }

  if (summary.abstractRatio >= 0.16) {
    notes.push("最近は抽象語が多いので、場所・物・作業・次の一歩のどれかを具体的に入れる");
  }

  if (summary.concreteDetail <= 0.26) {
    notes.push("今回は固有の対象か具体的な断片を一つ以上入れる");
  }

  if (summary.openerEchoRate >= 0.34) {
    notes.push("出だしは最近の言い回しから少し外す");
  }

  if (summary.focusMentionRate !== null && summary.focusMentionRate < 0.6) {
    notes.push("primary focus は一度だけでも明示する");
  }

  return notes;
}
