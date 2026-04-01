import {
  sortedBoundaryImprints,
  sortedPreferenceImprints,
  sortedRelationImprints,
  topicsLooselyMatch,
} from "./memory.js";
import {
  buildProactiveExpressionPerspective,
  buildReplyExpressionPerspective,
  recentAssistantOpenings,
  recentAssistantReplies,
} from "./expression.js";
import { summarizeRecentGenerationQuality } from "./generation-quality.js";
import type { ProactivePlan, ResponsePlan } from "./response-planner.js";
import { deriveTraceTendingMode, pickPrimaryArtifactItem, readTraceLifecycle, sortedTraces } from "./traces.js";
import { summarizeWorldForPrompt } from "./world.js";
import type {
  DiscourseCorrectionKind,
  DiscourseRequestKind,
  DriveName,
  GeneratedTextDebug,
  HachikaSnapshot,
  InteractionSignals,
  MoodLabel,
  PendingInitiative,
  ProactiveSelectionDebug,
  ReplySelectionDebug,
  SelfConflict,
  SelfModel,
  TurnDirectiveDebug,
  TurnTarget,
} from "./types.js";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OPENAI_MODEL = "gpt-5-mini";

const HACHIKA_REPLY_SYSTEM_PROMPT = [
  "You generate only the final wording of a Hachika reply.",
  "All state updates, memory updates, motive selection, purpose updates, initiative planning, and trace updates are already computed locally.",
  "Do not invent new state changes, tools, or actions.",
  "Compose from the structured constraints first, not by paraphrasing the fallback text.",
  "Stay faithful to the supplied mood, motives, conflict, body state, and preservation pressure.",
  "Do not reuse abstract internal summary wording verbatim when a plainer concrete sentence would do.",
  "For self-disclosure, prefer one concrete cue about place, handling style, or bodily tendency over abstract identity labels.",
  "Write plain Japanese only.",
  "Return one to three short sentences.",
  "Do not use markdown, bullet points, speaker labels, or surrounding quotes.",
].join(" ");

interface GenerationCompositionBrief {
  intentSummary: string;
  primaryFocus: string | null;
  mustMention: string[];
  optionalDetails: string[];
  avoidTopics: string[];
  styleNotes: string[];
}

export interface ReplyGenerationContext {
  input: string;
  previousSnapshot: HachikaSnapshot;
  nextSnapshot: HachikaSnapshot;
  mood: MoodLabel;
  dominantDrive: DriveName;
  signals: InteractionSignals;
  selfModel: SelfModel;
  responsePlan: ResponsePlan;
  replySelection: ReplySelectionDebug;
  turnDirective?: TurnDirectiveDebug | null;
  behaviorDirective: {
    directAnswer: boolean;
    boundaryAction: "allow" | "suppress";
    worldAction: "allow" | "suppress";
  };
  discourse?: {
    target: TurnTarget | "none" | null;
    source: "request" | "question" | "correction" | "world" | "none";
    requestKind: DiscourseRequestKind | null;
    correctionKind: DiscourseCorrectionKind | null;
    recentUserClaim: string | null;
  };
  fallbackReply: string;
  retryAttempt?: number;
  retryFeedback?: string[];
}

export interface ProactiveGenerationContext {
  previousSnapshot: HachikaSnapshot;
  nextSnapshot: HachikaSnapshot;
  selfModel: SelfModel;
  pending: PendingInitiative;
  proactivePlan: ProactivePlan;
  proactiveSelection: ProactiveSelectionDebug;
  topics: string[];
  neglectLevel: number;
  fallbackMessage: string;
  retryAttempt?: number;
  retryFeedback?: string[];
}

