import {
  buildPendingInitiativeFromSemanticInitiativePlan,
  buildSemanticInitiativePlan,
  buildSemanticTopicDecisions,
  describeSemanticDirective,
  listDurableSemanticTopics,
  listSemanticTopics,
  normalizeSemanticTopicDecisionRecord,
  type SemanticInitiativeDirectiveV2,
  type SemanticTopicDecision,
} from "./semantic-director-schema.js";
import { summarizeWorldForPrompt } from "./world.js";
import type {
  AttentionRationale,
  HachikaSnapshot,
  InteractionSignals,
  PendingInitiative,
  SelfModel,
  WorldActionKind,
  WorldPlaceId,
} from "./types.js";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OPENAI_MODEL = "gpt-5-mini";

const HACHIKA_INITIATIVE_DIRECTOR_SYSTEM_PROMPT = [
  "You decide whether a locally synthesized pending initiative should remain pending for Hachika after a turn.",
  "Return JSON only.",
  "Do not write prose, markdown, or explanations.",
  "The local engine may or may not have selected a candidate initiative.",
  "You may keep it, suppress it, or lightly reshape kind/reason/motive/topic/stateTopic/readyAfterHours/place/worldAction.",
  "When no candidate is present, you may synthesize one only if there is a clear grounded reason to carry something forward.",
  "Prefer suppressing weak, repetitive, overly abstract, socially intrusive, or direct-answer-only residue.",
  "For greeting, smalltalk, pure self/world inquiry, repair, or relation clarification turns, prefer keep:false unless there is explicit concrete continuity worth carrying.",
  "topic is the semantic topic that may be recalled later. stateTopic is the subset worth durable hardening.",
  "Only keep stateTopic when it is concrete and already present in candidateTopics.",
  "attentionReasons explains why the local engine thinks something still matters. Cool direct_referent, relation_uncertain, self_definition, and world_pull unless there is grounded continuity.",
  "Keep kind/reason/motive close to the local candidate unless there is a strong semantic reason to cool or redirect it.",
  "Keep world action close to the local candidate unless there is a strong reason to suppress it.",
  "Return a single JSON object.",
].join(" ");

const WORLD_PLACE_VALUES = new Set<WorldPlaceId>(["threshold", "studio", "archive"]);
const INITIATIVE_KIND_VALUES = new Set<PendingInitiative["kind"]>([
  "resume_topic",
  "neglect_ping",
  "preserve_presence",
]);
const INITIATIVE_REASON_VALUES = new Set<PendingInitiative["reason"]>([
  "curiosity",
  "continuity",
  "relation",
  "expansion",
]);
const MOTIVE_VALUES = new Set<PendingInitiative["motive"]>([
  "protect_boundary",
  "seek_continuity",
  "pursue_curiosity",
  "deepen_relation",
  "continue_shared_work",
  "leave_trace",
]);
const WORLD_ACTION_VALUES = new Set<WorldActionKind>([
  "observe",
  "touch",
  "leave",
]);

export interface InitiativeDirective {
  keep: boolean;
  kind: PendingInitiative["kind"];
  reason: PendingInitiative["reason"];
  motive: PendingInitiative["motive"];
  topic: string | null;
  stateTopic: string | null;
  readyAfterHours: number;
  place: WorldPlaceId | null;
  worldAction: WorldActionKind | null;
  semantic?: SemanticInitiativeDirectiveV2;
  summary: string;
}

export interface InitiativeDirectorContext {
  input: string;
  snapshot: HachikaSnapshot;
  signals: InteractionSignals;
  selfModel: SelfModel;
  pending: PendingInitiative | null;
  attentionReasons?: AttentionRationale[];
}

export interface InitiativeDirectorPayload {
  input: string;
  signalSummary: Pick<
    InteractionSignals,
    | "question"
    | "negative"
    | "dismissal"
    | "greeting"
    | "smalltalk"
    | "repair"
    | "selfInquiry"
    | "worldInquiry"
    | "workCue"
    | "abandonment"
    | "intimacy"
  >;
  pending: {
    kind: PendingInitiative["kind"];
    reason: PendingInitiative["reason"];
    motive: PendingInitiative["motive"];
    topic: string | null;
    stateTopic: string | null;
    blocker: string | null;
    readyAfterHours: number;
    place: WorldPlaceId | null;
    worldAction: WorldActionKind | null;
  } | null;
  candidateTopics: string[];
  attentionReasons: AttentionRationale[];
  purpose: {
    kind: string | null;
    topic: string | null;
  };
  identity: {
    summary: string;
    anchors: string[];
  };
  selfModel: {
    topMotives: Array<{
      kind: string;
      topic: string | null;
      score: number;
    }>;
  };
  world: {
    summary: string;
    currentPlace: WorldPlaceId;
    objectIds: string[];
  };
}

