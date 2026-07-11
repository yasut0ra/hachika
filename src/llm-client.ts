export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_OPENAI_MODEL = "gpt-5-mini";
export const DEFAULT_OPENAI_TIMEOUT_MS = 30_000;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OpenAIChatClientOptions {
  apiKey: string;
  model: string;
  baseUrl?: string | undefined;
  organization?: string | null | undefined;
  project?: string | null | undefined;
  timeoutMs?: number | undefined;
}

export class OpenAIChatClient {
  readonly model: string;

  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #organization: string | null;
  readonly #project: string | null;
  readonly #timeoutMs: number;

  constructor(options: OpenAIChatClientOptions) {
    this.model = options.model;
    this.#apiKey = options.apiKey;
    this.#baseUrl = trimTrailingSlash(options.baseUrl ?? DEFAULT_OPENAI_BASE_URL);
    this.#organization = options.organization ?? null;
    this.#project = options.project ?? null;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_OPENAI_TIMEOUT_MS;
  }

  async complete(messages: ChatMessage[]): Promise<string | null> {
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
          model: this.model,
          messages,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(await buildOpenAIHttpError(response));
      }

      return extractOpenAIReplyText((await response.json()) as unknown);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export async function buildOpenAIHttpError(response: Response): Promise<string> {
  const body = await response.text();
  const detail = body.trim();
  const suffix = detail.length > 0 ? ` ${truncate(detail, 240)}` : "";
  return `openai ${response.status}${suffix}`;
}

export function extractOpenAIReplyText(payload: unknown): string | null {
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

export function parseJsonRecordText(rawText: string | null): Record<string, unknown> | null {
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

export function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
