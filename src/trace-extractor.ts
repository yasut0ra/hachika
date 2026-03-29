import { topPreferredTopics } from "./memory.js";
import { clamp01 } from "./state.js";
import { sortedTraces } from "./traces.js";
import type {
  HachikaSnapshot,
  InteractionSignals,
  StructuredTraceExtraction,
  TraceKind,
} from "./types.js";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OPENAI_MODEL = "gpt-5-mini";

const HACHIKA_TRACE_EXTRACTOR_SYSTEM_PROMPT = [
  "You extract structured trace hints for Hachika's local trace engine.",
  "Return JSON only.",
  "Do not write prose, markdown, or explanations.",
  "Only extract concrete reusable topics, blockers, next steps, fragments, or decisions when they are actually present.",
  "Do not emit greetings, fillers, vague acknowledgements, or soft social repair lines as trace content.",
  "Do not turn naming, calling forms, requests for directness, or relationship clarification into trace content unless concrete reusable work is explicit.",
  "Prefer compact concrete topics like 仕様の境界 or 問題点 over broad meta topics.",
  "If the utterance is mostly social or vague, return empty arrays and kindHint null.",
  "completion must be a number in 0..1.",
  "kindHint must be one of note, continuity_marker, spec_fragment, decision, or null.",
].join(" ");

const TRACE_KIND_VALUES = new Set<TraceKind>([
  "note",
  "continuity_marker",
  "spec_fragment",
  "decision",
]);

export interface TraceExtractionContext {
  input: string;
  snapshot: HachikaSnapshot;
  signals: InteractionSignals;
}

export interface TraceExtractionPayload {
  input: string;
  signalTopics: string[];
  knownTopics: string[];
  activePurpose: {
    kind: string | null;
    topic: string | null;
  };
  topTraceTopics: string[];
  identitySummary: string;
  signalSummary: {
    question: number;
    workCue: number;
    memoryCue: number;
    expansionCue: number;
    completion: number;
    abandonment: number;
    greeting: number;
    smalltalk: number;
    repair: number;
    selfInquiry: number;
    negative: number;
    dismissal: number;
    preservationThreat: number;
  };
}

export interface TraceExtractionResult {
  extraction: StructuredTraceExtraction;
  provider: string;
  model: string | null;
}

export interface TraceExtractor {
  readonly name: string;
  extractTrace(
    context: TraceExtractionContext,
  ): Promise<TraceExtractionResult | null>;
}

interface OpenAITraceExtractorOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  organization?: string | null;
  project?: string | null;
  timeoutMs?: number;
}

export class OpenAITraceExtractor implements TraceExtractor {
  readonly name = "openai";

  readonly #apiKey: string;
  readonly #model: string;
  readonly #baseUrl: string;
  readonly #organization: string | null;
  readonly #project: string | null;
  readonly #timeoutMs: number;

  constructor(options: OpenAITraceExtractorOptions) {
    this.#apiKey = options.apiKey;
    this.#model = options.model;
    this.#baseUrl = trimTrailingSlash(options.baseUrl ?? DEFAULT_OPENAI_BASE_URL);
    this.#organization = options.organization ?? null;
    this.#project = options.project ?? null;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
  }

  async extractTrace(
    context: TraceExtractionContext,
  ): Promise<TraceExtractionResult | null> {
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
          messages: buildOpenAITraceExtractionMessages(context),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(await buildOpenAIHttpError(response));
      }

      const payload = (await response.json()) as unknown;
      const extraction = normalizeTraceExtraction(extractOpenAIReplyText(payload));

      if (!extraction) {
        return null;
      }

      return {
        extraction,
        provider: this.name,
        model: this.#model,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createTraceExtractorFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): TraceExtractor | null {
  const apiKey = env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    return null;
  }

  return new OpenAITraceExtractor({
    apiKey,
    model:
      env.OPENAI_TRACE_MODEL?.trim() ||
      env.OPENAI_MODEL?.trim() ||
      DEFAULT_OPENAI_MODEL,
    baseUrl: env.OPENAI_BASE_URL?.trim() || DEFAULT_OPENAI_BASE_URL,
    organization: env.OPENAI_ORGANIZATION?.trim() || null,
    project: env.OPENAI_PROJECT?.trim() || null,
  });
}

export function describeTraceExtractor(extractor: TraceExtractor | null): string {
  return extractor ? extractor.name : "rule";
}