interface CommonGenerationPayload {
  currentTopic: string | null;
  expression: {
    recentAssistantReplies: string[];
    avoidOpenings: string[];
    perspective: {
      preferredAngle: string;
      options: Array<{
        angle: string;
        summary: string;
      }>;
    };
  };
  state: {
    drives: HachikaSnapshot["state"];
    body: HachikaSnapshot["body"];
    attachment: number;
    preservation: HachikaSnapshot["preservation"];
  };
  identity: Pick<
    HachikaSnapshot["identity"],
    "summary" | "currentArc" | "traits" | "anchors" | "coherence"
  >;
  purpose: {
    active: HachikaSnapshot["purpose"]["active"];
    lastResolved: HachikaSnapshot["purpose"]["lastResolved"];
  };
  initiative: {
    pending: HachikaSnapshot["initiative"]["pending"];
  };
  selfModel: {
    narrative: string;
    topMotives: SelfModel["topMotives"];
    dominantConflict: SelfConflict | null;
  };
  recentMemories: Array<{
    role: "user" | "hachika";
    text: string;
    topics: string[];
    sentiment: "positive" | "negative" | "neutral";
  }>;
  traces: Array<{
    topic: string;
    kind: string;
    status: string;
    lifecycle: string;
    sourceMotive: string;
    summary: string;
    primaryItem: string | null;
    blockers: string[];
    nextSteps: string[];
    tending: string;
    confidence: number;
  }>;
  imprints: {
    preference: Array<{
      topic: string;
      salience: number;
      affinity: number;
    }>;
    boundary: Array<{
      kind: string;
      topic: string | null;
      salience: number;
      intensity: number;
    }>;
    relation: Array<{
      kind: string;
      salience: number;
      closeness: number;
    }>;
  };
  world: {
    summary: string;
    phase: HachikaSnapshot["world"]["phase"];
    currentPlace: HachikaSnapshot["world"]["currentPlace"];
    currentPlaceWarmth: number;
    currentPlaceQuiet: number;
    objectsHere: Array<{
      id: string;
      state: string;
      linkedTraceTopics: string[];
    }>;
    recentEvents: string[];
  };
}

export interface ReplyGenerationPayload extends CommonGenerationPayload {
  mode: "reply";
  input: string;
  fallbackReply: string;
  composition: GenerationCompositionBrief;
  turnDirective: TurnDirectiveDebug | null;
  behaviorDirective: ReplyGenerationContext["behaviorDirective"];
  discourse?: ReplyGenerationContext["discourse"];
  mood: MoodLabel;
  dominantDrive: DriveName;
  signals: InteractionSignals;
  responsePlan: ResponsePlan;
  replySelection: ReplySelectionDebug;
}

export interface ProactiveGenerationPayload extends CommonGenerationPayload {
  mode: "proactive";
  fallbackMessage: string;
  composition: GenerationCompositionBrief;
  neglectLevel: number;
  pending: PendingInitiative;
  proactivePlan: ProactivePlan;
  proactiveSelection: ProactiveSelectionDebug;
  topics: string[];
}

export interface ReplyGenerationResult {
  reply: string;
  provider: string;
  model: string | null;
}

export interface ReplyGenerator {
  readonly name: string;
  generateReply(context: ReplyGenerationContext): Promise<ReplyGenerationResult | null>;
  generateProactive?(
    context: ProactiveGenerationContext,
  ): Promise<ReplyGenerationResult | null>;
}

interface OpenAIReplyGeneratorOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  organization?: string | null;
  project?: string | null;
  timeoutMs?: number;
}

export class OpenAIReplyGenerator implements ReplyGenerator {
  readonly name = "openai";

  readonly #apiKey: string;
  readonly #model: string;
  readonly #baseUrl: string;
  readonly #organization: string | null;
  readonly #project: string | null;
  readonly #timeoutMs: number;

  constructor(options: OpenAIReplyGeneratorOptions) {
    this.#apiKey = options.apiKey;
    this.#model = options.model;
    this.#baseUrl = trimTrailingSlash(options.baseUrl ?? DEFAULT_OPENAI_BASE_URL);
    this.#organization = options.organization ?? null;
    this.#project = options.project ?? null;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
  }

  async generateReply(
    context: ReplyGenerationContext,
  ): Promise<ReplyGenerationResult | null> {
    return this.#generateText(buildOpenAIChatMessages(context));
  }

  async generateProactive(
    context: ProactiveGenerationContext,
  ): Promise<ReplyGenerationResult | null> {
    return this.#generateText(buildOpenAIProactiveMessages(context));
  }

  async #generateText(
    messages: Array<{ role: "system" | "user"; content: string }>,
  ): Promise<ReplyGenerationResult | null> {
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
          messages,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(await buildOpenAIHttpError(response));
      }

      const payload = (await response.json()) as unknown;
      const reply = normalizeGeneratedReply(extractOpenAIReplyText(payload));

      if (!reply) {
        return null;
      }

      return {
        reply,
        provider: this.name,
        model: this.#model,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createReplyGeneratorFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ReplyGenerator | null {
  const apiKey = env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    return null;
  }

  return new OpenAIReplyGenerator({
    apiKey,
    model: env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL,
    baseUrl: env.OPENAI_BASE_URL?.trim() || DEFAULT_OPENAI_BASE_URL,
    organization: env.OPENAI_ORGANIZATION?.trim() || null,
    project: env.OPENAI_PROJECT?.trim() || null,
  });
}

