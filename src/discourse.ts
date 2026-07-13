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
  const commitments = existing.map((commitment) => ({
    ...commitment,
    evidence: commitment.evidence ? { ...commitment.evidence } : null,
    events: commitment.events.map((event) => ({ ...event })),
  }));
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
    const sourceStatus: DiscourseCommitment["status"] =
      source.status !== "resolved"
        ? "open"
        : source.kind === "task"
          ? "accepted"
          : "fulfilled";
    const status = source.kind === "task"
      ? preservedTaskStatus(current) ?? sourceStatus
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
        status === "fulfilled" || status === "released"
          ? (current.resolvedAt ?? source.resolvedAt)
          : null;
      current.evidence =
        status === "fulfilled" || status === "released"
          ? current.evidence
          : null;
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
      events: [],
    });
  }

  return commitments.slice(-16);
}

export function advanceTaskCommitments(
  snapshot: HachikaSnapshot,
  context: {
    input?: string;
    reply?: string;
    signals?: InteractionSignals;
    timestamp: string;
  },
): void {
  const transitioned = new Set<DiscourseCommitment>();
  const activeTasks = activeTaskCommitments(snapshot);
  const userRelease = context.input && isUserWithdrawal(context.input)
    ? selectTransitionTarget(activeTasks, context.input, context.signals?.topics ?? [])
    : null;

  if (userRelease) {
    releaseCommitment(userRelease.commitment, {
      kind: "user_withdrawal",
      topic: userRelease.topic,
      summary: compactEvidenceSummary(context.input!),
      recordedAt: context.timestamp,
    });
    transitioned.add(userRelease.commitment);
  }

  for (const commitment of activeTaskCommitments(snapshot)) {
    const traceEvidence = findTaskTraceEvidence(snapshot, commitment);
    const userEvidence = traceEvidence
      ? null
      : findUserCompletionEvidence(
          commitment,
          activeTaskCommitments(snapshot),
          context,
        );
    const evidence = traceEvidence ?? userEvidence;
    if (!evidence) {
      continue;
    }

    commitment.status = "fulfilled";
    commitment.resolvedAt = evidence.recordedAt;
    commitment.evidence = evidence;
    appendCommitmentEvent(commitment, evidence);
    transitioned.add(commitment);
  }

  const remainingTasks = activeTaskCommitments(snapshot);
  const userRenegotiation =
    context.input && isUserRenegotiation(context.input)
      ? selectTransitionTarget(
          remainingTasks.filter((commitment) => !transitioned.has(commitment)),
          context.input,
          context.signals?.topics ?? [],
        )
      : null;
  if (userRenegotiation) {
    renegotiateCommitment(userRenegotiation.commitment, {
      kind: "user_renegotiation",
      topic: userRenegotiation.topic,
      summary: compactEvidenceSummary(context.input!),
      recordedAt: context.timestamp,
    });
    transitioned.add(userRenegotiation.commitment);
  }

  if (!context.reply) {
    return;
  }

  const hachikaTasks = activeTaskCommitments(snapshot).filter(
    (commitment) => !transitioned.has(commitment),
  );
  const hachikaRelease = isHachikaRelease(context.reply)
    ? selectTransitionTarget(hachikaTasks, context.reply, [])
    : null;
  if (hachikaRelease) {
    releaseCommitment(hachikaRelease.commitment, {
      kind: "hachika_release",
      topic: hachikaRelease.topic,
      summary: compactEvidenceSummary(context.reply),
      recordedAt: context.timestamp,
    });
    transitioned.add(hachikaRelease.commitment);
  }

  const hachikaRenegotiation = isHachikaRenegotiation(context.reply)
    ? selectTransitionTarget(
        activeTaskCommitments(snapshot).filter(
          (commitment) => !transitioned.has(commitment),
        ),
        context.reply,
        [],
      )
    : null;
  if (hachikaRenegotiation) {
    renegotiateCommitment(hachikaRenegotiation.commitment, {
      kind: "hachika_renegotiation",
      topic: hachikaRenegotiation.topic,
      summary: compactEvidenceSummary(context.reply),
      recordedAt: context.timestamp,
    });
  }
}

export interface TaskCommitmentTiming {
  ageHours: number;
  inactiveHours: number;
  stalled: boolean;
  lastProgressAt: string;
}

export function describeTaskCommitmentTiming(
  snapshot: HachikaSnapshot,
  commitment: DiscourseCommitment,
  observedAt: string,
): TaskCommitmentTiming {
  const acceptedAt = commitment.acceptedAt ?? commitment.createdAt;
  const topics = commitmentTopics(commitment.text);
  const matchingTraceTimes = Object.values(snapshot.traces)
    .filter((trace) => topics.length > 0 && traceMatchesCommitment(trace, topics))
    .map((trace) => trace.lastUpdatedAt);
  const eventTimes = commitment.events.map((event) => event.recordedAt);
  const lastProgressAt = [acceptedAt, ...matchingTraceTimes, ...eventTimes]
    .filter(isValidTimestamp)
    .sort((left, right) => right.localeCompare(left))[0] ?? acceptedAt;
  const ageHours = elapsedHours(acceptedAt, observedAt);
  const inactiveHours = elapsedHours(lastProgressAt, observedAt);

  return {
    ageHours,
    inactiveHours,
    stalled:
      (commitment.status === "accepted" || commitment.status === "renegotiated") &&
      inactiveHours >= 72,
    lastProgressAt,
  };
}

