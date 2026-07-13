import { extractTopics, topicsLooselyMatch } from "./memory.js";
import { pickPrimaryArtifactItem, readTraceLifecycle } from "./traces.js";
import type { HachikaSnapshot, TraceEntry } from "./types.js";

export interface MemoryThreadEpisode {
  traceTopic: string;
  kind: TraceEntry["kind"];
  status: TraceEntry["status"];
  lifecycle: "live" | "archived";
  detail: string;
  blocker: string | null;
  nextStep: string | null;
  updatedAt: string;
}

export interface MemoryThread {
  id: string;
  title: string;
  phase: "active" | "resolved";
  traceTopics: string[];
  startedAt: string;
  lastUpdatedAt: string;
  facts: string[];
  blockers: string[];
  nextSteps: string[];
  episodes: MemoryThreadEpisode[];
}

const THREAD_GENERIC_TERMS = new Set([
  "参加",
  "予定",
  "決定",
  "決定済み",
  "一区切り",
  "週間",
  "長期",
  "社目",
  "結果",
  "評価",
  "改善",
  "業務",
  "関連",
  "具体化",
]);

const THREAD_BOILERPLATE = [
  /次に触れられる形へ整える/u,
  /もう少し具体化する/u,
  /続きの目印として残/u,
  /前進用の断片として残/u,
  /前のやり取りからひとまとまり/u,
];

export function deriveMemoryThreads(snapshot: HachikaSnapshot): MemoryThread[] {
  const traces = Object.values(snapshot.traces);

  if (traces.length === 0) {
    return [];
  }

  const signatures = new Map(
    traces.map((trace) => [trace.topic, buildTraceSignature(trace)]),
  );
  const cooccurringPairs = collectMemoryTopicPairs(snapshot);
  const parents = traces.map((_, index) => index);

  for (let left = 0; left < traces.length; left += 1) {
    for (let right = left + 1; right < traces.length; right += 1) {
      if (
        tracesBelongToSameThread(
          traces[left]!,
          traces[right]!,
          signatures,
          cooccurringPairs,
        )
      ) {
        union(parents, left, right);
      }
    }
  }

  const groups = new Map<number, TraceEntry[]>();
  traces.forEach((trace, index) => {
    const root = find(parents, index);
    groups.set(root, [...(groups.get(root) ?? []), trace]);
  });

  return [...groups.values()]
    .map((group) => buildMemoryThread(group, signatures))
    .sort(compareMemoryThreads);
}

