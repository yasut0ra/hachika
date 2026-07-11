import { topPreferredTopics } from "./memory.js";
import {
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_OPENAI_MODEL,
  OpenAIChatClient,
  parseJsonRecordText,
} from "./llm-client.js";
import { resolveOpenAICompatibleConfig } from "./llm-env.js";
import { clamp01 } from "./state.js";
import { sortedTraces } from "./traces.js";
import { describeWorldPlaceJa } from "./world.js";
import type {
  HachikaSnapshot,
  InteractionSignals,
  StructuredTraceExtraction,
  TraceKind,
} from "./types.js";

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
  actorCue: string;
  discourse: {
    openQuestions: Array<{
      target: string;
      text: string;
      status: string;
    }>;
    openRequests: Array<{
      target: string;
      kind: string;
      text: string;
      status: string;
    }>;
    lastCorrection: {
      target: string;
      kind: string;
      text: string;
    } | null;
  };
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
  name?: string;
  baseUrl?: string;
  organization?: string | null;
  project?: string | null;
  timeoutMs?: number;
}

export class OpenAITraceExtractor implements TraceExtractor {
  readonly name: string;

  readonly #client: OpenAIChatClient;

  constructor(options: OpenAITraceExtractorOptions) {
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

  async extractTrace(
    context: TraceExtractionContext,
  ): Promise<TraceExtractionResult | null> {
    const rawText = await this.#client.complete(
      buildOpenAITraceExtractionMessages(context),
    );
    const extraction = normalizeTraceExtraction(rawText);

    if (!extraction) {
      return null;
    }

    return {
      extraction,
      provider: this.name,
      model: this.#client.model,
    };
  }
}

export function createTraceExtractorFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): TraceExtractor | null {
  const config = resolveOpenAICompatibleConfig(env, {
    defaultBaseUrl: DEFAULT_OPENAI_BASE_URL,
    defaultModel: DEFAULT_OPENAI_MODEL,
    openAiModelEnv: "OPENAI_TRACE_MODEL",
    localModelEnv: "HACHIKA_LOCAL_AI_TRACE_MODEL",
  });

  if (!config) {
    return null;
  }

  return new OpenAITraceExtractor({
    apiKey: config.apiKey,
    model: config.model,
    name: config.local ? "local-ai" : "openai",
    baseUrl: config.baseUrl,
    organization: config.organization,
    project: config.project,
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
    actorCue: buildTraceActorCue(context),
    discourse: {
      openQuestions: context.snapshot.discourse.openQuestions
        .slice(-4)
        .map((question) => ({
          target: question.target,
          text: question.text,
          status: question.status,
        })),
      openRequests: context.snapshot.discourse.openRequests
        .slice(-4)
        .map((request) => ({
          target: request.target,
          kind: request.kind,
          text: request.text,
          status: request.status,
        })),
      lastCorrection: context.snapshot.discourse.lastCorrection
        ? {
            target: context.snapshot.discourse.lastCorrection.target,
            kind: context.snapshot.discourse.lastCorrection.kind,
            text: context.snapshot.discourse.lastCorrection.text,
          }
        : null,
    },
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

function buildTraceActorCue(
  context: TraceExtractionContext,
): string {
  const snapshot = context.snapshot;
  const place = describeWorldPlaceJa(snapshot.world.currentPlace);
  const focusTopic =
    context.signals.topics[0] ??
    snapshot.purpose.active?.topic ??
    sortedTraces(snapshot, 1)[0]?.topic ??
    snapshot.identity.anchors[0] ??
    null;

  if (
    snapshot.discourse.openRequests.some(
      (request) => request.status === "open" && request.kind !== "task",
    ) ||
    snapshot.discourse.lastCorrection
  ) {
    return `いまは${place}で、言い直しや直接の要望を trace に混ぜたくない。`;
  }

  if (context.signals.workCue >= 0.45 && focusTopic) {
    return `いまは${place}で、「${focusTopic}」の作業片だけを拾いたい。`;
  }

  return `いまは${place}で、再利用できる具体だけを拾いたい。`;
}

export function normalizeTraceExtraction(
  rawText: string | null,
): StructuredTraceExtraction | null {
  const parsed = parseJsonRecordText(rawText);

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

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}
