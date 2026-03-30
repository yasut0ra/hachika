import type {
  HachikaSnapshot,
  InitiativeAutonomyAction,
} from "./types.js";
import type { PreparedIdleAutonomyAction } from "./initiative.js";
import { summarizeWorldForPrompt } from "./world.js";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OPENAI_MODEL = "gpt-5-mini";

const HACHIKA_AUTONOMY_DIRECTOR_SYSTEM_PROMPT = [
  "You decide whether a locally synthesized internal autonomy action should materialize for Hachika during a resident-loop tick.",
  "Return JSON only.",
  "Do not write prose, markdown, or explanations.",
  "The local engine already prepared an internal action candidate: observe, hold, drift, or recall.",
  "You may keep it, suppress it, or lightly reshape the action.",
  "You may also decide whether outward proactive should be evaluated after this internal action.",
  "Prefer recall only when there is clear grounded continuity in a concrete trace, object-linked topic, or unfinished work.",
  "Prefer hold or drift for quiet internal organization.",
  "Prefer observe for low-pressure silent ticks where it is more natural to simply stay with the world.",
  "Prefer allowOutward:false for quiet, settled ticks that should remain silent after the internal action.",
  "Prefer allowOutward:true only when there is clear grounded continuity, neglect pressure, or a concrete follow-through worth evaluating.",
  "Do not introduce speak here.",
  "Keep the action close to the local suggestion unless there is a strong semantic reason to cool it.",
  "Return a single JSON object.",
].join(" ");

const INTERNAL_ACTION_VALUES = new Set<Exclude<InitiativeAutonomyAction, "speak" | null>>([
  "observe",
  "hold",
  "drift",
  "recall",
]);

export interface AutonomyDirective {
  keep: boolean;
  action: Exclude<InitiativeAutonomyAction, "speak" | null>;
  allowOutward: boolean;
  summary: string;
}

export interface AutonomyDirectorContext {
  previousSnapshot: HachikaSnapshot;
  nextSnapshot: HachikaSnapshot;
  hours: number;
  prepared: PreparedIdleAutonomyAction;
}

export interface AutonomyDirectorPayload {
  hours: number;
  suggestedAction: Exclude<InitiativeAutonomyAction, "speak" | null>;
  prioritizedTopic: string | null;
  prioritizedMotive: string | null;
  selected: {
    topic: string | null;
    motive: string | null;
    score: number | null;
    blocker: string | null;
    shouldInstallPending: boolean;
  };
  state: HachikaSnapshot["state"];
  body: HachikaSnapshot["body"];
  reactivity: HachikaSnapshot["reactivity"];
  attachment: number;
  identity: {
    summary: string;
    anchors: string[];
  };
  purpose: {
    kind: string | null;
    topic: string | null;
  };
  world: {
    summary: string;
    currentPlace: HachikaSnapshot["world"]["currentPlace"];
    linkedTopics: string[];
  };
}

export interface AutonomyDirectorResult {
  directive: AutonomyDirective;
  provider: string;
  model: string | null;
}

export interface AutonomyDirector {
  readonly name: string;
  directAutonomy(
    context: AutonomyDirectorContext,
  ): Promise<AutonomyDirectorResult | null>;
}

interface OpenAIAutonomyDirectorOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  organization?: string | null;
  project?: string | null;
  timeoutMs?: number;
}

export class OpenAIAutonomyDirector implements AutonomyDirector {
  readonly name = "openai";

  readonly #apiKey: string;
  readonly #model: string;
  readonly #baseUrl: string;
  readonly #organization: string | null;
  readonly #project: string | null;
  readonly #timeoutMs: number;

  constructor(options: OpenAIAutonomyDirectorOptions) {
    this.#apiKey = options.apiKey;
    this.#model = options.model;
    this.#baseUrl = trimTrailingSlash(options.baseUrl ?? DEFAULT_OPENAI_BASE_URL);
    this.#organization = options.organization ?? null;
    this.#project = options.project ?? null;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
  }

  async directAutonomy(
    context: AutonomyDirectorContext,
  ): Promise<AutonomyDirectorResult | null> {
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
          messages: buildOpenAIAutonomyDirectorMessages(context),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(await buildOpenAIHttpError(response));
      }

      const payload = (await response.json()) as unknown;
      const directive = normalizeAutonomyDirective(
        extractOpenAIReplyText(payload),
        context.prepared.action,
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

export function createAutonomyDirectorFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): AutonomyDirector | null {
  const apiKey = env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    return null;
  }

