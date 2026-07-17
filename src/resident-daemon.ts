import {
  createAutonomyDirectorFromEnv,
  describeAutonomyDirector,
} from "./autonomy-director.js";
import { resolveHachikaDataPaths } from "./data-paths.js";
import { loadDotEnv } from "./env.js";
import {
  createProactiveDirectorFromEnv,
  describeProactiveDirector,
} from "./proactive-director.js";
import { createReplyGeneratorFromEnv, describeReplyGenerator } from "./reply-generator.js";
import { formatResidentLoopStatus } from "./resident-monitor.js";
import {
  describeResidentLoopConfig,
  readResidentLoopConfigFromEnv,
} from "./resident-loop.js";
import { ResidentLoopRuntime } from "./resident-runtime.js";

loadDotEnv();
const {
  dataDir,
  snapshotPath,
  artifactsDir,
  residentLockPath,
  residentStatusPath,
} = resolveHachikaDataPaths();

const config = readResidentLoopConfigFromEnv();
const replyGenerator = createReplyGeneratorFromEnv();
const autonomyDirector = createAutonomyDirectorFromEnv();
const proactiveDirector = createProactiveDirectorFromEnv();
const runtime = new ResidentLoopRuntime({
  snapshotPath,
  artifactsDir,
  lockPath: residentLockPath,
  statusPath: residentStatusPath,
  config,
  replyDescription: describeReplyGenerator(replyGenerator),
  replyGenerator,
  autonomyDirector,
  proactiveDirector,
  log: console.log,
  error: console.error,
});

let shuttingDown = false;
process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

try {
  await runtime.start();
  console.log("Hachika resident loop");
  console.log(`data:${dataDir}`);
  console.log(describeResidentLoopConfig(config));
  console.log(`reply:${describeReplyGenerator(replyGenerator)}`);
  console.log(`autonomy:${describeAutonomyDirector(autonomyDirector)}`);
  console.log(`proactive:${describeProactiveDirector(proactiveDirector)}`);
  console.log(`status:${formatResidentLoopStatus(runtime.getStatus())}`);
} catch (error) {
  console.error(
    `[loop] startup error: ${error instanceof Error ? error.message : "resident_loop_lock_error"}`,
  );
  process.exitCode = 1;
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  try {
    await runtime.stop(signal);
  } catch (error) {
    console.error(
      `[loop] shutdown error: ${error instanceof Error ? error.message : "resident_loop_shutdown_error"}`,
    );
  }

  console.log("resident loop stopped");
}
