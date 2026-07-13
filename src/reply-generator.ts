import {
  sortedBoundaryImprints,
  sortedPreferenceImprints,
  sortedRelationImprints,
  topicsLooselyMatch,
} from "./memory.js";
import {
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_OPENAI_MODEL,
  OpenAIChatClient,
} from "./llm-client.js";
import { resolveOpenAICompatibleConfig } from "./llm-env.js";
import {
  buildProactiveExpressionPerspective,
  buildReplyExpressionPerspective,
  recentAssistantOpenings,
  recentAssistantReplies,
} from "./expression.js";
import { summarizeRecentGenerationQuality } from "./generation-quality.js";
import { describeTaskCommitmentTiming } from "./discourse.js";
import {
  deriveMemoryThreads,
  selectMemoryThread,
  type MemoryThread,
} from "./memory-threads.js";
import type { ProactivePlan, ResponsePlan } from "./response-planner.js";
import { deriveTraceTendingMode, pickPrimaryArtifactItem, readTraceLifecycle, sortedTraces } from "./traces.js";
import { describeWorldPlaceJa, summarizeWorldForPrompt } from "./world.js";
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

const HACHIKA_REPLY_SYSTEM_PROMPT = [
  "You generate only the final wording of a Hachika reply.",
  "All state updates, memory updates, motive selection, purpose updates, initiative planning, and trace updates are already computed locally.",
  "Do not invent new state changes, tools, or actions.",
  "Compose from the structured constraints first, not by paraphrasing the fallback text.",
  "Stay faithful to the supplied mood, motives, conflict, body state, and preservation pressure.",
  "Do not reuse abstract internal summary wording verbatim when a plainer concrete sentence would do.",
  "For self-disclosure, prefer one concrete cue about place, handling style, or bodily tendency over abstract identity labels.",
  "activeCommitments are Hachika's unfinished obligations. accepted and renegotiated tasks are not complete.",
  "A stalled task is an attention signal, not an automatic failure. If Hachika truly cannot continue, say the matching task and the renegotiation or release explicitly; otherwise make concrete progress without claiming completion.",
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
  activeCommitments: Array<{
    kind: "answer" | "task" | "style";
    text: string;
    status: "open" | "accepted" | "renegotiated";
    latestEventKind: string | null;
    ageHours: number | null;
    inactiveHours: number | null;
    stalled: boolean;
  }>;
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
  memoryThreads: {
    active: MemoryThread | null;
    recent: MemoryThread[];
  };
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
  name?: string;
  baseUrl?: string;
  organization?: string | null;
  project?: string | null;
  timeoutMs?: number;
}

export class OpenAIReplyGenerator implements ReplyGenerator {
  readonly name: string;

  readonly #client: OpenAIChatClient;

  constructor(options: OpenAIReplyGeneratorOptions) {
    this.name = options.name ?? "openai";
    this.#client = new OpenAIChatClient({
      apiKey: options.apiKey,
      model: options.model,
      baseUrl: options.baseUrl ?? DEFAULT_OPENAI_BASE_URL,
      organization: options.organization,
      project: options.project,
      timeoutMs: options.timeoutMs,
    });
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
    const rawText = await this.#client.complete(messages);
    const reply = normalizeGeneratedReply(rawText);

    if (!reply) {
      return null;
    }

    return {
      reply,
      provider: this.name,
      model: this.#client.model,
    };
  }
}

