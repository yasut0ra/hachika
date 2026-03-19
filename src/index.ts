import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { stdin as input, stdout as output } from "node:process";

import { describeArtifactFiles, syncArtifacts } from "./artifacts.js";
import { HachikaEngine } from "./engine.js";
import {
  sortedBoundaryImprints,
  sortedPreferenceImprints,
  sortedRelationImprints,
} from "./memory.js";
import { loadSnapshot, saveSnapshot } from "./persistence.js";
import { createInitialSnapshot, formatBodyState, formatDriveState } from "./state.js";
import { deriveEffectiveTraceStaleAt, deriveTraceTendingMode, sortedTraces } from "./traces.js";
import type { ResolvedPurpose } from "./types.js";

const snapshotPath = resolve(process.cwd(), "data/hachika-state.json");
const artifactsDir = resolve(process.cwd(), "data/artifacts");
const snapshot = await loadSnapshot(snapshotPath);
const engine = new HachikaEngine(snapshot);

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

    if (text === "/help") {
      printHelp();
      continue;
    }

    if (text === "/proactive") {
      await emitProactive(engine, true);
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
      engine.reset(createInitialSnapshot());
      await persistState(engine);
      console.log("state reset");
      continue;
    }

    const result = engine.respond(text);
    await persistState(engine);

    console.log(`hachika> ${result.reply}`);
  }
} finally {
  rl.close();
}

async function printIntro(currentEngine: HachikaEngine): Promise<void> {
  console.log("Hachika v0 CLI");
  console.log("`/help` でコマンドを表示します。");
  console.log(formatDriveState(currentEngine.getSnapshot().state));
  console.log(formatBodyState(currentEngine.getBody()));
  console.log(`attachment:${currentEngine.getSnapshot().attachment.toFixed(2)}`);
  console.log(`identity:${currentEngine.getIdentity().summary}`);
  console.log(`artifacts:${describeArtifactFiles(currentEngine.getSnapshot(), artifactsDir).length}`);
}

function printHelp(): void {
  console.log("/help   show commands");
  console.log("/proactive force a proactive line now");
  console.log("/idle N simulate N hours of inactivity");
  console.log("/state  print current drives");
  console.log("/body   print current body state");
  console.log("/purpose print active purpose");
  console.log("/self   print current self-model");
  console.log("/identity print current identity");
  console.log("/traces print stored traces");
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

function printTraces(currentEngine: HachikaEngine): void {
  const snapshot = currentEngine.getSnapshot();
  const traces = sortedTraces(snapshot, 8);

  if (traces.length === 0) {
    console.log("no traces");
    return;
  }

  for (const trace of traces) {
    console.log(
      `${trace.topic} ${trace.kind}/${trace.status} action:${trace.lastAction} tending:${deriveTraceTendingMode(snapshot, trace)} focus:${trace.work.focus ?? "none"} confidence:${trace.work.confidence.toFixed(2)} blockers:${trace.work.blockers.length} salience:${trace.salience.toFixed(2)} mentions:${trace.mentions} motive:${trace.sourceMotive} ${trace.summary}`,
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

  for (const file of files) {
    console.log(
      `${file.topic} ${file.kind}/${file.status} action:${file.lastAction} tending:${file.tending} focus:${file.focus ?? "none"} confidence:${file.confidence.toFixed(2)} blockers:${file.blockers.length} next:${file.pendingNextStep ?? "none"} stale:${file.staleAt ?? "none"} effectiveStale:${file.effectiveStaleAt ?? "none"} ${file.relativePath}`,
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
  const preferredTopics = Object.entries(snapshot.preferences)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 6);
  const preferenceImprints = sortedPreferenceImprints(snapshot, 6);
  const boundaryImprints = sortedBoundaryImprints(snapshot, 6);
  const relationImprints = sortedRelationImprints(snapshot, 6);
  const traces = sortedTraces(snapshot, 6);

  console.log(formatDriveState(snapshot.state));
  console.log(formatBodyState(snapshot.body));
  console.log(`attachment: ${snapshot.attachment.toFixed(2)}`);
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
  const message = currentEngine.emitInitiative();

  if (!message) {
    return;
  }

  await persistState(currentEngine);
  console.log(`hachika* ${message}`);
}

async function emitProactive(
  currentEngine: HachikaEngine,
  force: boolean,
): Promise<void> {
  const message = currentEngine.emitInitiative({ force });

  if (!message) {
    console.log("no proactive line");
    return;
  }

  await persistState(currentEngine);
  console.log(`hachika* ${message}`);
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

  currentEngine.rewindIdleHours(hours);
  await persistState(currentEngine);
  console.log(`idled ${hours}h`);
  await emitProactive(currentEngine, false);
}

async function persistState(currentEngine: HachikaEngine): Promise<void> {
  const snapshot = currentEngine.getSnapshot();
  await saveSnapshot(snapshotPath, snapshot);
  await syncArtifacts(snapshot, artifactsDir);
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
