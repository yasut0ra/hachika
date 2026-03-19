import assert from "node:assert/strict";
import test from "node:test";

import { loadDotEnv, parseDotEnvLine } from "./env.js";

test("parseDotEnvLine handles plain values and comments", () => {
  assert.deepEqual(parseDotEnvLine("OPENAI_MODEL=gpt-5-mini"), {
    key: "OPENAI_MODEL",
    value: "gpt-5-mini",
  });
  assert.deepEqual(parseDotEnvLine("OPENAI_BASE_URL=https://api.openai.com/v1 # comment"), {
    key: "OPENAI_BASE_URL",
    value: "https://api.openai.com/v1",
  });
});

test("parseDotEnvLine handles quoted values", () => {
  assert.deepEqual(parseDotEnvLine('OPENAI_API_KEY="sk-test-value"'), {
    key: "OPENAI_API_KEY",
    value: "sk-test-value",
  });
  assert.deepEqual(parseDotEnvLine("OPENAI_PROJECT='proj_123'"), {
    key: "OPENAI_PROJECT",
    value: "proj_123",
  });
});

test("loadDotEnv does not overwrite existing environment variables", () => {
  const original = process.env.OPENAI_MODEL;
  process.env.OPENAI_MODEL = "from-process";

  try {
    const loaded = loadDotEnv("/Users/yasut0ra/dev/hachika/.env.example");

    assert.equal(process.env.OPENAI_MODEL, "from-process");
    assert.equal(loaded.includes("OPENAI_MODEL"), false);
  } finally {
    if (original === undefined) {
      delete process.env.OPENAI_MODEL;
    } else {
      process.env.OPENAI_MODEL = original;
    }
  }
});
