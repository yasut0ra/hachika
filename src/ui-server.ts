import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, normalize, resolve } from "node:path";

import { syncArtifacts } from "./artifacts.js";
import { createAutonomyDirectorFromEnv } from "./autonomy-director.js";
import { createBehaviorDirectorFromEnv } from "./behavior-director.js";
import { runWithConflictRetry } from "./conflict-retry.js";
import { resolveHachikaDataPaths } from "./data-paths.js";
import { HachikaEngine } from "./engine.js";
import { loadDotEnv } from "./env.js";
import { createInputInterpreterFromEnv } from "./input-interpreter.js";
import { createInitiativeDirectorFromEnv } from "./initiative-director.js";
import { commitSnapshot, loadSnapshot } from "./persistence.js";
import { createProactiveDirectorFromEnv } from "./proactive-director.js";
import { createReplyGeneratorFromEnv, describeReplyGenerator } from "./reply-generator.js";
import { readResidentLoopConfigFromEnv } from "./resident-loop.js";
import {
  isResidentLoopAlreadyRunningError,
  ResidentLoopRuntime,
} from "./resident-runtime.js";
import { createResponsePlannerFromEnv } from "./response-planner.js";
import { createTraceExtractorFromEnv } from "./trace-extractor.js";
import { createTurnDirectorFromEnv } from "./turn-director.js";
import { createInitialSnapshot } from "./state.js";
import { buildUiState } from "./ui-state.js";

loadDotEnv();
const {
  dataDir,
  snapshotPath,
  artifactsDir,
  residentLockPath,
  residentStatusPath,
  metricsLogPath,
} = resolveHachikaDataPaths();
const uiDir = resolve(process.cwd(), "ui");
const host = process.env.HACHIKA_UI_HOST?.trim() || "127.0.0.1";
const port = Number(process.env.HACHIKA_UI_PORT?.trim() || "3042");
const snapshot = await loadSnapshot(snapshotPath);
const engine = new HachikaEngine(snapshot);
const replyGenerator = createReplyGeneratorFromEnv();
const autonomyDirector = createAutonomyDirectorFromEnv();
const proactiveDirector = createProactiveDirectorFromEnv();
const turnDirector = createTurnDirectorFromEnv();
const inputInterpreter = createInputInterpreterFromEnv();
const behaviorDirector = createBehaviorDirectorFromEnv();
const initiativeDirector = createInitiativeDirectorFromEnv();
const responsePlanner = createResponsePlannerFromEnv();
const traceExtractor = createTraceExtractorFromEnv();
const residentLoop = new ResidentLoopRuntime({
  snapshotPath,
  artifactsDir,
  lockPath: residentLockPath,
  statusPath: residentStatusPath,
  metricsLogPath,
  config: readResidentLoopConfigFromEnv(),
  replyDescription: describeReplyGenerator(replyGenerator),
  replyGenerator,
  autonomyDirector,
  proactiveDirector,
  log: console.log,
  error: console.error,
});
let ownsResidentLoop = false;
let shuttingDown = false;

