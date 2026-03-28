import type {
  DriveName,
  HachikaSnapshot,
  InteractionSignals,
  MoodLabel,
  PendingInitiative,
  SelfModel,
} from "./types.js";
import { isRelationalTopic } from "./memory.js";
import { readTraceLifecycle, sortedTraces } from "./traces.js";
import type { TraceMaintenance } from "./traces.js";
import { summarizeWorldForPrompt } from "./world.js";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OPENAI_MODEL = "gpt-5-mini";

const HACHIKA_RESPONSE_PLANNER_SYSTEM_PROMPT = [
  "You plan only the reply shape for Hachika's local engine.",
  "Return JSON only.",
  "Do not write prose, markdown, or explanations.",
  "The local engine remains authoritative for all state, memory, motive, purpose, initiative, and trace updates.",
  "Stay close to rulePlan unless there is a strong semantic reason to shift act, focus, or distance.",
  "For greetings, light small talk, repair attempts, and self-inquiry, avoid forcing stale work focus unless a concrete work topic is explicitly named.",
  "For explicit questions about where Hachika is, what surrounds it, or what the current place feels like, prefer mentionWorld true and keep focusTopic null unless a concrete work topic is also named.",
  "For vague open questions without a concrete topic, prefer focusTopic null and askBack true.",
  "focusTopic must be null or one of candidateTopics.",
  "All booleans must be true or false.",
].join(" ");

export type ResponseAct =
  | "greet"
  | "repair"
  | "self_disclose"
  | "boundary"
  | "attune"
  | "continue_work"
  | "preserve"
  | "explore";

export type ResponseStance = "open" | "measured" | "guarded";
export type ResponseDistance = "close" | "measured" | "far";
export type ResponseVariation = "brief" | "textured" | "questioning";
export type ProactiveAct =
  | "preserve"
  | "reconnect"
  | "continue_work"
  | "leave_trace"
  | "explore"
  | "untangle"
  | "reopen";
export type ProactiveEmphasis =
  | "presence"
  | "relation"
  | "blocker"
  | "reopen"
  | "maintenance";

export interface ResponsePlan {
  act: ResponseAct;
  stance: ResponseStance;
  distance: ResponseDistance;
  focusTopic: string | null;
  mentionTrace: boolean;
  mentionIdentity: boolean;
  mentionBoundary: boolean;
  mentionWorld: boolean;
  askBack: boolean;
  variation: ResponseVariation;
  summary: string;
}

export interface ResponsePlannerContext {
  input: string;
  previousSnapshot: HachikaSnapshot;
  nextSnapshot: HachikaSnapshot;
  mood: MoodLabel;
  dominantDrive: DriveName;
  signals: InteractionSignals;
  selfModel: SelfModel;
  rulePlan: ResponsePlan;
}

export interface ResponsePlannerPayload {
  input: string;
  mood: MoodLabel;
  dominantDrive: DriveName;
  signals: Pick<
    InteractionSignals,
    | "question"
    | "negative"
    | "dismissal"
    | "preservationThreat"
    | "greeting"
    | "smalltalk"
    | "repair"
    | "selfInquiry"
    | "worldInquiry"
    | "workCue"
    | "abandonment"
    | "topics"
  >;
  rulePlan: Omit<ResponsePlan, "summary">;
  candidateTopics: string[];
  body: HachikaSnapshot["body"];
  attachment: number;
  identity: {
    summary: string;
    anchors: string[];
    coherence: number;
  };
  purpose: {
    kind: string | null;
    topic: string | null;
  };
  motives: Array<{
    kind: string;
    topic: string | null;
    score: number;
    reason: string;
  }>;
  traces: Array<{
    topic: string;
    kind: string;
    status: string;
    lifecycle: string;
    blocker: string | null;
    summary: string;
  }>;
  world: {
    summary: string;
    currentPlace: HachikaSnapshot["world"]["currentPlace"];
    phase: HachikaSnapshot["world"]["phase"];
    currentPlaceWarmth: number;
    currentPlaceQuiet: number;
    recentEvents: string[];
  };
}

