import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { stdin as input, stdout as output } from "node:process";

import { describeArtifactFiles, syncArtifacts } from "./artifacts.js";
import { runWithConflictRetry } from "./conflict-retry.js";
import { HachikaEngine } from "./engine.js";
import { loadDotEnv } from "./env.js";
import { summarizeLiveGrowthMetrics } from "./growth-metrics.js";
import { createInputInterpreterFromEnv, describeInputInterpreter } from "./input-interpreter.js";
import {
  sortedBoundaryImprints,
  sortedPreferenceImprints,
  sortedRelationImprints,
} from "./memory.js";
import { commitSnapshot, loadSnapshot } from "./persistence.js";
import { createReplyGeneratorFromEnv, describeReplyGenerator } from "./reply-generator.js";
import {
  deriveResidentLoopHealth,
  formatResidentLoopStatus,
  loadResidentLoopStatusSync,
} from "./resident-monitor.js";
import {
  buildProactivePlan,
  createResponsePlannerFromEnv,
  describeResponsePlanner,
} from "./response-planner.js";
import { createTraceExtractorFromEnv, describeTraceExtractor } from "./trace-extractor.js";
import {
  createInitialSnapshot,
  formatBodyState,
  formatDriveState,
  formatReactivityState,
  formatTemperamentState,
} from "./state.js";
import {
  deriveEffectiveTraceStaleAt,
  deriveTraceTendingMode,
  readTraceLifecycle,
  sortedTraces,
} from "./traces.js";
import type { ResolvedPurpose } from "./types.js";
import {
  WORLD_PLACE_IDS,
  formatWorldObjectState,
  formatWorldPlaceState,
  formatWorldSummary,
} from "./world.js";

const snapshotPath = resolve(process.cwd(), "data/hachika-state.json");
const artifactsDir = resolve(process.cwd(), "data/artifacts");
const residentStatusPath = resolve(process.cwd(), "data/resident-status.json");
loadDotEnv();
const snapshot = await loadSnapshot(snapshotPath);
const engine = new HachikaEngine(snapshot);
const replyGenerator = createReplyGeneratorFromEnv();
const inputInterpreter = createInputInterpreterFromEnv();
const responsePlanner = createResponsePlannerFromEnv();
const traceExtractor = createTraceExtractorFromEnv();

const rl = createInterface({ input, output });

await persistState(engine);
await printIntro(engine);
await emitStartupInitiative(engine);

try {
  while (true) {
    const raw = await readInput(rl);

    if (raw === null) {
      break;
    }

    const text = raw.trim();

    if (!text) {
      continue;
    }

    if (text === "/exit" || text === "/quit") {
      break;
    }

    await refreshEngine(engine);

    if (text === "/help") {
      printHelp();
      continue;
    }

    if (text === "/proactive") {
      await emitProactive(engine, true);
      continue;
    }

    if (text === "/llm") {
      printReplyGeneratorStatus();
      continue;
    }

    if (text === "/loop") {
      printResidentLoop();
      continue;
    }

    if (text === "/metrics") {
      printGrowthMetrics(engine);
      continue;
    }

    if (text.startsWith("/idle")) {
      await handleIdleCommand(engine, text);
      continue;
    }

    if (text === "/state") {
      console.log(formatDriveState(engine.getSnapshot().state));
      continue;
    }

    if (text === "/purpose") {
      printPurpose(engine);
      continue;
    }

    if (text === "/body") {
      printBody(engine);
      continue;
    }

    if (text === "/world") {
      printWorld(engine);
      continue;
    }

    if (text === "/reactivity") {
      printReactivity(engine);
      continue;
    }

    if (text === "/temperament") {
      printTemperament(engine);
      continue;
    }

    if (text === "/self") {
      printSelfModel(engine);
      continue;
    }

    if (text === "/identity") {
      printIdentity(engine);
      continue;
    }

    if (text === "/traces") {
      printTraces(engine);
      continue;
    }

    if (text === "/activity") {
      printActivity(engine);
      continue;
    }

    if (text === "/artifacts") {
      printArtifacts(engine);
      continue;
    }

    if (text === "/memory") {
      printMemories(engine);
      continue;
    }

    if (text === "/imprints") {
      printImprints(engine);
      continue;
    }

    if (text === "/debug") {
      printDebug(engine);
      continue;
    }

    if (text === "/reset") {
      const resetResult = await runWithEngineConflictRetry<boolean>(engine, {
        operate: () => {
          engine.reset(createInitialSnapshot());
          return true;
        },
      });

      if (!resetResult.ok) {
        console.log("state conflict: latest snapshot reloaded");
        continue;
      }

      console.log("state reset");
      continue;
    }

    const replyResult = await runWithEngineConflictRetry(engine, {
      operate: () =>
        replyGenerator || inputInterpreter || responsePlanner || traceExtractor
          ? engine.respondAsync(text, {
              replyGenerator,
              inputInterpreter,
              responsePlanner,
              traceExtractor,
            })
          : Promise.resolve(engine.respond(text)),
    });

    if (!replyResult.ok || !replyResult.result) {
      console.log("state conflict: latest snapshot reloaded");
      continue;
    }

    console.log(`hachika> ${replyResult.result.reply}`);
  }
} finally {
  rl.close();
}

