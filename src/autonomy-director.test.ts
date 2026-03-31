import assert from "node:assert/strict";
import test from "node:test";

import { createInitialSnapshot } from "./state.js";
import type { PreparedIdleAutonomyAction } from "./initiative.js";
import { createAutonomyDirectorFromEnv } from "./autonomy-director.js";

test("autonomy-director env factory returns null without api key", () => {
  assert.equal(createAutonomyDirectorFromEnv({}), null);
});

test("semantic-director v2 autonomy contract can be parsed through directAutonomy", async () => {
  const snapshot = createInitialSnapshot();
  const prepared: PreparedIdleAutonomyAction = {
    action: "observe",
    hours: 2,
    selected: null,
    prioritizedTopic: "仕様の境界",
    prioritizedMotive: "continue_shared_work",
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    ({
      ok: true,
      async json() {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  mode: "autonomy",
                  topics: [
                    {
                      topic: "仕様の境界",
                      source: "trace",
                      durability: "ephemeral",
                      confidence: 0.81,
                    },
                  ],
                  autonomyPlan: {
                    keep: true,
                    action: "hold",
                    outwardMode: "none",
                  },
                  summary: "autonomy/hold",
                }),
              },
            },
          ],
        };
      },
    }) as Response;

  try {
    const director = createAutonomyDirectorFromEnv({
      OPENAI_API_KEY: "test-key",
      OPENAI_AUTONOMY_MODEL: "test-model",
    });
    assert.ok(director);

    const result = await director!.directAutonomy({
      previousSnapshot: snapshot,
      nextSnapshot: snapshot,
      hours: 2,
      prepared,
    });

    assert.ok(result);
    assert.equal(result?.directive.keep, true);
    assert.equal(result?.directive.action, "hold");
    assert.equal(result?.directive.outwardMode, "none");
    assert.equal(result?.directive.semantic?.mode, "autonomy");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
