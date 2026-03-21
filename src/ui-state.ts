import { describeArtifactFiles } from "./artifacts.js";
import type { ArtifactFile } from "./artifacts.js";
import { HachikaEngine } from "./engine.js";
import { loadResidentLoopStatusSync } from "./resident-monitor.js";
import type { ResidentLoopStatus } from "./resident-monitor.js";
import { sortedTraces } from "./traces.js";
import type {
  GeneratedTextDebug,
  InterpretationDebug,
  MemoryEntry,
  TraceExtractionDebug,
  TraceEntry,
} from "./types.js";

export interface UiStatePayload {
  summary: {
    state: ReturnType<HachikaEngine["getSnapshot"]>["state"];
    body: ReturnType<HachikaEngine["getSnapshot"]>["body"];
    reactivity: ReturnType<HachikaEngine["getSnapshot"]>["reactivity"];
    temperament: ReturnType<HachikaEngine["getSnapshot"]>["temperament"];
    attachment: number;
    conversationCount: number;
    lastInteractionAt: string | null;
    identity: ReturnType<HachikaEngine["getSnapshot"]>["identity"];
    purpose: ReturnType<HachikaEngine["getSnapshot"]>["purpose"];
    pendingInitiative: ReturnType<HachikaEngine["getSnapshot"]>["initiative"]["pending"];
    residentLoop: ResidentLoopStatus | null;
  };
  selfModel: ReturnType<HachikaEngine["getSelfModel"]>;
  memories: MemoryEntry[];
  traces: Array<{
    topic: TraceEntry["topic"];
    kind: TraceEntry["kind"];
    status: TraceEntry["status"];
    summary: TraceEntry["summary"];
    tending: string;
    lifecycle: string;
    blockers: string[];
    focus: string | null;
    confidence: number;
    staleAt: string | null;
    effectiveStaleAt: string | null;
  }>;
  artifacts: ArtifactFile[];
  diagnostics: {
    lastReply: GeneratedTextDebug | null;
    lastResponse: GeneratedTextDebug | null;
    lastProactive: GeneratedTextDebug | null;
    lastInterpretation: InterpretationDebug | null;
    lastTrace: TraceExtractionDebug | null;
  };
}

export function buildUiState(
  engine: HachikaEngine,
  artifactsDir: string,
  residentStatusPath?: string,
): UiStatePayload {
  const snapshot = engine.getSnapshot();
  const artifacts = describeArtifactFiles(snapshot, artifactsDir);
  const residentLoop = residentStatusPath
    ? loadResidentLoopStatusSync(residentStatusPath)
    : null;

  return {
    summary: {
      state: snapshot.state,
      body: snapshot.body,
      reactivity: snapshot.reactivity,
      temperament: snapshot.temperament,
      attachment: snapshot.attachment,
      conversationCount: snapshot.conversationCount,
      lastInteractionAt: snapshot.lastInteractionAt,
      identity: snapshot.identity,
      purpose: snapshot.purpose,
      pendingInitiative: snapshot.initiative.pending,
      residentLoop,
    },
    selfModel: engine.getSelfModel(),
    memories: snapshot.memories.slice(-18),
    traces: sortedTraces(snapshot, 10).map((trace) => ({
      topic: trace.topic,
      kind: trace.kind,
      status: trace.status,
      summary: trace.summary,
      tending:
        trace.lifecycle?.phase === "archived"
          ? "archive"
          : artifacts.find((file) => file.topic === trace.topic)?.tending ?? "steady",
      lifecycle: trace.lifecycle?.phase ?? "live",
      blockers: [...trace.work.blockers],
      focus: trace.work.focus,
      confidence: trace.work.confidence,
      staleAt: trace.work.staleAt,
      effectiveStaleAt:
        artifacts.find((file) => file.topic === trace.topic)?.effectiveStaleAt ??
        trace.work.staleAt,
    })),
    artifacts,
    diagnostics: {
      lastReply: engine.getLastReplyDebug(),
      lastResponse: engine.getLastResponseDebug(),
      lastProactive: engine.getLastProactiveDebug(),
      lastInterpretation: engine.getLastInterpretationDebug(),
      lastTrace: engine.getLastTraceExtractionDebug(),
    },
  };
}
