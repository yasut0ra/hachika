import { openingSignature, recentAssistantOpenings } from "./expression.js";
import { topicsLooselyMatch } from "./memory.js";
import type { HachikaSnapshot } from "./types.js";

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
