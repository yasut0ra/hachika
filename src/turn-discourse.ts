import {
  advanceTaskCommitments,
  reconcileDiscourseCommitments,
} from "./discourse.js";
import {
  extractDeclaredUserName,
  validatePersonalNameCandidate,
} from "./memory.js";
import type { ResponsePlan } from "./response-planner.js";
import type {
  HachikaSnapshot,
  InteractionSignals,
  TurnDirectiveDebug,
} from "./types.js";

export function extractAssignedHachikaName(text: string): string | null {
  const normalized = text.normalize("NFKC").trim();
  const match = normalized.match(
    /(?:あなた|君|きみ)の名前は[\s　]*([^\s。、！？?？]{1,24}?)(?:です|だよ|だ)?(?:[。！？!?]|$)/u,
  );
  const candidate = match?.[1]?.trim() ?? null;

  return candidate ? validatePersonalNameCandidate(candidate) : null;
}

export function updateDiscourseState(
  snapshot: HachikaSnapshot,
  input: string,
  reply: string,
  signals: InteractionSignals,
  turnDebug: TurnDirectiveDebug | null,
  responsePlan: ResponsePlan,
): void {
  const timestamp = snapshot.lastInteractionAt ?? new Date().toISOString();
  const normalized = input.normalize("NFKC").trim();
  const declaredUserName = extractDeclaredUserName(input);
  const assignedHachikaName = extractAssignedHachikaName(input);

  if (
    declaredUserName &&
    (!turnDebug || turnDebug.target === "user_name" || turnDebug.target === "user_profile")
  ) {
    snapshot.discourse.userName = {
      kind: "user_name",
      value: declaredUserName,
      confidence: 0.94,
      source: "user_assertion",
      updatedAt: timestamp,
    };
  }

  if (assignedHachikaName && turnDebug?.relationMove === "naming") {
    snapshot.discourse.hachikaName = {
      kind: "hachika_name",
      value: assignedHachikaName,
      confidence: 0.86,
      source: "relation_assignment",
      updatedAt: timestamp,
    };
  }

  resolveQuestionAwaitingUser(snapshot, normalized, signals, turnDebug, timestamp);
  resolveQuestionAwaitingHachika(snapshot, turnDebug, timestamp);
  resolveRequestAwaitingHachika(snapshot, turnDebug, timestamp);

  if (
    turnDebug &&
    turnDebug.target !== "none" &&
    shouldRecordOpenQuestion(normalized, signals, turnDebug)
  ) {
    snapshot.discourse.openQuestions.push({
      target: turnDebug.target,
      text: normalized,
      askedAt: timestamp,
      askedBy: "user",
      answerExpectedFrom: "hachika",
      status: turnDebug.answerMode === "clarify" ? "open" : "resolved",
      resolvedAt: turnDebug.answerMode === "clarify" ? null : timestamp,
    });
    snapshot.discourse.openQuestions = snapshot.discourse.openQuestions.slice(-8);
  }

  const request = detectDiscourseRequest(normalized, turnDebug, timestamp);
  if (request) {
    snapshot.discourse.openRequests.push(request);
    snapshot.discourse.openRequests = snapshot.discourse.openRequests.slice(-8);
  }

  recordHachikaQuestion(snapshot, reply, turnDebug, responsePlan, timestamp);

  if (!declaredUserName && !assignedHachikaName) {
    const claim = detectDiscourseClaim(normalized, signals, turnDebug, timestamp);
    if (claim) {
      snapshot.discourse.recentClaims.push(claim);
      snapshot.discourse.recentClaims = snapshot.discourse.recentClaims.slice(-8);
    }
  }

  const correction = detectDiscourseCorrection(input, turnDebug, timestamp);
  if (correction) {
    snapshot.discourse.lastCorrection = correction;
  }

  snapshot.discourse.commitments = reconcileDiscourseCommitments(
    snapshot.discourse.commitments,
    snapshot.discourse.openQuestions,
    snapshot.discourse.openRequests,
  );
  advanceTaskCommitments(snapshot, {
    input: normalized,
    reply,
    signals,
    timestamp,
  });
}

export function recordExplicitHachikaQuestion(
  snapshot: HachikaSnapshot,
  reply: string,
  target: HachikaSnapshot["discourse"]["openQuestions"][number]["target"],
  timestamp: string,
): void {
  const text = extractLastExplicitQuestion(reply);
  if (!text) {
    return;
  }

  const duplicate = snapshot.discourse.openQuestions.some(
    (question) =>
      question.status === "open" &&
      question.askedBy === "hachika" &&
      question.answerExpectedFrom === "user" &&
      question.text === text,
  );
  if (duplicate) {
    return;
  }

  snapshot.discourse.openQuestions.push({
    target,
    text,
    askedAt: timestamp,
    askedBy: "hachika",
    answerExpectedFrom: "user",
    status: "open",
    resolvedAt: null,
  });
  snapshot.discourse.openQuestions = snapshot.discourse.openQuestions.slice(-8);
}