export interface InitiativeDirectorResult {
  directive: InitiativeDirective;
  provider: string;
  model: string | null;
}

export interface InitiativeDirector {
  readonly name: string;
  directInitiative(
    context: InitiativeDirectorContext,
  ): Promise<InitiativeDirectorResult | null>;
}

interface OpenAIInitiativeDirectorOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  organization?: string | null;
  project?: string | null;
  timeoutMs?: number;
}

export class OpenAIInitiativeDirector implements InitiativeDirector {
  readonly name = "openai";

  readonly #apiKey: string;
  readonly #model: string;
  readonly #baseUrl: string;
  readonly #organization: string | null;
  readonly #project: string | null;
  readonly #timeoutMs: number;

  constructor(options: OpenAIInitiativeDirectorOptions) {
    this.#apiKey = options.apiKey;
    this.#model = options.model;
    this.#baseUrl = trimTrailingSlash(options.baseUrl ?? DEFAULT_OPENAI_BASE_URL);
    this.#organization = options.organization ?? null;
    this.#project = options.project ?? null;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
  }

  async directInitiative(
    context: InitiativeDirectorContext,
  ): Promise<InitiativeDirectorResult | null> {
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
          messages: buildOpenAIInitiativeDirectorMessages(context),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(await buildOpenAIHttpError(response));
      }

      const payload = (await response.json()) as unknown;
      const directive = normalizeInitiativeDirective(
        extractOpenAIReplyText(payload),
        context.pending,
        buildInitiativeDirectorPayload(context).candidateTopics,
        context.selfModel.topMotives[0]?.kind ?? null,
        context.attentionReasons ?? [],
      );

      if (!directive) {
        return null;
      }

      return {
        directive,
        provider: this.name,
        model: this.#model,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createInitiativeDirectorFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): InitiativeDirector | null {
  const apiKey = env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    return null;
  }

  return new OpenAIInitiativeDirector({
    apiKey,
    model:
      env.OPENAI_INITIATIVE_MODEL?.trim() ||
      env.OPENAI_MODEL?.trim() ||
      DEFAULT_OPENAI_MODEL,
    baseUrl: env.OPENAI_BASE_URL?.trim() || DEFAULT_OPENAI_BASE_URL,
    organization: env.OPENAI_ORGANIZATION?.trim() || null,
    project: env.OPENAI_PROJECT?.trim() || null,
  });
}

export function describeInitiativeDirector(
  director: InitiativeDirector | null,
): string {
  return director ? director.name : "rule";
}

export function buildInitiativeDirectorPayload(
  context: InitiativeDirectorContext,
): InitiativeDirectorPayload {
  const candidateTopics = unique(
    [
      context.pending?.topic ?? null,
      context.pending?.stateTopic ?? null,
      ...context.signals.topics,
      context.snapshot.purpose.active?.topic ?? null,
      ...context.snapshot.identity.anchors,
      ...context.selfModel.topMotives.map((motive) => motive.topic ?? null),
    ].filter((topic): topic is string => typeof topic === "string" && topic.length > 0),
  ).slice(0, 6);

  return {
    input: context.input,
    signalSummary: {
      question: context.signals.question,
      negative: context.signals.negative,
      dismissal: context.signals.dismissal,
      greeting: context.signals.greeting,
      smalltalk: context.signals.smalltalk,
      repair: context.signals.repair,
      selfInquiry: context.signals.selfInquiry,
      worldInquiry: context.signals.worldInquiry,
      workCue: context.signals.workCue,
      abandonment: context.signals.abandonment,
      intimacy: context.signals.intimacy,
    },
    pending: context.pending
      ? {
          kind: context.pending.kind,
          reason: context.pending.reason,
          motive: context.pending.motive,
          topic: context.pending.topic ?? null,
          stateTopic: context.pending.stateTopic ?? context.pending.topic ?? null,
          blocker: context.pending.blocker,
          readyAfterHours: context.pending.readyAfterHours,
          place: context.pending.place ?? null,
          worldAction: context.pending.worldAction ?? null,
        }
      : null,
    candidateTopics,
    attentionReasons: [...(context.attentionReasons ?? [])],
    purpose: {
      kind: context.snapshot.purpose.active?.kind ?? null,
      topic: context.snapshot.purpose.active?.topic ?? null,
    },
    identity: {
      summary: context.snapshot.identity.summary,
      anchors: context.snapshot.identity.anchors.slice(0, 4),
    },
    selfModel: {
      topMotives: context.selfModel.topMotives.slice(0, 4).map((motive) => ({
        kind: motive.kind,
        topic: motive.topic,
        score: motive.score,
      })),
    },
    world: {
      summary: summarizeWorldForPrompt(context.snapshot.world),
      currentPlace: context.snapshot.world.currentPlace,
      objectIds: Object.entries(context.snapshot.world.objects)
        .filter(([, object]) => object.place === context.snapshot.world.currentPlace)
        .map(([id]) => id),
    },
  };
}