  return new OpenAIAutonomyDirector({
    apiKey,
    model:
      env.OPENAI_AUTONOMY_MODEL?.trim() ||
      env.OPENAI_MODEL?.trim() ||
      DEFAULT_OPENAI_MODEL,
    baseUrl: env.OPENAI_BASE_URL?.trim() || DEFAULT_OPENAI_BASE_URL,
    organization: env.OPENAI_ORGANIZATION?.trim() || null,
    project: env.OPENAI_PROJECT?.trim() || null,
  });
}

export function describeAutonomyDirector(
  director: AutonomyDirector | null,
): string {
  return director ? director.name : "rule";
}

export function buildAutonomyDirectorPayload(
  context: AutonomyDirectorContext,
): AutonomyDirectorPayload {
  const linkedTopics =
    context.nextSnapshot.world.objects[
      Object.keys(context.nextSnapshot.world.objects).find(
        (id) =>
          context.nextSnapshot.world.objects[id]?.place ===
          context.nextSnapshot.world.currentPlace,
      ) as keyof HachikaSnapshot["world"]["objects"]
    ]?.linkedTraceTopics ?? [];

  return {
    hours: context.hours,
    suggestedAction: context.prepared.action,
    prioritizedTopic: context.prepared.prioritizedTopic,
    prioritizedMotive: context.prepared.prioritizedMotive,
    selected: {
      topic: context.prepared.selected?.trace.topic ?? null,
      motive: context.prepared.selected?.motive ?? null,
      score: context.prepared.selected?.score ?? null,
      blocker: context.prepared.selected?.blocker ?? null,
      shouldInstallPending: context.prepared.selected?.shouldInstallPending ?? false,
    },
    state: context.nextSnapshot.state,
    body: context.nextSnapshot.body,
    reactivity: context.nextSnapshot.reactivity,
    attachment: context.nextSnapshot.attachment,
    identity: {
      summary: context.nextSnapshot.identity.summary,
      anchors: context.nextSnapshot.identity.anchors.slice(0, 4),
    },
    purpose: {
      kind: context.nextSnapshot.purpose.active?.kind ?? null,
      topic: context.nextSnapshot.purpose.active?.topic ?? null,
    },
    world: {
      summary: summarizeWorldForPrompt(context.nextSnapshot.world),
      currentPlace: context.nextSnapshot.world.currentPlace,
      linkedTopics: linkedTopics.slice(0, 4),
    },
  };
}

function buildOpenAIAutonomyDirectorMessages(
  context: AutonomyDirectorContext,
): Array<{ role: "system" | "user"; content: string }> {
  return [
    {
      role: "system",
      content: HACHIKA_AUTONOMY_DIRECTOR_SYSTEM_PROMPT,
    },
    {
      role: "user",
      content: JSON.stringify(buildAutonomyDirectorPayload(context)),
    },
  ];
}

function normalizeAutonomyDirective(
  text: string,
  fallbackAction: Exclude<InitiativeAutonomyAction, "speak" | null>,
): AutonomyDirective | null {
  try {
    const raw = JSON.parse(text) as Record<string, unknown>;
    const keep = raw.keep !== false;
    const allowOutward = raw.allowOutward !== false;
    const action = INTERNAL_ACTION_VALUES.has(raw.action as never)
      ? (raw.action as Exclude<InitiativeAutonomyAction, "speak" | null>)
      : fallbackAction;
    const summary =
      typeof raw.summary === "string" && raw.summary.trim().length > 0
        ? raw.summary.trim()
        : `${keep ? "keep" : "suppress"}/${action}`;

    return {
      keep,
      action,
      allowOutward,
      summary,
    };
  } catch {
    return null;
  }
}

async function buildOpenAIHttpError(response: Response): Promise<string> {
  const text = await response.text();
  return `openai_autonomy_director_http_${response.status}:${text.slice(0, 240)}`;
}

function extractOpenAIReplyText(payload: unknown): string {
  if (
    payload &&
    typeof payload === "object" &&
    "choices" in payload &&
    Array.isArray((payload as { choices?: unknown[] }).choices)
  ) {
    const choice = (payload as { choices: Array<{ message?: { content?: unknown } }> }).choices[0];
    const content = choice?.message?.content;
    if (typeof content === "string") {
      return content.trim();
    }
  }

  return "";
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