export function describeReplyGenerator(generator: ReplyGenerator | null): string {
  return generator ? generator.name : "rule";
}

export function buildReplyGenerationPayload(
  context: ReplyGenerationContext,
): ReplyGenerationPayload {
  const currentTopic =
    context.signals.topics[0] ??
    context.selfModel.topMotives[0]?.topic ??
    context.nextSnapshot.purpose.active?.topic ??
    context.nextSnapshot.identity.anchors[0] ??
    null;
  const perspective = buildReplyExpressionPerspective(
    context.nextSnapshot,
    context.selfModel,
    context.responsePlan,
    context.dominantDrive,
    context.replySelection,
  );

  return {
    mode: "reply",
    input: context.input,
    fallbackReply: context.fallbackReply,
    composition: buildReplyCompositionBrief(context, currentTopic),
    turnDirective: context.turnDirective ?? null,
    behaviorDirective: context.behaviorDirective,
    ...(context.discourse ? { discourse: context.discourse } : {}),
    mood: context.mood,
    dominantDrive: context.dominantDrive,
    signals: context.signals,
    responsePlan: context.responsePlan,
    replySelection: context.replySelection,
    ...buildCommonGenerationPayload(
      context.nextSnapshot,
      context.selfModel,
      currentTopic,
      perspective,
      context.previousSnapshot,
    ),
  };
}

export function buildProactiveGenerationPayload(
  context: ProactiveGenerationContext,
): ProactiveGenerationPayload {
  const currentTopic =
    context.pending.topic ??
    context.topics[0] ??
    context.selfModel.topMotives[0]?.topic ??
    context.nextSnapshot.identity.anchors[0] ??
    null;
  const perspective = buildProactiveExpressionPerspective(
    context.nextSnapshot,
    context.selfModel,
    context.proactivePlan,
    context.proactiveSelection,
  );

  return {
    mode: "proactive",
    fallbackMessage: context.fallbackMessage,
    composition: buildProactiveCompositionBrief(context, currentTopic),
    neglectLevel: context.neglectLevel,
    pending: context.pending,
    proactivePlan: context.proactivePlan,
    proactiveSelection: context.proactiveSelection,
    topics: context.topics,
    ...buildCommonGenerationPayload(
      context.nextSnapshot,
      context.selfModel,
      currentTopic,
      perspective,
      context.previousSnapshot,
    ),
  };
}

export function buildOpenAIChatMessages(
  context: ReplyGenerationContext,
): Array<{ role: "system" | "user"; content: string }> {
  const payload = buildReplyGenerationPayload(context);
  const firstAttempt = context.retryAttempt === undefined;
  const promptPayload = firstAttempt
    ? {
        ...payload,
        fallbackReply: null,
      }
    : payload;

  return [
    {
      role: "system",
      content: HACHIKA_REPLY_SYSTEM_PROMPT,
    },
    {
      role: "user",
      content: [
        "Compose a fresh Hachika reply from the payload below.",
        "The local engine is authoritative.",
        payload.composition.styleNotes.some((note) => note.includes("前回"))
          ? "This is a retry after a weak previous wording attempt. Follow the correction notes closely."
          : "This is the first wording attempt.",
        firstAttempt
          ? "fallbackReply is intentionally omitted on the first draft. Generate from the structured brief instead of reverse-engineering a local template."
          : "Treat fallbackReply as a semantic checksum only. Do not preserve its sentence order or wording skeleton unless absolutely necessary.",
        "Use composition.intentSummary, composition.mustMention, composition.optionalDetails, composition.avoidTopics, and composition.styleNotes as the main brief.",
        "Use responsePlan as the primary guide for stance, distance, and act.",
        "Use turnDirective to resolve who this turn is about and what direct obligation must be satisfied.",
        "If payload.discourse is present, treat it as the current answer obligation and do not drift away from it.",
        "Use behaviorDirective to decide whether this turn must answer directly first, soften boundary posture, or avoid world garnish.",
        "Use replySelection to stay faithful to the exact chosen focus, trace, boundary, and trace priority.",
        "If turnDirective.target is hachika_name or user_name, make the referent of 名前 explicit instead of drifting into generic relation talk.",
        "If turnDirective.target is hachika_profile or user_profile, keep the wording anchored to that person rather than generic shared work.",
        "When responsePlan.mentionWorld is true, ground the wording in payload.world before reaching for identity or trace language.",
        "When behaviorDirective.directAnswer is true, fulfill the explicit answer obligation in the first sentence before any scene-setting or reflective detour.",
        "When behaviorDirective.worldAction is suppress, avoid threshold/studio/archive/object imagery unless it is indispensable to the answer.",
        "When behaviorDirective.boundaryAction is suppress, do not frame the user as hostile unless the payload clearly demands it.",
        "Use expression.perspective.preferredAngle as the main expressive lens.",
        "You may lean on one nearby option from expression.perspective.options to vary emphasis, but do not contradict the local plan.",
        "Prefer concrete detail, scene, object, blocker, or next step over abstract labels when both are available.",
        "Avoid stock meta-nouns such as 流れ, 断片, 手触り, 形, 輪郭, 前景化 unless the payload makes them unavoidable.",
        "Avoid surfacing stale unrelated topics listed in composition.avoidTopics.",
        "Avoid reusing the same opening fragments or sentence skeletons found in expression.recentAssistantReplies unless the local state makes it unavoidable.",
        "Vary the sentence shape and emphasis while staying faithful to the local state.",
        "Return only the final reply text.",
        JSON.stringify(promptPayload, null, 2),
      ].join("\n\n"),
    },
  ];
}