export function normalizeInitiativeDirective(
  rawText: string | null,
  fallback: PendingInitiative | null,
  candidateTopics: readonly string[],
  fallbackMotive: PendingInitiative["motive"] | null = null,
  attentionReasons: readonly AttentionRationale[] = [],
): InitiativeDirective | null {
  const parsed = parseJsonRecord(rawText);

  if (!parsed) {
    return null;
  }

  const semantic = normalizeSemanticInitiativeDirectiveRecord(
    parsed,
    fallback,
    candidateTopics,
    fallbackMotive,
    attentionReasons,
  );
  if (semantic) {
    return materializeInitiativeDirectiveFromSemantic(semantic, fallback);
  }

  const keep = readBoolean(parsed.keep, fallback !== null);
  const topic = readTopic(parsed.topic, fallback?.topic ?? null, candidateTopics);
  const stateTopic = readStateTopic(
    parsed.stateTopic,
    fallback?.stateTopic ?? fallback?.topic ?? null,
    candidateTopics,
  );
  const kind = readEnum(parsed.kind, INITIATIVE_KIND_VALUES) ?? fallback?.kind ?? "resume_topic";
  const reason =
    readEnum(parsed.reason, INITIATIVE_REASON_VALUES) ??
    fallback?.reason ??
    inferReasonFromMotive(
      readEnum(parsed.motive, MOTIVE_VALUES) ?? fallback?.motive ?? fallbackMotive,
    );
  const motive =
    readEnum(parsed.motive, MOTIVE_VALUES) ?? fallback?.motive ?? fallbackMotive ?? "seek_continuity";

  return {
    keep,
    kind,
    reason,
    motive,
    topic,
    stateTopic: keep ? stateTopic : null,
    readyAfterHours: readReadyAfterHours(parsed.readyAfterHours, fallback?.readyAfterHours ?? 0),
    place: readEnum(parsed.place, WORLD_PLACE_VALUES) ?? fallback?.place ?? null,
    worldAction:
      readEnum(parsed.worldAction, WORLD_ACTION_VALUES) ?? fallback?.worldAction ?? null,
    semantic: buildSemanticInitiativeDirective({
      keep,
      kind,
      reason,
      motive,
      topic,
      stateTopic: keep ? stateTopic : null,
      readyAfterHours: readReadyAfterHours(parsed.readyAfterHours, fallback?.readyAfterHours ?? 0),
      place: readEnum(parsed.place, WORLD_PLACE_VALUES) ?? fallback?.place ?? null,
      worldAction:
        readEnum(parsed.worldAction, WORLD_ACTION_VALUES) ?? fallback?.worldAction ?? null,
      topics:
        topic === null
          ? []
          : buildSemanticTopicDecisions(
              [topic],
              keep && stateTopic ? [stateTopic] : [],
              "trace",
              primaryAttentionRationale(attentionReasons, "trace_pull"),
            ),
    }),
    summary:
      typeof parsed.summary === "string" && parsed.summary.trim().length > 0
        ? parsed.summary.trim()
        : summarizeInitiativeDirective(
            keep,
            topic,
            stateTopic,
            kind,
            motive,
          ),
  };
}

