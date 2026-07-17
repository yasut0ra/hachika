import { execFileSync } from "node:child_process";

import {
  assertExperimentBirthAvailable,
  createExperimentBirth,
  experimentBirthUsage,
  parseExperimentBirthCliArgs,
} from "./experiment-birth.js";
import {
  loadExperimentConfig,
  parseExperimentConfig,
  validateExperimentFreeze,
  type ExperimentRepositoryState,
} from "./experiment-freeze.js";

try {
  const options = parseExperimentBirthCliArgs(process.argv.slice(2));
  if (options.help) {
    console.log(experimentBirthUsage());
  } else {
    const rawConfig = await loadExperimentConfig(options.configPath);
    const repository = readRepositoryState();
    const validation = validateExperimentFreeze(rawConfig, repository);
    if (validation.errors.length > 0) {
      throw new Error(`experiment_not_frozen:${validation.errors.join("; ")}`);
    }
    const config = parseExperimentConfig(rawConfig);
    const birthOptions = options.individualIds.map((individualId) => ({
      config,
      individualId,
      implementationRevision: repository.headRevision,
      configPath: options.configPath,
    }));

    for (const birth of birthOptions) {
      await assertExperimentBirthAvailable(birth);
    }
    for (const birth of birthOptions) {
      const result = await createExperimentBirth(birth);
      console.log(
        `birth:${result.individualId}/${result.name} snapshot:${result.snapshotPath} record:${result.birthRecordPath} sha256:${result.snapshotSha256}`,
      );
    }
  }
} catch (error) {
  console.error(
    `[birth] error: ${error instanceof Error ? error.message : "experiment_birth_failed"}`,
  );
  process.exitCode = 1;
}

function readRepositoryState(): ExperimentRepositoryState {
  const git = (args: string[]) =>
    execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  return {
    dirty: git(["status", "--porcelain", "--untracked-files=all"]).length > 0,
    headRevision: git(["rev-parse", "HEAD"]),
    tagsAtHead: git(["tag", "--points-at", "HEAD"])
      .split("\n")
      .map((value) => value.trim())
      .filter(Boolean),
    nodeVersion: process.version,
  };
}