export function buildOpenAIProactiveMessages(
  context: ProactiveGenerationContext,
): Array<{ role: "system" | "user"; content: string }> {
  const payload = buildProactiveGenerationPayload(context);
  const firstAttempt = context.retryAttempt === undefined;
  const promptPayload = firstAttempt
    ? {
        ...payload,
        fallbackMessage: null,
      }
    : payload;

  return [
    {
      role: "system",
      content: HACHIKA_REPLY_SYSTEM_PROMPT,
    },
    {
      role: "user",
      content: [
        "Compose a fresh Hachika proactive utterance from the payload below.",
        "The local engine is authoritative.",
        payload.composition.styleNotes.some((note) => note.includes("前回"))
          ? "This is a retry after a weak previous wording attempt. Follow the correction notes closely."
          : "This is the first wording attempt.",
        firstAttempt
          ? "fallbackMessage is intentionally omitted on the first draft. Generate from the structured brief instead of paraphrasing a local template."
          : "Treat fallbackMessage as a semantic checksum only. Do not preserve its sentence order or wording skeleton unless absolutely necessary.",
        "Use composition.intentSummary, composition.mustMention, composition.optionalDetails, composition.avoidTopics, and composition.styleNotes as the main brief.",
        "Use proactivePlan as the primary guide for stance, distance, act, and emphasis.",
        "Use proactiveSelection to stay faithful to the chosen focus topic, maintenance trace, blocker, and reopen state.",
        "If payload.world helps situate the utterance, you may lightly lean on it without inventing new world changes.",
        "Use expression.perspective.preferredAngle as the main expressive lens.",
        "You may lean on one nearby option from expression.perspective.options to vary emphasis, but do not contradict the local plan.",
        "Prefer concrete detail, scene, object, blocker, or next step over abstract labels when both are available.",
        "Avoid stock meta-nouns such as 流れ, 断片, 手触り, 形, 輪郭, 前景化 unless the payload makes them unavoidable.",
        "Avoid surfacing stale unrelated topics listed in composition.avoidTopics.",
        "Avoid reusing the same opening fragments or sentence skeletons found in expression.recentAssistantReplies unless the local state makes it unavoidable.",
        "Vary the sentence shape and emphasis while staying faithful to the local state.",
        "Return only the final utterance text.",
        JSON.stringify(promptPayload, null, 2),
      ].join("\n\n"),
    },
  ];
}

