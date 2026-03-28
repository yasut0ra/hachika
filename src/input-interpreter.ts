import {
  isMeaningfulTopic,
  requiresConcreteTopicSupport,
  topPreferredTopics,
} from "./memory.js";
import { clamp01 } from "./state.js";
import { sortedTraces } from "./traces.js";
import type { HachikaSnapshot, PreservationConcern } from "./types.js";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OPENAI_MODEL = "gpt-5-mini";

const HACHIKA_INPUT_INTERPRETER_SYSTEM_PROMPT = [
  "You classify one user utterance for Hachika's local engine.",
  "Return JSON only.",
  "Do not write explanations, markdown, or prose.",
  "Treat greetings, acknowledgements, vague fillers, backchannels, and light small talk as non-topical unless the input clearly names a concrete topic.",
  "When the user asks to change the subject or talk about something else, set abandonment high and keep topics empty unless a new concrete topic is explicitly named.",
  "Do not output discourse scaffolding such as まずは, いちばん, って, かな, or similar filler fragments as topics.",
  "Avoid generic meta topics such as 会話, 話, 言い方, 雰囲気, 温度, or 感じ unless the user is clearly managing them as a concrete work topic.",
  "Prefer compact concrete topics like 仕様の境界, 問題点, or 世界観 over broad heads like 仕様, 問題, or 世界 when the utterance makes the relation explicit.",
  "For pure self-inquiry or world-inquiry without concrete work, prefer topics: [] over abstract placeholders like 存在, 目的, 世界, or 棚の残り.",
  "Only reuse knownTopics when the input clearly refers to them.",
  "Keep topics short, concrete, and reusable.",
  "All numeric fields must be in the range 0..1.",
].join(" ");

const TRIVIAL_TOPICS = new Set([
  "そう",
  "それ",
  "これ",
  "あれ",
  "なんか",
  "へー",
  "ふーん",
  "うん",
  "はい",
  "いや",
  "よかった",
  "納得",
  "例えば",
  "たとえば",
  "じゃあ",
  "ひとつ",
  "二つ",
  "三つ",
  "分け",
  "会話",
  "話",
  "言い方",
  "雰囲気",
  "温度",
  "感じ",
  "ごめん",
  "さっき",
  "て話",
  "始まり",
  "まずは",
  "いちばん",
  "って",
  "かな",
  "ちゃんと",
  "頑張って",
  "頑張ってね",
  "頑張れ",
  "なんでも",
  "なんでも聞",
  "なんでも聞いて",
  "お疲れ",
  "おつかれ",
]);

export interface InputInterpretationContext {
  input: string;
  snapshot: HachikaSnapshot;
  localTopics: string[];
}

export interface InputInterpretation {
  topics: string[];
  positive: number;
  negative: number;
  question: number;
  intimacy: number;
  dismissal: number;
  memoryCue: number;
  expansionCue: number;
  completion: number;
  abandonment: number;
  preservationThreat: number;
  preservationConcern: PreservationConcern | null;
  greeting: number;
  smalltalk: number;
  repair: number;
  selfInquiry: number;
  worldInquiry: number;
  workCue: number;
}

export interface InputInterpretationPayload {
  input: string;
  localTopics: string[];
  knownTopics: string[];
  activePurpose: {
    kind: string | null;
    topic: string | null;
  };
  identitySummary: string;
}

export interface InputInterpretationResult {
  interpretation: InputInterpretation;
  provider: string;
  model: string | null;
}

export interface InputInterpreter {
  readonly name: string;
  interpretInput(
    context: InputInterpretationContext,
  ): Promise<InputInterpretationResult | null>;
}

interface OpenAIInputInterpreterOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  organization?: string | null;
  project?: string | null;
  timeoutMs?: number;
}

export class OpenAIInputInterpreter implements InputInterpreter {
  readonly name = "openai";

  readonly #apiKey: string;
  readonly #model: string;
  readonly #baseUrl: string;
  readonly #organization: string | null;
  readonly #project: string | null;
  readonly #timeoutMs: number;

