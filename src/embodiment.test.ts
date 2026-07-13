import assert from "node:assert/strict";
import test from "node:test";

import { deriveEmbodimentState } from "./embodiment.js";
import { createInitialSnapshot } from "./state.js";

const NOW = new Date("2026-07-13T12:00:00.000Z");

test("embodiment maps a safe relational state to an open nearby presence", () => {
  const snapshot = createInitialSnapshot();
  snapshot.dynamics.trust = 0.78;
  snapshot.dynamics.safety = 0.82;
  snapshot.state.relation = 0.74;
  snapshot.body.tension = 0.12;
  snapshot.temperament.guardedness = 0.16;

  const embodiment = deriveEmbodimentState(snapshot, NOW);

  assert.equal(embodiment.posture, "open");
  assert.ok(embodiment.proximity > 0.5);
  assert.ok(embodiment.expressionWarmth > 0.5);
});

test("embodiment keeps bodily guardedness after mistrust and threat", () => {
  const snapshot = createInitialSnapshot();
  snapshot.body.tension = 0.88;
  snapshot.temperament.guardedness = 0.84;
  snapshot.reactivity.mistrust = 0.76;
  snapshot.preservation.threat = 0.7;
  snapshot.dynamics.safety = 0.2;

  const embodiment = deriveEmbodimentState(snapshot, NOW);

  assert.equal(embodiment.posture, "withdrawn");
  assert.ok(embodiment.proximity < 0.35);
  assert.ok(embodiment.expressionWarmth < 0.5);
});

test("embodiment turns recent recall into a visible look toward the shelf", () => {
  const snapshot = createInitialSnapshot();
  snapshot.world.currentPlace = "archive";
  snapshot.initiative.history.push({
    kind: "idle_reactivation",
    autonomyAction: "recall",
    timestamp: "2026-07-13T11:58:00.000Z",
    motive: "seek_continuity",
    topic: "仕様",
    traceTopic: "仕様",
    blocker: null,
    place: "archive",
    worldAction: "touch",
    maintenanceAction: null,
    reopened: false,
    hours: 8,
    summary: "棚の痕跡を思い返した。",
  });

  const embodiment = deriveEmbodimentState(snapshot, NOW);

  assert.equal(embodiment.action, "recall");
  assert.equal(embodiment.gazeTarget, "shelf");
  assert.match(embodiment.summary, /棚/);
});

test("embodiment exposes a fresh reply as speaking without making it permanent", () => {
  const snapshot = createInitialSnapshot();
  snapshot.memories.push({
    role: "hachika",
    text: "ここにいる。",
    timestamp: "2026-07-13T11:59:55.000Z",
    topics: [],
    sentiment: "neutral",
  });

  assert.equal(deriveEmbodimentState(snapshot, NOW).action, "speak");
  assert.equal(
    deriveEmbodimentState(snapshot, new Date("2026-07-13T12:01:00.000Z")).action,
    "rest",
  );
});

test("embodiment does not keep speaking after simulated idle has moved on", () => {
  const snapshot = createInitialSnapshot();
  snapshot.memories.push({
    role: "hachika",
    text: "少し考えている。",
    timestamp: "2026-07-13T11:59:55.000Z",
    topics: [],
    sentiment: "neutral",
  });
  snapshot.idleClock.absenceHours = 8;

  assert.equal(deriveEmbodimentState(snapshot, NOW).action, "rest");
});
