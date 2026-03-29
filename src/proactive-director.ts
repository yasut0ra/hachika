import type { ProactivePlan } from "./response-planner.js";
import { summarizeWorldForPrompt } from "./world.js";
import type {
  HachikaSnapshot,
  PendingInitiative,
  ProactiveSelectionDebug,
} from "./types.js";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OPENAI_MODEL = "gpt-5-mini";

const HACHIKA_PROACTIVE_DIRECTOR_SYSTEM_PROMPT = [
  "You decide whether a locally synthesized proactive action should actually materialize for Hachika.",
  "Return JSON only.",
  "Do not write prose, markdown, or explanations.",
  "The local engine already selected a candidate proactive action. Your job is to accept, suppress, or lightly reshape its expressive plan.",
  "Prefer suppressing weak, repetitive, overly abstract, or socially intrusive proactive moves.",
  "Allow proactive moves when they are concretely grounded in a trace, blocker, relation continuity, or current world object context.",
  "Keep plan close to rulePlan unless there is a strong semantic reason to change act, focus, distance, or emphasis.",
  "Use focusTopic only when the topic is concrete and already present in candidateTopics.",
  "Return a single JSON object.",
].join(" ");

const PROACTIVE_ACT_VALUES = new Set<ProactivePlan["act"]>([
  "preserve",
  "reconnect",
  "continue_work",
  "leave_trace",
  "explore",
  "untangle",
  "reopen",
]);
const RESPONSE_STANCE_VALUES = new Set<ProactivePlan["stance"]>([
  "open",
  "measured",
  "guarded",
]);
const RESPONSE_DISTANCE_VALUES = new Set<ProactivePlan["distance"]>([
  "close",
  "measured",
  "far",
]);
const PROACTIVE_EMPHASIS_VALUES = new Set<ProactivePlan["emphasis"]>([
  "presence",
  "relation",
  "blocker",
  "reopen",
  "maintenance",
]);
const RESPONSE_VARIATION_VALUES = new Set<ProactivePlan["variation"]>([
  "brief",
  "textured",
  "questioning",
]);

export interface ProactiveDirective {
  emit: boolean;
  plan: ProactivePlan | null;
  summary: string;
}

export interface ProactiveDirectorContext {
  previousSnapshot: HachikaSnapshot;
  nextSnapshot: HachikaSnapshot;
  pending: PendingInitiative;
  neglectLevel: number;
  rulePlan: ProactivePlan;
  selection: ProactiveSelectionDebug;
}

export interface ProactiveDirectorPayload {
  pending: {
    kind: PendingInitiative["kind"];
    reason: PendingInitiative["reason"];
    motive: PendingInitiative["motive"];
    topic: string | null;
    stateTopic: string | null;
    blocker: string | null;
    place: PendingInitiative["place"] | null;
    worldAction: PendingInitiative["worldAction"] | null;
  };
  neglectLevel: number;
  body: HachikaSnapshot["body"];
  attachment: number;
  identity: {
    summary: string;
    anchors: string[];
  };
  purpose: {
    kind: string | null;
    topic: string | null;
  };
  selection: ProactiveSelectionDebug;
  rulePlan: Omit<ProactivePlan, "summary">;
  candidateTopics: string[];
  currentWorld: {
    summary: string;
    place: HachikaSnapshot["world"]["currentPlace"];
    objectIds: string[];
  };
}

export interface ProactiveDirectorResult {
  directive: ProactiveDirective;
  provider: string;
  model: string | null;
}

export interface ProactiveDirector {
  readonly name: string;
  directProactive(
    context: ProactiveDirectorContext,
  ): Promise<ProactiveDirectorResult | null>;
}

interface OpenAIProactiveDirectorOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  organization?: string | null;
  project?: string | null;
  timeoutMs?: number;
}

export class OpenAIProactiveDirector implements ProactiveDirector {
  readonly name = "openai";

  readonly #apiKey: string;
  readonly #model: string;
  readonly #baseUrl: string;
  readonly #organization: string | null;
  readonly #project: string | null;
  readonly #timeoutMs: number;