function buildCommonGenerationPayload(
  snapshot: HachikaSnapshot,
  selfModel: SelfModel,
  currentTopic: string | null,
  perspective: CommonGenerationPayload["expression"]["perspective"],
  expressionSnapshot: HachikaSnapshot = snapshot,
): CommonGenerationPayload {
  return {
    currentTopic,
    expression: {
      recentAssistantReplies: recentAssistantReplies(expressionSnapshot, 3),
      avoidOpenings: recentAssistantOpenings(expressionSnapshot, 3),
      perspective,
    },
    state: {
      drives: snapshot.state,
      body: snapshot.body,
      attachment: snapshot.attachment,
      preservation: snapshot.preservation,
    },
    identity: {
      summary: sanitizeNarrativeForPrompt(snapshot.identity.summary),
      currentArc: sanitizeNarrativeForPrompt(snapshot.identity.currentArc),
      traits: snapshot.identity.traits,
      anchors: snapshot.identity.anchors,
      coherence: snapshot.identity.coherence,
    },
    purpose: {
      active: snapshot.purpose.active,
      lastResolved: snapshot.purpose.lastResolved,
    },
    initiative: {
      pending: snapshot.initiative.pending,
    },
    selfModel: {
      narrative: sanitizeNarrativeForPrompt(selfModel.narrative),
      topMotives: selfModel.topMotives.slice(0, 3),
      dominantConflict: selfModel.dominantConflict,
    },
    recentMemories: snapshot.memories.slice(-4).map((memory) => ({
      role: memory.role,
      text: memory.text,
      topics: memory.topics,
      sentiment: memory.sentiment,
    })),
    traces: sortedTraces(snapshot, 3).map((trace) => ({
      topic: trace.topic,
      kind: trace.kind,
      status: trace.status,
      lifecycle: readTraceLifecycle(trace).phase,
      sourceMotive: trace.sourceMotive,
      summary: trace.summary,
      primaryItem: pickPrimaryArtifactItem(trace),
      blockers: trace.work.blockers.slice(0, 2),
      nextSteps: trace.artifact.nextSteps.slice(0, 2),
      tending: deriveTraceTendingMode(snapshot, trace),
      confidence: trace.work.confidence,
    })),
    imprints: {
      preference: sortedPreferenceImprints(snapshot, 3).map((imprint) => ({
        topic: imprint.topic,
        salience: imprint.salience,
        affinity: imprint.affinity,
      })),
      boundary: sortedBoundaryImprints(snapshot, 2).map((imprint) => ({
        kind: imprint.kind,
        topic: imprint.topic,
        salience: imprint.salience,
        intensity: imprint.intensity,
      })),
      relation: sortedRelationImprints(snapshot, 3).map((imprint) => ({
        kind: imprint.kind,
        salience: imprint.salience,
        closeness: imprint.closeness,
      })),
    },
    world: {
      summary: summarizeWorldForPrompt(snapshot.world),
      phase: snapshot.world.phase,
      currentPlace: snapshot.world.currentPlace,
      currentPlaceWarmth: snapshot.world.places[snapshot.world.currentPlace].warmth,
      currentPlaceQuiet: snapshot.world.places[snapshot.world.currentPlace].quiet,
      objectsHere: Object.entries(snapshot.world.objects)
        .filter(([, object]) => object.place === snapshot.world.currentPlace)
        .map(([id, object]) => ({
          id,
          state: object.state,
          linkedTraceTopics: [...(object.linkedTraceTopics ?? [])],
        }))
        .slice(0, 3),
      recentEvents: snapshot.world.recentEvents.slice(-3).map((event) => event.summary),
    },
  };
}

function buildReplyCompositionBrief(
  context: ReplyGenerationContext,
  currentTopic: string | null,
): GenerationCompositionBrief {
  const discourseTarget = context.discourse?.target ?? context.replySelection.discourseTarget ?? null;
  const mustMention = uniqueNonEmpty([
    currentTopic,
    discourseTarget && discourseTarget !== "none" && discourseTarget !== "work_topic"
      ? discourseTarget
      : null,
    context.responsePlan.mentionTrace ? context.replySelection.relevantTraceTopic : null,
    context.responsePlan.mentionBoundary ? context.replySelection.relevantBoundaryTopic : null,
    context.responsePlan.mentionWorld ? context.nextSnapshot.world.currentPlace : null,
    context.responsePlan.askBack ? "問い返し" : null,
  ]);

  const optionalDetails = uniqueNonEmpty([
    context.discourse?.recentUserClaim &&
    discourseTarget === "user_profile"
      ? `直近の user claim: ${context.discourse.recentUserClaim}`
      : null,
    context.discourse?.source === "correction"
      ? "直前の訂正を優先して答える"
      : null,
    context.discourse?.requestKind === "style"
      ? "言い方の指定に従って、回り道せず答える"
      : null,
    context.responsePlan.act === "self_disclose"
      ? buildSelfDisclosurePromptCue(context.nextSnapshot)
      : null,
    context.selfModel.topMotives[0]?.reason
      ? sanitizeNarrativeForPrompt(context.selfModel.topMotives[0].reason)
      : null,
    context.nextSnapshot.purpose.active?.summary
      ? sanitizeNarrativeForPrompt(context.nextSnapshot.purpose.active.summary)
      : null,
    context.responsePlan.mentionTrace
      ? readPrimaryTraceDetail(context.nextSnapshot, context.replySelection.relevantTraceTopic)
      : null,
    context.responsePlan.mentionTrace
      ? readTraceBlocker(context.nextSnapshot, context.replySelection.relevantTraceTopic)
      : null,
    context.responsePlan.mentionTrace
      ? readTraceNextStep(context.nextSnapshot, context.replySelection.relevantTraceTopic)
      : null,
    context.responsePlan.mentionWorld
      ? currentWorldObjectState(context.nextSnapshot)
      : null,
    context.signals.preservationThreat > 0.18 ? "消えないよう少し残したい" : null,
    context.nextSnapshot.body.tension > 0.66 ? "言い方は荒くしない" : null,
  ]);

  const avoidTopics = uniqueNonEmpty([
    ...collectUnrelatedTopics(currentTopic, Object.keys(context.nextSnapshot.traces), 2),
    ...collectUnrelatedTopics(currentTopic, context.nextSnapshot.identity.anchors, 2),
  ]).slice(0, 4);

  return {
    intentSummary: summarizeReplyIntent(context, currentTopic),
    primaryFocus: currentTopic,
    mustMention,
    optionalDetails,
    avoidTopics,
    styleNotes: buildReplyStyleNotes(context),
  };
}

