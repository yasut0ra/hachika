import {
  createWebhookNotifier,
  formatMaintenanceHealth,
  runDailyMaintenance,
  type MaintenanceNotifier,
} from "./daily-maintenance.js";
import { resolveHachikaDataPaths } from "./data-paths.js";
import { loadDotEnv } from "./env.js";

loadDotEnv();

try {
  const paths = resolveHachikaDataPaths();
  const webhook = createWebhookNotifier();
  const notify: MaintenanceNotifier = async (alert) => {
    console.error(`[maintenance/alert] ${alert.message} data:${alert.dataDir}`);
    await webhook?.(alert);
  };
  const result = await runDailyMaintenance({
    dataDir: paths.dataDir,
    snapshotPath: paths.snapshotPath,
    archiveSnapshotsDir: paths.archiveSnapshotsDir,
    residentStatusPath: paths.residentStatusPath,
    notify,
  });

  console.log(
    `[maintenance/archive] ${result.archive.created ? "created" : "exists"} ${result.archive.filePath} revision:${result.archive.snapshot.revision}`,
  );
  console.log(`[maintenance/health] ${formatMaintenanceHealth(result.health)}`);

  if (!result.health.healthy) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(
    `[maintenance] error: ${error instanceof Error ? error.message : "daily_maintenance_failed"}`,
  );
  process.exitCode = 1;
}
