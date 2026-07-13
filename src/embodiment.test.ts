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
    timestamp: "2026-07-13T11:59:59.000Z",
    topics: [],
    sentiment: "neutral",
  });

  const speaking = deriveEmbodimentState(snapshot, NOW);
  assert.equal(speaking.action, "speak");
  assert.equal(speaking.actionId, "speak:2026-07-13T11:59:59.000Z");
  assert.equal(speaking.layers.mouth, "speaking");
  assert.ok(speaking.speech.remainingMs > 0);
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

test("embodiment learns a reaching manner from relational openness", () => {
  const snapshot = createInitialSnapshot();
  snapshot.temperament.bondingBias = 0.92;
  snapshot.temperament.openness = 0.78;
  snapshot.temperament.selfDisclosureBias = 0.72;
  snapshot.temperament.guardedness = 0.1;
  snapshot.temperament.workDrive = 0.24;
  snapshot.temperament.traceHunger = 0.28;

  const embodiment = deriveEmbodimentState(snapshot, NOW);

  assert.equal(embodiment.motion.manner, "reaching");
  assert.ok(embodiment.motion.gazePersistence > 0.6);
});

test("embodiment learns still guarded movement from guarded temperament", () => {
  const snapshot = createInitialSnapshot();
  snapshot.temperament.guardedness = 0.92;
  snapshot.temperament.openness = 0.18;
  snapshot.temperament.selfDisclosureBias = 0.12;
  snapshot.temperament.bondingBias = 0.22;
  snapshot.temperament.workDrive = 0.3;
  snapshot.temperament.traceHunger = 0.66;

  const embodiment = deriveEmbodimentState(snapshot, NOW);

  assert.equal(embodiment.motion.manner, "guarded");
  assert.ok(embodiment.motion.stillness > 0.65);
  assert.ok(embodiment.motion.gestureAmplitude < 0.35);
  assert.ok(embodiment.motion.settlingTimeMs > 1_700);
});

test("embodiment gives each new action occurrence a stable replay id", () => {
  const snapshot = createInitialSnapshot();
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

  const first = deriveEmbodimentState(snapshot, NOW);
  const repeatedPoll = deriveEmbodimentState(snapshot, NOW);
  snapshot.initiative.history.push({
    ...snapshot.initiative.history[0]!,
    timestamp: "2026-07-13T11:59:00.000Z",
  });
  const nextOccurrence = deriveEmbodimentState(snapshot, NOW);

  assert.equal(first.actionId, repeatedPoll.actionId);
  assert.notEqual(first.actionId, nextOccurrence.actionId);
});

test("embodiment separates eye mouth and hand layer intentions", () => {
  const snapshot = createInitialSnapshot();
  snapshot.body.tension = 0.72;
  snapshot.temperament.guardedness = 0.7;
  snapshot.initiative.history.push({
    kind: "idle_consolidation",
    autonomyAction: "hold",
    timestamp: "2026-07-13T11:59:00.000Z",
    motive: "protect_boundary",
    topic: null,
    traceTopic: null,
    blocker: null,
    place: "threshold",
    worldAction: null,
    maintenanceAction: null,
    reopened: false,
    hours: 8,
    summary: "言葉を抱えた。",
  });

  const holding = deriveEmbodimentState(snapshot, NOW);

  assert.equal(holding.layers.eyes, "closed");
  assert.equal(holding.layers.mouth, "neutral");
  assert.equal(holding.layers.hands, "gather");
  assert.ok(holding.layers.blinkIntervalMs >= 2_800);
});

test("embodiment speech duration follows utterance length instead of a fixed window", () => {
  const short = createInitialSnapshot();
  short.memories.push({
    role: "hachika",
    text: "うん。",
    timestamp: "2026-07-13T11:59:59.000Z",
    topics: [],
    sentiment: "neutral",
  });
  const long = createInitialSnapshot();
  long.memories.push({
    role: "hachika",
    text: "ここに残っている言葉を、急がずにひとつずつ確かめながら話していきたい。",
    timestamp: "2026-07-13T11:59:59.000Z",
    topics: [],
    sentiment: "neutral",
  });

  const shortSpeech = deriveEmbodimentState(short, NOW).speech;
  const longSpeech = deriveEmbodimentState(long, NOW).speech;

  assert.equal(shortSpeech.durationMs, 1_800);
  assert.ok(longSpeech.durationMs > shortSpeech.durationMs);
  assert.ok(longSpeech.remainingMs > shortSpeech.remainingMs);
});

test("embodiment speech closes after its own duration and carries cadence and emphasis", () => {
  const snapshot = createInitialSnapshot();
  snapshot.dynamics.activation = 0.82;
  snapshot.memories.push({
    role: "hachika",
    text: "聞いて。",
    timestamp: "2026-07-13T11:59:59.000Z",
    topics: [],
    sentiment: "neutral",
  });

  const active = deriveEmbodimentState(snapshot, NOW);
  const finished = deriveEmbodimentState(
    snapshot,
    new Date("2026-07-13T12:00:03.000Z"),
  );

  assert.equal(active.speech.active, true);
  assert.ok(active.speech.cadence > 0.5);
  assert.ok(active.speech.emphasis > 0.45);
  assert.equal(finished.speech.active, false);
  assert.equal(finished.layers.mouth, "neutral");
});

test("expired speech does not linger through the autonomy activity fallback", () => {
  const snapshot = createInitialSnapshot();
  snapshot.memories.push({
    role: "hachika",
    text: "うん。",
    timestamp: "2026-07-13T11:59:59.000Z",
    topics: [],
    sentiment: "neutral",
  });
  snapshot.initiative.lastProactiveAt = "2026-07-13T11:59:59.000Z";
  snapshot.initiative.history.push({
    kind: "proactive_emission",
    autonomyAction: "speak",
    timestamp: "2026-07-13T11:59:59.000Z",
    motive: "seek_continuity",
    topic: null,
    traceTopic: null,
    blocker: null,
    place: "threshold",
    worldAction: null,
    maintenanceAction: null,
    reopened: false,
    hours: null,
    summary: "短く声をかけた。",
  });

  const finished = deriveEmbodimentState(
    snapshot,
    new Date("2026-07-13T12:00:03.000Z"),
  );

  assert.equal(finished.speech.active, false);
  assert.notEqual(finished.action, "speak");
  assert.equal(finished.layers.mouth, "neutral");
});