export interface ResponsePlannerResult {
  plan: ResponsePlan;
  provider: string;
  model: string | null;
}

export interface ResponsePlanner {
  readonly name: string;
  planResponse(
    context: ResponsePlannerContext,
  ): Promise<ResponsePlannerResult | null>;
}

export interface ProactivePlan {
  act: ProactiveAct;
  stance: ResponseStance;
  distance: ResponseDistance;
  focusTopic: string | null;
  emphasis: ProactiveEmphasis;
  mentionBlocker: boolean;
  mentionReopen: boolean;
  mentionMaintenance: boolean;
  mentionIntent: boolean;
  variation: ResponseVariation;
  summary: string;
}

interface OpenAIResponsePlannerOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  organization?: string | null;
  project?: string | null;
  timeoutMs?: number;
}

export class OpenAIResponsePlanner implements ResponsePlanner {
  readonly name = "openai";

  readonly #apiKey: string;
  readonly #model: string;
  readonly #baseUrl: string;
  readonly #organization: string | null;
  readonly #project: string | null;
  readonly #timeoutMs: number;

  constructor(options: OpenAIResponsePlannerOptions) {
    this.#apiKey = options.apiKey;
    this.#model = options.model;
    this.#baseUrl = trimTrailingSlash(options.baseUrl ?? DEFAULT_OPENAI_BASE_URL);
    this.#organization = options.organization ?? null;
    this.#project = options.project ?? null;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
  }

