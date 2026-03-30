import { summarizeWorldForPrompt } from "./world.js";
import type {
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
  "The local engine already selected a candidate initiative.",
  "You may keep it, suppress it, or lightly reshape kind/reason/motive/topic/stateTopic/readyAfterHours/place/worldAction.",
  "Prefer suppressing weak, repetitive, overly abstract, socially intrusive, or direct-answer-only residue.",
  "For greeting, smalltalk, pure self/world inquiry, repair, or relation clarification turns, prefer keep:false unless there is explicit concrete continuity worth carrying.",
  "topic is the semantic topic that may be recalled later. stateTopic is the subset worth durable hardening.",
  "Only keep stateTopic when it is concrete and already present in candidateTopics.",
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
  summary: string;
}

export interface InitiativeDirectorContext {
  input: string;
  snapshot: HachikaSnapshot;
  signals: InteractionSignals;
  selfModel: SelfModel;
  pending: PendingInitiative;
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
  };
  candidateTopics: string[];
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
      context.pending.topic,
      context.pending.stateTopic,
      ...context.signals.topics,
      context.snapshot.purpose.active?.topic ?? null,
      ...context.snapshot.identity.anchors,
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
    pending: {
      kind: context.pending.kind,
      reason: context.pending.reason,
      motive: context.pending.motive,
      topic: context.pending.topic ?? null,
      stateTopic: context.pending.stateTopic ?? context.pending.topic ?? null,
      blocker: context.pending.blocker,
      readyAfterHours: context.pending.readyAfterHours,
      place: context.pending.place ?? null,
      worldAction: context.pending.worldAction ?? null,
    },
    candidateTopics,
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
  fallback: PendingInitiative,
  candidateTopics: readonly string[],
): InitiativeDirective | null {
  const parsed = parseJsonRecord(rawText);

  if (!parsed) {
    return null;
  }

  const keep = readBoolean(parsed.keep, true);
  const topic = readTopic(parsed.topic, fallback.topic, candidateTopics);
  const stateTopic = readStateTopic(
    parsed.stateTopic,
    fallback.stateTopic ?? fallback.topic ?? null,
    candidateTopics,
  );

  return {
    keep,
    kind: readEnum(parsed.kind, INITIATIVE_KIND_VALUES) ?? fallback.kind,
    reason: readEnum(parsed.reason, INITIATIVE_REASON_VALUES) ?? fallback.reason,
    motive: readEnum(parsed.motive, MOTIVE_VALUES) ?? fallback.motive,
    topic,
    stateTopic: keep ? stateTopic : null,
    readyAfterHours: readReadyAfterHours(parsed.readyAfterHours, fallback.readyAfterHours),
    place: readEnum(parsed.place, WORLD_PLACE_VALUES) ?? fallback.place ?? null,
    worldAction:
      readEnum(parsed.worldAction, WORLD_ACTION_VALUES) ?? fallback.worldAction ?? null,
    summary:
      typeof parsed.summary === "string" && parsed.summary.trim().length > 0
        ? parsed.summary.trim()
        : summarizeInitiativeDirective(
            keep,
            topic,
            stateTopic,
            readEnum(parsed.kind, INITIATIVE_KIND_VALUES) ?? fallback.kind,
            readEnum(parsed.motive, MOTIVE_VALUES) ?? fallback.motive,
          ),
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

function unique(items: string[]): string[] {
  return Array.from(new Set(items));
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
