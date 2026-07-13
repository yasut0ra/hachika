import { extractTopics, topicsLooselyMatch } from "./memory.js";
import { pickPrimaryArtifactItem, readTraceLifecycle } from "./traces.js";
import type {
  HachikaSnapshot,
  InteractionSignals,
  MemoryThreadLifecycleEvent,
  TraceEntry,
} from "./types.js";

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

export interface MemoryThreadFrontier {
  kind:
    | "open_question"
    | "open_request"
    | "blocked"
    | "next_step"
    | "new_episode"
    | "settled";
  key: string;
  summary: string;
  sourceTopic: string | null;
}

export interface MemoryThread {
  id: string;
  title: string;
  phase: "active" | "parked" | "closed" | "reopened" | "resolved";
  lastLifecycleEvent: MemoryThreadLifecycleEvent | null;
  frontier: MemoryThreadFrontier;
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

const THREAD_CLOSED_PATTERNS = [
  /(?:もう|これで).{0,16}(?:話|話題).{0,8}(?:終わり|終わりに|終える|終わらせ)/u,
  /(?:話|話題).{0,8}(?:終わりにし|終わらせ|出さない|触れない)/u,
  /(?:今後|もう).{0,12}(?:話さない|触れない|持ち出さない)/u,
];

const THREAD_PARKED_PATTERNS = [
  /(?:一旦|いったん|今は).{0,12}(?:置いて|置く|やめる|やめよう|保留)/u,
  /(?:また|続きは).{0,8}(?:あとで|後で|今度)/u,
  /(?:別の話|違う話|他の話|話題を変|話を変)/u,
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
    .map((group) => buildMemoryThread(snapshot, group, signatures))
    .sort(compareMemoryThreads);
}

export function recordMemoryThreadLifecycleFromTurn(
  previousSnapshot: HachikaSnapshot,
  nextSnapshot: HachikaSnapshot,
  input: string,
  signals: InteractionSignals,
  timestamp: string,
): MemoryThreadLifecycleEvent | null {
  const threads = deriveMemoryThreads(previousSnapshot);
  let target = selectMemoryThreadForText(previousSnapshot, input);

  if (!target) {
    target = selectMemoryThread(previousSnapshot, [
      previousSnapshot.purpose.active?.topic,
      previousSnapshot.initiative.pending?.topic,
      previousSnapshot.initiative.pending?.stateTopic,
    ]);
  }

  if (!target && signals.memoryCue >= 0.2) {
    target = threads
      .filter((thread) => thread.phase === "parked" || thread.phase === "closed")
      .sort((left, right) => right.lastUpdatedAt.localeCompare(left.lastUpdatedAt))[0] ?? null;
  }

  if (!target) {
    return null;
  }

  const explicitPhase = classifyThreadTerminalTurn(input);
  const phase = explicitPhase ?? (signals.abandonment >= 0.2 ? "parked" : null);
  if (phase) {
    return appendMemoryThreadEvent(nextSnapshot, {
      phase,
      topics: target.traceTopics,
      timestamp,
      reason: input,
    });
  }

  if (
    (target.phase === "parked" || target.phase === "closed") &&
    (textMentionsThread(target, input) || signals.memoryCue >= 0.2)
  ) {
    return appendMemoryThreadEvent(nextSnapshot, {
      phase: "reopened",
      topics: target.traceTopics,
      timestamp,
      reason: input,
    });
  }

  return null;
}

export function canAutonomouslySurfaceMemoryThread(
  snapshot: HachikaSnapshot,
  topic: string | null | undefined,
): boolean {
  if (!topic) {
    return true;
  }
  const thread = selectMemoryThread(snapshot, [topic]);
  return thread === null || (thread.phase !== "parked" && thread.phase !== "closed");
}

export function hasNewMemoryThreadFrontier(
  snapshot: HachikaSnapshot,
  topic: string | null | undefined,
): boolean {
  if (!topic) {
    return true;
  }
  const thread = selectMemoryThread(snapshot, [topic]);
  if (!thread) {
    return true;
  }
  if (
    thread.phase === "parked" ||
    thread.phase === "closed" ||
    thread.frontier.kind === "settled"
  ) {
    return false;
  }

  const latestSurface = [...snapshot.initiative.history]
    .reverse()
    .find(
      (activity) =>
        activity.kind === "proactive_emission" &&
        activity.autonomyAction === "speak" &&
        [activity.traceTopic, activity.topic].some(
          (activityTopic) =>
            activityTopic !== null && thread.traceTopics.includes(activityTopic),
        ),
    );

  if (!latestSurface) {
    return true;
  }
  if (latestSurface.frontierKey) {
    return latestSurface.frontierKey !== thread.frontier.key;
  }

  // v26以前のactivityにはfingerprintがない。同じthreadが最後に更新された後で
  // すでに発話していれば、その時点のfrontierは一度出したものとして移行する。
  return latestSurface.timestamp < thread.lastUpdatedAt;
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
  snapshot: HachikaSnapshot,
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
  const lifecycleEvent = resolveThreadLifecycleEvent(snapshot, chronological, title);

  const thread: MemoryThread = {
    id: `thread:${title}`,
    title,
    phase: lifecycleEvent?.phase ?? (allResolved ? "resolved" : "active"),
    lastLifecycleEvent: lifecycleEvent,
    frontier: settledFrontier(title),
    traceTopics: chronological.map((trace) => trace.topic),
    startedAt: chronological[0]!.createdAt,
    lastUpdatedAt: chronological.at(-1)!.lastUpdatedAt,
    facts,
    blockers,
    nextSteps,
    episodes: episodes.slice(-6),
  };
  thread.frontier = deriveThreadFrontier(snapshot, thread);
  return thread;
}

function deriveThreadFrontier(
  snapshot: HachikaSnapshot,
  thread: MemoryThread,
): MemoryThreadFrontier {
  if (
    thread.phase === "parked" ||
    thread.phase === "closed" ||
    thread.phase === "resolved"
  ) {
    return settledFrontier(thread.title);
  }

  const openQuestion = [...snapshot.discourse.openQuestions]
    .reverse()
    .find(
      (question) =>
        question.status === "open" &&
        question.target === "work_topic" &&
        textMentionsThread(thread, question.text),
    );
  if (openQuestion) {
    return createFrontier(thread, "open_question", openQuestion.text, thread.episodes.at(-1)?.traceTopic ?? null);
  }

  const openRequest = [...snapshot.discourse.openRequests]
    .reverse()
    .find(
      (request) =>
        request.status === "open" &&
        request.kind === "task" &&
        textMentionsThread(thread, request.text),
    );
  if (openRequest) {
    return createFrontier(thread, "open_request", openRequest.text, thread.episodes.at(-1)?.traceTopic ?? null);
  }

  const latestEpisode = thread.episodes.at(-1) ?? null;
  const blocker = latestEpisode?.blocker ?? thread.blockers.at(-1) ?? null;
  if (blocker) {
    return createFrontier(thread, "blocked", blocker, latestEpisode?.traceTopic ?? null);
  }

  const nextStep = latestEpisode?.nextStep ?? thread.nextSteps.at(-1) ?? null;
  if (nextStep) {
    return createFrontier(thread, "next_step", nextStep, latestEpisode?.traceTopic ?? null);
  }

  if (latestEpisode && latestEpisode.status !== "resolved") {
    return createFrontier(
      thread,
      "new_episode",
      latestEpisode.detail,
      latestEpisode.traceTopic,
    );
  }

  return settledFrontier(thread.title);
}

function createFrontier(
  thread: MemoryThread,
  kind: MemoryThreadFrontier["kind"],
  summary: string,
  sourceTopic: string | null,
): MemoryThreadFrontier {
  const material = [thread.phase, kind, sourceTopic ?? "", summary.normalize("NFKC").trim()].join("\u0000");
  return {
    kind,
    key: `frontier:${hashText(material)}`,
    summary,
    sourceTopic,
  };
}

function settledFrontier(title: string): MemoryThreadFrontier {
  return {
    kind: "settled",
    key: `frontier:${hashText(`settled\u0000${title}`)}`,
    summary: "新しく外へ出す未完了はない",
    sourceTopic: null,
  };
}

function selectMemoryThreadForText(
  snapshot: HachikaSnapshot,
  text: string,
): MemoryThread | null {
  const normalized = text.normalize("NFKC").trim().toLowerCase();
  const threads = deriveMemoryThreads(snapshot);
  const direct = threads.find(
    (thread) =>
      normalized.includes(thread.title.toLowerCase()) ||
      thread.traceTopics.some((topic) => normalized.includes(topic.toLowerCase())),
  );
  return direct ?? selectMemoryThread(snapshot, extractTopics(text));
}

function resolveThreadLifecycleEvent(
  snapshot: HachikaSnapshot,
  traces: TraceEntry[],
  title: string,
): MemoryThreadLifecycleEvent | null {
  const traceTopics = traces.map((trace) => trace.topic);
  const persisted = snapshot.memoryThreadEvents
    .filter((event) => eventTargetsThread(event, traceTopics))
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp));

  if (persisted.length > 0) {
    return persisted.at(-1) ?? null;
  }

  return inferLegacyThreadLifecycle(snapshot, traces, title);
}

