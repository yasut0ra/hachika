import type {
  DiscourseCommitment,
  DiscourseOpenQuestion,
  DiscourseOpenRequest,
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
    const status = source.status === "resolved" ? "fulfilled" : "open";

    if (current) {
      current.kind = source.kind;
      current.target = source.target;
      current.text = source.text;
      current.status = status;
      current.resolvedAt = status === "fulfilled" ? source.resolvedAt : null;
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
      resolvedAt: status === "fulfilled" ? source.resolvedAt : null,
    });
  }

  return commitments.slice(-16);
}