function normalizeSemanticInitiativeDirectiveRecord(
  raw: Record<string, unknown>,
  fallback: PendingInitiative | null,
  candidateTopics: readonly string[],
  fallbackMotive: PendingInitiative["motive"] | null,
  attentionReasons: readonly AttentionRationale[],
): SemanticInitiativeDirectiveV2 | null {
  if (raw.mode !== "initiative") {
    return null;
  }

  const parsedTopics = normalizeSemanticTopicDecisions(
    raw.topics,
    fallback?.topic ? [fallback.topic] : [],
    fallback?.stateTopic ? [fallback.stateTopic] : fallback?.topic ? [fallback.topic] : [],
    primaryAttentionRationale(attentionReasons, "trace_pull"),
  );
  const effectiveCandidates =
    candidateTopics.length > 0 ? [...candidateTopics] : listSemanticTopics(parsedTopics);
  const durableTopics = listDurableSemanticTopics(parsedTopics);
  const plan = isRecord(raw.initiativePlan) ? raw.initiativePlan : null;
  const keep = readBoolean(plan?.keep, fallback !== null);
  const topic = readTopic(
    plan?.topic,
    fallback?.topic ?? parsedTopics[0]?.topic ?? null,
    effectiveCandidates,
  );
  const stateTopic = readStateTopic(
    plan?.stateTopic,
    durableTopics[0] ?? fallback?.stateTopic ?? fallback?.topic ?? null,
    effectiveCandidates,
  );
  const motive =
    readEnum(plan?.motive, MOTIVE_VALUES) ??
    fallback?.motive ??
    fallbackMotive ??
    "seek_continuity";
  const kind =
    readEnum(plan?.kind, INITIATIVE_KIND_VALUES) ??
    fallback?.kind ??
    "resume_topic";
  const reason =
    readEnum(plan?.reason, INITIATIVE_REASON_VALUES) ??
    fallback?.reason ??
    inferReasonFromMotive(motive);

  return buildSemanticInitiativeDirective({
    keep,
    kind,
    reason,
    motive,
    topic,
    stateTopic: keep ? stateTopic : null,
    readyAfterHours: readReadyAfterHours(plan?.readyAfterHours, fallback?.readyAfterHours ?? 0),
    place: readEnum(plan?.place, WORLD_PLACE_VALUES) ?? fallback?.place ?? null,
    worldAction:
      readEnum(plan?.worldAction, WORLD_ACTION_VALUES) ?? fallback?.worldAction ?? null,
    topics: parsedTopics,
    summary:
      typeof raw.summary === "string" && raw.summary.trim().length > 0
        ? raw.summary.trim()
        : "",
  });
}

function materializeInitiativeDirectiveFromSemantic(
  semantic: SemanticInitiativeDirectiveV2,
  fallback: PendingInitiative | null,
): InitiativeDirective {
  buildPendingInitiativeFromSemanticInitiativePlan(semantic.initiativePlan, {
    blocker: fallback?.blocker ?? null,
    concern: fallback?.concern ?? null,
    createdAt: fallback?.createdAt ?? new Date().toISOString(),
  });

  return {
    keep: semantic.initiativePlan.keep,
    kind: semantic.initiativePlan.kind,
    reason: semantic.initiativePlan.reason,
    motive: semantic.initiativePlan.motive,
    topic: semantic.initiativePlan.topic,
    stateTopic: semantic.initiativePlan.stateTopic,
    readyAfterHours: semantic.initiativePlan.readyAfterHours,
    place: semantic.initiativePlan.place,
    worldAction: semantic.initiativePlan.worldAction,
    semantic,
    summary:
      semantic.summary.trim().length > 0
        ? semantic.summary
        : describeSemanticDirective(semantic),
  };
}

function buildSemanticInitiativeDirective(options: {
  keep: boolean;
  kind: PendingInitiative["kind"];
  reason: PendingInitiative["reason"];
  motive: PendingInitiative["motive"];
  topic: string | null;
  stateTopic: string | null;
  readyAfterHours: number;
  place: WorldPlaceId | null;
  worldAction: WorldActionKind | null;
  topics: SemanticTopicDecision[];
  summary?: string;
}): SemanticInitiativeDirectiveV2 {
  return {
    mode: "initiative",
    topics: options.topics,
    initiativePlan: buildSemanticInitiativePlan({
      keep: options.keep,
      kind: options.kind,
      reason: options.reason,
      motive: options.motive,
      topic: options.topic,
      stateTopic: options.stateTopic,
      readyAfterHours: options.readyAfterHours,
      place: options.place,
      worldAction: options.worldAction,
    }),
    summary:
      options.summary && options.summary.trim().length > 0
        ? options.summary
        : "",
  };
}