export function buildTraceExtractionPayload(
  context: TraceExtractionContext,
): TraceExtractionPayload {
  const knownTopics = unique([
    ...context.signals.topics,
    ...topPreferredTopics(context.snapshot, 4),
    ...sortedTraces(context.snapshot, 4).map((trace) => trace.topic),
    ...context.snapshot.identity.anchors,
    context.snapshot.purpose.active?.topic ?? "",
  ].filter((topic) => topic.length > 0)).slice(0, 8);

  return {
    input: context.input,
    signalTopics: context.signals.topics,
    knownTopics,
    activePurpose: {
      kind: context.snapshot.purpose.active?.kind ?? null,
      topic: context.snapshot.purpose.active?.topic ?? null,
    },
    topTraceTopics: sortedTraces(context.snapshot, 3).map((trace) => trace.topic),
    identitySummary: context.snapshot.identity.summary,
    signalSummary: {
      question: context.signals.question,
      workCue: context.signals.workCue,
      memoryCue: context.signals.memoryCue,
      expansionCue: context.signals.expansionCue,
      completion: context.signals.completion,
      abandonment: context.signals.abandonment,
      greeting: context.signals.greeting,
      smalltalk: context.signals.smalltalk,
      repair: context.signals.repair,
      selfInquiry: context.signals.selfInquiry,
      negative: context.signals.negative,
      dismissal: context.signals.dismissal,
      preservationThreat: context.signals.preservationThreat,
    },
  };
}

export function buildOpenAITraceExtractionMessages(
  context: TraceExtractionContext,
): Array<{ role: "system" | "user"; content: string }> {
  const payload = buildTraceExtractionPayload(context);

  return [
    {
      role: "system",
      content: HACHIKA_TRACE_EXTRACTOR_SYSTEM_PROMPT,
    },
    {
      role: "user",
      content: [
        "Extract structured trace hints for Hachika's local trace engine.",
        "Return a single JSON object with this exact shape:",
        '{"topics":[],"kindHint":null,"completion":0,"blockers":[],"memo":[],"fragments":[],"decisions":[],"nextSteps":[]}',
        "Use topics only for concrete reusable topics.",
        "Use kindHint decision only for explicit completion or resolution.",
        "Use kindHint spec_fragment for explicit work fragments or design/spec details.",
        "Use blockers only for actual unresolved constraints or uncertainties.",
        "Use nextSteps only for explicit next actions.",
        "Return JSON only.",
        JSON.stringify(payload, null, 2),
      ].join("\n\n"),
    },
  ];
}

export function normalizeTraceExtraction(
  rawText: string | null,
): StructuredTraceExtraction | null {
  const parsed = parseJsonRecord(rawText);

  if (!parsed) {
    return null;
  }

  return {
    topics: normalizeStringArray(parsed.topics, 4),
    kindHint: normalizeTraceKind(parsed.kindHint),
    completion: clamp01(typeof parsed.completion === "number" ? parsed.completion : 0),
    blockers: normalizeStringArray(parsed.blockers, 3),
    memo: normalizeStringArray(parsed.memo, 3),
    fragments: normalizeStringArray(parsed.fragments, 3),
    decisions: normalizeStringArray(parsed.decisions, 3),
    nextSteps: normalizeStringArray(parsed.nextSteps, 3),
  };
}

function normalizeTraceKind(value: unknown): TraceKind | null {
  return typeof value === "string" && TRACE_KIND_VALUES.has(value as TraceKind)
    ? (value as TraceKind)
    : null;
}

function normalizeStringArray(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return unique(
    value
      .map((item) => (typeof item === "string" ? item.replace(/\s+/g, " ").trim() : ""))
      .filter((item) => item.length > 0),
  ).slice(0, limit);
}

function parseJsonRecord(rawText: string | null): Record<string, unknown> | null {
  if (!rawText) {
    return null;
  }

  const trimmed = rawText.trim();
  const direct = tryParseRecord(trimmed);
  if (direct) {
    return direct;
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  return tryParseRecord(trimmed.slice(start, end + 1));
}

function tryParseRecord(value: string): Record<string, unknown> | null {
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
  if (!isRecord(payload) || !Array.isArray(payload.choices)) {
    return null;
  }

  const firstChoice = payload.choices[0];
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