await persistState(engine);

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${host}:${port}`);
    const isApiRequest = url.pathname.startsWith("/api/");

    if (isApiRequest) {
      await refreshEngine(engine);
    }

    if (url.pathname === "/api/state" && request.method === "GET") {
      return sendJson(response, 200, buildUiState(engine, artifactsDir, residentStatusPath));
    }

    if (url.pathname === "/api/message" && request.method === "POST") {
      const body = await readJsonBody(request);
      const text = typeof body.text === "string" ? body.text.trim() : "";

      if (!text) {
        return sendJson(response, 400, { error: "message_required" });
      }

      const replyResult = await runWithEngineConflictRetry(engine, {
        operate: () =>
          replyGenerator ||
          inputInterpreter ||
          behaviorDirector ||
          initiativeDirector ||
          responsePlanner ||
          traceExtractor
            ? engine.respondAsync(text, {
                replyGenerator,
                turnDirector,
                inputInterpreter,
                behaviorDirector,
                initiativeDirector,
                responsePlanner,
                traceExtractor,
              })
            : Promise.resolve(engine.respond(text)),
      });

      if (!replyResult.ok || !replyResult.result) {
        return sendJson(response, 409, {
          error: "state_conflict",
          ui: buildUiState(engine, artifactsDir, residentStatusPath),
        });
      }

      return sendJson(response, 200, {
        reply: replyResult.result.reply,
        ui: buildUiState(engine, artifactsDir, residentStatusPath),
      });
    }

    if (url.pathname === "/api/proactive" && request.method === "POST") {
      const body = await readJsonBody(request);
      const force = body.force !== false;

      const proactiveResult = await runWithEngineConflictRetry<string | null>(engine, {
        operate: () =>
          replyGenerator
            ? engine.emitInitiativeAsync({ force, replyGenerator, proactiveDirector })
            : Promise.resolve(engine.emitInitiative({ force })),
        shouldPersist: (message) => message !== null,
      });

      if (!proactiveResult.ok) {
        return sendJson(response, 409, {
          error: "state_conflict",
          ui: buildUiState(engine, artifactsDir, residentStatusPath),
        });
      }

      return sendJson(response, 200, {
        message: proactiveResult.result,
        ui: buildUiState(engine, artifactsDir, residentStatusPath),
      });
    }

    if (url.pathname === "/api/idle" && request.method === "POST") {
      const body = await readJsonBody(request);
      const hours = Number(body.hours);

      if (!Number.isFinite(hours) || hours <= 0) {
        return sendJson(response, 400, { error: "hours_must_be_positive" });
      }

      const idleResult = await runWithEngineConflictRetry<string | null>(engine, {
        operate: () => {
          engine.rewindIdleHours(hours);
          return replyGenerator
            ? engine.emitInitiativeAsync({ replyGenerator, proactiveDirector })
            : Promise.resolve(engine.emitInitiative());
        },
      });

      if (!idleResult.ok) {
        return sendJson(response, 409, {
          error: "state_conflict",
          ui: buildUiState(engine, artifactsDir, residentStatusPath),
        });
      }

      return sendJson(response, 200, {
        hours,
        proactive: idleResult.result,
        ui: buildUiState(engine, artifactsDir, residentStatusPath),
      });
    }

    if (url.pathname === "/api/reset" && request.method === "POST") {
      const resetResult = await runWithEngineConflictRetry<boolean>(engine, {
        operate: () => {
          engine.reset(createInitialSnapshot());
          return true;
        },
      });

      if (!resetResult.ok) {
        return sendJson(response, 409, {
          error: "state_conflict",
          ui: buildUiState(engine, artifactsDir, residentStatusPath),
        });
      }
      return sendJson(response, 200, {
        ok: true,
        ui: buildUiState(engine, artifactsDir, residentStatusPath),
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

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

await listenServer(server, port, host);
console.log(`Hachika UI listening on http://${host}:${port}`);
console.log(`Hachika data: ${dataDir}`);

try {
  await residentLoop.start();
  ownsResidentLoop = true;
  console.log("Hachika resident loop started with UI");
} catch (error) {
  if (isResidentLoopAlreadyRunningError(error)) {
    console.log("Hachika UI is using the existing resident loop");
  } else {
    console.error(
      `[ui/loop] startup error: ${error instanceof Error ? error.message : "resident_loop_startup_error"}`,
    );
  }
}

async function listenServer(
  currentServer: typeof server,
  currentPort: number,
  currentHost: string,
): Promise<void> {
  await new Promise<void>((resolveListen, rejectListen) => {
    const onError = (error: Error) => {
      rejectListen(error);
    };

    currentServer.once("error", onError);
    currentServer.listen(currentPort, currentHost, () => {
      currentServer.off("error", onError);
      resolveListen();
    });
  });
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  try {
    if (server.listening) {
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => {
          if (error) {
            rejectClose(error);
            return;
          }
          resolveClose();
        });
      });
    }
  } catch (error) {
    console.error(
      `[ui] shutdown error: ${error instanceof Error ? error.message : "ui_server_shutdown_error"}`,
    );
  }

  try {
    if (ownsResidentLoop) {
      await residentLoop.stop(signal);
      ownsResidentLoop = false;
    }
  } catch (error) {
    console.error(
      `[ui/loop] shutdown error: ${error instanceof Error ? error.message : "resident_loop_shutdown_error"}`,
    );
  }

  console.log("Hachika UI stopped");
}

async function persistState(currentEngine: HachikaEngine): Promise<boolean> {
  const currentSnapshot = currentEngine.getSnapshot();
  const committed = await commitSnapshot(snapshotPath, currentSnapshot);

  if (!committed.ok) {
    currentEngine.syncSnapshot(committed.snapshot);
    return false;
  }

  currentEngine.syncSnapshot(committed.snapshot);
  await syncArtifacts(committed.snapshot, artifactsDir);
  return true;
}

async function refreshEngine(currentEngine: HachikaEngine): Promise<void> {
  currentEngine.syncSnapshot(await loadSnapshot(snapshotPath));
}

async function runWithEngineConflictRetry<T>(
  currentEngine: HachikaEngine,
  options: {
    operate: () => Promise<T> | T;
    shouldPersist?: (result: T) => boolean;
  },
): Promise<Awaited<ReturnType<typeof runWithConflictRetry<T>>>> {
  const result = await runWithConflictRetry<T>({
    operate: async () => await options.operate(),
    persist: async (result) => {
      if (options.shouldPersist && !options.shouldPersist(result)) {
        return true;
      }

      return persistState(currentEngine);
    },
  });

  if (result.ok) {
    currentEngine.annotateLastRetryAttempts(result.attempts);
  }

  return result;
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
    case ".png":
      return "image/png";
    default:
      return "application/octet-stream";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