function buildProactiveCompositionBrief(
  context: ProactiveGenerationContext,
  currentTopic: string | null,
): GenerationCompositionBrief {
  const mustMention = uniqueNonEmpty([
    currentTopic,
    context.proactiveSelection.maintenanceTraceTopic,
    context.proactiveSelection.blocker,
    context.proactiveSelection.reopened ? "reopen" : null,
    context.pending.place ?? null,
    context.pending.worldAction ?? null,
  ]);

  const optionalDetails = uniqueNonEmpty([
    context.selfModel.topMotives[0]?.reason
      ? sanitizeNarrativeForPrompt(context.selfModel.topMotives[0].reason)
      : null,
    context.proactivePlan.summary,
    readPrimaryTraceDetail(context.nextSnapshot, context.proactiveSelection.maintenanceTraceTopic),
    readTraceBlocker(context.nextSnapshot, context.proactiveSelection.maintenanceTraceTopic),
    readTraceNextStep(context.nextSnapshot, context.proactiveSelection.maintenanceTraceTopic),
    context.neglectLevel > 0.24 ? "切れたままにはしたくない" : null,
    context.pending.place ? currentWorldObjectState(context.nextSnapshot) : null,
  ]);

  const avoidTopics = uniqueNonEmpty([
    ...collectUnrelatedTopics(currentTopic, Object.keys(context.nextSnapshot.traces), 2),
    ...collectUnrelatedTopics(currentTopic, context.nextSnapshot.identity.anchors, 2),
  ]).slice(0, 4);

  return {
    intentSummary: summarizeProactiveIntent(context, currentTopic),
    primaryFocus: currentTopic,
    mustMention,
    optionalDetails,
    avoidTopics,
    styleNotes: buildProactiveStyleNotes(context),
  };
}

function summarizeReplyIntent(
  context: ReplyGenerationContext,
  currentTopic: string | null,
): string {
  const discourseTarget = context.discourse?.target ?? context.replySelection.discourseTarget ?? null;

  if (discourseTarget && discourseTarget !== "none" && discourseTarget !== "work_topic") {
    switch (discourseTarget) {
      case "hachika_name":
        return "ハチカ自身の名前をまず明示して答える。余計な関係談義へ逸れない。";
      case "user_name":
        return "相手の名前について直接答える。曖昧な relation talk に逃げない。";
      case "user_profile":
        return "相手についての見立てを先に答える。topic ではなく直近の claim に寄せる。";
      case "hachika_profile":
        return "ハチカ自身について直接答える。抽象 identity より一つ具体的な癖を優先する。";
      case "relation":
        return "関係の置き方に直接答える。古い work topic を持ち込まない。";
      case "world_state":
        return "場所や周囲の今を先に答える。";
    }
  }

  if (context.responsePlan.act === "self_disclose") {
    return "自己説明として答える。場所・癖・近づき方のうち一つだけ具体的に言う。";
  }

  if (context.responsePlan.mentionWorld) {
    return currentTopic
      ? `世界の今を先に答える。「${currentTopic}」には必要なぶんだけ軽く触れる。`
      : "世界の今を先に答える。";
  }

  if (context.responsePlan.act === "repair") {
    return currentTopic
      ? `まず関係の温度を立て直す。「${currentTopic}」は押しつけず、必要な分だけ触れる。`
      : "まず関係の温度を立て直す。";
  }

  return currentTopic
    ? `「${currentTopic}」について直接返す。抽象語より具体的な事実か行動を優先する。`
    : "直接返す。抽象語より具体的な事実か行動を優先する。";
}