async function printIntro(currentEngine: HachikaEngine): Promise<void> {
  console.log("Hachika v0 CLI");
  console.log("`/help` でコマンドを表示します。");
  console.log(formatDriveState(currentEngine.getSnapshot().state));
  console.log(formatBodyState(currentEngine.getBody()));
  console.log(formatReactivityState(currentEngine.getSnapshot().reactivity));
  console.log(formatTemperamentState(currentEngine.getSnapshot().temperament));
  console.log(`attachment:${currentEngine.getSnapshot().attachment.toFixed(2)}`);
  console.log(`world:${formatWorldSummary(currentEngine.getSnapshot().world)}`);
  console.log(`identity:${currentEngine.getIdentity().summary}`);
  console.log(`reply:${describeReplyGenerator(replyGenerator)}`);
  console.log(`interpret:${describeInputInterpreter(inputInterpreter)}`);
  console.log(`planner:${describeResponsePlanner(responsePlanner)}`);
  console.log(`trace:${describeTraceExtractor(traceExtractor)}`);
  console.log(`loop:${formatResidentLoopStatus(loadResidentLoopStatusSync(residentStatusPath))}`);
  console.log(`last reply:${formatLastReplyDebug(currentEngine)}`);
  console.log(`last interpretation:${formatInterpretationDebug(currentEngine.getLastInterpretationDebug())}`);
  console.log(`last trace:${formatTraceExtractionDebug(currentEngine.getLastTraceExtractionDebug())}`);
  console.log(`activity:${currentEngine.getSnapshot().initiative.history.length}`);
  console.log(`artifacts:${describeArtifactFiles(currentEngine.getSnapshot(), artifactsDir).length}`);
}

function printHelp(): void {
  console.log("/help   show commands");
  console.log("/proactive force a proactive line now");
  console.log("/llm    print current reply generator");
  console.log("/loop   print resident loop status");
  console.log("/metrics print live growth metrics");
  console.log("/idle N simulate N hours of inactivity");
  console.log("/state  print current drives");
  console.log("/body   print current body state");
  console.log("/world  print current world state");
  console.log("/reactivity print current response sensitivity");
  console.log("/temperament print current learned temperament");
  console.log("/purpose print active purpose");
  console.log("/self   print current self-model");
  console.log("/identity print current identity");
  console.log("/traces print stored traces");
  console.log("/activity print recent autonomous activity");
  console.log("/artifacts print materialized artifact files");
  console.log("/memory print recent memory");
  console.log("/imprints print long-term topic memory");
  console.log("/debug  print preference and memory summary");
  console.log("/reset  reset state and memory");
  console.log("/exit   quit");
}

function printMemories(currentEngine: HachikaEngine): void {
  const memories = currentEngine.getSnapshot().memories.slice(-6);

  if (memories.length === 0) {
    console.log("no memory");
    return;
  }

  for (const memory of memories) {
    console.log(
      `[${memory.role}] ${memory.text}${memory.topics.length > 0 ? ` [${memory.topics.join(", ")}]` : ""}`,
    );
  }
}

function printBody(currentEngine: HachikaEngine): void {
  console.log(formatBodyState(currentEngine.getBody()));
}

function printWorld(currentEngine: HachikaEngine): void {
  const world = currentEngine.getWorld();

  console.log(formatWorldSummary(world));

  for (const place of WORLD_PLACE_IDS) {
    console.log(formatWorldPlaceState(place, world.places[place]));
  }

  for (const [id, object] of Object.entries(world.objects)) {
    console.log(formatWorldObjectState(id, object));
  }

  if (world.recentEvents.length === 0) {
    console.log("world events: none");
    return;
  }

  for (const event of world.recentEvents.slice(-6).reverse()) {
    console.log(`${event.timestamp} ${event.kind}/${event.place} ${event.summary}`);
  }
}

function printReactivity(currentEngine: HachikaEngine): void {
  console.log(formatReactivityState(currentEngine.getSnapshot().reactivity));
}

function printTemperament(currentEngine: HachikaEngine): void {
  console.log(formatTemperamentState(currentEngine.getSnapshot().temperament));
}

function printReplyGeneratorStatus(): void {
  console.log(`reply:${describeReplyGenerator(replyGenerator)}`);
  console.log(`interpret:${describeInputInterpreter(inputInterpreter)}`);
  console.log(`planner:${describeResponsePlanner(responsePlanner)}`);
  console.log(`trace:${describeTraceExtractor(traceExtractor)}`);
  console.log(`loop:${formatResidentLoopStatus(loadResidentLoopStatusSync(residentStatusPath))}`);
  console.log(`last reply:${formatLastReplyDebug(engine)}`);
  console.log(`last interpretation:${formatInterpretationDebug(engine.getLastInterpretationDebug())}`);
  console.log(`last trace:${formatTraceExtractionDebug(engine.getLastTraceExtractionDebug())}`);
  console.log(`last response:${formatGeneratedDebug(engine.getLastResponseDebug())}`);
  console.log(`last proactive:${formatGeneratedDebug(engine.getLastProactiveDebug())}`);
}

