import { execFileSync } from "node:child_process";

import {
  experimentCheckUsage,
  loadExperimentConfig,
  parseExperimentCheckCliArgs,
  validateExperimentFreeze,
  type ExperimentRepositoryState,
} from "./experiment-freeze.js";

try {
  const options = parseExperimentCheckCliArgs(process.argv.slice(2));
  if (options.help) {
    console.log(experimentCheckUsage());
  } else {
    const config = await loadExperimentConfig(options.configPath);
    const repository = readRepositoryState();
    const result = validateExperimentFreeze(config, repository);

    console.log(`config:${options.configPath}`);
    console.log(`fingerprint:sha256:${result.fingerprint}`);
    console.log(`head:${repository.headRevision}`);

    if (result.errors.length > 0) {
      for (const error of result.errors) {
        console.error(`[experiment/error] ${error}`);
      }
      process.exitCode = 1;
    } else {
      console.log("experiment freeze: ready");
    }
  }
} catch (error) {
  console.error(
    `[experiment] error: ${error instanceof Error ? error.message : "experiment_check_failed"}`,
  );
  process.exitCode = 1;
}

function readRepositoryState(): ExperimentRepositoryState {
  const headRevision = git(["rev-parse", "HEAD"]);
  const tagsAtHead = git(["tag", "--points-at", "HEAD"])
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean);
  const dirty = git(["status", "--porcelain", "--untracked-files=all"]).length > 0;

  return {
    dirty,
    headRevision,
    tagsAtHead,
    nodeVersion: process.version,
  };
}

function git(args: string[]): string {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
