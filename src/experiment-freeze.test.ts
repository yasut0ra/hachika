import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import {
  fingerprintExperimentConfig,
  parseExperimentCheckCliArgs,
  validateExperimentFreeze,
} from "./experiment-freeze.js";

const REVISION = "0123456789abcdef0123456789abcdef01234567";

test("experiment freeze accepts a complete reproducible configuration", () => {
  const config = validConfig();
  const result = validateExperimentFreeze(config, {
    dirty: false,
    headRevision: REVISION,
    tagsAtHead: ["v3-life-1"],
    nodeVersion: "v24.6.0",
  });

  assert.deepEqual(result.errors, []);
  assert.match(result.fingerprint, /^[0-9a-f]{64}$/u);
});

test("experiment freeze rejects placeholders, secrets, simulation, and ambiguous individuals", () => {
  const config = validConfig();
  config.runtime.host = "<choose-host>";
  config.runtime.fixedIdleHoursPerTick = 0.5;
  config.llm.apiKey = "must-not-be-recorded";
  config.individuals[1]!.name = config.individuals[0]!.name;
  config.individuals[1]!.seed = config.individuals[0]!.seed;
  const result = validateExperimentFreeze(config, {
    dirty: true,
    headRevision: "f".repeat(40),
    tagsAtHead: [],
    nodeVersion: "v22.0.0",
  });

  assert.ok(result.errors.includes("runtime.host still contains a placeholder"));
  assert.ok(
    result.errors.includes(
      "runtime.fixedIdleHoursPerTick must be null for a wall-clock life",
    ),
  );
  assert.ok(
    result.errors.includes(
      "llm.apiKey must not be recorded in the tracked manifest",
    ),
  );
  assert.ok(result.errors.includes("individual names must be unique"));
  assert.ok(result.errors.includes("individual seeds must be unique"));
  assert.ok(result.errors.includes("git worktree must be clean"));
  assert.ok(result.errors.includes("git HEAD must carry tag v3-life-1"));
  assert.ok(
    result.errors.includes(
      "runtime.nodeVersion must equal the current Node.js version",
    ),
  );
});

test("experiment config fingerprint is independent of object key order", () => {
  const left = { b: { y: 2, x: 1 }, a: [3, 4] };
  const right = { a: [3, 4], b: { x: 1, y: 2 } };
  assert.equal(
    fingerprintExperimentConfig(left),
    fingerprintExperimentConfig(right),
  );
});

test("experiment check CLI resolves an explicit manifest path", () => {
  const cwd = resolve("/tmp", "hachika-freeze");
  assert.deepEqual(
    parseExperimentCheckCliArgs(
      ["--config", "docs/lab-notes/experiment-config.json"],
      { cwd },
    ),
    {
      configPath: resolve(cwd, "docs/lab-notes/experiment-config.json"),
      help: false,
    },
  );
});

function validConfig() {
  return {
    schemaVersion: 1,
    experimentId: "hachika-life-2026",
    implementation: {
      tag: "v3-life-1",
    },
    schedule: {
      birthDate: "2026-08-01",
      endDate: "2026-10-30",
      timeZone: "Asia/Tokyo",
    },
    runtime: {
      host: "life-host-01",
      nodeVersion: "v24.6.0",
      loopIntervalMs: 15_000,
      fixedIdleHoursPerTick: null as number | null,
      keepAwake: "launchd + caffeinate -is",
    },
    llm: {
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-5-mini",
      roleModels: {},
      apiKey: undefined as string | undefined,
    },
    fork: {
      enabled: true,
      day: 45,
    },
    publication: "repository lab notes",
    individuals: [
      {
        id: "A",
        name: "あかり",
        dataDir: "individuals/a",
        seed: "hachika-life-a",
        condition: "warm",
        protocol: "週5日以上、1回5ターン以上。週2日以上は共有作業。",
      },
      {
        id: "B",
        name: "しずく",
        dataDir: "individuals/b",
        seed: "hachika-life-b",
        condition: "quiet",
        protocol: "週1回、2〜3ターンの中立的な接触のみ。",
      },
    ],
  };
}
