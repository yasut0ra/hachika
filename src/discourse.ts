import { extractTopics, isMeaningfulTopic, topicsLooselyMatch } from "./memory.js";
import type {
  DiscourseCommitment,
  DiscourseCommitmentEvidence,
  DiscourseOpenQuestion,
  DiscourseOpenRequest,
  HachikaSnapshot,
  InteractionSignals,
  TraceEntry,
} from "./types.js";

export function reconcileDiscourseCommitments(
  existing: readonly DiscourseCommitment[],
  questions: readonly DiscourseOpenQuestion[],
  requests: readonly DiscourseOpenRequest[],
): DiscourseCommitment[] {
  const commitments = existing.map((commitment) => ({ ...commitment }));
  const userRequests = requests.filter(
    (request) =>
      request.requestedBy === "user" && request.responsibleParty === "hachika",
  );
  const sources = [
    ...questions
      .filter(
        (question) =>
          question.askedBy === "user" &&
          question.answerExpectedFrom === "hachika" &&
          !userRequests.some(
            (request) =>
              request.askedAt === question.askedAt && request.text === question.text,
          ),
      )
      .map((question) => ({
        source: "question" as const,
        sourceAskedAt: question.askedAt,
        target: question.target,
        kind: "answer" as const,
        text: question.text,
        status: question.status,
        resolvedAt: question.resolvedAt,
      })),
    ...userRequests.map((request) => ({
      source: "request" as const,
      sourceAskedAt: request.askedAt,
      target: request.target,
      kind:
        request.kind === "task"
          ? ("task" as const)
          : request.kind === "style"
            ? ("style" as const)
            : ("answer" as const),
      text: request.text,
      status: request.status,
      resolvedAt: request.resolvedAt,
    })),
  ];

  for (const source of sources) {
    const current = commitments.find(
      (commitment) =>
        commitment.source === source.source &&
        commitment.sourceAskedAt === source.sourceAskedAt,
    );
    const sourceStatus =
      source.status !== "resolved"
        ? "open"
        : source.kind === "task"
          ? "accepted"
          : "fulfilled";
    const status =
      source.kind === "task" && current?.status === "fulfilled" && current.evidence
        ? "fulfilled"
        : sourceStatus;

    if (current) {
      current.kind = source.kind;
      current.target = source.target;
      current.text = source.text;
      current.status = status;
      current.acceptedAt =
        source.kind === "task" && source.status === "resolved"
          ? (current.acceptedAt ?? source.resolvedAt)
          : null;
      current.resolvedAt =
        status === "fulfilled"
          ? (current.resolvedAt ?? source.resolvedAt)
          : null;
      current.evidence = status === "fulfilled" ? current.evidence : null;
      continue;
    }

    commitments.push({
      owner: "hachika",
      kind: source.kind,
      source: source.source,
      sourceAskedAt: source.sourceAskedAt,
      target: source.target,
      text: source.text,
      status,
      createdAt: source.sourceAskedAt,
      acceptedAt:
        source.kind === "task" && source.status === "resolved"
          ? source.resolvedAt
          : null,
      resolvedAt:
        status === "fulfilled" && source.kind !== "task" ? source.resolvedAt : null,
      evidence: null,
    });
  }

  return commitments.slice(-16);
}

export function advanceTaskCommitments(
  snapshot: HachikaSnapshot,
  context: {
    input?: string;
    signals?: InteractionSignals;
    timestamp: string;
  },
): void {
  const acceptedTasks = snapshot.discourse.commitments.filter(
    (commitment) =>
      commitment.owner === "hachika" &&
      commitment.kind === "task" &&
      commitment.status === "accepted",
  );

  for (const commitment of acceptedTasks) {
    const traceEvidence = findTaskTraceEvidence(snapshot, commitment);
    const userEvidence = traceEvidence
      ? null
      : findUserCompletionEvidence(commitment, acceptedTasks, context);
    const evidence = traceEvidence ?? userEvidence;
    if (!evidence) {
      continue;
    }

    commitment.status = "fulfilled";
    commitment.resolvedAt = evidence.recordedAt;
    commitment.evidence = evidence;
  }
}

