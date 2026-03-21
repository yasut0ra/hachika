import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, normalize, resolve } from "node:path";

import { syncArtifacts } from "./artifacts.js";
import { HachikaEngine } from "./engine.js";
import { loadDotEnv } from "./env.js";
import { createInputInterpreterFromEnv } from "./input-interpreter.js";
import { loadSnapshot, saveSnapshot } from "./persistence.js";
import { createReplyGeneratorFromEnv } from "./reply-generator.js";
import { createResponsePlannerFromEnv } from "./response-planner.js";
import { createTraceExtractorFromEnv } from "./trace-extractor.js";
import { createInitialSnapshot } from "./state.js";
import { buildUiState } from "./ui-state.js";

const snapshotPath = resolve(process.cwd(), "data/hachika-state.json");
const artifactsDir = resolve(process.cwd(), "data/artifacts");
const uiDir = resolve(process.cwd(), "ui");
loadDotEnv();
const host = process.env.HACHIKA_UI_HOST?.trim() || "127.0.0.1";
const port = Number(process.env.HACHIKA_UI_PORT?.trim() || "3042");
const snapshot = await loadSnapshot(snapshotPath);
const engine = new HachikaEngine(snapshot);
const replyGenerator = createReplyGeneratorFromEnv();
const inputInterpreter = createInputInterpreterFromEnv();
const responsePlanner = createResponsePlannerFromEnv();
const traceExtractor = createTraceExtractorFromEnv();

await persistState(engine);

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${host}:${port}`);

    if (url.pathname === "/api/state" && request.method === "GET") {
      return sendJson(response, 200, buildUiState(engine, artifactsDir));
    }

    if (url.pathname === "/api/message" && request.method === "POST") {
      const body = await readJsonBody(request);
      const text = typeof body.text === "string" ? body.text.trim() : "";

      if (!text) {
        return sendJson(response, 400, { error: "message_required" });
      }

      const result = replyGenerator || inputInterpreter || responsePlanner || traceExtractor
        ? await engine.respondAsync(text, {
            replyGenerator,
            inputInterpreter,
            responsePlanner,
            traceExtractor,
          })
        : engine.respond(text);

      await persistState(engine);
      return sendJson(response, 200, {
        reply: result.reply,
        ui: buildUiState(engine, artifactsDir),
      });
    }

    if (url.pathname === "/api/proactive" && request.method === "POST") {
      const body = await readJsonBody(request);
      const force = body.force !== false;
      const message = replyGenerator
        ? await engine.emitInitiativeAsync({ force, replyGenerator })
        : engine.emitInitiative({ force });

      await persistState(engine);
      return sendJson(response, 200, {
        message,
        ui: buildUiState(engine, artifactsDir),
      });
    }

    if (url.pathname === "/api/idle" && request.method === "POST") {
      const body = await readJsonBody(request);
      const hours = Number(body.hours);

      if (!Number.isFinite(hours) || hours <= 0) {
        return sendJson(response, 400, { error: "hours_must_be_positive" });
      }

      engine.rewindIdleHours(hours);
      let proactive: string | null = null;
      proactive = replyGenerator
        ? await engine.emitInitiativeAsync({ replyGenerator })
        : engine.emitInitiative();

      await persistState(engine);
      return sendJson(response, 200, {
        hours,
        proactive,
        ui: buildUiState(engine, artifactsDir),
      });
    }

    if (url.pathname === "/api/reset" && request.method === "POST") {
      engine.reset(createInitialSnapshot());
      await persistState(engine);
      return sendJson(response, 200, {
        ok: true,
        ui: buildUiState(engine, artifactsDir),
      });
    }

    if (request.method === "GET") {
      return serveStatic(response, url.pathname);
    }

    return sendJson(response, 405, { error: "method_not_allowed" });
  } catch (error) {
    return sendJson(response, 500, {
      error: error instanceof Error ? error.message : "ui_server_error",
    });
  }
});

server.listen(port, host, () => {
  console.log(`Hachika UI listening on http://${host}:${port}`);
});

async function persistState(currentEngine: HachikaEngine): Promise<void> {
  const currentSnapshot = currentEngine.getSnapshot();
  await saveSnapshot(snapshotPath, currentSnapshot);
  await syncArtifacts(currentSnapshot, artifactsDir);
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));

    if (chunks.reduce((size, part) => size + part.length, 0) > 1_000_000) {
      throw new Error("request_too_large");
    }
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {};
  }

  const parsed = JSON.parse(raw) as unknown;
  return isRecord(parsed) ? parsed : {};
}

async function serveStatic(response: ServerResponse, pathname: string): Promise<void> {
  const target = pathname === "/" ? "/index.html" : pathname;
  const resolved = resolve(uiDir, `.${normalize(target)}`);

  if (!resolved.startsWith(uiDir)) {
    sendText(response, 404, "not found");
    return;
  }

  try {
    const file = await readFile(resolved);
    response.writeHead(200, { "Content-Type": contentTypeFor(resolved) });
    response.end(file);
  } catch {
    sendText(response, 404, "not found");
  }
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(`${JSON.stringify(payload)}\n`);
}

function sendText(response: ServerResponse, status: number, text: string): void {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(text);
}

function contentTypeFor(filePath: string): string {
  switch (extname(filePath)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
