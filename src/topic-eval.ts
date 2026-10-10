import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// 話題抽出の評価: 合成した発話と正解の話題から precision / recall を測る。
// 除外リストを勘で足すのではなく、変更のたびに数字で比べるための土台
export interface TopicEvalCase {
  text: string;
  topics: string[];
  acceptable?: string[];
}

export interface TopicEvalSet {
  turns: TopicEvalCase[];
  meaningful: string[];
  notMeaningful: string[];
}

export interface TopicEvalCaseResult {
  text: string;
  predicted: string[];
  missing: string[];
  unexpected: string[];
}

export interface TopicEvalScore {
  precision: number;
  recall: number;
  f1: number;
  predictedCount: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  cases: TopicEvalCaseResult[];
}

export interface TopicJudgementScore {
  accuracy: number;
  wronglyAccepted: string[];
  wronglyRejected: string[];
}

export function loadTopicEvalSet(
  filePath = fileURLToPath(new URL("./fixtures/topic-eval.json", import.meta.url)),
): TopicEvalSet {
  return JSON.parse(readFileSync(filePath, "utf8")) as TopicEvalSet;
}

export function evaluateTopicExtraction(
  cases: readonly TopicEvalCase[],
  extract: (text: string) => string[],
): TopicEvalScore {
  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  let predictedCount = 0;
  const results: TopicEvalCaseResult[] = [];

  for (const evalCase of cases) {
    const predicted = unique(extract(evalCase.text).map(normalizeEvalTopic));
    const gold = new Set(evalCase.topics.map(normalizeEvalTopic));
    const acceptable = new Set((evalCase.acceptable ?? []).map(normalizeEvalTopic));
    const unexpected = predicted.filter((topic) => !gold.has(topic) && !acceptable.has(topic));
    const missing = [...gold].filter((topic) => !predicted.includes(topic));
    const matched = predicted.filter((topic) => gold.has(topic)).length;

    // acceptable は正解でも誤りでもないので precision の分母から外す
    predictedCount += matched + unexpected.length;
    truePositives += matched;
    falsePositives += unexpected.length;
    falseNegatives += missing.length;
    results.push({ text: evalCase.text, predicted, missing, unexpected });
  }

  const precision = ratio(truePositives, truePositives + falsePositives);
  const recall = ratio(truePositives, truePositives + falseNegatives);

  return {
    precision,
    recall,
    f1: precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall),
    predictedCount,
    truePositives,
    falsePositives,
    falseNegatives,
    cases: results,
  };
}

export function evaluateTopicJudgement(
  set: Pick<TopicEvalSet, "meaningful" | "notMeaningful">,
  isMeaningful: (topic: string) => boolean,
): TopicJudgementScore {
  const wronglyRejected = set.meaningful.filter((topic) => !isMeaningful(topic));
  const wronglyAccepted = set.notMeaningful.filter((topic) => isMeaningful(topic));
  const total = set.meaningful.length + set.notMeaningful.length;

  return {
    accuracy: ratio(total - wronglyRejected.length - wronglyAccepted.length, total),
    wronglyAccepted,
    wronglyRejected,
  };
}

export function formatTopicEvalReport(
  score: TopicEvalScore,
  judgement: TopicJudgementScore,
): string {
  const lines = [
    `extraction  precision ${formatRatio(score.precision)}  recall ${formatRatio(score.recall)}  f1 ${formatRatio(score.f1)}`,
    `            tp ${score.truePositives}  fp ${score.falsePositives}  fn ${score.falseNegatives}`,
    `judgement   accuracy ${formatRatio(judgement.accuracy)}`,
  ];

  if (judgement.wronglyAccepted.length > 0) {
    lines.push(`            accepted noise: ${judgement.wronglyAccepted.join(", ")}`);
  }

  if (judgement.wronglyRejected.length > 0) {
    lines.push(`            rejected topics: ${judgement.wronglyRejected.join(", ")}`);
  }

  const misses = score.cases.filter(
    (result) => result.missing.length > 0 || result.unexpected.length > 0,
  );

  if (misses.length > 0) {
    lines.push("", "cases with errors:");
    for (const result of misses) {
      const parts = [
        result.unexpected.length > 0 ? `noise: ${result.unexpected.join(", ")}` : null,
        result.missing.length > 0 ? `missed: ${result.missing.join(", ")}` : null,
      ].filter((part): part is string => part !== null);
      lines.push(`- ${result.text.replaceAll("\n", " ")}  →  ${parts.join(" / ")}`);
    }
  }

  return lines.join("\n");
}

function normalizeEvalTopic(topic: string): string {
  return topic.normalize("NFKC").trim().toLowerCase();
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

function formatRatio(value: number): string {
  return value.toFixed(3);
}