function findTaskTraceEvidence(
  snapshot: HachikaSnapshot,
  commitment: DiscourseCommitment,
): DiscourseCommitmentEvidence | null {
  const acceptedAt = commitment.acceptedAt ?? commitment.createdAt;
  const topics = commitmentTopics(commitment.text);
  if (topics.length === 0) {
    return null;
  }

  const decisionTask = /決め|選ん|選定|方針|判断|確定/u.test(commitment.text);
  const trace = Object.values(snapshot.traces)
    .filter(
      (candidate) =>
        timestampAfter(candidate.lastUpdatedAt, acceptedAt) &&
        traceMatchesCommitment(candidate, topics),
    )
    .filter(
      (candidate) =>
        candidate.status === "resolved" ||
        (decisionTask && candidate.artifact.decisions.length > 0),
    )
    .sort((left, right) => right.lastUpdatedAt.localeCompare(left.lastUpdatedAt))[0];

  if (!trace) {
    return null;
  }

  const decision = trace.artifact.decisions.at(-1) ?? null;
  return {
    kind:
      decisionTask && decision ? "trace_decision" : "trace_resolution",
    topic: trace.topic,
    summary: decision ?? trace.summary,
    recordedAt: trace.lastUpdatedAt,
  };
}

function findUserCompletionEvidence(
  commitment: DiscourseCommitment,
  acceptedTasks: readonly DiscourseCommitment[],
  context: {
    input?: string;
    signals?: InteractionSignals;
    timestamp: string;
  },
): DiscourseCommitmentEvidence | null {
  if (
    !context.input ||
    !context.signals ||
    context.signals.completion < 0.18 ||
    !/(?:完了した|終わった|できた|実装した|決まった|解決した|片付いた|済んだ)/u.test(
      context.input,
    )
  ) {
    return null;
  }

  const expectedTopics = commitmentTopics(commitment.text);
  const currentTopics = uniqueTopics([
    ...context.signals.topics,
    ...extractTopics(context.input),
  ]);
  const matchedTopic = expectedTopics.find((expected) =>
    currentTopics.some((current) => topicsLooselyMatch(expected, current)),
  );
  const unambiguousUntopicalCompletion =
    expectedTopics.length === 0 &&
    acceptedTasks.length === 1 &&
    context.signals.workCue >= 0.18;

  if (!matchedTopic && !unambiguousUntopicalCompletion) {
    return null;
  }

  const mostRecentMatchingCommitment = [...acceptedTasks]
    .reverse()
    .find((candidate) => {
      const candidateTopics = commitmentTopics(candidate.text);
      return candidateTopics.length === 0
        ? unambiguousUntopicalCompletion
        : candidateTopics.some((expected) =>
            currentTopics.some((current) => topicsLooselyMatch(expected, current)),
          );
    });
  if (mostRecentMatchingCommitment !== commitment) {
    return null;
  }

  return {
    kind: "user_completion",
    topic: matchedTopic ?? null,
    summary: compactEvidenceSummary(context.input),
    recordedAt: context.timestamp,
  };
}

function traceMatchesCommitment(trace: TraceEntry, topics: readonly string[]): boolean {
  const traceTexts = [
    trace.topic,
    trace.summary,
    ...trace.artifact.memo,
    ...trace.artifact.fragments,
    ...trace.artifact.decisions,
    ...trace.artifact.nextSteps,
  ];

  return topics.some((topic) =>
    traceTexts.some(
      (text) =>
        topicsLooselyMatch(topic, text) ||
        text.normalize("NFKC").includes(topic.normalize("NFKC")),
    ),
  );
}

function commitmentTopics(text: string): string[] {
  return uniqueTopics(extractTopics(text).filter(isMeaningfulTopic));
}

function uniqueTopics(topics: readonly string[]): string[] {
  return [...new Set(topics.map((topic) => topic.normalize("NFKC").trim()))].filter(
    (topic) => topic.length > 0,
  );
}

function timestampAfter(candidate: string, reference: string): boolean {
  const candidateTime = Date.parse(candidate);
  const referenceTime = Date.parse(reference);
  return Number.isFinite(candidateTime) &&
    Number.isFinite(referenceTime) &&
    candidateTime > referenceTime;
}

function compactEvidenceSummary(text: string): string {
  const normalized = text.normalize("NFKC").trim();
  return normalized.length <= 120 ? normalized : `${normalized.slice(0, 119)}…`;
}
