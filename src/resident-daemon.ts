import { resolve } from "node:path";

import { syncArtifacts } from "./artifacts.js";
import { loadDotEnv } from "./env.js";
import { loadSnapshot, saveSnapshot } from "./persistence.js";
import { createReplyGeneratorFromEnv, describeReplyGenerator } from "./reply-generator.js";
import {
  describeResidentLoopConfig,
  formatResidentActivity,
  readResidentLoopConfigFromEnv,
  runResidentLoopTick,
} from "./resident-loop.js";

const snapshotPath = resolve(process.cwd(), "data/hachika-state.json");
const artifactsDir = resolve(process.cwd(), "data/artifacts");

loadDotEnv();

const config = readResidentLoopConfigFromEnv();
const replyGenerator = createReplyGeneratorFromEnv();
let running = false;
let stopped = false;

console.log("Hachika resident loop");
console.log(describeResidentLoopConfig(config));
console.log(`reply:${describeReplyGenerator(replyGenerator)}`);

const timer = setInterval(() => {
  void tick();
}, config.intervalMs);

void tick();

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function tick(): Promise<void> {
  if (running || stopped) {
    return;
  }

  running = true;

  try {
    const snapshot = await loadSnapshot(snapshotPath);
    const result = await runResidentLoopTick(snapshot, {
      idleHours: config.idleHoursPerTick,
      replyGenerator,
    });

    await saveSnapshot(snapshotPath, result.snapshot);
    await syncArtifacts(result.snapshot, artifactsDir);

    for (const activity of result.activities) {
      console.log(`[loop] ${formatResidentActivity(activity)}`);
    }

    if (result.proactiveMessage) {
      console.log(`hachika* ${result.proactiveMessage}`);
    }
  } catch (error) {
    console.error(
      `[loop] error: ${error instanceof Error ? error.message : "resident_loop_error"}`,
    );
  } finally {
    running = false;
  }
}

function shutdown(): void {
  if (stopped) {
    return;
  }

  stopped = true;
  clearInterval(timer);
  console.log("resident loop stopped");
}