function preservedTaskStatus(
  commitment: DiscourseCommitment | undefined,
): DiscourseCommitment["status"] | null {
  if (
    commitment?.status === "fulfilled" &&
    commitment.evidence &&
    isFulfillmentEvidence(commitment.evidence)
  ) {
    return "fulfilled";
  }
  if (
    commitment?.status === "released" &&
    commitment.evidence &&
    isReleaseEvidence(commitment.evidence)
  ) {
    return "released";
  }
  if (
    commitment?.status === "renegotiated" &&
    commitment.events.at(-1) !== undefined &&
    isRenegotiationEvidence(commitment.events.at(-1)!)
  ) {
    return "renegotiated";
  }
  return null;
}

function activeTaskCommitments(snapshot: HachikaSnapshot): DiscourseCommitment[] {
  return snapshot.discourse.commitments.filter(
    (commitment) =>
      commitment.owner === "hachika" &&
      commitment.kind === "task" &&
      (commitment.status === "accepted" || commitment.status === "renegotiated"),
  );
}

function releaseCommitment(
  commitment: DiscourseCommitment,
  evidence: DiscourseCommitmentEvidence,
): void {
  commitment.status = "released";
  commitment.resolvedAt = evidence.recordedAt;
  commitment.evidence = evidence;
  appendCommitmentEvent(commitment, evidence);
}

function renegotiateCommitment(
  commitment: DiscourseCommitment,
  evidence: DiscourseCommitmentEvidence,
): void {
  commitment.status = "renegotiated";
  commitment.resolvedAt = null;
  commitment.evidence = null;
  appendCommitmentEvent(commitment, evidence);
}

function appendCommitmentEvent(
  commitment: DiscourseCommitment,
  evidence: DiscourseCommitmentEvidence,
): void {
  commitment.events.push(evidence);
  commitment.events = commitment.events.slice(-12);
}

function selectTransitionTarget(
  commitments: readonly DiscourseCommitment[],
  text: string,
  signalTopics: readonly string[],
): { commitment: DiscourseCommitment; topic: string | null } | null {
  const currentTopics = uniqueTopics([...signalTopics, ...extractTopics(text)]);
  const matched = [...commitments]
    .reverse()
    .map((commitment) => {
      const expectedTopics = commitmentTopics(commitment.text);
      const topic = expectedTopics.find((expected) =>
        currentTopics.some((current) => topicsLooselyMatch(expected, current)),
      ) ?? null;
      return { commitment, topic };
    })
    .find((candidate) => candidate.topic !== null);

  if (matched) {
    return matched;
  }

  if (
    commitments.length === 1 &&
    !currentTopics.some(
      (topic) =>
        isMeaningfulTopic(topic) &&
        !/(?:その件|この件|依頼|お願い|約束|作業|保留|後で|あとで|また今度)/u.test(
          topic,
        ),
    ) &&
    /(?:その件|この件|それ|これ|依頼|お願い|約束|作業|保留|後で|あとで|また今度)/u.test(
      text,
    )
  ) {
    return { commitment: commitments[0]!, topic: null };
  }
  return null;
}

function isUserWithdrawal(text: string): boolean {
  return (
    /(?:やらなくて|しなくて|対応しなくて|進めなくて).{0,5}(?:いい|大丈夫)/u.test(text) ||
    /(?:依頼|お願い|約束).{0,10}(?:取り下げ|撤回|解除)/u.test(text) ||
    /(?:その|この|例の).{0,18}(?:やめよう|中止|不要|もういい)/u.test(text)
  );
}

function isUserRenegotiation(text: string): boolean {
  return (
    /(?:一旦|いったん|今は).{0,16}(?:保留|置いて|止めて|待って)/u.test(text) ||
    /(?:後で|あとで|また今度).{0,16}(?:やろう|進めよう|再開)/u.test(text) ||
    /(?:急がなくて|期限|締切|条件|進め方).{0,18}(?:いい|変え|延ば|見直)/u.test(text)
  );
}

function isHachikaRelease(text: string): boolean {
  return (
    /(?:依頼|作業|約束).{0,16}(?:引き受けられない|取り下げる|手放す)/u.test(text) ||
    /(?:対応|実行|継続).{0,12}(?:できない|しないことにする)/u.test(text)
  );
}

function isHachikaRenegotiation(text: string): boolean {
  return (
    /(?:条件|期限|締切|進め方).{0,16}(?:変えたい|延ばしたい|見直したい|相談したい)/u.test(text) ||
    /(?:先に|まず).{0,24}(?:確認|情報|合意).{0,10}(?:必要|ほしい)/u.test(text)
  );
}

function isFulfillmentEvidence(evidence: DiscourseCommitmentEvidence): boolean {
  return (
    evidence.kind === "user_completion" ||
    evidence.kind === "trace_resolution" ||
    evidence.kind === "trace_decision"
  );
}

function isReleaseEvidence(evidence: DiscourseCommitmentEvidence): boolean {
  return evidence.kind === "user_withdrawal" || evidence.kind === "hachika_release";
}

function isRenegotiationEvidence(evidence: DiscourseCommitmentEvidence): boolean {
  return (
    evidence.kind === "user_renegotiation" ||
    evidence.kind === "hachika_renegotiation"
  );
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

function isValidTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function elapsedHours(from: string, to: string): number {
  const fromTime = Date.parse(from);
  const toTime = Date.parse(to);
  if (!Number.isFinite(fromTime) || !Number.isFinite(toTime)) {
    return 0;
  }
  return Math.max(0, (toTime - fromTime) / 3_600_000);
}

function compactEvidenceSummary(text: string): string {
  const normalized = text.normalize("NFKC").trim();
  return normalized.length <= 120 ? normalized : `${normalized.slice(0, 119)}…`;
}