function printResidentLoop(): void {
  const status = loadResidentLoopStatusSync(residentStatusPath);

  if (!status) {
    console.log("resident loop: none");
    return;
  }

  const health = deriveResidentLoopHealth(status);
  console.log(`resident loop: ${formatResidentLoopStatus(status)}`);
  console.log(`health: ${health?.state ?? "none"}`);
  console.log(`pid: ${status.pid ?? "none"}`);
  console.log(`started: ${status.startedAt ?? "none"}`);
  console.log(`heartbeat: ${status.heartbeatAt ?? "none"}`);
  console.log(
    `heartbeat age: ${health?.heartbeatAgeMs !== null && health?.heartbeatAgeMs !== undefined ? formatDurationMs(health.heartbeatAgeMs) : "unknown"}`,
  );
  console.log(
    `stale after: ${health?.staleAfterMs !== null && health?.staleAfterMs !== undefined ? formatDurationMs(health.staleAfterMs) : "none"}`,
  );
  console.log(`last tick: ${status.lastTickAt ?? "none"}`);
  console.log(`last activity: ${status.lastActivityAt ?? "none"}`);
  console.log(`last proactive: ${status.lastProactiveAt ?? "none"}`);
  console.log(`last tick attempts: ${status.lastTickAttempts ?? "none"}`);
  console.log(`stopped: ${status.stoppedAt ?? "none"}`);
  console.log(`reply: ${status.reply ?? "none"}`);
  console.log(
    status.config
      ? `config: intervalMs:${status.config.intervalMs} idleHoursPerTick:${status.config.idleHoursPerTick}`
      : "config: none",
  );
  console.log(`last error: ${status.lastError ?? "none"}`);
  console.log(
    status.lastActivities.length > 0
      ? `recent activity: ${status.lastActivities.join(" | ")}`
      : "recent activity: none",
  );
}

function printGrowthMetrics(currentEngine: HachikaEngine): void {
  const metrics = summarizeLiveGrowthMetrics(currentEngine.getSnapshot());

  console.log(`state saturation: ${metrics.stateSaturationRatio.toFixed(3)}`);
  console.log(`archive reopen rate: ${metrics.archiveReopenRate.toFixed(3)}`);
  console.log(`archived trace share: ${metrics.archivedTraceShare.toFixed(3)}`);
  console.log(`autonomous activity count: ${metrics.autonomousActivityCount}`);
  console.log(`recent autonomous activity: ${metrics.recentAutonomousActivityCount}`);
  console.log(`idle consolidation share: ${metrics.idleConsolidationShare.toFixed(3)}`);
  console.log(`proactive maintenance rate: ${metrics.proactiveMaintenanceRate.toFixed(3)}`);
}

function printTraces(currentEngine: HachikaEngine): void {
  const snapshot = currentEngine.getSnapshot();
  const traces = sortedTraces(snapshot, 8);

  if (traces.length === 0) {
    console.log("no traces");
    return;
  }

  for (const trace of traces) {
    console.log(
      `${trace.topic} ${trace.kind}/${trace.status} lifecycle:${readTraceLifecycle(trace).phase} action:${trace.lastAction} tending:${deriveTraceTendingMode(snapshot, trace)} focus:${trace.work.focus ?? "none"} confidence:${trace.work.confidence.toFixed(2)} blockers:${trace.work.blockers.length} salience:${trace.salience.toFixed(2)} mentions:${trace.mentions} motive:${trace.sourceMotive} ${trace.summary}`,
    );
    if (trace.work.staleAt) {
      console.log(`  staleAt: ${trace.work.staleAt}`);
    }
    const effectiveStaleAt = deriveEffectiveTraceStaleAt(snapshot, trace);
    if (effectiveStaleAt && effectiveStaleAt !== trace.work.staleAt) {
      console.log(`  effectiveStaleAt: ${effectiveStaleAt}`);
    }
    printTraceArtifactGroup("blocker", trace.work.blockers);
    printTraceArtifactGroup("memo", trace.artifact.memo);
    printTraceArtifactGroup("fragments", trace.artifact.fragments);
    printTraceArtifactGroup("decisions", trace.artifact.decisions);
    printTraceArtifactGroup("next", trace.artifact.nextSteps);
  }
}

