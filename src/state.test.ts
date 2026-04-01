import assert from "node:assert/strict";
import test from "node:test";

import { createInitialSnapshot } from "./state.js";

test("createInitialSnapshot starts on the current snapshot version", () => {
  const snapshot = createInitialSnapshot();

  assert.equal(snapshot.version, 24);
  assert.ok(snapshot.dynamics);
  assert.equal(snapshot.discourse.userName, null);
  assert.equal(snapshot.discourse.hachikaName?.value, "ハチカ");
  assert.deepEqual(snapshot.discourse.openQuestions, []);
  assert.deepEqual(snapshot.discourse.recentClaims, []);
  assert.deepEqual(snapshot.discourse.openRequests, []);
  assert.equal(snapshot.discourse.lastCorrection, null);
});