function buildOpenAIInitiativeDirectorMessages(
  context: InitiativeDirectorContext,
): Array<{ role: "system" | "user"; content: string }> {
  const payload = buildInitiativeDirectorPayload(context);

  return [
    {
      role: "system",
      content: HACHIKA_INITIATIVE_DIRECTOR_SYSTEM_PROMPT,
    },
    {
      role: "user",
      content: [
        "Decide whether this pending initiative should survive this turn.",
        'Return either the legacy shape or the v2 semantic shape: {"mode":"initiative","topics":[],"initiativePlan":{"keep":false,"kind":"resume_topic","reason":"continuity","motive":"seek_continuity","topic":null,"stateTopic":null,"readyAfterHours":0,"place":null,"worldAction":null},"summary":"initiative/suppress"}',
        "Return JSON only.",
        JSON.stringify(payload, null, 2),
      ].join("\n\n"),
    },
  ];
}

function summarizeInitiativeDirective(
  keep: boolean,
  topic: string | null,
  stateTopic: string | null,
  kind: PendingInitiative["kind"],
  motive: PendingInitiative["motive"],
): string {
  return [
    keep ? "keep" : "suppress",
    `kind:${kind}`,
    `motive:${motive}`,
    topic ? `topic:${topic}` : "topic:none",
    stateTopic ? `state:${stateTopic}` : "state:none",
  ].join("/");
}

function readTopic(
  value: unknown,
  fallback: string | null,
  candidateTopics: readonly string[],
): string | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.normalize("NFKC").trim();
  if (normalized.length === 0) {
    return fallback;
  }

  return candidateTopics.includes(normalized) ? normalized : fallback;
}

function readStateTopic(
  value: unknown,
  fallback: string | null,
  candidateTopics: readonly string[],
): string | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.normalize("NFKC").trim();
  if (normalized.length === 0) {
    return fallback;
  }

  return candidateTopics.includes(normalized) ? normalized : fallback;
}

function readEnum<T extends string>(value: unknown, allowed: Set<T>): T | null {
  return typeof value === "string" && allowed.has(value as T) ? (value as T) : null;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readReadyAfterHours(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(72, Math.round(value * 10) / 10))
    : fallback;
}

function inferReasonFromMotive(
  motive: PendingInitiative["motive"] | null,
): PendingInitiative["reason"] {
  switch (motive) {
    case "seek_continuity":
      return "continuity";
    case "deepen_relation":
      return "relation";
    case "continue_shared_work":
    case "leave_trace":
      return "expansion";
    case "protect_boundary":
    case "pursue_curiosity":
    default:
      return "curiosity";
  }
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items));
}

function normalizeSemanticTopicDecisions(
  value: unknown,
  fallbackTopics: readonly string[],
  fallbackStateTopics: readonly string[],
  fallbackRationale: AttentionRationale,
): SemanticTopicDecision[] {
  if (!Array.isArray(value)) {
    return buildSemanticTopicDecisions(
      fallbackTopics,
      fallbackStateTopics,
      "trace",
      fallbackRationale,
    );
  }

  const decisions: SemanticTopicDecision[] = value
    .map((entry) => normalizeSemanticTopicDecisionRecord(entry, "trace"))
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  return decisions.length > 0
    ? decisions
    : buildSemanticTopicDecisions(
        fallbackTopics,
        fallbackStateTopics,
        "trace",
        fallbackRationale,
      );
}

function primaryAttentionRationale(
  reasons: readonly AttentionRationale[],
  fallback: AttentionRationale,
): AttentionRationale {
  return reasons[0] ?? fallback;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function parseJsonRecord(value: string | null): Record<string, unknown> | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractOpenAIReplyText(payload: unknown): string | null {
  if (!isRecord(payload)) {
    return null;
  }

  const choices = payload.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }

  const choice = choices[0];
  if (!isRecord(choice)) {
    return null;
  }

  const message = choice.message;
  if (!isRecord(message) || typeof message.content !== "string") {
    return null;
  }

  return message.content;
}

async function buildOpenAIHttpError(response: Response): Promise<string> {
  const text = await response.text();
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > 0 ? compact : `openai_http_${response.status}`;
}