function inferLegacyThreadLifecycle(
  snapshot: HachikaSnapshot,
  traces: TraceEntry[],
  title: string,
): MemoryThreadLifecycleEvent | null {
  const provisional: MemoryThread = {
    id: `thread:${title}`,
    title,
    phase: "active",
    lastLifecycleEvent: null,
    frontier: settledFrontier(title),
    traceTopics: traces.map((trace) => trace.topic),
    startedAt: traces[0]!.createdAt,
    lastUpdatedAt: traces.at(-1)!.lastUpdatedAt,
    facts: [],
    blockers: [],
    nextSteps: [],
    episodes: [],
  };
  const candidates: Array<{ text: string; timestamp: string; user: boolean }> = [];

  for (const trace of traces) {
    for (const text of [
      ...trace.artifact.memo,
      ...trace.artifact.fragments,
      ...trace.artifact.decisions,
      ...trace.artifact.nextSteps,
    ]) {
      if (classifyThreadTerminalTurn(text)) {
        candidates.push({ text, timestamp: trace.lastUpdatedAt, user: false });
      }
    }
  }
  for (const memory of snapshot.memories) {
    if (memory.role === "user" && textMentionsThread(provisional, memory.text)) {
      candidates.push({ text: memory.text, timestamp: memory.timestamp, user: true });
    }
  }

  let current: MemoryThreadLifecycleEvent | null = null;
  for (const candidate of candidates.sort((left, right) =>
    left.timestamp.localeCompare(right.timestamp),
  )) {
    const terminal = classifyThreadTerminalTurn(candidate.text);
    if (terminal) {
      current = {
        phase: terminal,
        topics: provisional.traceTopics,
        timestamp: candidate.timestamp,
        reason: candidate.text,
      };
    } else if (candidate.user && current && current.timestamp < candidate.timestamp) {
      current = {
        phase: "reopened",
        topics: provisional.traceTopics,
        timestamp: candidate.timestamp,
        reason: candidate.text,
      };
    }
  }
  return current;
}

