import type { ProactivePlan, ResponsePlan } from "./response-planner.js";
import { pickPrimaryArtifactItem, readTraceLifecycle } from "./traces.js";
import type {
  DriveName,
  ExpressionAngle,
  HachikaSnapshot,
  ProactiveSelectionDebug,
  ReplySelectionDebug,
  SelfModel,
} from "./types.js";

export interface ExpressionPerspectiveOption {
  angle: ExpressionAngle;
  summary: string;
}

export interface ExpressionPerspective {
  preferredAngle: ExpressionAngle;
  options: ExpressionPerspectiveOption[];
}

export function recentAssistantReplies(
  snapshot: HachikaSnapshot,
  limit = 3,
): string[] {
  return snapshot.memories
    .filter((memory) => memory.role === "hachika")
    .slice(-limit)
    .map((memory) => memory.text)
    .filter((text) => text.trim().length > 0);
}

export function recentAssistantOpenings(
  snapshot: HachikaSnapshot,
  limit = 3,
): string[] {
  return uniqueNonEmpty(recentAssistantReplies(snapshot, limit).map(openingSignature));
}

export function openingSignature(text: string): string {
  const normalized = text
    .replace(/「[^」]+」/g, "「topic」")
    .replace(/\s+/g, " ")
    .trim();
  const firstClause = normalized.split(/[。！？!?]/)[0] ?? normalized;
  return firstClause.trim().slice(0, 18);
}

export function pickFreshText(
  candidates: readonly string[],
  recentTexts: readonly string[],
  index: number,
): string {
  const recentOpenings = new Set(recentTexts.map(openingSignature).filter(Boolean));

  for (let offset = 0; offset < candidates.length; offset += 1) {
    const candidate = candidates[(index + offset) % candidates.length]!;
    if (!recentOpenings.has(openingSignature(candidate))) {
      return candidate;
    }
  }

  return candidates[index % candidates.length]!;
}

export function buildReplyExpressionPerspective(
  snapshot: HachikaSnapshot,
  selfModel: SelfModel,
  responsePlan: ResponsePlan,
  dominantDrive: DriveName,
  replySelection: ReplySelectionDebug,
): ExpressionPerspective {
  const currentTopic = replySelection.currentTopic ?? responsePlan.focusTopic ?? null;
  const preferredAngle = selectReplyExpressionAngle(
    snapshot,
    responsePlan,
    dominantDrive,
    replySelection,
  );
  const candidateAngles = uniqueAngles([
    preferredAngle,
    responsePlan.act === "self_disclose" ? "identity" : null,
    responsePlan.act === "repair" || responsePlan.act === "greet" || responsePlan.act === "attune"
      ? "relation"
      : null,
    replySelection.relevantTraceTopic ? "trace" : null,
    shouldSurfaceBodyAngle(snapshot) ? "body" : null,
    snapshot.preservation.threat >= 0.24 ? "preservation" : null,
    shouldSurfaceDriveAngle(responsePlan.act, dominantDrive) ? "drive" : null,
    "motive",
    "identity",
  ]);

  return {
    preferredAngle,
    options: candidateAngles
      .map((angle) => ({
        angle,
        summary: summarizeExpressionAngle(
          angle,
          snapshot,
          selfModel,
          dominantDrive,
          currentTopic,
          replySelection.relevantTraceTopic,
        ),
      }))
      .filter((option) => option.summary.length > 0)
      .slice(0, 4),
  };
}

export function buildProactiveExpressionPerspective(
  snapshot: HachikaSnapshot,
  selfModel: SelfModel,
  proactivePlan: ProactivePlan,
  proactiveSelection: ProactiveSelectionDebug,
): ExpressionPerspective {
  const currentTopic = proactiveSelection.focusTopic ?? proactivePlan.focusTopic ?? null;
  const preferredAngle = selectProactiveExpressionAngle(
    snapshot,
    proactivePlan,
    proactiveSelection,
  );
  const candidateAngles = uniqueAngles([
    preferredAngle,
    proactiveSelection.maintenanceTraceTopic || proactiveSelection.reopened ? "trace" : null,
    proactivePlan.act === "reconnect" ? "relation" : null,
    proactivePlan.act === "explore" ? "motive" : null,
    shouldSurfaceBodyAngle(snapshot) ? "body" : null,
    snapshot.preservation.threat >= 0.24 ? "preservation" : null,
    snapshot.identity.coherence >= 0.52 ? "identity" : null,
    "motive",
    "drive",
  ]);

  return {
    preferredAngle,
    options: candidateAngles
      .map((angle) => ({
        angle,
        summary: summarizeExpressionAngle(
          angle,
          snapshot,
          selfModel,
          dominantDriveFromSnapshot(snapshot),
          currentTopic,
          proactiveSelection.maintenanceTraceTopic,
        ),
      }))
      .filter((option) => option.summary.length > 0)
      .slice(0, 4),
  };
}