export function selectMemoryThread(
  snapshot: HachikaSnapshot,
  topics: readonly (string | null | undefined)[],
): MemoryThread | null {
  const focusTopics = unique(
    topics
      .map((topic) => topic?.normalize("NFKC").trim() ?? "")
      .filter((topic) => topic.length > 0),
  );

  if (focusTopics.length === 0) {
    return null;
  }

  const threads = deriveMemoryThreads(snapshot);
  return threads
    .map((thread) => ({
      thread,
      score: scoreThreadMatch(thread, focusTopics),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score)[0]?.thread ?? null;
}

function tracesBelongToSameThread(
  left: TraceEntry,
  right: TraceEntry,
  signatures: Map<string, Set<string>>,
  cooccurringPairs: Set<string>,
): boolean {
  if (topicsLooselyMatch(left.topic, right.topic)) {
    return true;
  }

  if (cooccurringPairs.has(pairKey(left.topic, right.topic))) {
    return true;
  }

  const leftText = traceText(left);
  const rightText = traceText(right);
  if (leftText.includes(right.topic) || rightText.includes(left.topic)) {
    return true;
  }

  const leftTerms = signatures.get(left.topic) ?? new Set<string>();
  const rightTerms = signatures.get(right.topic) ?? new Set<string>();
  const shared = [...leftTerms].filter((term) => rightTerms.has(term));

  return (
    shared.some((term) => term.length >= 4 && !THREAD_GENERIC_TERMS.has(term)) ||
    shared.filter((term) => term.length >= 2 && !THREAD_GENERIC_TERMS.has(term)).length >= 2
  );
}

function buildMemoryThread(
  traces: TraceEntry[],
  signatures: Map<string, Set<string>>,
): MemoryThread {
  const chronological = [...traces].sort(
    (left, right) => left.lastUpdatedAt.localeCompare(right.lastUpdatedAt),
  );
  const title = chooseThreadTitle(chronological, signatures);
  const episodes = chronological.map(buildEpisode);
  const settledFacts = unique(
    chronological
      .flatMap((trace) => trace.artifact.decisions)
      .filter(isUsefulThreadText),
  ).slice(-4);
  const recentFacts = unique(
    chronological.flatMap((trace) => [
      ...trace.artifact.fragments,
      ...trace.artifact.memo,
    ]).filter(isUsefulThreadText),
  )
    .filter((fact) => !settledFacts.includes(fact))
    .slice(-(8 - settledFacts.length));
  const facts = [...settledFacts, ...recentFacts];
  const blockers = unique(
    chronological.flatMap((trace) => trace.work.blockers).filter(isUsefulThreadText),
  ).slice(-4);
  const nextSteps = unique(
    chronological
      .flatMap((trace) => trace.artifact.nextSteps)
      .filter(isUsefulThreadText),
  ).slice(-4);
  const allResolved = chronological.every(
    (trace) => trace.status === "resolved" || readTraceLifecycle(trace).phase === "archived",
  );

  return {
    id: `thread:${title}`,
    title,
    phase: allResolved ? "resolved" : "active",
    traceTopics: chronological.map((trace) => trace.topic),
    startedAt: chronological[0]!.createdAt,
    lastUpdatedAt: chronological.at(-1)!.lastUpdatedAt,
    facts,
    blockers,
    nextSteps,
    episodes: episodes.slice(-6),
  };
}

function buildEpisode(trace: TraceEntry): MemoryThreadEpisode {
  const detail =
    collectTraceFacts(trace).at(-1) ??
    pickPrimaryArtifactItem(trace) ??
    trace.summary;

  return {
    traceTopic: trace.topic,
    kind: trace.kind,
    status: trace.status,
    lifecycle: readTraceLifecycle(trace).phase,
    detail,
    blocker: trace.work.blockers.find(isUsefulThreadText) ?? null,
    nextStep: trace.artifact.nextSteps.find(isUsefulThreadText) ?? null,
    updatedAt: trace.lastUpdatedAt,
  };
}

function chooseThreadTitle(
  traces: TraceEntry[],
  signatures: Map<string, Set<string>>,
): string {
  if (traces.length === 1) {
    return traces[0]!.topic;
  }

  const counts = new Map<string, number>();
  for (const trace of traces) {
    for (const term of signatures.get(trace.topic) ?? []) {
      if (term.length < 2 || THREAD_GENERIC_TERMS.has(term)) {
        continue;
      }
      counts.set(term, (counts.get(term) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([term, count]) => ({
      term,
      score: count * 2 + Math.min(6, term.length) * 0.12,
    }))
    .sort((left, right) => right.score - left.score || left.term.localeCompare(right.term))[0]
    ?.term ?? traces.at(-1)!.topic;
}

function buildTraceSignature(trace: TraceEntry): Set<string> {
  const fields = [
    trace.topic,
    ...trace.artifact.memo,
    ...trace.artifact.fragments,
    ...trace.artifact.decisions,
    ...trace.artifact.nextSteps,
    ...trace.work.blockers,
  ];
  return new Set(
    fields
      .flatMap((field) => extractTopics(field))
      .map((term) => term.normalize("NFKC").trim().toLowerCase())
      .filter((term) => term.length >= 2),
  );
}

function collectMemoryTopicPairs(snapshot: HachikaSnapshot): Set<string> {
  const pairs = new Set<string>();
  for (const memory of snapshot.memories) {
    const topics = unique(memory.topics.filter((topic) => snapshot.traces[topic]));
    for (let left = 0; left < topics.length; left += 1) {
      for (let right = left + 1; right < topics.length; right += 1) {
        pairs.add(pairKey(topics[left]!, topics[right]!));
      }
    }
  }
  return pairs;
}

function collectTraceFacts(trace: TraceEntry): string[] {
  return unique([
    ...trace.artifact.decisions,
    ...trace.artifact.fragments,
    ...trace.artifact.memo,
  ].filter(isUsefulThreadText));
}

function scoreThreadMatch(thread: MemoryThread, focusTopics: string[]): number {
  let score = 0;
  for (const focus of focusTopics) {
    if (thread.traceTopics.includes(focus)) {
      score = Math.max(score, 4);
      continue;
    }
    if (topicsLooselyMatch(thread.title, focus)) {
      score = Math.max(score, 2.5);
    }
    if (thread.traceTopics.some((topic) => topicsLooselyMatch(topic, focus))) {
      score = Math.max(score, 2);
    }
  }
  return score > 0
    ? score + Math.min(0.5, thread.traceTopics.length * 0.04)
    : 0;
}

function compareMemoryThreads(left: MemoryThread, right: MemoryThread): number {
  if (left.phase !== right.phase) {
    return left.phase === "active" ? -1 : 1;
  }
  if (left.traceTopics.length !== right.traceTopics.length) {
    return right.traceTopics.length - left.traceTopics.length;
  }
  return right.lastUpdatedAt.localeCompare(left.lastUpdatedAt);
}

function traceText(trace: TraceEntry): string {
  return [
    trace.topic,
    trace.summary,
    ...trace.artifact.memo,
    ...trace.artifact.fragments,
    ...trace.artifact.decisions,
    ...trace.artifact.nextSteps,
    ...trace.work.blockers,
  ].join("\n");
}

function isUsefulThreadText(value: string): boolean {
  const normalized = value.normalize("NFKC").trim();
  return normalized.length >= 4 && !THREAD_BOILERPLATE.some((pattern) => pattern.test(normalized));
}

function pairKey(left: string, right: string): string {
  return [left, right].sort().join("\u0000");
}

function find(parents: number[], index: number): number {
  if (parents[index] !== index) {
    parents[index] = find(parents, parents[index]!);
  }
  return parents[index]!;
}

function union(parents: number[], left: number, right: number): void {
  const leftRoot = find(parents, left);
  const rightRoot = find(parents, right);
  if (leftRoot !== rightRoot) {
    parents[rightRoot] = leftRoot;
  }
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items));
}