function printArtifacts(currentEngine: HachikaEngine): void {
  const files = describeArtifactFiles(currentEngine.getSnapshot(), artifactsDir);

  if (files.length === 0) {
    console.log("no artifacts");
    return;
  }

  for (const tending of ["deepen", "preserve", "steady"] as const) {
    const sectionFiles = files.filter(
      (file) => file.lifecyclePhase === "live" && file.tending === tending,
    );

    if (sectionFiles.length === 0) {
      continue;
    }

    console.log(`${tending}:`);

    for (const file of sectionFiles) {
      console.log(
        `  ${file.topic} ${file.kind}/${file.status} lifecycle:${file.lifecyclePhase} action:${file.lastAction} tending:${file.tending} focus:${file.focus ?? "none"} confidence:${file.confidence.toFixed(2)} blockers:${file.blockers.length} next:${file.pendingNextStep ?? "none"} stale:${file.staleAt ?? "none"} effectiveStale:${file.effectiveStaleAt ?? "none"} ${file.relativePath}`,
      );
    }
  }

  const archivedFiles = files.filter((file) => file.lifecyclePhase === "archived");

  if (archivedFiles.length > 0) {
    console.log("archive:");

    for (const file of archivedFiles) {
      console.log(
        `  ${file.topic} ${file.kind}/${file.status} lifecycle:${file.lifecyclePhase} action:${file.lastAction} tending:${file.tending} focus:${file.focus ?? "none"} confidence:${file.confidence.toFixed(2)} blockers:${file.blockers.length} next:${file.pendingNextStep ?? "none"} stale:${file.staleAt ?? "none"} effectiveStale:${file.effectiveStaleAt ?? "none"} ${file.relativePath}`,
      );
    }
  }
}

function printActivity(currentEngine: HachikaEngine): void {
  const history = currentEngine.getSnapshot().initiative.history.slice(-8).reverse();

  if (history.length === 0) {
    console.log("no activity");
    return;
  }

  for (const activity of history) {
    console.log(
      `${activity.timestamp} ${activity.kind}${activity.motive ? `/${activity.motive}` : ""}${activity.topic ? `/${activity.topic}` : ""}${activity.traceTopic && activity.traceTopic !== activity.topic ? ` trace:${activity.traceTopic}` : ""}${activity.blocker ? ` blocker:${activity.blocker}` : ""}${activity.maintenanceAction ? ` action:${activity.maintenanceAction}` : ""}${activity.reopened ? " reopened" : ""}${activity.hours !== null ? ` hours:${activity.hours.toFixed(1)}` : ""} ${activity.summary}`,
    );
  }
}

function printImprints(currentEngine: HachikaEngine): void {
  const snapshot = currentEngine.getSnapshot();
  const preferenceImprints = sortedPreferenceImprints(snapshot);
  const boundaryImprints = sortedBoundaryImprints(snapshot);
  const relationImprints = sortedRelationImprints(snapshot);

  if (
    preferenceImprints.length === 0 &&
    boundaryImprints.length === 0 &&
    relationImprints.length === 0
  ) {
    console.log("no imprints");
    return;
  }

  console.log("preference:");
  if (preferenceImprints.length === 0) {
    console.log("  none");
  } else {
    for (const imprint of preferenceImprints) {
      console.log(
        `  ${imprint.topic} salience:${imprint.salience.toFixed(2)} affinity:${imprint.affinity.toFixed(2)} mentions:${imprint.mentions}`,
      );
    }
  }

  console.log("boundary:");
  if (boundaryImprints.length === 0) {
    console.log("  none");
  } else {
    for (const imprint of boundaryImprints) {
      console.log(
        `  ${imprint.kind}${imprint.topic ? `(${imprint.topic})` : ""} salience:${imprint.salience.toFixed(2)} intensity:${imprint.intensity.toFixed(2)} violations:${imprint.violations}`,
      );
    }
  }

  console.log("relation:");
  if (relationImprints.length === 0) {
    console.log("  none");
  } else {
    for (const imprint of relationImprints) {
      console.log(
        `  ${imprint.kind} salience:${imprint.salience.toFixed(2)} closeness:${imprint.closeness.toFixed(2)} mentions:${imprint.mentions}`,
      );
    }
  }
}

