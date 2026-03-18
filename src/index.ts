import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { stdin as input, stdout as output } from "node:process";

import { HachikaEngine } from "./engine.js";
import { sortedImprints } from "./memory.js";
import { loadSnapshot, saveSnapshot } from "./persistence.js";
import { createInitialSnapshot, formatDriveState } from "./state.js";

const snapshotPath = resolve(process.cwd(), "data/hachika-state.json");
const snapshot = await loadSnapshot(snapshotPath);
const engine = new HachikaEngine(snapshot);

const rl = createInterface({ input, output });

printIntro(engine);

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

    if (text === "/state") {
      console.log(formatDriveState(engine.getSnapshot().state));
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
      await saveSnapshot(snapshotPath, engine.getSnapshot());
      console.log("state reset");
      continue;
    }

    const result = engine.respond(text);
    await saveSnapshot(snapshotPath, result.snapshot);

    console.log(`hachika> ${result.reply}`);
  }
} finally {
  rl.close();
}

async function printIntro(currentEngine: HachikaEngine): Promise<void> {
  console.log("Hachika v0 CLI");
  console.log("`/help` でコマンドを表示します。");
  console.log(formatDriveState(currentEngine.getSnapshot().state));
  console.log(`attachment:${currentEngine.getSnapshot().attachment.toFixed(2)}`);
}

function printHelp(): void {
  console.log("/help   show commands");
  console.log("/state  print current drives");
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

function printImprints(currentEngine: HachikaEngine): void {
  const imprints = sortedImprints(currentEngine.getSnapshot());

  if (imprints.length === 0) {
    console.log("no imprints");
    return;
  }

  for (const imprint of imprints) {
    console.log(
      `${imprint.topic} salience:${imprint.salience.toFixed(2)} valence:${imprint.valence.toFixed(2)} mentions:${imprint.mentions}`,
    );
  }
}

function printDebug(currentEngine: HachikaEngine): void {
  const snapshot = currentEngine.getSnapshot();
  const preferredTopics = Object.entries(snapshot.preferences)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 6);
  const imprints = sortedImprints(snapshot, 6);

  console.log(formatDriveState(snapshot.state));
  console.log(`attachment: ${snapshot.attachment.toFixed(2)}`);

  if (preferredTopics.length === 0) {
    console.log("preferences: none");
  } else {
    console.log(
      `preferences: ${preferredTopics
        .map(([topic, score]) => `${topic}:${score.toFixed(2)}`)
        .join(" | ")}`,
    );
  }

  if (imprints.length === 0) {
    console.log("imprints: none");
  } else {
    console.log(
      `imprints: ${imprints
        .map((imprint) => `${imprint.topic}:${imprint.salience.toFixed(2)}/${imprint.valence.toFixed(2)}`)
        .join(" | ")}`,
    );
  }
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