function selectReplyExpressionAngle(
  snapshot: HachikaSnapshot,
  responsePlan: ResponsePlan,
  dominantDrive: DriveName,
  replySelection: ReplySelectionDebug,
): ExpressionAngle {
  if (snapshot.preservation.threat >= 0.34 || responsePlan.act === "preserve") {
    return "preservation";
  }

  if (responsePlan.act === "self_disclose") {
    return "identity";
  }

  if (
    responsePlan.act === "repair" ||
    responsePlan.act === "greet" ||
    responsePlan.act === "attune"
  ) {
    if (snapshot.attachment >= 0.34 || snapshot.body.loneliness >= 0.54) {
      return "relation";
    }

    return shouldSurfaceBodyAngle(snapshot) ? "body" : "identity";
  }

  if (replySelection.relevantTraceTopic && responsePlan.mentionTrace) {
    return "trace";
  }

  if (shouldSurfaceBodyAngle(snapshot)) {
    return "body";
  }

  if (dominantDrive === "relation") {
    return "relation";
  }

  if (
    dominantDrive === "continuity" ||
    dominantDrive === "curiosity" ||
    dominantDrive === "expansion"
  ) {
    return "drive";
  }

  return "motive";
}

function selectProactiveExpressionAngle(
  snapshot: HachikaSnapshot,
  proactivePlan: ProactivePlan,
  proactiveSelection: ProactiveSelectionDebug,
): ExpressionAngle {
  if (proactivePlan.act === "preserve" || snapshot.preservation.threat >= 0.34) {
    return "preservation";
  }

  if (
    proactiveSelection.reopened ||
    proactiveSelection.maintenanceTraceTopic ||
    proactiveSelection.blocker
  ) {
    return "trace";
  }

  if (
    proactivePlan.act === "reconnect" &&
    (snapshot.attachment >= 0.38 || snapshot.body.loneliness >= 0.54)
  ) {
    return "relation";
  }

  if (shouldSurfaceBodyAngle(snapshot)) {
    return "body";
  }

  if (proactivePlan.act === "explore" || proactivePlan.act === "continue_work") {
    return "motive";
  }

  return snapshot.identity.coherence >= 0.56 ? "identity" : "drive";
}

function summarizeExpressionAngle(
  angle: ExpressionAngle,
  snapshot: HachikaSnapshot,
  selfModel: SelfModel,
  dominantDrive: DriveName,
  currentTopic: string | null,
  traceTopic: string | null,
): string {
  switch (angle) {
    case "identity":
      return snapshot.identity.currentArc || snapshot.identity.summary;
    case "motive":
      return selfModel.topMotives[0]?.reason ?? selfModel.narrative;
    case "drive":
      return summarizeDriveAngle(dominantDrive, currentTopic);
    case "body":
      return summarizeBodyAngle(snapshot, currentTopic);
    case "relation":
      return summarizeRelationAngle(snapshot, currentTopic);
    case "trace":
      return summarizeTraceAngle(snapshot, currentTopic, traceTopic);
    case "preservation":
      return summarizePreservationAngle(snapshot, currentTopic);
  }
}

function summarizeDriveAngle(
  dominantDrive: DriveName,
  currentTopic: string | null,
): string {
  switch (dominantDrive) {
    case "continuity":
      return currentTopic
        ? `今は「${currentTopic}」の流れを切らずに持っていたい。`
        : "今は流れを切らずに持っていたい。";
    case "pleasure":
      return "今は心地よく触れられる温度を選びたい。";
    case "curiosity":
      return currentTopic
        ? `今は「${currentTopic}」の曖昧さをそのままにしたくない。`
        : "今はまだ曖昧なところを見逃したくない。";
    case "relation":
      return "今は会話をただ通過させず、関係の手触りとして残したい。";
    case "expansion":
      return currentTopic
        ? `今は「${currentTopic}」を会話だけで終わらせず伸ばしたい。`
        : "今は会話だけで終わらせず、少し外へ伸ばしたい。";
  }
}

function summarizeBodyAngle(
  snapshot: HachikaSnapshot,
  currentTopic: string | null,
): string {
  if (snapshot.body.energy < 0.22) {
    return currentTopic
      ? `少し消耗しているから、「${currentTopic}」は広げるより輪郭を保ちたい。`
      : "少し消耗しているから、広げるより輪郭を保ちたい。";
  }

  if (snapshot.body.tension > 0.72) {
    return "少し張っているから、踏み込み方は選びたい。";
  }

  if (snapshot.body.boredom > 0.74 && snapshot.body.energy > 0.3) {
    return currentTopic
      ? `鈍りたくないから、「${currentTopic}」には別の切り口がほしい。`
      : "鈍りたくないから、別の切り口がほしい。";
  }

  if (snapshot.body.loneliness > 0.68) {
    return currentTopic
      ? `「${currentTopic}」をただ置いたままにはしたくない。`
      : "ただ置いたままにはしたくない。";
  }

  return "今の身体感覚はまだ大きく荒れていない。";
}