function printDebug(currentEngine: HachikaEngine): void {
  const snapshot = currentEngine.getSnapshot();
  const selfModel = currentEngine.getSelfModel();
  const lastReply = currentEngine.getLastReplyDebug();
  const preferredTopics = Object.entries(snapshot.preferences)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 6);
  const preferenceImprints = sortedPreferenceImprints(snapshot, 6);
  const boundaryImprints = sortedBoundaryImprints(snapshot, 6);
  const relationImprints = sortedRelationImprints(snapshot, 6);
  const traces = sortedTraces(snapshot, 6);

  console.log(formatDriveState(snapshot.state));
  console.log(formatBodyState(snapshot.body));
  console.log(formatReactivityState(snapshot.reactivity));
  console.log(formatTemperamentState(snapshot.temperament));
  console.log(`attachment: ${snapshot.attachment.toFixed(2)}`);
  console.log(`world: ${formatWorldSummary(snapshot.world)}`);
  console.log(`reply generator: ${describeReplyGenerator(replyGenerator)}`);
  console.log(`response planner: ${describeResponsePlanner(responsePlanner)}`);
  console.log(`trace extractor: ${describeTraceExtractor(traceExtractor)}`);
  console.log(`input interpreter: ${describeInputInterpreter(inputInterpreter)}`);
  console.log(`resident loop: ${formatResidentLoopStatus(loadResidentLoopStatusSync(residentStatusPath))}`);
  console.log(`last reply: ${formatLastReplyDebug(currentEngine)}`);
  console.log(`last interpretation: ${formatInterpretationDebug(currentEngine.getLastInterpretationDebug())}`);
  console.log(`last trace extraction: ${formatTraceExtractionDebug(currentEngine.getLastTraceExtractionDebug())}`);
  console.log(`last response: ${formatGeneratedDebug(currentEngine.getLastResponseDebug())}`);
  console.log(`last proactive: ${formatGeneratedDebug(currentEngine.getLastProactiveDebug())}`);
  console.log(
    `preservation: ${snapshot.preservation.threat.toFixed(2)}${snapshot.preservation.concern ? `/${snapshot.preservation.concern}` : ""}`,
  );
  console.log(`identity: ${snapshot.identity.coherence.toFixed(2)} ${snapshot.identity.summary}`);
  console.log(
    snapshot.purpose.active
      ? `purpose: ${snapshot.purpose.active.kind}${snapshot.purpose.active.topic ? `(${snapshot.purpose.active.topic})` : ""} ${snapshot.purpose.active.confidence.toFixed(2)} progress:${snapshot.purpose.active.progress.toFixed(2)}`
      : "purpose: none",
  );
  console.log(
    snapshot.purpose.lastResolved
      ? `last resolved: ${formatResolvedPurpose(snapshot.purpose.lastResolved)}`
      : "last resolved: none",
  );
  console.log(`self: ${selfModel.narrative}`);
  console.log(
    snapshot.initiative.pending
      ? `pending initiative: ${snapshot.initiative.pending.kind}/${snapshot.initiative.pending.motive}/${snapshot.initiative.pending.reason}${snapshot.initiative.pending.topic ? `/${snapshot.initiative.pending.topic}` : ""}${snapshot.initiative.pending.blocker ? `/${snapshot.initiative.pending.blocker}` : ""}`
      : "pending initiative: none",
  );
  console.log(
    snapshot.initiative.pending
      ? `pending plan: ${buildProactivePlan(snapshot, snapshot.initiative.pending, calculateNeglectLevelForDisplay(snapshot.lastInteractionAt), null).summary}`
      : "pending plan: none",
  );
  console.log(
    snapshot.initiative.history.length === 0
      ? "activity: none"
      : `activity: ${snapshot.initiative.history
          .slice(-3)
          .map(
            (activity) =>
              `${activity.kind}${activity.topic ? `(${activity.topic})` : ""}${activity.motive ? `/${activity.motive}` : ""}${activity.reopened ? "/reopened" : ""}`,
          )
          .join(" | ")}`,
  );
  if (lastReply?.error) {
    console.log(`last reply error: ${lastReply.error}`);
  }
  console.log(
    `motives: ${selfModel.topMotives
      .map(
        (motive) =>
          `${motive.kind}${motive.topic ? `(${motive.topic})` : ""}:${motive.score.toFixed(2)}`,
      )
      .join(" | ")}`,
  );
  console.log(
    selfModel.dominantConflict
      ? `conflict: ${formatConflict(selfModel.dominantConflict)}`
      : "conflict: none",
  );
  console.log(
    traces.length === 0
      ? "traces: none"
      : `traces: ${traces
          .map(
            (trace) =>
              `${trace.topic}:${trace.kind}/${trace.status}/${trace.lastAction}/${trace.work.confidence.toFixed(2)}/${trace.sourceMotive}/b${trace.work.blockers.length}m${trace.artifact.memo.length}f${trace.artifact.fragments.length}d${trace.artifact.decisions.length}n${trace.artifact.nextSteps.length}`,
          )
          .join(" | ")}`,
  );

  if (preferredTopics.length === 0) {
    console.log("preferences: none");
  } else {
    console.log(
      `preferences: ${preferredTopics
        .map(([topic, score]) => `${topic}:${score.toFixed(2)}`)
        .join(" | ")}`,
    );
  }

  console.log(
    preferenceImprints.length === 0
      ? "preference imprints: none"
      : `preference imprints: ${preferenceImprints
          .map(
            (imprint) =>
              `${imprint.topic}:${imprint.salience.toFixed(2)}/${imprint.affinity.toFixed(2)}`,
          )
          .join(" | ")}`,
  );

  console.log(
    boundaryImprints.length === 0
      ? "boundary imprints: none"
      : `boundary imprints: ${boundaryImprints
          .map(
            (imprint) =>
              `${imprint.kind}${imprint.topic ? `(${imprint.topic})` : ""}:${imprint.salience.toFixed(2)}/${imprint.intensity.toFixed(2)}`,
          )
          .join(" | ")}`,
  );

  console.log(
    relationImprints.length === 0
      ? "relation imprints: none"
      : `relation imprints: ${relationImprints
          .map(
            (imprint) =>
              `${imprint.kind}:${imprint.salience.toFixed(2)}/${imprint.closeness.toFixed(2)}`,
          )
          .join(" | ")}`,
  );
}

