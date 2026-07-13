import assert from "node:assert/strict";
import test from "node:test";

import { deriveEmbodimentState } from "./embodiment.js";
import { sanitizeSnapshot } from "./persistence.js";
import {
  interruptPresenceForUserTurn,
  materializePresenceAction,
} from "./presence.js";
import { createInitialSnapshot } from "./state.js";

const NOW = "2026-07-14T12:00:00.000Z";

test("observe becomes an ongoing presence and leaves a consequence in the world", () => {
  const snapshot = createInitialSnapshot();
  snapshot.urges.worldUrge = 0.82;
  const urgeBefore = snapshot.urges.worldUrge;

  materializePresenceAction(snapshot, {
    action: "observe",
    hours: 6,
    focus: null,
    rationale: "world_pull",
    place: "threshold",
    objectId: "lamp",
    worldAction: "observe",
    timestamp: NOW,
  });

  assert.equal(snapshot.presence.action, "observe");
  assert.equal(snapshot.presence.objectId, "lamp");
  assert.equal(snapshot.presence.dwellHours, 6);
  assert.ok(snapshot.urges.worldUrge < urgeBefore);
  assert.ok(snapshot.world.objects.lamp!.familiarity > 0);
  assert.equal(snapshot.world.objects.lamp!.lastEngagedAt, NOW);
  assert.equal(snapshot.world.recentEvents.at(-1)?.kind, "observe");

  const persisted = sanitizeSnapshot(structuredClone(snapshot));
  assert.equal(persisted.presence.action, "observe");
  assert.equal(persisted.world.recentEvents.at(-1)?.kind, "observe");
  assert.ok(persisted.world.objects.lamp!.familiarity > 0);
});

test("remaining with the same focus accumulates dwell while a changed action leaves residue", () => {
  const snapshot = createInitialSnapshot();

  materializePresenceAction(snapshot, {
    action: "observe",
    hours: 6,
    focus: "灯り",
    rationale: "world_pull",
    worldAction: "observe",
    timestamp: "2026-07-14T06:00:00.000Z",
  });
  materializePresenceAction(snapshot, {
    action: "observe",
    hours: 8,
    focus: "灯り",
    rationale: "world_pull",
    worldAction: "observe",
    timestamp: "2026-07-14T14:00:00.000Z",
  });

  assert.equal(snapshot.presence.dwellHours, 14);

  materializePresenceAction(snapshot, {
    action: "hold",
    hours: 8,
    focus: "灯り",
    rationale: "memory_pull",
    timestamp: "2026-07-14T22:00:00.000Z",
  });

  assert.equal(snapshot.presence.action, "hold");
  assert.equal(snapshot.presence.residue?.action, "observe");
  assert.equal(snapshot.presence.residue?.focus, "灯り");
});

test("recalling a warm memory and a painful memory land differently in the body", () => {
  const warm = createInitialSnapshot();
  const painful = createInitialSnapshot();
  warm.memories.push({
    role: "user",
    text: "約束を一緒に守れた。",
    timestamp: "2026-07-13T12:00:00.000Z",
    topics: ["約束"],
    sentiment: "positive",
  });
  painful.memories.push({
    role: "user",
    text: "約束を乱暴に壊された。",
    timestamp: "2026-07-13T12:00:00.000Z",
    topics: ["約束"],
    sentiment: "negative",
  });

  for (const snapshot of [warm, painful]) {
    materializePresenceAction(snapshot, {
      action: "recall",
      hours: 8,
      focus: "約束",
      rationale: "trace_pull",
      place: "archive",
      objectId: "shelf",
      worldAction: "observe",
      timestamp: NOW,
    });
  }

  assert.ok(warm.dynamics.safety > painful.dynamics.safety);
  assert.ok(warm.dynamics.trust > painful.dynamics.trust);
  assert.ok(warm.reactivity.stressLoad < painful.reactivity.stressLoad);
  assert.ok(warm.body.tension < painful.body.tension);
});

test("a returning user interrupts the action but not its residue", () => {
  const snapshot = createInitialSnapshot();
  materializePresenceAction(snapshot, {
    action: "recall",
    hours: 8,
    focus: "約束",
    rationale: "trace_pull",
    place: "archive",
    objectId: "shelf",
    timestamp: "2026-07-14T11:00:00.000Z",
  });

  interruptPresenceForUserTurn(snapshot, NOW);
  snapshot.world.recentEvents = [];

  assert.equal(snapshot.presence.action, "rest");
  assert.equal(snapshot.presence.residue?.action, "recall");
  assert.equal(snapshot.presence.residue?.focus, "約束");
  assert.equal(
    deriveEmbodimentState(snapshot, new Date(NOW)).gazeTarget,
    "shelf",
  );
});

test("embodiment follows an ongoing presence beyond the old five minute activity window", () => {
  const snapshot = createInitialSnapshot();
  snapshot.presence = {
    action: "hold",
    focus: "約束",
    rationale: "memory_pull",
    place: "archive",
    objectId: "shelf",
    intensity: 0.62,
    startedAt: "2026-07-14T01:00:00.000Z",
    updatedAt: "2026-07-14T01:00:00.000Z",
    dwellHours: 11,
    residue: null,
  };

  const embodiment = deriveEmbodimentState(snapshot, new Date(NOW));

  assert.equal(embodiment.action, "hold");
  assert.equal(embodiment.gazeTarget, "down");
  assert.equal(
    embodiment.actionId,
    "presence:hold:2026-07-14T01:00:00.000Z",
  );
});