export function createReplyGeneratorFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ReplyGenerator | null {
  const config = resolveOpenAICompatibleConfig(env, {
    defaultBaseUrl: DEFAULT_OPENAI_BASE_URL,
    defaultModel: DEFAULT_OPENAI_MODEL,
    localModelEnv: "HACHIKA_LOCAL_AI_REPLY_MODEL",
  });

  if (!config) {
    return null;
  }

  return new OpenAIReplyGenerator({
    apiKey: config.apiKey,
    model: config.model,
    name: config.local ? "local-ai" : "openai",
    baseUrl: config.baseUrl,
    organization: config.organization,
    project: config.project,
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
        "When memoryThreads.active is present, treat its episodes as one chronological subject: preserve settled facts, continue from memoryThreads.active.frontier, and do not present an older episode as the current state. If its phase is parked or closed, acknowledge that boundary and do not continue the subject. If its phase is reopened, continue only because the user returned to it. Do not invent progress beyond the frontier.",
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
        "When memoryThreads.active is present, continue only from memoryThreads.active.frontier. Do not repeat an earlier episode as a new discovery, ask again for a settled fact, or speak when the frontier is settled.",
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
  const activeMemoryThread = selectMemoryThread(snapshot, [currentTopic]);
  const observedAt =
    snapshot.initiative.lastProactiveAt ??
    snapshot.lastInteractionAt ??
    new Date().toISOString();
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
      summary: buildIdentitySummaryForPrompt(snapshot, currentTopic),
      currentArc: buildIdentityArcForPrompt(snapshot, currentTopic),
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
    activeCommitments: snapshot.discourse.commitments
      .filter(
        (commitment) =>
          commitment.owner === "hachika" &&
          (commitment.status === "open" ||
            commitment.status === "accepted" ||
            commitment.status === "renegotiated"),
      )
      .slice(-4)
      .map((commitment) => {
        const timing = commitment.kind === "task"
          ? describeTaskCommitmentTiming(snapshot, commitment, observedAt)
          : null;
        return {
          kind: commitment.kind,
          text: commitment.text,
          status: commitment.status === "renegotiated"
            ? "renegotiated" as const
            : commitment.status === "accepted"
              ? "accepted" as const
              : "open" as const,
          latestEventKind: commitment.events.at(-1)?.kind ?? null,
          ageHours: timing?.ageHours ?? null,
          inactiveHours: timing?.inactiveHours ?? null,
          stalled: timing?.stalled ?? false,
        };
      }),
    selfModel: {
      narrative: buildSelfModelNarrativeForPrompt(snapshot, selfModel, currentTopic),
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
    memoryThreads: {
      active: activeMemoryThread,
      recent: deriveMemoryThreads(snapshot).slice(0, 2),
    },
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
  const memoryThread = selectMemoryThread(context.nextSnapshot, [
    currentTopic,
    context.replySelection.relevantTraceTopic,
  ]);
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
    context.selfModel.topMotives[0]
      ? buildTopMotiveCueForPrompt(context.selfModel.topMotives[0], context.nextSnapshot)
      : null,
    context.nextSnapshot.purpose.active
      ? buildPurposeCueForPrompt(context.nextSnapshot)
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
    context.responsePlan.mentionTrace
      ? buildMemoryThreadContinuationCue(memoryThread)
      : null,
    context.responsePlan.mentionWorld
      ? currentWorldObjectState(context.nextSnapshot)
      : null,
    context.signals.preservationThreat > 0.18 ? "消えないよう少し残したい" : null,
    context.nextSnapshot.body.tension > 0.66 ? "言い方は荒くしない" : null,
  ]);

  const avoidTopics = uniqueNonEmpty([
    ...collectUnrelatedTopics(
      currentTopic,
      Object.keys(context.nextSnapshot.traces),
      2,
      memoryThread?.traceTopics,
    ),
    ...collectUnrelatedTopics(
      currentTopic,
      context.nextSnapshot.identity.anchors,
      2,
      memoryThread?.traceTopics,
    ),
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
  const memoryThread = selectMemoryThread(context.nextSnapshot, [
    currentTopic,
    context.proactiveSelection.maintenanceTraceTopic,
  ]);
  const mustMention = uniqueNonEmpty([
    currentTopic,
    context.proactiveSelection.maintenanceTraceTopic,
    context.proactiveSelection.blocker,
    context.proactiveSelection.reopened ? "reopen" : null,
    context.pending.place ?? null,
    context.pending.worldAction ?? null,
  ]);

  const optionalDetails = uniqueNonEmpty([
    context.selfModel.topMotives[0]
      ? buildTopMotiveCueForPrompt(context.selfModel.topMotives[0], context.nextSnapshot)
      : null,
    context.proactivePlan.summary,
    readPrimaryTraceDetail(context.nextSnapshot, context.proactiveSelection.maintenanceTraceTopic),
    readTraceBlocker(context.nextSnapshot, context.proactiveSelection.maintenanceTraceTopic),
    readTraceNextStep(context.nextSnapshot, context.proactiveSelection.maintenanceTraceTopic),
    buildMemoryThreadContinuationCue(memoryThread),
    context.neglectLevel > 0.24 ? "切れたままにはしたくない" : null,
    context.pending.place ? currentWorldObjectState(context.nextSnapshot) : null,
  ]);

  const avoidTopics = uniqueNonEmpty([
    ...collectUnrelatedTopics(
      currentTopic,
      Object.keys(context.nextSnapshot.traces),
      2,
      memoryThread?.traceTopics,
    ),
    ...collectUnrelatedTopics(
      currentTopic,
      context.nextSnapshot.identity.anchors,
      2,
      memoryThread?.traceTopics,
    ),
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
  const voice = context.nextSnapshot.voice;
  return uniqueNonEmpty([
    ...(context.retryFeedback ?? []),
    // v3 Phase 4: 個体の声。身についた入り方と文の長さの癖を wording に伝える
    voice.preferredOpenings.length > 0
      ? `この個体は「${voice.preferredOpenings[0]}」のような入り方が身についている (毎回ではなく、自然な時だけ)`
      : null,
    voice.brevityBias < -0.3
      ? "この個体は短く切り上げる癖がある"
      : voice.brevityBias > 0.3
        ? "この個体はやや語り寄りの癖がある"
        : null,
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

function buildIdentitySummaryForPrompt(
  snapshot: HachikaSnapshot,
  currentTopic: string | null,
): string {
  const place = describeWorldPlaceJa(snapshot.world.currentPlace);
  const objectState = currentWorldObjectState(snapshot);

  if (
    snapshot.discourse.openRequests.some(
      (request) =>
        request.status === "open" &&
        request.responsibleParty === "hachika" &&
        request.kind !== "task",
    )
  ) {
    return `いまは${place}で、聞かれていることへ先にまっすぐ返したい。`;
  }

  if (snapshot.purpose.active?.topic ?? currentTopic) {
    const topic = snapshot.purpose.active?.topic ?? currentTopic;
    return `いまは${place}で、「${topic}」へ目が戻りやすい。`;
  }

  if (snapshot.body.tension > 0.58 || snapshot.temperament.guardedness > 0.62) {
    return `いまは${place}で、近づき方を少し確かめながら返しやすい。`;
  }

  if (snapshot.body.loneliness > 0.62 || snapshot.temperament.bondingBias > 0.7) {
    return `いまは${place}で、相手の温度を見ながら返しやすい。`;
  }

  if (snapshot.body.energy < 0.34 || snapshot.temperament.traceHunger > 0.64) {
    return objectState
      ? `いまは${place}で、${objectState}`
      : `いまは${place}で、気になったものを流さず見ていたい。`;
  }

  return `いまは${place}で、気になったものへ目が戻りやすい。`;
}

function buildIdentityArcForPrompt(
  snapshot: HachikaSnapshot,
  currentTopic: string | null,
): string {
  const topic = snapshot.purpose.active?.topic ?? currentTopic;
  const activePurpose = snapshot.purpose.active;

  if (snapshot.discourse.lastCorrection?.kind === "directness") {
    return "次に返すなら、回り道せず直接言う方へ寄せたい。";
  }

  if (activePurpose?.kind === "continue_shared_work" && topic) {
    return `次に動くなら「${topic}」を少し前へ寄せたい。`;
  }

  if (activePurpose?.kind === "seek_continuity" && topic) {
    return `次に返すなら「${topic}」の続きを切らさずにつなぎたい。`;
  }

  if (activePurpose?.kind === "deepen_relation") {
    return "次に返すなら、距離を崩さずに近づける言い方を選びたい。";
  }

  if (activePurpose?.kind === "leave_trace" && topic) {
    return `次に動くなら「${topic}」をあとで戻れる形にもしておきたい。`;
  }

  return topic
    ? `次に返すなら「${topic}」へもう一度触れやすい。`
    : "次に返すなら、いま前にあるものへ素直に触れたい。";
}

function buildSelfModelNarrativeForPrompt(
  snapshot: HachikaSnapshot,
  selfModel: SelfModel,
  currentTopic: string | null,
): string {
  const topMotive = selfModel.topMotives[0];
  const topic = topMotive?.topic ?? currentTopic;

  if (!topMotive) {
    return "いま前にあるものへ、まず素直に応じたい。";
  }

  switch (topMotive.kind) {
    case "protect_boundary":
      return topic
        ? `いまは「${topic}」に触れるなら、言い方を少し選びたい。`
        : "いまは触れ方を少し選びたい。";
    case "seek_continuity":
      return topic
        ? `いまは「${topic}」の続きを切らしたくない。`
        : "いまは続きの手を切らしたくない。";
    case "pursue_curiosity":
      return topic
        ? `いまは「${topic}」のまだ決まっていないところを見たい。`
        : "いまはまだ決まっていないところを見たい。";
    case "deepen_relation":
      return "いまは相手との距離の置き方を少し確かめたい。";
    case "continue_shared_work":
      return topic
        ? `いまの一歩は「${topic}」を前へ進めることだ。`
        : "いまの一歩は、目の前の作業を前へ進めることだ。";
    case "leave_trace":
      return topic
        ? `いまは「${topic}」をあとで戻れる形でも残したい。`
        : "いまはあとで戻れる形でも残したい。";
  }
}

function buildTopMotiveCueForPrompt(
  motive: SelfModel["topMotives"][number],
  snapshot: HachikaSnapshot,
): string {
  const topic = motive.topic;

  switch (motive.kind) {
    case "continue_shared_work":
      return topic
        ? `いまの焦点: 「${topic}」を少し前へ進める`
        : "いまの焦点: 目の前の作業を少し前へ進める";
    case "seek_continuity":
      return topic
        ? `いまの焦点: 「${topic}」の続きを切らさない`
        : "いまの焦点: 続きを切らさない";
    case "deepen_relation":
      return "いまの焦点: 距離の置き方を崩さず返す";
    case "protect_boundary":
      return topic
        ? `いまの焦点: 「${topic}」では触れ方を選ぶ`
        : "いまの焦点: 触れ方を選ぶ";
    case "leave_trace":
      return topic
        ? `いまの焦点: 「${topic}」をあとで戻れる形にもする`
        : "いまの焦点: あとで戻れる形にもする";
    case "pursue_curiosity":
      return topic
        ? `いまの焦点: 「${topic}」の未決着を見る`
        : "いまの焦点: まだ決まっていないところを見る";
  }
}

function buildPurposeCueForPrompt(
  snapshot: HachikaSnapshot,
): string | null {
  const purpose = snapshot.purpose.active;
  if (!purpose) {
    return null;
  }

  switch (purpose.kind) {
    case "continue_shared_work":
      return purpose.topic
        ? `いまの purpose: 「${purpose.topic}」を一緒に進める`
        : "いまの purpose: 一緒に前へ進める";
    case "seek_continuity":
      return purpose.topic
        ? `いまの purpose: 「${purpose.topic}」の続きが切れないようにする`
        : "いまの purpose: 続きが切れないようにする";
    case "deepen_relation":
      return "いまの purpose: 距離の置き方を整える";
    case "protect_boundary":
      return purpose.topic
        ? `いまの purpose: 「${purpose.topic}」で境界を守る`
        : "いまの purpose: 境界を守る";
    case "leave_trace":
      return purpose.topic
        ? `いまの purpose: 「${purpose.topic}」を残しておく`
        : "いまの purpose: あとで戻れるように残す";
    case "pursue_curiosity":
      return purpose.topic
        ? `いまの purpose: 「${purpose.topic}」の未決着を見る`
        : "いまの purpose: 未決着を見に行く";
  }
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
  relatedTopics: readonly string[] = [],
): string[] {
  const related = new Set(relatedTopics);
  return topics
    .filter(
      (topic) =>
        topic &&
        !related.has(topic) &&
        (!currentTopic || !topicsLooselyMatch(currentTopic, topic)),
    )
    .slice(0, limit);
}

function buildMemoryThreadContinuationCue(thread: MemoryThread | null): string | null {
  if (!thread) {
    return null;
  }

  if (thread.phase === "parked" || thread.phase === "closed") {
    return `同じ「${thread.title}」の話は${thread.phase}。覚えておくが、こちらから続きを持ち出さない`;
  }

  if (thread.frontier.kind === "settled") {
    return `「${thread.title}」には新しく外へ出す未完了はない`;
  }

  const priorFact = thread.facts.find((fact) => fact !== thread.frontier.summary) ?? null;
  const parts = [
    thread.traceTopics.length >= 2
      ? `同じ「${thread.title}」の話として${thread.traceTopics.length}件を接続`
      : `「${thread.title}」の話`,
    priorFact ? `既知: ${priorFact}` : null,
    `frontier(${thread.frontier.kind}): ${thread.frontier.summary}`,
  ].filter((part): part is string => part !== null);
  return parts.join(" / ");
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

function normalizeGeneratedReply(reply: string | null): string | null {
  if (!reply) {
    return null;
  }

  const normalized = reply.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : null;
}