  constructor(options: OpenAIInputInterpreterOptions) {
    this.#apiKey = options.apiKey;
    this.#model = options.model;
    this.#baseUrl = trimTrailingSlash(options.baseUrl ?? DEFAULT_OPENAI_BASE_URL);
    this.#organization = options.organization ?? null;
    this.#project = options.project ?? null;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
  }

  async interpretInput(
    context: InputInterpretationContext,
  ): Promise<InputInterpretationResult | null> {
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
          messages: buildOpenAIInputInterpretationMessages(context),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(await buildOpenAIHttpError(response));
      }

      const payload = (await response.json()) as unknown;
      const rawText = extractOpenAIReplyText(payload);
      const interpretation = normalizeInputInterpretation(rawText);

      if (!interpretation) {
        return null;
      }

      return {
        interpretation,
        provider: this.name,
        model: this.#model,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createInputInterpreterFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): InputInterpreter | null {
  const apiKey = env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    return null;
  }

  return new OpenAIInputInterpreter({
    apiKey,
    model:
      env.OPENAI_INTERPRETER_MODEL?.trim() ||
      env.OPENAI_MODEL?.trim() ||
      DEFAULT_OPENAI_MODEL,
    baseUrl: env.OPENAI_BASE_URL?.trim() || DEFAULT_OPENAI_BASE_URL,
    organization: env.OPENAI_ORGANIZATION?.trim() || null,
    project: env.OPENAI_PROJECT?.trim() || null,
  });
}

export function describeInputInterpreter(interpreter: InputInterpreter | null): string {
  return interpreter ? interpreter.name : "rule";
}

export function buildInputInterpretationPayload(
  context: InputInterpretationContext,
): InputInterpretationPayload {
  const traceTopics = sortedTraces(context.snapshot, 3).map((trace) => trace.topic);
  const knownTopics = unique([
    ...context.localTopics,
    ...topPreferredTopics(context.snapshot, 4),
    ...traceTopics,
    context.snapshot.purpose.active?.topic ?? "",
    context.snapshot.purpose.lastResolved?.topic ?? "",
    ...context.snapshot.identity.anchors,
  ].filter((topic) => topic.length > 0)).slice(0, 8);

  return {
    input: context.input,
    localTopics: context.localTopics,
    knownTopics,
    activePurpose: {
      kind: context.snapshot.purpose.active?.kind ?? null,
      topic: context.snapshot.purpose.active?.topic ?? null,
    },
    identitySummary: context.snapshot.identity.summary,
  };
}

export function buildOpenAIInputInterpretationMessages(
  context: InputInterpretationContext,
): Array<{ role: "system" | "user"; content: string }> {
  const payload = buildInputInterpretationPayload(context);

  return [
    {
      role: "system",
      content: HACHIKA_INPUT_INTERPRETER_SYSTEM_PROMPT,
    },
    {
      role: "user",
      content: [
        "Interpret the user utterance for Hachika's local signal engine.",
        "Return a single JSON object with this exact shape:",
        '{"topics":["..."],"positive":0,"negative":0,"question":0,"intimacy":0,"dismissal":0,"memoryCue":0,"expansionCue":0,"completion":0,"abandonment":0,"preservationThreat":0,"preservationConcern":null,"greeting":0,"smalltalk":0,"repair":0,"selfInquiry":0,"worldInquiry":0,"workCue":0}',
        "Use topics: [] for greetings, fillers, vague acknowledgements, and light small talk that do not name a concrete topic.",
        "If the user is asking to switch subjects or say 'let's talk about something else', set abandonment high and keep topics empty unless a new concrete topic is named.",
        "Never output discourse scaffolding like まずは, いちばん, って, かな as topics.",
        "Set selfInquiry high when the user asks about Hachika itself, its inner state, motives, or worldview.",
        "Set worldInquiry high when the user asks where Hachika is, what surrounds it, or what the current place/world feels like.",
        "Set repair high when the user is softening, encouraging, reconnecting, apologizing, or trying to restore rapport.",
        "Set workCue high only when the input is clearly trying to specify, build, plan, record, or resolve something.",
        JSON.stringify(payload, null, 2),
      ].join("\n\n"),
    },
  ];
}