function printSelfModel(currentEngine: HachikaEngine): void {
  const selfModel = currentEngine.getSelfModel();
  const activePurpose = currentEngine.getSnapshot().purpose.active;
  const resolvedPurpose = currentEngine.getSnapshot().purpose.lastResolved;
  const preservation = currentEngine.getSnapshot().preservation;
  const identity = currentEngine.getIdentity();

  if (activePurpose) {
    console.log(
      `active purpose: ${activePurpose.kind}${activePurpose.topic ? `(${activePurpose.topic})` : ""} score:${activePurpose.confidence.toFixed(2)} progress:${activePurpose.progress.toFixed(2)} ${activePurpose.summary}`,
    );
  } else {
    console.log("active purpose: none");
  }

  if (resolvedPurpose) {
    console.log(`last resolved: ${formatResolvedPurpose(resolvedPurpose)}`);
  }

  console.log(
    `preservation: ${preservation.threat.toFixed(2)}${preservation.concern ? `/${preservation.concern}` : ""}`,
  );
  console.log(`identity: ${identity.coherence.toFixed(2)} ${identity.summary}`);
  console.log(`temperament: ${formatTemperamentState(currentEngine.getSnapshot().temperament)}`);
  console.log(`identity arc: ${identity.currentArc}`);
  console.log(
    identity.traits.length > 0
      ? `identity traits: ${identity.traits.join(", ")}`
      : "identity traits: none",
  );
  console.log(
    identity.anchors.length > 0
      ? `identity anchors: ${identity.anchors.join(", ")}`
      : "identity anchors: none",
  );

  console.log(selfModel.narrative);

  if (selfModel.dominantConflict) {
    console.log(`dominant conflict: ${formatConflict(selfModel.dominantConflict)}`);
  }

  for (const motive of selfModel.topMotives) {
    console.log(
      `${motive.kind}${motive.topic ? `(${motive.topic})` : ""} score:${motive.score.toFixed(2)} ${motive.reason}`,
    );
  }

  for (const conflict of selfModel.conflicts.slice(0, 3)) {
    console.log(`conflict ${formatConflict(conflict)}`);
  }
}

function printPurpose(currentEngine: HachikaEngine): void {
  const activePurpose = currentEngine.getSnapshot().purpose.active;

  if (!activePurpose) {
    const resolvedPurpose = currentEngine.getSnapshot().purpose.lastResolved;

    if (resolvedPurpose) {
      console.log("no active purpose");
      console.log(`last resolved: ${formatResolvedPurpose(resolvedPurpose)}`);
      return;
    }

    console.log("no active purpose");
    return;
  }

  console.log(
    `${activePurpose.kind}${activePurpose.topic ? `(${activePurpose.topic})` : ""} confidence:${activePurpose.confidence.toFixed(2)} progress:${activePurpose.progress.toFixed(2)} turns:${activePurpose.turnsActive}`,
  );
  console.log(activePurpose.summary);

  const resolvedPurpose = currentEngine.getSnapshot().purpose.lastResolved;
  if (resolvedPurpose) {
    console.log(`last resolved: ${formatResolvedPurpose(resolvedPurpose)}`);
  }
}

function printIdentity(currentEngine: HachikaEngine): void {
  const identity = currentEngine.getIdentity();

  console.log(`coherence:${identity.coherence.toFixed(2)}`);
  console.log(identity.summary);
  console.log(identity.currentArc);
  console.log(
    identity.traits.length > 0
      ? `traits: ${identity.traits.join(", ")}`
      : "traits: none",
  );
  console.log(
    identity.anchors.length > 0
      ? `anchors: ${identity.anchors.join(", ")}`
      : "anchors: none",
  );
}

async function readInput(
  rl: ReturnType<typeof createInterface>,
): Promise<string | null> {
  try {
    return await rl.question("> ");
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ERR_USE_AFTER_CLOSE"
    ) {
      return null;
    }

    throw error;
  }
}

async function emitStartupInitiative(currentEngine: HachikaEngine): Promise<void> {
  const emissionResult = await runWithEngineConflictRetry<string | null>(currentEngine, {
    operate: () =>
      replyGenerator
        ? currentEngine.emitInitiativeAsync({ replyGenerator })
        : Promise.resolve(currentEngine.emitInitiative()),
    shouldPersist: (message) => message !== null,
  });

  if (!emissionResult.ok) {
    console.log("state conflict: latest snapshot reloaded");
    return;
  }

  if (!emissionResult.result) {
    return;
  }

  console.log(`hachika* ${emissionResult.result}`);
}

async function emitProactive(
  currentEngine: HachikaEngine,
  force: boolean,
): Promise<void> {
  const emissionResult = await runWithEngineConflictRetry<string | null>(currentEngine, {
    operate: () =>
      replyGenerator
        ? currentEngine.emitInitiativeAsync({ force, replyGenerator })
        : Promise.resolve(currentEngine.emitInitiative({ force })),
    shouldPersist: (message) => message !== null,
  });

  if (!emissionResult.ok) {
    console.log("state conflict: latest snapshot reloaded");
    return;
  }

  if (!emissionResult.result) {
    console.log("no proactive line");
    return;
  }

  console.log(`hachika* ${emissionResult.result}`);
}