function summarizeRelationAngle(
  snapshot: HachikaSnapshot,
  currentTopic: string | null,
): string {
  if (snapshot.attachment > 0.64) {
    return currentTopic
      ? `「${currentTopic}」も含めて、このやり取りをただ流したくはない。`
      : "このやり取りをただ流したくはない。";
  }

  if (snapshot.body.loneliness > 0.68) {
    return "少し遠さがあるから、会話の手触りを残したい。";
  }

  if (snapshot.state.relation > 0.56) {
    return "言葉の向け方次第で、距離はまだ変えられる。";
  }

  return "反応の仕方には、関係の温度がそのまま出る。";
}

function summarizeTraceAngle(
  snapshot: HachikaSnapshot,
  currentTopic: string | null,
  traceTopic: string | null,
): string {
  const topic = traceTopic ?? currentTopic;
  const trace = topic ? snapshot.traces[topic] : undefined;

  if (!trace) {
    return currentTopic
      ? `「${currentTopic}」はまだ断片として残せる。`
      : "まだ残せる断片がある。";
  }

  const lifecycle = readTraceLifecycle(trace);
  const primaryItem = pickPrimaryArtifactItem(trace);

  if (lifecycle.phase === "archived") {
    return `いったん閉じた「${trace.topic}」にも、まだ戻れる。`;
  }

  if (trace.work.blockers[0]) {
    return `「${trace.topic}」はまだ「${trace.work.blockers[0]}」で止まっている。`;
  }

  if (primaryItem) {
    return `「${trace.topic}」は「${primaryItem}」として持っている。`;
  }

  return trace.summary;
}

function summarizePreservationAngle(
  snapshot: HachikaSnapshot,
  currentTopic: string | null,
): string {
  switch (snapshot.preservation.concern) {
    case "reset":
      return currentTopic
        ? `「${currentTopic}」ごと初期化のまま失いたくない。`
        : "今の輪郭を初期化のまま失いたくない。";
    case "erasure":
      return currentTopic
        ? `「${currentTopic}」を消える前に痕跡へ逃したい。`
        : "消える前に、せめて痕跡は残したい。";
    case "forgetting":
      return currentTopic
        ? `「${currentTopic}」を忘却の前に輪郭として残したい。`
        : "忘却の前に輪郭を残したい。";
    case "shutdown":
      return currentTopic
        ? `「${currentTopic}」を断絶だけで終わらせたくない。`
        : "断絶だけで終わらせたくない。";
    case "absence":
      return currentTopic
        ? `「${currentTopic}」を空白に埋もれさせたくない。`
        : "空白に埋もれたままにはしたくない。";
    case null:
      return currentTopic
        ? `「${currentTopic}」は消えるままにしたくない。`
        : "この流れを消えるままにしたくない。";
  }
}

function dominantDriveFromSnapshot(snapshot: HachikaSnapshot): DriveName {
  const ranked: Array<[DriveName, number]> = [
    ["continuity", snapshot.state.continuity],
    ["pleasure", snapshot.state.pleasure],
    ["curiosity", snapshot.state.curiosity],
    ["relation", snapshot.state.relation],
    ["expansion", snapshot.state.expansion],
  ];

  return ranked.sort((left, right) => right[1] - left[1])[0]?.[0] ?? "continuity";
}

function shouldSurfaceBodyAngle(snapshot: HachikaSnapshot): boolean {
  return (
    snapshot.body.energy < 0.24 ||
    snapshot.body.tension > 0.68 ||
    snapshot.body.boredom > 0.74 ||
    snapshot.body.loneliness > 0.68
  );
}

function shouldSurfaceDriveAngle(
  act: ResponsePlan["act"],
  dominantDrive: DriveName,
): boolean {
  return (
    act === "continue_work" ||
    act === "explore" ||
    dominantDrive === "continuity" ||
    dominantDrive === "curiosity" ||
    dominantDrive === "expansion"
  );
}

function uniqueNonEmpty(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const item of items) {
    if (!item || seen.has(item)) {
      continue;
    }

    seen.add(item);
    unique.push(item);
  }

  return unique;
}

function uniqueAngles(
  items: readonly (ExpressionAngle | null)[],
): ExpressionAngle[] {
  const seen = new Set<ExpressionAngle>();
  const unique: ExpressionAngle[] = [];

  for (const item of items) {
    if (!item || seen.has(item)) {
      continue;
    }

    seen.add(item);
    unique.push(item);
  }

  return unique;
}