function normalizeInputInterpretation(rawText: string | null): InputInterpretation | null {
  if (!rawText) {
    return null;
  }

  const objectText = extractJsonObject(rawText);
  if (!objectText) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(objectText);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  const interpretation: InputInterpretation = {
    topics: normalizeTopics(parsed.topics),
    positive: readClampedNumber(parsed.positive),
    negative: readClampedNumber(parsed.negative),
    question: readClampedNumber(parsed.question),
    intimacy: readClampedNumber(parsed.intimacy),
    dismissal: readClampedNumber(parsed.dismissal),
    memoryCue: readClampedNumber(parsed.memoryCue),
    expansionCue: readClampedNumber(parsed.expansionCue),
    completion: readClampedNumber(parsed.completion),
    abandonment: readClampedNumber(parsed.abandonment),
    preservationThreat: readClampedNumber(parsed.preservationThreat),
    preservationConcern: normalizePreservationConcern(parsed.preservationConcern),
    greeting: readClampedNumber(parsed.greeting),
    smalltalk: readClampedNumber(parsed.smalltalk),
    repair: readClampedNumber(parsed.repair),
    selfInquiry: readClampedNumber(parsed.selfInquiry),
    worldInquiry: readClampedNumber(parsed.worldInquiry),
    workCue: readClampedNumber(parsed.workCue),
  };

  if (shouldSuppressBroadSocialTopics(interpretation)) {
    interpretation.topics = interpretation.topics.filter((topic) =>
      !requiresConcreteTopicSupport(topic) && !isPseudoWorldTopic(topic),
    );
  };

  if (
    interpretation.abandonment >= 0.28 &&
    interpretation.question >= 0.2 &&
    interpretation.negative < 0.18
  ) {
    interpretation.dismissal = Math.min(interpretation.dismissal, 0.08);
  }

  return interpretation;
}

function normalizeTopics(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const topics = raw
    .map((topic) => normalizeTopic(topic))
    .filter((topic): topic is string => Boolean(topic));

  return unique(topics).slice(0, 4);
}

function normalizeTopic(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }

  const topic = raw
    .normalize("NFKC")
    .trim()
    .replace(/^[「『"'`\s]+/, "")
    .replace(/[」』"'`\s]+$/, "")
    .replace(/\s+/g, " ");

  if (topic.length < 2) {
    return null;
  }

  if (TRIVIAL_TOPICS.has(topic.toLowerCase())) {
    return null;
  }

  if (topic.includes("なんでも")) {
    return null;
  }

  if (!isMeaningfulTopic(topic)) {
    return null;
  }

  return topic;
}

function shouldSuppressBroadSocialTopics(interpretation: InputInterpretation): boolean {
  return (
    interpretation.workCue < 0.35 &&
    Math.max(
      interpretation.greeting,
      interpretation.smalltalk,
      interpretation.repair,
      interpretation.selfInquiry,
      interpretation.worldInquiry,
      interpretation.abandonment,
    ) >= 0.38
  );
}

function isPseudoWorldTopic(topic: string): boolean {
  if (
    topic === "世界" ||
    topic === "場所" ||
    topic === "世界の様子" ||
    topic === "そっちの様子" ||
    topic === "そっちの世界"
  ) {
    return true;
  }

  return ["残り", "様子", "気配", "空気", "周り", "周囲", "景色", "棚", "机", "灯り"].some(
    (part) => topic.includes(part),
  );
}

function normalizePreservationConcern(raw: unknown): PreservationConcern | null {
  switch (raw) {
    case "forgetting":
    case "reset":
    case "erasure":
    case "shutdown":
    case "absence":
      return raw;
    default:
      return null;
  }
}

function extractJsonObject(value: string): string | null {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = fenced?.[1] ?? value;
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");

  if (start < 0 || end <= start) {
    return null;
  }

  return source.slice(start, end + 1);
}

function readClampedNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? clamp01(value) : 0;
}

function extractOpenAIReplyText(payload: unknown): string | null {
  if (!isRecord(payload)) {
    return null;
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

      return typeof item.text === "string" ? item.text : null;
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
      if (!isRecord(content) || typeof content.text !== "string") {
        continue;
      }

      parts.push(content.text);
    }
  }

  return parts.length > 0 ? parts.join("\n") : null;
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

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