function resolveQuestionAwaitingUser(
  snapshot: HachikaSnapshot,
  input: string,
  signals: InteractionSignals,
  turnDebug: TurnDirectiveDebug | null,
  timestamp: string,
): void {
  if (!input || signals.question >= 0.22 || /[?？]/u.test(input)) {
    return;
  }

  const question = [...snapshot.discourse.openQuestions]
    .reverse()
    .find(
      (candidate) =>
        candidate.status === "open" &&
        candidate.askedBy === "hachika" &&
        candidate.answerExpectedFrom === "user",
    );

  if (!question) {
    return;
  }

  if (
    turnDebug?.target === "hachika_name" ||
    turnDebug?.target === "hachika_profile" ||
    turnDebug?.target === "world_state"
  ) {
    return;
  }

  question.status = "resolved";
  question.resolvedAt = timestamp;
}

function resolveQuestionAwaitingHachika(
  snapshot: HachikaSnapshot,
  turnDebug: TurnDirectiveDebug | null,
  timestamp: string,
): void {
  if (!turnDebug || turnDebug.answerMode === "clarify") {
    return;
  }

  const question = [...snapshot.discourse.openQuestions]
    .reverse()
    .find(
      (candidate) =>
        candidate.status === "open" &&
        candidate.askedBy === "user" &&
        candidate.answerExpectedFrom === "hachika" &&
        (turnDebug.target === candidate.target || turnDebug.target === "none"),
    );

  if (question) {
    question.status = "resolved";
    question.resolvedAt = timestamp;
  }
}

function resolveRequestAwaitingHachika(
  snapshot: HachikaSnapshot,
  turnDebug: TurnDirectiveDebug | null,
  timestamp: string,
): void {
  if (!turnDebug || turnDebug.answerMode === "clarify") {
    return;
  }

  const request = [...snapshot.discourse.openRequests]
    .reverse()
    .find(
      (candidate) =>
        candidate.status === "open" &&
        candidate.requestedBy === "user" &&
        candidate.responsibleParty === "hachika" &&
        (turnDebug.target === candidate.target || turnDebug.target === "none"),
    );

  if (request) {
    request.status = "resolved";
    request.resolvedAt = timestamp;
  }
}

function recordHachikaQuestion(
  snapshot: HachikaSnapshot,
  reply: string,
  turnDebug: TurnDirectiveDebug | null,
  responsePlan: ResponsePlan,
  timestamp: string,
): void {
  const target = inferHachikaQuestionTarget(turnDebug, responsePlan);
  recordExplicitHachikaQuestion(snapshot, reply, target, timestamp);
}

function extractLastExplicitQuestion(reply: string): string | null {
  const normalized = reply.normalize("NFKC").trim();
  const questionEnd = Math.max(normalized.lastIndexOf("?"), normalized.lastIndexOf("？"));
  if (questionEnd < 0) {
    return null;
  }

  const prefix = normalized.slice(0, questionEnd);
  const sentenceStart = Math.max(
    prefix.lastIndexOf("\n"),
    prefix.lastIndexOf("。"),
    prefix.lastIndexOf("!"),
    prefix.lastIndexOf("！"),
  );
  const latest = normalized.slice(sentenceStart + 1, questionEnd + 1).trim();
  return latest.length >= 3 ? latest : null;
}

function inferHachikaQuestionTarget(
  turnDebug: TurnDirectiveDebug | null,
  responsePlan: ResponsePlan,
): HachikaSnapshot["discourse"]["openQuestions"][number]["target"] {
  if (responsePlan.focusTopic || turnDebug?.target === "work_topic") {
    return "work_topic";
  }
  if (responsePlan.act === "attune") {
    return turnDebug?.target === "relation" ? "relation" : "user_profile";
  }
  if (turnDebug?.target === "hachika_name") {
    return "user_name";
  }
  if (turnDebug?.target === "hachika_profile") {
    return "user_profile";
  }
  return turnDebug?.target ?? "none";
}

function shouldRecordOpenQuestion(
  input: string,
  signals: InteractionSignals,
  turnDebug: TurnDirectiveDebug,
): boolean {
  if (signals.question >= 0.22 || /[?？]/u.test(input)) {
    return true;
  }

  if (turnDebug.answerMode !== "direct" && turnDebug.answerMode !== "clarify") {
    return false;
  }

  return (
    turnDebug.target === "user_name" ||
    turnDebug.target === "hachika_name" ||
    turnDebug.target === "user_profile" ||
    turnDebug.target === "hachika_profile" ||
    turnDebug.target === "world_state"
  );
}