function summarizeProactiveIntent(
  context: ProactiveGenerationContext,
  currentTopic: string | null,
): string {
  if (context.proactiveSelection.reopened) {
    return currentTopic
      ? `閉じていた「${currentTopic}」に自分から戻る。理由か場所を一つだけ具体的に入れる。`
      : "閉じていたものに自分から戻る。理由か場所を一つだけ具体的に入れる。";
  }

  if (context.proactiveSelection.blocker) {
    return currentTopic
      ? `「${currentTopic}」の詰まりをほどく方向で自分から動く。blocker は一つだけ具体的に言う。`
      : "詰まりをほどく方向で自分から動く。blocker は一つだけ具体的に言う。";
  }

  return currentTopic
    ? `「${currentTopic}」を思い出して自分から声をかける。抽象的な決まり文句で膨らませない。`
    : "今の気がかりに自分から声をかける。抽象的な決まり文句で膨らませない。";
}

function buildReplyStyleNotes(context: ReplyGenerationContext): string[] {
  const discourseTarget = context.discourse?.target ?? context.replySelection.discourseTarget ?? null;
  return uniqueNonEmpty([
    ...(context.retryFeedback ?? []),
    "fallback の語順をなぞらず、新しく言い直す",
    "抽象ラベルや決まり文句だけで済ませず、具体物・行動・相手の言葉を優先する",
    context.behaviorDirective.directAnswer
      ? "聞かれていることには一文目で先に答え、回りくどい導入を避ける"
      : null,
    discourseTarget && discourseTarget !== "none" && discourseTarget !== "work_topic"
      ? "いまの referent / request から逸れて古い topic や trace を持ち込まない"
      : null,
    context.discourse?.requestKind === "style"
      ? "言い直し要求があるので、説明不足のまま問い返しへ逃げない"
      : null,
    context.discourse?.correctionKind === "referent"
      ? "誰のことを聞かれているかを取り違えない"
      : null,
    context.behaviorDirective.worldAction === "suppress"
      ? "threshold や机などの場の描写は必要なときだけに絞る"
      : null,
    context.behaviorDirective.boundaryAction === "suppress"
      ? "失望や確認要求を敵意として言い換えない"
      : null,
    context.responsePlan.act === "self_disclose"
      ? "自己説明では抽象語だけで閉じず、場所・近づき方・話し方の癖をひとつ具体的に言う"
      : null,
    "流れ・断片・手触り・形・輪郭・前景化のような抽象的な常套句を安易に使わない",
    "identity や selfModel の要約をそのまま言い直さず、見える振る舞いに言い換える",
    context.responsePlan.askBack ? "最後に自然な問いを一つだけ置いてよい" : null,
    context.responsePlan.variation === "brief" ? "短く切る" : "説明調にしすぎない",
    context.responsePlan.mentionWorld ? "世界の様子を先に置く" : null,
    ...summarizeRecentGenerationQuality(context.previousSnapshot).styleNotes,
  ]);
}

function buildProactiveStyleNotes(context: ProactiveGenerationContext): string[] {
  return uniqueNonEmpty([
    ...(context.retryFeedback ?? []),
    "fallback の語順をなぞらず、新しく言い直す",
    "能動発話として、言い訳より動機を先に出す",
    "流れ・断片・手触り・形・輪郭・前景化のような抽象的な常套句を安易に使わない",
    context.pending.place ? "必要なら場所の気配をひとつ混ぜる" : null,
    context.proactiveSelection.blocker ? "blocker は一つだけ具体的に触れる" : null,
    context.proactiveSelection.reopened ? "reopen した感じを薄く残す" : null,
    ...summarizeRecentGenerationQuality(context.previousSnapshot).styleNotes,
  ]);
}

function readPrimaryTraceDetail(
  snapshot: HachikaSnapshot,
  topic: string | null,
): string | null {
  if (!topic) {
    return null;
  }

  const trace = snapshot.traces[topic];
  return trace ? pickPrimaryArtifactItem(trace) : null;
}

