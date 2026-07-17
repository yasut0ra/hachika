import { resolve } from "node:path";

export interface HachikaDataPaths {
  dataDir: string;
  snapshotPath: string;
  artifactsDir: string;
  residentLockPath: string;
  residentStatusPath: string;
  metricsLogPath: string;
  archiveSnapshotsDir: string;
}

export interface ResolveHachikaDataPathsOptions {
  cwd?: string;
  dataDir?: string | null;
}

// 一個体の永続データを必ず一つのrootへ束ねる。
// 相対パスは起動cwd基準、絶対パスはそのまま使う。
export function resolveHachikaDataPaths(
  options: ResolveHachikaDataPathsOptions = {},
): HachikaDataPaths {
  const cwd = options.cwd ?? process.cwd();
  const configured =
    options.dataDir === undefined
      ? process.env.HACHIKA_DATA_DIR
      : options.dataDir;
  const value = configured?.trim();
  const dataDir = resolve(cwd, value || "data");

  return {
    dataDir,
    snapshotPath: resolve(dataDir, "hachika-state.json"),
    artifactsDir: resolve(dataDir, "artifacts"),
    residentLockPath: resolve(dataDir, "resident-lock.json"),
    residentStatusPath: resolve(dataDir, "resident-status.json"),
    metricsLogPath: resolve(dataDir, "metrics-log.jsonl"),
    archiveSnapshotsDir: resolve(dataDir, "archive-snapshots"),
  };
}