function detectDiscourseRequest(
  input: string,
  turnDebug: TurnDirectiveDebug | null,
  timestamp: string,
): HachikaSnapshot["discourse"]["openRequests"][number] | null {
  if (!turnDebug) {
    return null;
  }

  const styleRequest = /具体的|直接|短く|3つ|一言で|箇条書き/u.test(input);
  const taskRequest =
    /整理して|まとめて|説明して|書いて|出して|決めて|作って|直して|見せて/u.test(input);
  const directRequest =
    /答えて|教えて|言って|聞かせて|示して|してほしい/u.test(input);

  if (!styleRequest && !taskRequest && !directRequest) {
    return null;
  }

  return {
    target: inferCorrectionTarget(input, turnDebug.target),
    kind: styleRequest ? "style" : taskRequest ? "task" : "direct_answer",
    text: input,
    askedAt: timestamp,
    requestedBy: "user",
    responsibleParty: "hachika",
    status: turnDebug.answerMode === "clarify" ? "open" : "resolved",
    resolvedAt: turnDebug.answerMode === "clarify" ? null : timestamp,
  };
}

function detectDiscourseClaim(
  input: string,
  signals: InteractionSignals,
  turnDebug: TurnDirectiveDebug | null,
  timestamp: string,
): HachikaSnapshot["discourse"]["recentClaims"][number] | null {
  if (!turnDebug || signals.question >= 0.22 || input.length < 4) {
    return null;
  }

  if (
    /答えて|教えて|言って|聞かせて|示して|具体的|直接|整理して|まとめて|説明して|してほしい/u.test(
      input,
    )
  ) {
    return null;
  }

  if (turnDebug.target === "user_name" || turnDebug.target === "hachika_name") {
    return null;
  }

  let subject: HachikaSnapshot["discourse"]["recentClaims"][number]["subject"] = "shared";
  if (turnDebug.target === "user_profile" || /^(私|僕|俺)(?:は|も|って|が)?/u.test(input)) {
    subject = "user";
  } else if (
    turnDebug.target === "hachika_profile" ||
    /^(あなた|君|きみ|ハチカ)(?:は|も|って|が)?/u.test(input)
  ) {
    subject = "hachika";
  }

  let kind: HachikaSnapshot["discourse"]["recentClaims"][number]["kind"] = "other";
  if (turnDebug.target === "work_topic" || signals.workCue >= 0.35) {
    kind = "work";
  } else if (/好き|嫌い|苦手|気になる|興味/u.test(input)) {
    kind = "preference";
  } else if (
    turnDebug.target === "user_profile" ||
    turnDebug.target === "hachika_profile" ||
    /疲れ|眠い|しんどい|元気|不安|落ち着か/u.test(input)
  ) {
    kind = "state";
  } else if (turnDebug.relationMove !== "none" || signals.intimacy >= 0.28) {
    kind = "relation";
  }

  return {
    subject,
    kind,
    text: input,
    updatedAt: timestamp,
  };
}

function detectDiscourseCorrection(
  input: string,
  turnDebug: TurnDirectiveDebug | null,
  timestamp: string,
): HachikaSnapshot["discourse"]["lastCorrection"] {
  if (!turnDebug) {
    return null;
  }

  const normalized = input.normalize("NFKC").trim();
  const referentCorrection = /じゃなくて|ではなくて|違う|そうじゃなくて/u.test(normalized);
  const directnessCorrection = /具体的|直接/u.test(normalized);
  const relationCorrection = /落ち着いて|言い方|急ぎすぎ/u.test(normalized);

  if (!referentCorrection && !directnessCorrection && !relationCorrection) {
    return null;
  }

  const inferredTarget = inferCorrectionTarget(normalized, turnDebug.target);

  return {
    target: inferredTarget,
    kind: directnessCorrection
      ? "directness"
      : relationCorrection
        ? "relation"
        : "referent",
    text: normalized,
    updatedAt: timestamp,
  };
}

function inferCorrectionTarget(
  input: string,
  fallback: TurnDirectiveDebug["target"],
): TurnDirectiveDebug["target"] | "none" {
  if (/ハチカ自身|あなた自身/u.test(input)) {
    return /名前/u.test(input) ? "hachika_name" : "hachika_profile";
  }

  if (/私のこと/u.test(input)) {
    return /名前/u.test(input) ? "user_name" : "user_profile";
  }

  return fallback ?? "none";
}