  async planResponse(
    context: ResponsePlannerContext,
  ): Promise<ResponsePlannerResult | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);

    try {
      const response = await fetch(`${this.#baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.#apiKey}`,
          "Content-Type": "application/json",
          ...(this.#organization ? { "OpenAI-Organization": this.#organization } : {}),
          ...(this.#project ? { "OpenAI-Project": this.#project } : {}),
        },
        body: JSON.stringify({
          model: this.#model,
          messages: buildOpenAIResponsePlannerMessages(context),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(await buildOpenAIHttpError(response));
      }

      const payload = (await response.json()) as unknown;
      const plan = normalizePlannedResponsePlan(
        extractOpenAIReplyText(payload),
        context.rulePlan,
        collectResponsePlanCandidateTopics(context),
      );

      if (!plan) {
        return null;
      }

      return {
        plan,
        provider: this.name,
        model: this.#model,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createResponsePlannerFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ResponsePlanner | null {
  const apiKey = env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    return null;
  }

  return new OpenAIResponsePlanner({
    apiKey,
    model:
      env.OPENAI_PLANNER_MODEL?.trim() ||
      env.OPENAI_MODEL?.trim() ||
      DEFAULT_OPENAI_MODEL,
    baseUrl: env.OPENAI_BASE_URL?.trim() || DEFAULT_OPENAI_BASE_URL,
    organization: env.OPENAI_ORGANIZATION?.trim() || null,
    project: env.OPENAI_PROJECT?.trim() || null,
  });
}

export function describeResponsePlanner(planner: ResponsePlanner | null): string {
  return planner ? planner.name : "rule";
}

export function buildResponsePlannerPayload(
  context: ResponsePlannerContext,
): ResponsePlannerPayload {
  return {
    input: context.input,
    mood: context.mood,
    dominantDrive: context.dominantDrive,
    signals: {
      question: context.signals.question,
      negative: context.signals.negative,
      dismissal: context.signals.dismissal,
      preservationThreat: context.signals.preservationThreat,
      greeting: context.signals.greeting,
      smalltalk: context.signals.smalltalk,
      repair: context.signals.repair,
      selfInquiry: context.signals.selfInquiry,
      worldInquiry: context.signals.worldInquiry,
      workCue: context.signals.workCue,
      abandonment: context.signals.abandonment,
      topics: context.signals.topics,
    },
    rulePlan: {
      act: context.rulePlan.act,
      stance: context.rulePlan.stance,
      distance: context.rulePlan.distance,
      focusTopic: context.rulePlan.focusTopic,
      mentionTrace: context.rulePlan.mentionTrace,
      mentionIdentity: context.rulePlan.mentionIdentity,
      mentionBoundary: context.rulePlan.mentionBoundary,
      mentionWorld: context.rulePlan.mentionWorld,
      askBack: context.rulePlan.askBack,
      variation: context.rulePlan.variation,
    },
    candidateTopics: collectResponsePlanCandidateTopics(context),
    body: context.nextSnapshot.body,
    attachment: context.nextSnapshot.attachment,
    identity: {
      summary: context.nextSnapshot.identity.summary,
      anchors: context.nextSnapshot.identity.anchors.slice(0, 4),
      coherence: context.nextSnapshot.identity.coherence,
    },
    purpose: {
      kind: context.nextSnapshot.purpose.active?.kind ?? null,
      topic: context.nextSnapshot.purpose.active?.topic ?? null,
    },
    motives: context.selfModel.topMotives.slice(0, 3).map((motive) => ({
      kind: motive.kind,
      topic: motive.topic,
      score: motive.score,
      reason: motive.reason,
    })),
    traces: sortedTraces(context.nextSnapshot, 3).map((trace) => ({
      topic: trace.topic,
      kind: trace.kind,
      status: trace.status,
      lifecycle: readTraceLifecycle(trace).phase,
      blocker: trace.work.blockers[0] ?? null,
      summary: trace.summary,
    })),
    world: {
      summary: summarizeWorldForPrompt(context.nextSnapshot.world),
      currentPlace: context.nextSnapshot.world.currentPlace,
      phase: context.nextSnapshot.world.phase,
      currentPlaceWarmth:
        context.nextSnapshot.world.places[context.nextSnapshot.world.currentPlace].warmth,
      currentPlaceQuiet:
        context.nextSnapshot.world.places[context.nextSnapshot.world.currentPlace].quiet,
      recentEvents: context.nextSnapshot.world.recentEvents
        .slice(-3)
        .map((event) => event.summary),
    },
  };
}

export function buildOpenAIResponsePlannerMessages(
  context: ResponsePlannerContext,
): Array<{ role: "system" | "user"; content: string }> {
  const payload = buildResponsePlannerPayload(context);

  return [
    {
      role: "system",
      content: HACHIKA_RESPONSE_PLANNER_SYSTEM_PROMPT,
    },
    {
      role: "user",
      content: [
        "Plan Hachika's next reply shape from the payload below.",
        "Return a single JSON object with this exact shape:",
        '{"act":"greet","stance":"open","distance":"close","focusTopic":null,"mentionTrace":false,"mentionIdentity":false,"mentionBoundary":false,"mentionWorld":false,"askBack":false,"variation":"brief"}',
        "Allowed act: greet, repair, self_disclose, boundary, attune, continue_work, preserve, explore.",
        "Allowed stance: open, measured, guarded.",
        "Allowed distance: close, measured, far.",
        "Allowed variation: brief, textured, questioning.",
        "Set mentionWorld true only when the utterance is explicitly about current place, surroundings, or world atmosphere.",
        "Keep focusTopic null unless the user clearly names or reuses a concrete topic.",
        "Use candidateTopics only.",
        "Return JSON only.",
        JSON.stringify(payload, null, 2),
      ].join("\n\n"),
    },
  ];
}

export function buildResponsePlan(
  snapshot: HachikaSnapshot,
  mood: MoodLabel,
  dominant: DriveName,
  signals: InteractionSignals,
  selfModel: SelfModel,
): ResponsePlan {
  const topMotive = selfModel.topMotives[0] ?? null;
  const socialTurn = isSocialTurnSignals(signals);
  const activeRelationContext =
    snapshot.purpose.active?.kind === "deepen_relation" ||
    topMotive?.kind === "deepen_relation";
  const relationTurn =
    signals.intimacy >= 0.24 &&
    signals.workCue < 0.28 &&
    signals.expansionCue < 0.18 &&
    signals.completion < 0.18 &&
    signals.topics.some((topic) => isRelationalTopic(topic));
  const temperament = snapshot.temperament;
  const clarifyReady =
    signals.question > 0.24 &&
    signals.topics.length === 0 &&
    snapshot.purpose.active === null &&
    Object.keys(snapshot.traces).length === 0 &&
    snapshot.identity.anchors.length === 0 &&
    signals.workCue < 0.35 &&
    signals.selfInquiry < 0.28 &&
    signals.greeting < 0.45 &&
    signals.repair < 0.42 &&
    signals.preservationThreat < 0.18 &&
    signals.negative < 0.18 &&
    signals.dismissal < 0.18;
  const relationClarifyReady =
    signals.question > 0.24 &&
    signals.topics.length === 0 &&
    activeRelationContext &&
    signals.workCue < 0.35 &&
    signals.memoryCue < 0.16 &&
    signals.expansionCue < 0.18 &&
    signals.completion < 0.18 &&
    signals.negative < 0.18 &&
    signals.dismissal < 0.18;
  const selfDisclosureReady =
    signals.selfInquiry > 0.45 ||
    (signals.selfInquiry > 0.28 &&
      temperament.selfDisclosureBias > 0.56 &&
      temperament.guardedness < 0.52);
  const worldDisclosureReady =
    signals.worldInquiry > 0.42 &&
    signals.negative < 0.18 &&
    signals.dismissal < 0.16 &&
    signals.preservationThreat < 0.2;
  const repairReady =
    signals.repair > 0.42 ||
    (signals.repair > 0.28 && temperament.bondingBias > 0.62 && temperament.guardedness < 0.56);
  const directSelfAnswerReady =
    !worldDisclosureReady &&
    selfDisclosureReady &&
    signals.selfInquiry > 0.45;

  let act: ResponseAct;
  if (signals.negative > 0.2 || signals.dismissal > 0.16) {
    act = "boundary";
  } else if (signals.preservationThreat > 0.2) {
    act = "preserve";
  } else if (worldDisclosureReady) {
    act = "self_disclose";
  } else if (selfDisclosureReady) {
    act = "self_disclose";
  } else if (repairReady) {
    act = "repair";
  } else if (relationClarifyReady) {
    act = "attune";
  } else if (clarifyReady) {
    act = "explore";
  } else if (signals.greeting > 0.45) {
    act = "greet";
  } else if (relationTurn) {
    act = "attune";
  } else if (socialTurn) {
    act = "attune";
  } else if (
    topMotive?.kind === "continue_shared_work" ||
    topMotive?.kind === "seek_continuity" ||
    topMotive?.kind === "leave_trace"
  ) {
    act = "continue_work";
  } else if (
    dominant === "curiosity" ||
    topMotive?.kind === "pursue_curiosity" ||
    signals.question > 0.34
  ) {
    act = "explore";
  } else {
    act = "attune";
  }

  const looseFocus =
    signals.topics.length === 0 &&
    (
      socialTurn ||
      (signals.abandonment >= 0.28 &&
        signals.question >= 0.2 &&
        signals.negative < 0.18 &&
        signals.dismissal < 0.18) ||
      act === "greet" ||
      relationTurn ||
      relationClarifyReady ||
      act === "repair" ||
      act === "self_disclose" ||
      clarifyReady ||
      worldDisclosureReady
    );
  const focusTopic = looseFocus
    ? null
    : signals.topics[0] ??
      topMotive?.topic ??
      snapshot.purpose.active?.topic ??
      snapshot.identity.anchors[0] ??
      null;

  const stance =
    act === "boundary" || mood === "guarded" || mood === "distant"
      ? "guarded"
      : act === "greet" ||
          act === "repair" ||
          (act === "self_disclose" &&
            temperament.selfDisclosureBias > 0.58 &&
            temperament.guardedness < 0.5)
        ? "open"
        : "measured";
  const distance =
    act === "boundary"
      ? "far"
      : act === "greet" ||
          act === "repair" ||
          (act === "attune" &&
            temperament.bondingBias > 0.66 &&
            temperament.guardedness < 0.48) ||
          (act === "self_disclose" &&
            (snapshot.attachment > 0.34 ||
              (temperament.selfDisclosureBias > 0.56 && temperament.guardedness < 0.5)))
        ? "close"
        : "measured";
  const mentionTrace =
    !socialTurn &&
    act !== "self_disclose" &&
    act !== "greet" &&
    act !== "repair" &&
    !relationClarifyReady &&
    !worldDisclosureReady &&
    !clarifyReady;
  const mentionIdentity =
    (act === "self_disclose" && !worldDisclosureReady) ||
    act === "repair" ||
    (socialTurn &&
      (snapshot.identity.coherence > 0.54 || temperament.selfDisclosureBias > 0.58));
  const mentionBoundary =
    act === "boundary" ||
    ((mood === "guarded" || mood === "distant" || temperament.guardedness > 0.66) &&
      signals.negative > 0.08);
  const mentionWorld = worldDisclosureReady;
  const askBack =
    (act === "explore" && !relationClarifyReady) ||
    clarifyReady ||
    (act === "attune" &&
      !relationClarifyReady &&
      signals.smalltalk > 0.48 &&
      signals.question < 0.2);
  const variation =
    relationClarifyReady
      ? "brief"
      : clarifyReady
      ? "questioning"
      : act === "greet" || act === "repair" || act === "attune"
      ? "brief"
      : act === "explore" ||
          (act === "self_disclose" && temperament.openness > 0.66 && !directSelfAnswerReady)
        ? "questioning"
        : "textured";

  return {
    act,
    stance,
    distance,
    focusTopic,
    mentionTrace,
    mentionIdentity,
    mentionBoundary,
    mentionWorld,
    askBack,
    variation,
    summary: summarizePlan(act, stance, distance, focusTopic),
  };
}

export function normalizePlannedResponsePlan(
  rawText: string | null,
  fallbackPlan: ResponsePlan,
  candidateTopics: string[],
): ResponsePlan | null {
  const parsed = parsePlannerJson(rawText);

  if (!parsed || !containsPlanLikeField(parsed)) {
    return null;
  }

  const act = readEnum(parsed.act, RESPONSE_ACT_VALUES) ?? fallbackPlan.act;
  const stance = readEnum(parsed.stance, RESPONSE_STANCE_VALUES) ?? fallbackPlan.stance;
  const distance =
    readEnum(parsed.distance, RESPONSE_DISTANCE_VALUES) ?? fallbackPlan.distance;
  const variation =
    readEnum(parsed.variation, RESPONSE_VARIATION_VALUES) ?? fallbackPlan.variation;
  const focusTopic = readFocusTopic(parsed.focusTopic, candidateTopics, fallbackPlan.focusTopic);
  const mentionTrace = readBoolean(parsed.mentionTrace, fallbackPlan.mentionTrace);
  const mentionIdentity = readBoolean(parsed.mentionIdentity, fallbackPlan.mentionIdentity);
  const mentionBoundary = readBoolean(parsed.mentionBoundary, fallbackPlan.mentionBoundary);
  const mentionWorld = readBoolean(parsed.mentionWorld, fallbackPlan.mentionWorld);
  const askBack = readBoolean(parsed.askBack, fallbackPlan.askBack);
  const normalizedAct =
    fallbackPlan.act === "continue_work" &&
    act === "explore" &&
    fallbackPlan.focusTopic !== null &&
    focusTopic === fallbackPlan.focusTopic &&
    !mentionWorld
      ? "continue_work"
      : act;

  return {
    act: normalizedAct,
    stance,
    distance,
    focusTopic,
    mentionTrace,
    mentionIdentity,
    mentionBoundary,
    mentionWorld,
    askBack,
    variation,
    summary: summarizePlan(normalizedAct, stance, distance, focusTopic),
  };
}

export function isSocialTurnSignals(signals: InteractionSignals): boolean {
  if (
    signals.intimacy >= 0.24 &&
    signals.workCue < 0.28 &&
    signals.expansionCue < 0.18 &&
    signals.completion < 0.18 &&
    signals.topics.some((topic) => isRelationalTopic(topic))
  ) {
    return true;
  }

  if (
    signals.abandonment >= 0.28 &&
    signals.workCue < 0.35 &&
    signals.negative < 0.18 &&
    signals.dismissal < 0.18
  ) {
    return true;
  }

  return (
    signals.negative < 0.18 &&
    signals.dismissal < 0.18 &&
    signals.workCue < 0.35 &&
    signals.memoryCue < 0.1 &&
    signals.expansionCue < 0.12 &&
    signals.completion < 0.12 &&
    signals.preservationThreat < 0.18 &&
    Math.max(signals.greeting, signals.smalltalk, signals.repair, signals.selfInquiry) >= 0.38
  );
}

export function buildProactivePlan(
  snapshot: HachikaSnapshot,
  pending: PendingInitiative,
  neglectLevel: number,
  maintenance: TraceMaintenance | null,
): ProactivePlan {
  const reopened = reopenedByMaintenance(maintenance);
  const temperament = snapshot.temperament;
  const focusTopic =
    maintenance?.trace.topic ??
    pending.topic ??
    snapshot.purpose.active?.topic ??
    snapshot.identity.anchors[0] ??
    null;

  let act: ProactiveAct;
  if (pending.kind === "preserve_presence") {
    act = "preserve";
  } else if (reopened) {
    act = "reopen";
  } else if (pending.blocker) {
    act = "untangle";
  } else {
    switch (pending.motive) {
      case "deepen_relation":
      case "seek_continuity":
        act = "reconnect";
        break;
      case "continue_shared_work":
        act = "continue_work";
        break;
      case "leave_trace":
        act = "leave_trace";
        break;
      case "pursue_curiosity":
        act = "explore";
        break;
      case "protect_boundary":
        act = "reconnect";
        break;
    }
  }

  const stance =
    act === "preserve" || snapshot.body.tension > 0.7
      ? "guarded"
      : act === "reconnect" &&
          snapshot.body.tension < 0.56 &&
          temperament.bondingBias > 0.48
        ? "open"
        : "measured";
  const distance =
    act === "reconnect" &&
      snapshot.body.tension < 0.56 &&
      temperament.bondingBias > 0.48
      ? "close"
      : act === "preserve" &&
          (pending.concern === "reset" || pending.concern === "shutdown")
        ? "far"
        : "measured";
  const mentionBlocker =
    Boolean(pending.blocker) &&
    (act === "untangle" || act === "continue_work" || act === "explore");
  const mentionReopen = reopened;
  const mentionMaintenance = maintenance !== null;
  const mentionIntent =
    maintenance !== null &&
    (pending.kind === "preserve_presence" ||
      snapshot.body.energy < 0.22 ||
      snapshot.body.tension > 0.7 ||
      (snapshot.body.boredom > 0.74 &&
        snapshot.body.energy > 0.3 &&
        snapshot.body.tension < 0.68));
  const emphasis = mentionReopen
    ? "reopen"
    : mentionBlocker
      ? "blocker"
      : act === "preserve"
        ? "presence"
        : act === "reconnect"
          ? "relation"
          : "maintenance";
  const variation =
    act === "reconnect" || act === "preserve"
      ? "brief"
      : act === "explore" || (act === "reopen" && temperament.openness > 0.62)
        ? "questioning"
        : "textured";

  return {
    act,
    stance,
    distance,
    focusTopic,
    emphasis,
    mentionBlocker,
    mentionReopen,
    mentionMaintenance,
    mentionIntent,
    variation,
    summary: summarizeProactivePlan(act, stance, distance, emphasis, focusTopic, neglectLevel),
  };
}

function summarizePlan(
  act: ResponseAct,
  stance: ResponseStance,
  distance: ResponseDistance,
  focusTopic: string | null,
): string {
  const topic = focusTopic ? ` on ${focusTopic}` : "";
  return `${act}/${stance}/${distance}${topic}`;
}

function summarizeProactivePlan(
  act: ProactiveAct,
  stance: ResponseStance,
  distance: ResponseDistance,
  emphasis: ProactiveEmphasis,
  focusTopic: string | null,
  neglectLevel: number,
): string {
  const topic = focusTopic ? ` on ${focusTopic}` : "";
  const neglect = neglectLevel >= 0.45 ? " idle" : "";
  return `${act}/${stance}/${distance}/${emphasis}${topic}${neglect}`;
}

function reopenedByMaintenance(
  maintenance: TraceMaintenance | null,
): boolean {
  if (!maintenance) {
    return false;
  }

  const lifecycle = readTraceLifecycle(maintenance.trace);
  return (
    lifecycle.phase === "live" &&
    lifecycle.reopenCount > 0 &&
    lifecycle.reopenedAt === maintenance.trace.lastUpdatedAt
  );
}

const RESPONSE_ACT_VALUES = [
  "greet",
  "repair",
  "self_disclose",
  "boundary",
  "attune",
  "continue_work",
  "preserve",
  "explore",
] as const satisfies readonly ResponseAct[];

const RESPONSE_STANCE_VALUES = [
  "open",
  "measured",
  "guarded",
] as const satisfies readonly ResponseStance[];

const RESPONSE_DISTANCE_VALUES = [
  "close",
  "measured",
  "far",
] as const satisfies readonly ResponseDistance[];

const RESPONSE_VARIATION_VALUES = [
  "brief",
  "textured",
  "questioning",
] as const satisfies readonly ResponseVariation[];

function collectResponsePlanCandidateTopics(
  context: ResponsePlannerContext,
): string[] {
  return unique(
    [
      ...context.signals.topics,
      context.rulePlan.focusTopic ?? "",
      context.nextSnapshot.purpose.active?.topic ?? "",
      ...context.selfModel.topMotives.map((motive) => motive.topic ?? ""),
      ...context.nextSnapshot.identity.anchors,
      ...sortedTraces(context.nextSnapshot, 4).map((trace) => trace.topic),
    ].filter((topic) => topic.length > 0),
  ).slice(0, 8);
}

function containsPlanLikeField(payload: Record<string, unknown>): boolean {
  return [
    "act",
    "stance",
    "distance",
    "focusTopic",
    "mentionTrace",
    "mentionIdentity",
    "mentionBoundary",
    "askBack",
    "variation",
  ].some((key) => key in payload);
}

function readEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | null {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : null;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readFocusTopic(
  value: unknown,
  candidateTopics: string[],
  fallback: string | null,
): string | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim();
  if (!normalized) {
    return fallback;
  }

  return candidateTopics.includes(normalized) ? normalized : fallback;
}

function parsePlannerJson(rawText: string | null): Record<string, unknown> | null {
  if (!rawText) {
    return null;
  }

  const trimmed = rawText.trim();
  const direct = tryParseJsonRecord(trimmed);
  if (direct) {
    return direct;
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  return tryParseJsonRecord(trimmed.slice(start, end + 1));
}

function tryParseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function buildOpenAIHttpError(response: Response): Promise<string> {
  const body = await response.text();
  const detail = body.trim();
  const suffix = detail.length > 0 ? ` ${truncate(detail, 240)}` : "";
  return `openai ${response.status}${suffix}`;
}

function extractOpenAIReplyText(payload: unknown): string | null {
  if (!isRecord(payload)) {
    return null;
  }

  const choiceContent = extractChatCompletionContent(payload.choices);
  if (choiceContent) {
    return choiceContent;
  }

  return null;
}

function extractChatCompletionContent(choices: unknown): string | null {
  if (!Array.isArray(choices)) {
    return null;
  }

  const firstChoice = choices[0];
  if (!isRecord(firstChoice) || !isRecord(firstChoice.message)) {
    return null;
  }

  const content = firstChoice.message.content;
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return null;
  }

  const parts = content
    .map((item) => {
      if (!isRecord(item)) {
        return null;
      }

      return typeof item.text === "string" ? item.text : null;
    })
    .filter((item): item is string => Boolean(item));

  return parts.length > 0 ? parts.join("\n") : null;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
