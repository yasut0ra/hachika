import assert from "node:assert/strict";
import test from "node:test";

import { deriveEmbodimentState } from "./embodiment.js";
import { sanitizeSnapshot } from "./persistence.js";
import {
  advancePresenceHours,
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

test("short wall-clock ticks advance an ongoing experience without creating a new episode", () => {
  const snapshot = createInitialSnapshot();
  materializePresenceAction(snapshot, {
    action: "observe",
    hours: 0,
    focus: "灯り",
    rationale: "world_pull",
    place: "threshold",
    objectId: "lamp",
    timestamp: "2026-07-14T12:00:00.000Z",
  });
  const startedAt = snapshot.presence.startedAt;
  const worldEvents = snapshot.world.recentEvents.length;
  const worldUrgeBefore = snapshot.urges.worldUrge;

  advancePresenceHours(snapshot, 0.25, "2026-07-14T12:15:00.000Z");

  assert.equal(snapshot.presence.startedAt, startedAt);
  assert.equal(snapshot.presence.updatedAt, "2026-07-14T12:15:00.000Z");
  assert.equal(snapshot.presence.dwellHours, 0.25);
  assert.equal(snapshot.world.recentEvents.length, worldEvents);
  assert.equal(snapshot.urges.worldUrge, worldUrgeBefore);

  advancePresenceHours(snapshot, 0.25, "2026-07-14T12:30:00.000Z");

  assert.equal(snapshot.presence.dwellHours, 0.5);
  assert.equal(snapshot.world.recentEvents.length, worldEvents);
  assert.ok(snapshot.urges.worldUrge < worldUrgeBefore);
});

test("presence duration, intensity, and consequences are stable across tick sizes", () => {
  const bulk = createInitialSnapshot();
  materializePresenceAction(bulk, {
    action: "hold",
    hours: 0,
    focus: "約束",
    rationale: "memory_pull",
    timestamp: "2026-07-14T04:00:00.000Z",
  });
  const fine = structuredClone(bulk);

  advancePresenceHours(bulk, 8, "2026-07-14T12:00:00.000Z");
  for (let index = 1; index <= 32; index += 1) {
    advancePresenceHours(
      fine,
      0.25,
      new Date(Date.parse("2026-07-14T04:00:00.000Z") + index * 15 * 60 * 1000)
        .toISOString(),
    );
  }

  assert.equal(fine.presence.dwellHours, bulk.presence.dwellHours);
  assert.equal(fine.presence.intensity, bulk.presence.intensity);
  assert.equal(fine.urges.silenceNeed, bulk.urges.silenceNeed);
  assert.ok(
    Math.abs(fine.dynamics.cognitiveLoad - bulk.dynamics.cognitiveLoad) < 1e-9,
  );
});

test("return residue fades by elapsed time instead of resident tick count", () => {
  const snapshot = createInitialSnapshot();
  materializePresenceAction(snapshot, {
    action: "recall",
    hours: 0,
    focus: "約束",
    rationale: "trace_pull",
    timestamp: "2026-07-14T12:00:00.000Z",
  });
  interruptPresenceForUserTurn(snapshot, "2026-07-14T12:05:00.000Z");
  const residueBefore = snapshot.presence.residue!.intensity;

  advancePresenceHours(snapshot, 9, "2026-07-14T21:05:00.000Z");

  assert.equal(snapshot.presence.action, "rest");
  assert.equal(snapshot.presence.dwellHours, 9);
  assert.ok(snapshot.presence.residue!.intensity < residueBefore);
  assert.ok(
    Math.abs(snapshot.presence.residue!.intensity - residueBefore * Math.SQRT1_2) <
      0.001,
  );
  assert.equal(snapshot.presence.residue!.ageHours, 9);
});

test("version 32 residue migrates with a zero elapsed-time baseline", () => {
  const legacy = createInitialSnapshot();
  legacy.version = 32;
  materializePresenceAction(legacy, {
    action: "observe",
    hours: 0,
    focus: "灯り",
    rationale: "world_pull",
    timestamp: "2026-07-14T12:00:00.000Z",
  });
  interruptPresenceForUserTurn(legacy, "2026-07-14T12:05:00.000Z");
  delete (legacy.presence.residue as unknown as { ageHours?: number }).ageHours;

  const migrated = sanitizeSnapshot(legacy);

  assert.equal(migrated.version, 33);
  assert.equal(migrated.presence.residue?.ageHours, 0);
});

test("intentional rest recovers load and stress instead of being an empty default", () => {
  const snapshot = createInitialSnapshot();
  snapshot.body.energy = 0.24;
  snapshot.dynamics.cognitiveLoad = 0.78;
  snapshot.dynamics.activation = 0.62;
  snapshot.reactivity.stressLoad = 0.54;
  snapshot.urges.silenceNeed = 0.74;
  const before = structuredClone(snapshot);

  materializePresenceAction(snapshot, {
    action: "rest",
    hours: 8,
    focus: null,
    rationale: "body_need",
    place: "archive",
    timestamp: NOW,
  });

  assert.equal(snapshot.presence.action, "rest");
  assert.ok(snapshot.presence.intensity > 0);
  assert.ok(snapshot.dynamics.cognitiveLoad < before.dynamics.cognitiveLoad);
  assert.ok(snapshot.dynamics.activation < before.dynamics.activation);
  assert.ok(snapshot.reactivity.stressLoad < before.reactivity.stressLoad);
  assert.ok(snapshot.urges.silenceNeed < before.urges.silenceNeed);
  assert.ok(snapshot.body.energy > before.body.energy);
  assert.equal(
    deriveEmbodimentState(snapshot, new Date(NOW)).actionId,
    `presence:rest:${NOW}`,
  );
});

test("a familiar object makes touch safer and less costly than an unfamiliar one", () => {
  const familiar = createInitialSnapshot();
  const unfamiliar = createInitialSnapshot();
  familiar.world.objects.lamp!.familiarity = 0.72;

  for (const snapshot of [familiar, unfamiliar]) {
    snapshot.urges.worldUrge = 0.82;
    materializePresenceAction(snapshot, {
      action: "touch",
      hours: 8,
      focus: null,
      rationale: "world_pull",
      place: "threshold",
      objectId: "lamp",
      worldAction: "touch",
      timestamp: NOW,
    });
  }

  assert.ok(familiar.dynamics.safety > unfamiliar.dynamics.safety);
  assert.ok(
    familiar.dynamics.cognitiveLoad < unfamiliar.dynamics.cognitiveLoad,
  );
  assert.ok(familiar.world.objects.lamp!.familiarity > 0.72);
});
