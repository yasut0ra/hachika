import { resolve } from "node:path";

import { syncArtifacts } from "./artifacts.js";
import { runWithConflictRetry } from "./conflict-retry.js";
import { loadDotEnv } from "./env.js";
import { commitSnapshot, loadSnapshot } from "./persistence.js";
import {
  createProactiveDirectorFromEnv,
  describeProactiveDirector,
} from "./proactive-director.js";
import { createReplyGeneratorFromEnv, describeReplyGenerator } from "./reply-generator.js";
import {
  acquireResidentLoopLock,
  formatResidentLoopStatus,
  releaseResidentLoopLock,
  saveResidentLoopStatus,
  type ResidentLoopLock,
  type ResidentLoopStatus,
} from "./resident-monitor.js";
import {
  describeResidentLoopConfig,
  formatResidentActivity,
  readResidentLoopConfigFromEnv,
  runResidentLoopTick,
} from "./resident-loop.js";

const snapshotPath = resolve(process.cwd(), "data/hachika-state.json");
const artifactsDir = resolve(process.cwd(), "data/artifacts");
const residentLockPath = resolve(process.cwd(), "data/resident-lock.json");
const residentStatusPath = resolve(process.cwd(), "data/resident-status.json");

loadDotEnv();

const config = readResidentLoopConfigFromEnv();
const replyGenerator = createReplyGeneratorFromEnv();
const proactiveDirector = createProactiveDirectorFromEnv();
const startedAt = new Date().toISOString();

let running = false;
let stopped = false;
let timer: NodeJS.Timeout | null = null;
let lock: ResidentLoopLock | null = null;
const status: ResidentLoopStatus = {
  active: false,
  pid: process.pid,
  startedAt,
  heartbeatAt: startedAt,
  lastTickAt: null,
  lastActivityAt: null,
  lastInternalAt: null,
  lastProactiveAt: null,
  lastTickAttempts: null,
  lastError: null,
  lastInternalActivities: [],
  lastActivities: [],
  reply: describeReplyGenerator(replyGenerator),
  config,
  stoppedAt: null,
};

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

await main();

async function main(): Promise<void> {
  try {
    lock = await acquireResidentLoopLock(residentLockPath);
  } catch (error) {
    console.error(
      `[loop] startup error: ${error instanceof Error ? error.message : "resident_loop_lock_error"}`,
    );
    process.exitCode = 1;
    return;
  }

  status.active = true;
  await flushStatus();

  console.log("Hachika resident loop");
  console.log(describeResidentLoopConfig(config));
  console.log(`reply:${describeReplyGenerator(replyGenerator)}`);
  console.log(`proactive:${describeProactiveDirector(proactiveDirector)}`);
  console.log(`status:${formatResidentLoopStatus(status)}`);

  timer = setInterval(() => {
    void tick();
  }, config.intervalMs);

  await tick();
}

async function tick(): Promise<void> {
  if (running || stopped) {
    return;
  }

  running = true;
  status.heartbeatAt = new Date().toISOString();

  try {
    const outcome = await runWithConflictRetry({
      operate: async () => {
        const snapshot = await loadSnapshot(snapshotPath);
        return runResidentLoopTick(snapshot, {
          idleHours: config.idleHoursPerTick,
          replyGenerator,
          proactiveDirector,
        });
      },
      persist: async (result) => {
        const committed = await commitSnapshot(snapshotPath, result.snapshot);

        if (!committed.ok) {
          return false;
        }

        await syncArtifacts(committed.snapshot, artifactsDir);
        return true;
      },
    });

    if (!outcome.ok || !outcome.result) {
      status.active = true;
      status.heartbeatAt = new Date().toISOString();
      status.lastTickAttempts = outcome.attempts;
      status.lastError = "snapshot_revision_conflict";
      await flushStatus();
      console.error("[loop] conflict: snapshot revision changed before save");
      return;
    }

    const result = outcome.result;

    const tickAt = new Date().toISOString();
    status.active = true;
    status.heartbeatAt = tickAt;
    status.lastTickAt = tickAt;
    status.lastTickAttempts = outcome.attempts;
    status.lastError = null;
    status.lastInternalActivities = result.internalActivities
      .map(formatResidentActivity)
      .slice(-6);
    status.lastActivities = result.activities.map(formatResidentActivity).slice(-6);

    if (result.activities.length > 0) {
      status.lastActivityAt = tickAt;
    }

    if (result.internalActivities.length > 0) {
      status.lastInternalAt = tickAt;
    }

    if (result.proactiveMessage) {
      status.lastProactiveAt = tickAt;
    }

    await flushStatus();

    for (const activity of result.internalActivities) {
      console.log(`[loop/internal] ${formatResidentActivity(activity)}`);
    }

    for (const activity of result.outwardActivities) {
      console.log(`[loop/outward] ${formatResidentActivity(activity)}`);
    }

    if (result.proactiveMessage) {
      console.log(`hachika* ${result.proactiveMessage}`);
    }
  } catch (error) {
    status.active = true;
    status.heartbeatAt = new Date().toISOString();
    status.lastTickAttempts = null;
    status.lastError =
      error instanceof Error ? error.message : "resident_loop_error";
    await flushStatus();
    console.error(`[loop] error: ${status.lastError}`);
  } finally {
    running = false;
  }
}

async function shutdown(signal: string): Promise<void> {
  if (stopped) {
    return;
  }

  stopped = true;

  if (timer) {
    clearInterval(timer);
    timer = null;
  }

  const stoppedAt = new Date().toISOString();
  status.active = false;
  status.heartbeatAt = stoppedAt;
  status.stoppedAt = stoppedAt;
  status.lastError = status.lastError ?? `stopped:${signal}`;

  try {
    await flushStatus();
  } catch (error) {
    console.error(
      `[loop] shutdown status error: ${error instanceof Error ? error.message : "resident_loop_shutdown_error"}`,
    );
  }

  if (lock) {
    try {
      await releaseResidentLoopLock(lock);
    } catch (error) {
      console.error(
        `[loop] unlock error: ${error instanceof Error ? error.message : "resident_loop_unlock_error"}`,
      );
    }
  }

  console.log("resident loop stopped");
}

async function flushStatus(): Promise<void> {
  await saveResidentLoopStatus(residentStatusPath, status);
}
