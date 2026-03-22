import assert from "node:assert/strict";
import test from "node:test";

import { runWithConflictRetry } from "./conflict-retry.js";

test("runWithConflictRetry retries once after a conflict and returns the second result", async () => {
  let attempts = 0;

  const result = await runWithConflictRetry({
    operate: async () => {
      attempts += 1;
      return attempts;
    },
    persist: async (value) => value >= 2,
  });

  assert.equal(result.ok, true);
  assert.equal(result.result, 2);
  assert.equal(result.attempts, 2);
});

test("runWithConflictRetry fails cleanly after exhausting retries", async () => {
  let attempts = 0;

  const result = await runWithConflictRetry({
    operate: async () => {
      attempts += 1;
      return attempts;
    },
    persist: async () => false,
    maxAttempts: 2,
  });

  assert.equal(result.ok, false);
  assert.equal(result.result, null);
  assert.equal(result.attempts, 2);
});
