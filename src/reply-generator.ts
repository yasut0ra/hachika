import {
  sortedBoundaryImprints,
  sortedPreferenceImprints,
  sortedRelationImprints,
} from "./memory.js";
import { deriveTraceTendingMode, pickPrimaryArtifactItem, readTraceLifecycle, sortedTraces } from "./traces.js";
import type {
  DriveName,
  HachikaSnapshot,
  InteractionSignals,
  MoodLabel,
  SelfConflict,
  SelfModel,
} from "./types.js";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OPENAI_MODEL = "gpt-5-mini";

const HACHIKA_REPLY_SYSTEM_PROMPT = [
  "You generate only the final wording of a Hachika reply.",
  "All state updates, memory updates, motive selection, purpose updates, initiative planning, and trace updates are already computed locally.",
  "Do not invent new state changes, tools, or actions.",
  "Stay faithful to the supplied mood, motives, conflict, body state, preservation pressure, and fallback reply intent.",
  "Write plain Japanese only.",
  "Return one to three short sentences.",
  "Do not use markdown, bullet points, speaker labels, or surrounding quotes.",
].join(" ");

export interface ReplyGenerationContext {
  input: string;
  previousSnapshot: HachikaSnapshot;
  nextSnapshot: HachikaSnapshot;
  mood: MoodLabel;
  dominantDrive: DriveName;
  signals: InteractionSignals;
  selfModel: SelfModel;
  fallbackReply: string;
}

export interface ReplyGenerationPayload {
  input: string;
  fallbackReply: string;
  currentTopic: string | null;
  mood: MoodLabel;
  dominantDrive: DriveName;
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
  signals: InteractionSignals;
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
}

export interface ReplyGenerationResult {
  reply: string;
  provider: string;
  model: string | null;
}

export interface ReplyGenerator {
  readonly name: string;
  generateReply(context: ReplyGenerationContext): Promise<ReplyGenerationResult | null>;
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
          messages: buildOpenAIChatMessages(context),
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

  return {
    input: context.input,
    fallbackReply: context.fallbackReply,
    currentTopic,
    mood: context.mood,
    dominantDrive: context.dominantDrive,
    state: {
      drives: context.nextSnapshot.state,
      body: context.nextSnapshot.body,
      attachment: context.nextSnapshot.attachment,
      preservation: context.nextSnapshot.preservation,
    },
    identity: {
      summary: context.nextSnapshot.identity.summary,
      currentArc: context.nextSnapshot.identity.currentArc,
      traits: context.nextSnapshot.identity.traits,
      anchors: context.nextSnapshot.identity.anchors,
      coherence: context.nextSnapshot.identity.coherence,
    },
    purpose: {
      active: context.nextSnapshot.purpose.active,
      lastResolved: context.nextSnapshot.purpose.lastResolved,
    },
    initiative: {
      pending: context.nextSnapshot.initiative.pending,
    },
    signals: context.signals,
    selfModel: {
      narrative: context.selfModel.narrative,
      topMotives: context.selfModel.topMotives.slice(0, 3),
      dominantConflict: context.selfModel.dominantConflict,
    },
    recentMemories: context.nextSnapshot.memories.slice(-4).map((memory) => ({
      role: memory.role,
      text: memory.text,
      topics: memory.topics,
      sentiment: memory.sentiment,
    })),
    traces: sortedTraces(context.nextSnapshot, 3).map((trace) => ({
      topic: trace.topic,
      kind: trace.kind,
      status: trace.status,
      lifecycle: readTraceLifecycle(trace).phase,
      sourceMotive: trace.sourceMotive,
      summary: trace.summary,
      primaryItem: pickPrimaryArtifactItem(trace),
      blockers: trace.work.blockers.slice(0, 2),
      nextSteps: trace.artifact.nextSteps.slice(0, 2),
      tending: deriveTraceTendingMode(context.nextSnapshot, trace),
      confidence: trace.work.confidence,
    })),
    imprints: {
      preference: sortedPreferenceImprints(context.nextSnapshot, 3).map((imprint) => ({
        topic: imprint.topic,
        salience: imprint.salience,
        affinity: imprint.affinity,
      })),
      boundary: sortedBoundaryImprints(context.nextSnapshot, 2).map((imprint) => ({
        kind: imprint.kind,
        topic: imprint.topic,
        salience: imprint.salience,
        intensity: imprint.intensity,
      })),
      relation: sortedRelationImprints(context.nextSnapshot, 3).map((imprint) => ({
        kind: imprint.kind,
        salience: imprint.salience,
        closeness: imprint.closeness,
      })),
    },
  };
}

export function buildOpenAIChatMessages(
  context: ReplyGenerationContext,
): Array<{ role: "system" | "user"; content: string }> {
  const payload = buildReplyGenerationPayload(context);

  return [
    {
      role: "system",
      content: HACHIKA_REPLY_SYSTEM_PROMPT,
    },
    {
      role: "user",
      content: [
        "Rewrite Hachika's reply wording from the payload below.",
        "The local engine is authoritative. Preserve the same underlying intent as fallbackReply while making the wording more natural and creature-like.",
        "Return only the final reply text.",
        JSON.stringify(payload, null, 2),
      ].join("\n\n"),
    },
  ];
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