  constructor(options: OpenAIProactiveDirectorOptions) {
    this.#apiKey = options.apiKey;
    this.#model = options.model;
    this.#baseUrl = trimTrailingSlash(options.baseUrl ?? DEFAULT_OPENAI_BASE_URL);
    this.#organization = options.organization ?? null;
    this.#project = options.project ?? null;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
  }

  async directProactive(
    context: ProactiveDirectorContext,
  ): Promise<ProactiveDirectorResult | null> {
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
          messages: buildOpenAIProactiveDirectorMessages(context),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(await buildOpenAIHttpError(response));
      }

      const payload = (await response.json()) as unknown;
      const directive = normalizeProactiveDirective(
        extractOpenAIReplyText(payload),
        context.rulePlan,
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

export function createProactiveDirectorFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ProactiveDirector | null {
  const apiKey = env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    return null;
  }

  return new OpenAIProactiveDirector({
    apiKey,
    model:
      env.OPENAI_PROACTIVE_MODEL?.trim() ||
      env.OPENAI_MODEL?.trim() ||
      DEFAULT_OPENAI_MODEL,
    baseUrl: env.OPENAI_BASE_URL?.trim() || DEFAULT_OPENAI_BASE_URL,
    organization: env.OPENAI_ORGANIZATION?.trim() || null,
    project: env.OPENAI_PROJECT?.trim() || null,
  });
}

export function describeProactiveDirector(director: ProactiveDirector | null): string {
  return director ? director.name : "rule";
}

export function buildProactiveDirectorPayload(
  context: ProactiveDirectorContext,
): ProactiveDirectorPayload {
  const candidateTopics = unique([
    context.pending.topic ?? "",
    context.pending.stateTopic ?? "",
    context.selection.focusTopic ?? "",
    context.selection.stateTopic ?? "",
    context.selection.maintenanceTraceTopic ?? "",
    ...context.nextSnapshot.identity.anchors,
    context.nextSnapshot.purpose.active?.topic ?? "",
  ].filter((topic) => topic.length > 0)).slice(0, 6);

  return {
    pending: {
      kind: context.pending.kind,
      reason: context.pending.reason,
      motive: context.pending.motive,
      topic: context.pending.topic,
      stateTopic: context.pending.stateTopic ?? context.pending.topic ?? null,
      blocker: context.pending.blocker,
      place: context.pending.place ?? null,
      worldAction: context.pending.worldAction ?? null,
    },
    neglectLevel: context.neglectLevel,
    body: context.nextSnapshot.body,
    attachment: context.nextSnapshot.attachment,
    identity: {
      summary: context.nextSnapshot.identity.summary,
      anchors: context.nextSnapshot.identity.anchors.slice(0, 4),
    },
    purpose: {
      kind: context.nextSnapshot.purpose.active?.kind ?? null,
      topic: context.nextSnapshot.purpose.active?.topic ?? null,
    },
    selection: context.selection,
    rulePlan: {
      act: context.rulePlan.act,
      stance: context.rulePlan.stance,
      distance: context.rulePlan.distance,
      focusTopic: context.rulePlan.focusTopic,
      emphasis: context.rulePlan.emphasis,
      mentionBlocker: context.rulePlan.mentionBlocker,
      mentionReopen: context.rulePlan.mentionReopen,
      mentionMaintenance: context.rulePlan.mentionMaintenance,
      mentionIntent: context.rulePlan.mentionIntent,
      variation: context.rulePlan.variation,
    },
    candidateTopics,
    currentWorld: {
      summary: summarizeWorldForPrompt(context.nextSnapshot.world),
      place: context.nextSnapshot.world.currentPlace,
      objectIds: Object.entries(context.nextSnapshot.world.objects)
        .filter(([, object]) => object.place === context.nextSnapshot.world.currentPlace)
        .map(([id]) => id)
        .slice(0, 3),
    },
  };
}

export function buildOpenAIProactiveDirectorMessages(
  context: ProactiveDirectorContext,
): Array<{ role: "system" | "user"; content: string }> {
  const payload = buildProactiveDirectorPayload(context);

  return [
    {
      role: "system",
      content: HACHIKA_PROACTIVE_DIRECTOR_SYSTEM_PROMPT,
    },
    {
      role: "user",
      content: [
        "Decide whether this proactive action should materialize for Hachika.",
        "Return a single JSON object with this exact shape:",
        '{"emit":true,"plan":{"act":"reconnect","stance":"open","distance":"close","focusTopic":null,"emphasis":"relation","mentionBlocker":false,"mentionReopen":false,"mentionMaintenance":false,"mentionIntent":true,"variation":"brief"},"summary":"emit/reconnect"}',
        "emit must be true or false.",
        "plan.act must be one of preserve, reconnect, continue_work, leave_trace, explore, untangle, reopen.",
        "plan.stance must be one of open, measured, guarded.",
        "plan.distance must be one of close, measured, far.",
        "plan.emphasis must be one of presence, relation, blocker, reopen, maintenance.",
        "plan.variation must be one of brief, textured, questioning.",
        "plan.focusTopic must be null or one of candidateTopics.",
        "pending.stateTopic is the current durable topic candidate; if it is null, prefer keeping the move ephemeral unless there is strong grounded support to emit.",
        "Suppress weak or repetitive proactive moves. Allow grounded ones.",
        "Return JSON only.",
        JSON.stringify(payload, null, 2),
      ].join("\n\n"),
    },
  ];
}

export function normalizeProactiveDirective(
  rawText: string | null,
  fallbackPlan: ProactivePlan,
): ProactiveDirective | null {
  const parsed = parseJsonRecord(rawText);

  if (!parsed) {
    return null;
  }

  const emit = readBoolean(parsed.emit, true);
  const plan = normalizeProactivePlan(parsed.plan, fallbackPlan);

  return {
    emit,
    plan,
    summary:
      typeof parsed.summary === "string" && parsed.summary.trim().length > 0
        ? parsed.summary.trim()
        : summarizeProactiveDirective(emit, plan ?? fallbackPlan),
  };
}

function normalizeProactivePlan(
  raw: unknown,
  fallback: ProactivePlan,
): ProactivePlan | null {
  if (!isRecord(raw)) {
    return null;
  }

  const act = readEnum(raw.act, PROACTIVE_ACT_VALUES) ?? fallback.act;
  const stance = readEnum(raw.stance, RESPONSE_STANCE_VALUES) ?? fallback.stance;
  const distance = readEnum(raw.distance, RESPONSE_DISTANCE_VALUES) ?? fallback.distance;
  const emphasis = readEnum(raw.emphasis, PROACTIVE_EMPHASIS_VALUES) ?? fallback.emphasis;
  const variation = readEnum(raw.variation, RESPONSE_VARIATION_VALUES) ?? fallback.variation;
  const focusTopic = readFocusTopic(raw.focusTopic, fallback.focusTopic);

  return {
    act,
    stance,
    distance,
    focusTopic,
    emphasis,
    mentionBlocker: readBoolean(raw.mentionBlocker, fallback.mentionBlocker),
    mentionReopen: readBoolean(raw.mentionReopen, fallback.mentionReopen),
    mentionMaintenance: readBoolean(raw.mentionMaintenance, fallback.mentionMaintenance),
    mentionIntent: readBoolean(raw.mentionIntent, fallback.mentionIntent),
    variation,
    summary: summarizeProactivePlan(act, stance, distance, emphasis, focusTopic),
  };
}

function summarizeProactiveDirective(
  emit: boolean,
  plan: ProactivePlan,
): string {
  return `${emit ? "emit" : "suppress"}/${plan.summary}`;
}

function summarizeProactivePlan(
  act: ProactivePlan["act"],
  stance: ProactivePlan["stance"],
  distance: ProactivePlan["distance"],
  emphasis: ProactivePlan["emphasis"],
  focusTopic: string | null,
): string {
  const topic = focusTopic ? ` on ${focusTopic}` : "";
  return `${act}/${stance}/${distance}/${emphasis}${topic}`;
}

function readFocusTopic(value: unknown, fallback: string | null): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.normalize("NFKC").trim();
  return normalized.length > 0 ? normalized : fallback;
}

function readEnum<T extends string>(value: unknown, allowed: Set<T>): T | null {
  return typeof value === "string" && allowed.has(value as T) ? (value as T) : null;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
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