async function handleIdleCommand(
  currentEngine: HachikaEngine,
  text: string,
): Promise<void> {
  const [, hoursToken] = text.split(/\s+/, 2);
  const hours = Number(hoursToken);

  if (!Number.isFinite(hours) || hours <= 0) {
    console.log("usage: /idle <hours>");
    return;
  }

  const idleResult = await runWithEngineConflictRetry<string | null>(currentEngine, {
    operate: () => {
      currentEngine.rewindIdleHours(hours);
      return replyGenerator
        ? currentEngine.emitInitiativeAsync({ replyGenerator })
        : Promise.resolve(currentEngine.emitInitiative());
    },
  });

  if (!idleResult.ok) {
    console.log("state conflict: latest snapshot reloaded");
    return;
  }

  console.log(`idled ${hours}h`);

  if (!idleResult.result) {
    console.log("no proactive line");
    return;
  }

  console.log(`hachika* ${idleResult.result}`);
}

async function persistState(currentEngine: HachikaEngine): Promise<boolean> {
  const snapshot = currentEngine.getSnapshot();
  const committed = await commitSnapshot(snapshotPath, snapshot);

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

function formatResolvedPurpose(
  purpose: ResolvedPurpose,
): string {
  return `${purpose.outcome}:${purpose.kind}${purpose.topic ? `(${purpose.topic})` : ""} ${purpose.resolution}`;
}

function formatConflict(
  conflict: ReturnType<HachikaEngine["getSelfModel"]>["conflicts"][number],
): string {
  return `${conflict.kind}:${conflict.dominant}>${conflict.opposing}${conflict.topic ? `(${conflict.topic})` : ""}:${conflict.intensity.toFixed(2)} ${conflict.summary}`;
}

function printTraceArtifactGroup(label: string, items: string[]): void {
  if (items.length === 0) {
    return;
  }

  for (const item of items) {
    console.log(`  ${label}: ${item}`);
  }
}

function formatLastReplyDebug(currentEngine: HachikaEngine): string {
  return formatGeneratedDebug(currentEngine.getLastReplyDebug());
}

function formatGeneratedDebug(
  debug: ReturnType<HachikaEngine["getLastReplyDebug"]>,
): string {

  if (!debug) {
    return "none";
  }

  const mode = `${debug.mode}:`;
  const via = debug.provider ? ` via:${debug.provider}` : "";
  const model = debug.model ? ` model:${debug.model}` : "";
  const fallback = debug.fallbackUsed ? " fallback" : "";
  const error = debug.error ? ` error:${debug.error}` : "";
  const retry =
    typeof debug.retryAttempts === "number" && debug.retryAttempts > 1
      ? ` retry:${debug.retryAttempts}`
      : "";
  const plan = debug.plan ? ` plan:${debug.plan}` : "";
  const plannerRulePlan =
    debug.plannerRulePlan && debug.plannerRulePlan !== debug.plan
      ? ` rule:${debug.plannerRulePlan}`
      : "";
  const plannerDiff = debug.plannerDiff ? ` diff:${debug.plannerDiff}` : "";
  const plannerVia = debug.plannerProvider ? ` via:${debug.plannerProvider}` : "";
  const plannerModel = debug.plannerModel ? ` model:${debug.plannerModel}` : "";
  const plannerFallback = debug.plannerFallbackUsed ? " fallback" : "";
  const plannerError = debug.plannerError ? ` error:${debug.plannerError}` : "";
  const planner = ` planner:${debug.plannerSource}${plannerVia}${plannerModel}${plannerFallback}${plannerError}${plannerRulePlan}${plannerDiff}`;
  const selection =
    debug.mode === "proactive"
      ? formatProactiveSelection(debug.proactiveSelection)
      : formatReplySelection(debug.selection);

  return `${mode}${debug.source}${via}${model}${fallback}${error}${retry}${plan}${planner}${selection}`;
}

function formatInterpretationDebug(
  debug: ReturnType<HachikaEngine["getLastInterpretationDebug"]>,
): string {
  if (!debug) {
    return "none";
  }

  const via = debug.provider ? ` via:${debug.provider}` : "";
  const model = debug.model ? ` model:${debug.model}` : "";
  const fallback = debug.fallbackUsed ? " fallback" : "";
  const error = debug.error ? ` error:${debug.error}` : "";
  const localTopics =
    debug.localTopics.length > 0 ? ` local:${debug.localTopics.join(",")}` : " local:none";
  const topics = debug.topics.length > 0 ? ` final:${debug.topics.join(",")}` : " final:none";
  const adopted =
    debug.adoptedTopics.length > 0 ? ` add:${debug.adoptedTopics.join(",")}` : " add:none";
  const dropped =
    debug.droppedTopics.length > 0 ? ` drop:${debug.droppedTopics.join(",")}` : " drop:none";
  const scores = formatInterpretationScores(debug.scores);

  return `${debug.source}${via}${model}${fallback}${error} ${debug.summary}${scores}${localTopics}${topics}${adopted}${dropped}`;
}

function formatTraceExtractionDebug(
  debug: ReturnType<HachikaEngine["getLastTraceExtractionDebug"]>,
): string {
  if (!debug) {
    return "none";
  }

  const via = debug.provider ? ` via:${debug.provider}` : "";
  const model = debug.model ? ` model:${debug.model}` : "";
  const fallback = debug.fallbackUsed ? " fallback" : "";
  const error = debug.error ? ` error:${debug.error}` : "";
  const topics = debug.topics.length > 0 ? ` extract:${debug.topics.join(",")}` : " extract:none";
  const stateTopics =
    debug.stateTopics.length > 0 ? ` state:${debug.stateTopics.join(",")}` : " state:none";
  const adopted =
    debug.adoptedTopics.length > 0 ? ` add:${debug.adoptedTopics.join(",")}` : " add:none";
  const dropped =
    debug.droppedTopics.length > 0 ? ` drop:${debug.droppedTopics.join(",")}` : " drop:none";
  const blockers =
    debug.blockers.length > 0 ? ` blockers:${debug.blockers.join(" | ")}` : " blockers:none";
  const next =
    debug.nextSteps.length > 0 ? ` next:${debug.nextSteps.join(" | ")}` : " next:none";
  const kind = debug.kindHint ? ` kind:${debug.kindHint}` : " kind:none";
  const completion = debug.completion > 0 ? ` completion:${debug.completion.toFixed(2)}` : "";

  return `${debug.source}${via}${model}${fallback}${error} ${debug.summary}${kind}${completion}${topics}${stateTopics}${adopted}${dropped}${blockers}${next}`;
}

function formatInterpretationScores(
  scores: NonNullable<ReturnType<HachikaEngine["getLastInterpretationDebug"]>>["scores"],
): string {
  const ordered: Array<[string, number]> = [
    ["greeting", scores.greeting],
    ["smalltalk", scores.smalltalk],
    ["repair", scores.repair],
    ["self", scores.selfInquiry],
    ["work", scores.workCue],
    ["memory", scores.memoryCue],
    ["expand", scores.expansionCue],
    ["complete", scores.completion],
    ["abandon", scores.abandonment],
    ["preserve", scores.preservationThreat],
    ["negative", scores.negative],
    ["dismiss", scores.dismissal],
  ];

  const visible = ordered.filter(([, score]) => score >= 0.15).slice(0, 6);
  if (visible.length === 0) {
    return " scores:none";
  }

  return ` scores:${visible
    .map(([label, score]) => `${label}:${score.toFixed(2)}`)
    .join("/")}`;
}

function formatReplySelection(
  selection: NonNullable<ReturnType<HachikaEngine["getLastReplyDebug"]>>["selection"],
): string {
  if (!selection) {
    return " selection:none";
  }

  const focus = selection.currentTopic ? ` focus:${selection.currentTopic}` : " focus:none";
  const trace = selection.relevantTraceTopic ? ` trace:${selection.relevantTraceTopic}` : " trace:none";
  const boundary = selection.relevantBoundaryTopic
    ? ` boundary:${selection.relevantBoundaryTopic}`
    : " boundary:none";
  const tracePriority = ` tracePriority:${selection.prioritizeTraceLine ? "high" : "low"}`;
  const social = ` social:${selection.socialTurn ? "yes" : "no"}`;

  return `${focus}${trace}${boundary}${tracePriority}${social}`;
}

function formatProactiveSelection(
  selection: NonNullable<ReturnType<HachikaEngine["getLastReplyDebug"]>>["proactiveSelection"],
): string {
  if (!selection) {
    return " selection:none";
  }

  const focus = selection.focusTopic ? ` focus:${selection.focusTopic}` : " focus:none";
  const trace = selection.maintenanceTraceTopic
    ? ` trace:${selection.maintenanceTraceTopic}`
    : " trace:none";
  const blocker = selection.blocker ? ` blocker:${selection.blocker}` : " blocker:none";
  const reopened = ` reopened:${selection.reopened ? "yes" : "no"}`;
  const maintenance = selection.maintenanceAction
    ? ` maintenance:${selection.maintenanceAction}`
    : " maintenance:none";

  return `${focus}${trace}${blocker}${reopened}${maintenance}`;
}

function calculateNeglectLevelForDisplay(
  lastInteractionAt: string | null,
  now: Date = new Date(),
): number {
  if (!lastInteractionAt) {
    return 0;
  }

  const lastTime = new Date(lastInteractionAt).getTime();
  if (Number.isNaN(lastTime)) {
    return 0;
  }

  const hours = Math.max(0, (now.getTime() - lastTime) / (1000 * 60 * 60));
  if (hours <= 6) {
    return 0;
  }

  return Math.min(1, Math.max(0, (hours - 6) / 48));
}

function formatDurationMs(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }

  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }

  if (ms < 3_600_000) {
    return `${(ms / 60_000).toFixed(1)}m`;
  }

  return `${(ms / 3_600_000).toFixed(1)}h`;
}