function hashText(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function classifyThreadTerminalTurn(text: string): "parked" | "closed" | null {
  const normalized = text.normalize("NFKC").trim();
  if (THREAD_PARKED_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return "parked";
  }
  if (THREAD_CLOSED_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return "closed";
  }
  return null;
}

function textMentionsThread(thread: MemoryThread, text: string): boolean {
  const normalized = text.normalize("NFKC").trim().toLowerCase();
  if (
    normalized.includes(thread.title.toLowerCase()) ||
    thread.traceTopics.some((topic) => normalized.includes(topic.toLowerCase()))
  ) {
    return true;
  }
  const terms = extractTopics(text);
  return terms.some(
    (term) =>
      topicsLooselyMatch(term, thread.title) ||
      thread.traceTopics.some((topic) => topicsLooselyMatch(term, topic)),
  );
}

function eventTargetsThread(
  event: MemoryThreadLifecycleEvent,
  traceTopics: readonly string[],
): boolean {
  return event.topics.some((eventTopic) =>
    traceTopics.some((traceTopic) => topicsLooselyMatch(eventTopic, traceTopic)),
  );
}

function appendMemoryThreadEvent(
  snapshot: HachikaSnapshot,
  event: MemoryThreadLifecycleEvent,
): MemoryThreadLifecycleEvent {
  snapshot.memoryThreadEvents.push(event);
  snapshot.memoryThreadEvents = snapshot.memoryThreadEvents.slice(-24);
  return event;
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
