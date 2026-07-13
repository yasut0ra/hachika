import { extractTopics, isMeaningfulTopic, topicsLooselyMatch } from "./memory.js";
import type {
  DiscourseCommitment,
  DiscourseCommitmentEvidence,
  DiscourseCommitmentProgress,
  DiscourseCommitmentProgressEvent,
  DiscourseCommitmentWorkItem,
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
    progress: cloneCommitmentProgress(commitment),
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
      progress: createCommitmentProgress(
        source.kind,
        source.text,
        source.sourceAskedAt,
        status,
      ),
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
  for (const commitment of activeTaskCommitments(snapshot)) {
    synchronizeTaskCommitmentProgress(snapshot, commitment);
  }

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
    completeTaskProgress(commitment, evidence.recordedAt);
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

export interface TaskCommitmentProgressSummary {
  phase: "pending" | "working" | "blocked" | "paused" | "completed" | "released";
  completedItems: number;
  totalItems: number;
  completionRatio: number;
  currentItem: string | null;
  nextSteps: string[];
  blockers: string[];
  latestEvent: DiscourseCommitmentProgressEvent | null;
}

export function summarizeTaskCommitmentProgress(
  commitment: DiscourseCommitment,
): TaskCommitmentProgressSummary {
  const items = commitment.progress.items;
  const completedItems = items.filter((item) => item.status === "completed").length;
  const actionableItems = items.filter(
    (item) => item.status !== "completed" && item.status !== "cancelled",
  );
  const currentItem =
    actionableItems.find(
      (item) => item.source === "trace_next_step" && item.status === "in_progress",
    ) ??
    actionableItems.find(
      (item) => item.source === "trace_next_step" && item.status === "pending",
    ) ??
    actionableItems.find((item) => item.status === "in_progress") ??
    actionableItems[0] ??
    null;
  const phase: TaskCommitmentProgressSummary["phase"] =
    commitment.status === "fulfilled"
      ? "completed"
      : commitment.status === "released"
        ? "released"
        : commitment.status === "renegotiated" ||
            actionableItems.some((item) => item.status === "paused")
          ? "paused"
          : commitment.progress.blockers.length > 0
            ? "blocked"
            : actionableItems.some((item) => item.status === "in_progress")
              ? "working"
              : "pending";

  return {
    phase,
    completedItems,
    totalItems: items.length,
    completionRatio:
      items.length === 0 ? 0 : Math.round((completedItems / items.length) * 1000) / 1000,
    currentItem: currentItem?.text ?? null,
    nextSteps: actionableItems
      .filter((item) => item.source === "trace_next_step")
      .map((item) => item.text)
      .slice(0, 4),
    blockers: commitment.progress.blockers.slice(-4),
    latestEvent: commitment.progress.events.at(-1) ?? null,
  };
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
  const progressTimes = commitment.progress.events.map((event) => event.recordedAt);
  const lastProgressAt = [
    acceptedAt,
    ...matchingTraceTimes,
    ...eventTimes,
    ...progressTimes,
  ]
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

function createCommitmentProgress(
  kind: DiscourseCommitment["kind"],
  text: string,
  createdAt: string,
  status: DiscourseCommitment["status"],
): DiscourseCommitmentProgress {
  if (kind !== "task") {
    return {
      items: [],
      blockers: [],
      events: [],
      observedTraceAt: null,
      observedArtifacts: [],
    };
  }

  const itemStatus: DiscourseCommitmentWorkItem["status"] =
    status === "fulfilled"
      ? "completed"
      : status === "released"
        ? "cancelled"
        : status === "renegotiated"
          ? "paused"
          : "pending";
  return {
    items: [
      {
        id: "root",
        text,
        source: "request",
        status: itemStatus,
        createdAt,
        updatedAt: createdAt,
        completedAt:
          itemStatus === "completed" || itemStatus === "cancelled"
            ? createdAt
            : null,
      },
    ],
    blockers: [],
    events: [],
    observedTraceAt: null,
    observedArtifacts: [],
  };
}

function cloneCommitmentProgress(
  commitment: DiscourseCommitment,
): DiscourseCommitmentProgress {
  const progress = commitment.progress as DiscourseCommitmentProgress | undefined;
  if (!progress) {
    return createCommitmentProgress(
      commitment.kind,
      commitment.text,
      commitment.createdAt,
      commitment.status,
    );
  }
  return {
    items: progress.items.map((item) => ({ ...item })),
    blockers: [...progress.blockers],
    events: progress.events.map((event) => ({ ...event })),
    observedTraceAt: progress.observedTraceAt,
    observedArtifacts: [...progress.observedArtifacts],
  };
}

function synchronizeTaskCommitmentProgress(
  snapshot: HachikaSnapshot,
  commitment: DiscourseCommitment,
): void {
  const topics = commitmentTopics(commitment.text);
  if (topics.length === 0) {
    return;
  }
  const trace = Object.values(snapshot.traces)
    .filter((candidate) => traceMatchesCommitment(candidate, topics))
    .sort((left, right) => right.lastUpdatedAt.localeCompare(left.lastUpdatedAt))[0];
  if (!trace) {
    return;
  }

  const progress = commitment.progress;
  const acceptedAt = commitment.acceptedAt ?? commitment.createdAt;
  const traceAdvanced =
    timestampAfter(trace.lastUpdatedAt, acceptedAt) &&
    (!progress.observedTraceAt ||
      timestampAfter(trace.lastUpdatedAt, progress.observedTraceAt));
  const artifactTexts = uniqueTopics([
    ...trace.artifact.memo,
    ...trace.artifact.fragments,
    ...trace.artifact.decisions,
    ...trace.artifact.nextSteps,
  ]);
  const observed = new Set(progress.observedArtifacts);
  const newArtifacts = artifactTexts.filter((item) => !observed.has(item));
  const createdItems: DiscourseCommitmentWorkItem[] = [];

  for (const nextStep of trace.artifact.nextSteps) {
    if (progress.items.length >= 16) {
      break;
    }
    const normalized = nextStep.normalize("NFKC").trim();
    if (
      !normalized ||
      progress.items.some(
        (item) => item.text.normalize("NFKC").trim() === normalized,
      )
    ) {
      continue;
    }
    let sequence = 1;
    while (progress.items.some((item) => item.id === `step-${sequence}`)) {
      sequence += 1;
    }
    const item: DiscourseCommitmentWorkItem = {
      id: `step-${sequence}`,
      text: normalized,
      source: "trace_next_step",
      status: commitment.status === "renegotiated" ? "paused" : "pending",
      createdAt: trace.lastUpdatedAt,
      updatedAt: trace.lastUpdatedAt,
      completedAt: null,
    };
    progress.items.push(item);
    createdItems.push(item);
  }

  const nextBlockers = uniqueTopics(trace.work.blockers).slice(-6);
  const blockersChanged =
    JSON.stringify(progress.blockers) !== JSON.stringify(nextBlockers);

  if (traceAdvanced) {
    const root = progress.items.find((item) => item.source === "request") ?? null;
    const resuming = progress.items.some((item) => item.status === "paused");
    for (const item of progress.items) {
      if (item.status === "paused") {
        item.status = item.source === "request" ? "in_progress" : "pending";
        item.updatedAt = trace.lastUpdatedAt;
      }
    }
    if (root && root.status === "pending") {
      root.status = "in_progress";
      root.updatedAt = trace.lastUpdatedAt;
    }

    const hasStarted = progress.events.some(
      (event) => event.kind === "work_started",
    );
    if (!hasStarted || resuming) {
      appendProgressEvent(progress, {
        kind: resuming ? "work_resumed" : "work_started",
        topic: trace.topic,
        summary: resuming
          ? `${trace.topic}の作業を再開した`
          : `${trace.topic}の作業に着手した`,
        recordedAt: trace.lastUpdatedAt,
      });
    }

    for (const item of createdItems) {
      appendProgressEvent(progress, {
        kind: "next_step_added",
        topic: trace.topic,
        summary: item.text,
        recordedAt: trace.lastUpdatedAt,
      });
    }

    const completionArtifacts = [
      ...trace.artifact.decisions,
      ...trace.artifact.fragments,
    ].filter((item) => newArtifacts.includes(item.normalize("NFKC").trim()));
    for (const item of progress.items) {
      if (
        item.source !== "trace_next_step" ||
        item.status === "completed" ||
        item.status === "cancelled"
      ) {
        continue;
      }
      const completedBy = completionArtifacts.find(
        (artifact) =>
          artifact.normalize("NFKC").trim() !==
            item.text.normalize("NFKC").trim() &&
          workItemMatchesArtifact(item.text, artifact),
      );
      if (!completedBy) {
        continue;
      }
      item.status = "completed";
      item.updatedAt = trace.lastUpdatedAt;
      item.completedAt = trace.lastUpdatedAt;
      appendProgressEvent(progress, {
        kind: "work_item_completed",
        topic: trace.topic,
        summary: item.text,
        recordedAt: trace.lastUpdatedAt,
      });
    }

    const substantiveArtifact = [...trace.artifact.decisions, ...trace.artifact.fragments]
      .reverse()
      .find((item) => newArtifacts.includes(item.normalize("NFKC").trim()));
    if (substantiveArtifact) {
      appendProgressEvent(progress, {
        kind: "artifact_recorded",
        topic: trace.topic,
        summary: substantiveArtifact,
        recordedAt: trace.lastUpdatedAt,
      });
    }

    if (blockersChanged) {
      appendProgressEvent(progress, {
        kind: "blocker_changed",
        topic: trace.topic,
        summary:
          nextBlockers.at(-1) ?? `${trace.topic}のblockerが解消した`,
        recordedAt: trace.lastUpdatedAt,
      });
    }
  }

  progress.blockers = nextBlockers;
  progress.observedTraceAt =
    !progress.observedTraceAt ||
    timestampAfter(trace.lastUpdatedAt, progress.observedTraceAt)
      ? trace.lastUpdatedAt
      : progress.observedTraceAt;
  progress.observedArtifacts = uniqueTopics([
    ...progress.observedArtifacts,
    ...artifactTexts,
  ]).slice(-32);
}

function workItemMatchesArtifact(item: string, artifact: string): boolean {
  const normalizedItem = item.normalize("NFKC").trim();
  const normalizedArtifact = artifact.normalize("NFKC").trim();
  return (
    topicsLooselyMatch(normalizedItem, normalizedArtifact) ||
    normalizedArtifact.includes(normalizedItem) ||
    normalizedItem.includes(normalizedArtifact)
  );
}

function appendProgressEvent(
  progress: DiscourseCommitmentProgress,
  event: DiscourseCommitmentProgressEvent,
): void {
  if (
    progress.events.some(
      (current) =>
        current.kind === event.kind &&
        current.summary === event.summary &&
        current.recordedAt === event.recordedAt,
    )
  ) {
    return;
  }
  progress.events.push(event);
  progress.events = progress.events.slice(-24);
}

function completeTaskProgress(
  commitment: DiscourseCommitment,
  timestamp: string,
): void {
  for (const item of commitment.progress.items) {
    if (item.status === "cancelled") {
      continue;
    }
    item.status = "completed";
    item.updatedAt = timestamp;
    item.completedAt = timestamp;
  }
}

function cancelTaskProgress(
  commitment: DiscourseCommitment,
  timestamp: string,
): void {
  for (const item of commitment.progress.items) {
    if (item.status === "completed") {
      continue;
    }
    item.status = "cancelled";
    item.updatedAt = timestamp;
    item.completedAt = timestamp;
  }
}

function pauseTaskProgress(
  commitment: DiscourseCommitment,
  timestamp: string,
): void {
  for (const item of commitment.progress.items) {
    if (item.status === "pending" || item.status === "in_progress") {
      item.status = "paused";
      item.updatedAt = timestamp;
    }
  }
}

function releaseCommitment(
  commitment: DiscourseCommitment,
  evidence: DiscourseCommitmentEvidence,
): void {
  commitment.status = "released";
  commitment.resolvedAt = evidence.recordedAt;
  commitment.evidence = evidence;
  appendCommitmentEvent(commitment, evidence);
  cancelTaskProgress(commitment, evidence.recordedAt);
}

function renegotiateCommitment(
  commitment: DiscourseCommitment,
  evidence: DiscourseCommitmentEvidence,
): void {
  commitment.status = "renegotiated";
  commitment.resolvedAt = null;
  commitment.evidence = null;
  appendCommitmentEvent(commitment, evidence);
  pauseTaskProgress(commitment, evidence.recordedAt);
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