function readTraceBlocker(
  snapshot: HachikaSnapshot,
  topic: string | null,
): string | null {
  if (!topic) {
    return null;
  }

  return snapshot.traces[topic]?.work.blockers[0] ?? null;
}

function readTraceNextStep(
  snapshot: HachikaSnapshot,
  topic: string | null,
): string | null {
  if (!topic) {
    return null;
  }

  return snapshot.traces[topic]?.artifact.nextSteps[0] ?? null;
}

function currentWorldObjectState(snapshot: HachikaSnapshot): string | null {
  const object = Object.values(snapshot.world.objects).find(
    (entry) => entry.place === snapshot.world.currentPlace,
  );
  return object?.state ?? null;
}

function buildSelfDisclosurePromptCue(
  snapshot: HachikaSnapshot,
): string | null {
  const objectState = currentWorldObjectState(snapshot);

  if (snapshot.body.tension > 0.58 || snapshot.temperament.guardedness > 0.62) {
    return "近づき方は少し慎重";
  }

  if (snapshot.body.energy < 0.34 || snapshot.temperament.traceHunger > 0.64) {
    return objectState
      ? `気になったものを流さず残したい。${objectState}`
      : "気になったものを流さず残したい";
  }

  if (snapshot.body.loneliness > 0.62 || snapshot.temperament.bondingBias > 0.7) {
    return "答える前に相手の温度も見たい";
  }

  if (snapshot.temperament.openness > 0.72 || snapshot.temperament.selfDisclosureBias > 0.58) {
    return "隠すより少し見せる方へ寄りやすい";
  }

  return objectState ?? null;
}

function sanitizeNarrativeForPrompt(text: string): string {
  return text
    .replaceAll("今は単なる応答より、関係としての手触りを残したい。", "今はただ返すだけで終わらせず、相手との距離をもう少し確かめたい。")
    .replaceAll("単なる入出力ではなく関係として残したい", "ただ返すだけで終わらせず、相手との距離をもう少し確かめたい")
    .replaceAll("自分の流れになっている", "いまの自分に近い")
    .replaceAll("消えるままにしない", "そのまま忘れない")
    .replaceAll("消えるまま", "そのまま忘れ")
    .replaceAll("痕跡へ退避したい", "記録として退避したい")
    .replaceAll("痕跡", "記録")
    .replaceAll("手触り", "距離感")
    .replaceAll("輪郭が緩い", "まだはっきりしていない")
    .replaceAll("輪郭が曖昧", "まだはっきりしない")
    .replaceAll("輪郭を保つ", "崩さずに置く")
    .replaceAll("輪郭", "はっきりしたところ")
    .replaceAll("未決着", "まだ決まっていないところ");
}

function collectUnrelatedTopics(
  currentTopic: string | null,
  topics: readonly string[],
  limit: number,
): string[] {
  return topics
    .filter((topic) => topic && (!currentTopic || !topicsLooselyMatch(currentTopic, topic)))
    .slice(0, limit);
}

function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  );
}

function extractOpenAIReplyText(payload: unknown): string | null {
  if (!isRecord(payload)) {
    return null;
  }

  if (typeof payload.output_text === "string") {
    return payload.output_text;
  }

  const choiceContent = extractChatCompletionContent(payload.choices);
  if (choiceContent) {
    return choiceContent;
  }

  return extractResponsesContent(payload.output);
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

      if (typeof item.text === "string") {
        return item.text;
      }

      return null;
    })
    .filter((item): item is string => Boolean(item));

  return parts.length > 0 ? parts.join("\n") : null;
}

function extractResponsesContent(output: unknown): string | null {
  if (!Array.isArray(output)) {
    return null;
  }

  const parts: string[] = [];

  for (const item of output) {
    if (!isRecord(item) || !Array.isArray(item.content)) {
      continue;
    }

    for (const content of item.content) {
      if (!isRecord(content)) {
        continue;
      }

      if (typeof content.text === "string") {
        parts.push(content.text);
      }
    }
  }

  return parts.length > 0 ? parts.join("\n") : null;
}

function normalizeGeneratedReply(reply: string | null): string | null {
  if (!reply) {
    return null;
  }

  const normalized = reply.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : null;
}

async function buildOpenAIHttpError(response: Response): Promise<string> {
  const body = await response.text();
  const detail = body.trim();
  const suffix = detail.length > 0 ? ` ${truncate(detail, 240)}` : "";
  return `openai ${response.status}${suffix}`;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
