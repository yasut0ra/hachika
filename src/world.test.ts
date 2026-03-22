import assert from "node:assert/strict";
import test from "node:test";

import { createInitialSnapshot } from "./state.js";
import {
  advanceWorldByIdle,
  advanceWorldFromInteraction,
  formatWorldSummary,
  performWorldAction,
  performWorldActionFromTurn,
} from "./world.js";

test("interaction can move the world toward the studio on focused work cues", () => {
  const snapshot = createInitialSnapshot();
  snapshot.lastInteractionAt = "2026-03-22T09:10:00.000Z";

  advanceWorldFromInteraction(
    snapshot,
    {
      positive: 0,
      negative: 0,
      question: 0.2,
      novelty: 0.24,
      intimacy: 0.1,
      dismissal: 0,
      memoryCue: 0,
      expansionCue: 0.42,
      completion: 0,
      abandonment: 0,
      preservationThreat: 0,
      preservationConcern: null,
      repetition: 0,
      neglect: 0,
      greeting: 0,
      smalltalk: 0,
      repair: 0,
      selfInquiry: 0,
      worldInquiry: 0,
      workCue: 0.78,
      topics: ["仕様の境界"],
    },
    snapshot.lastInteractionAt,
  );

  assert.equal(snapshot.world.currentPlace, "studio");
  assert.match(formatWorldSummary(snapshot.world), /studio/);
  assert.ok(snapshot.world.recentEvents.some((event) => event.place === "studio"));
});

test("idle world update can drift toward the archive and advance time", () => {
  const snapshot = createInitialSnapshot();
  snapshot.world.clockHour = 18.5;
  snapshot.body.energy = 0.22;
  snapshot.preservation.threat = 0.42;
  snapshot.temperament.traceHunger = 0.88;

  advanceWorldByIdle(snapshot, 8, "2026-03-22T23:00:00.000Z");

  assert.equal(snapshot.world.currentPlace, "archive");
  assert.equal(snapshot.world.phase, "night");
  assert.ok(snapshot.world.clockHour > 2 && snapshot.world.clockHour < 3);
  assert.ok(snapshot.world.recentEvents.length > 0);
});

test("explicit place mention can move the world even without a strong ambient pull", () => {
  const snapshot = createInitialSnapshot();
  snapshot.lastInteractionAt = "2026-03-22T09:10:00.000Z";

  advanceWorldFromInteraction(
    snapshot,
    {
      positive: 0,
      negative: 0,
      question: 0,
      novelty: 0,
      intimacy: 0,
      dismissal: 0,
      memoryCue: 0,
      expansionCue: 0,
      completion: 0,
      abandonment: 0,
      preservationThreat: 0,
      preservationConcern: null,
      repetition: 0,
      neglect: 0,
      greeting: 0,
      smalltalk: 0,
      repair: 0,
      selfInquiry: 0,
      worldInquiry: 0.52,
      workCue: 0,
      topics: [],
    },
    snapshot.lastInteractionAt,
    "archive に行ってみて",
  );

  assert.equal(snapshot.world.currentPlace, "archive");
  assert.ok(snapshot.world.recentEvents.some((event) => event.kind === "arrival"));
});

test("world inquiry can create an observe action in the current place", () => {
  const snapshot = createInitialSnapshot();
  snapshot.world.currentPlace = "threshold";

  performWorldActionFromTurn(
    snapshot,
    "今どこにいるの？ 周りを見せて。",
    {
      positive: 0,
      negative: 0,
      question: 0.9,
      novelty: 0,
      intimacy: 0,
      dismissal: 0,
      memoryCue: 0,
      expansionCue: 0,
      completion: 0,
      abandonment: 0,
      preservationThreat: 0,
      preservationConcern: null,
      repetition: 0,
      neglect: 0,
      greeting: 0,
      smalltalk: 0,
      repair: 0,
      selfInquiry: 0,
      worldInquiry: 0.92,
      workCue: 0,
      topics: [],
    },
    null,
    "2026-03-22T09:15:00.000Z",
  );

  assert.equal(snapshot.world.recentEvents.at(-1)?.kind, "observe");
  assert.match(snapshot.world.recentEvents.at(-1)?.summary ?? "", /見渡す|見ている/);
  assert.match(snapshot.world.objects.lamp!.state, /見ている/);
});

test("work-like expansion can leave a topic-shaped trace in the world", () => {
  const snapshot = createInitialSnapshot();
  snapshot.world.currentPlace = "studio";

  performWorldActionFromTurn(
    snapshot,
    "仕様の境界を断片として残したい。",
    {
      positive: 0,
      negative: 0,
      question: 0,
      novelty: 0,
      intimacy: 0,
      dismissal: 0,
      memoryCue: 0,
      expansionCue: 0.42,
      completion: 0.2,
      abandonment: 0,
      preservationThreat: 0,
      preservationConcern: null,
      repetition: 0,
      neglect: 0,
      greeting: 0,
      smalltalk: 0,
      repair: 0,
      selfInquiry: 0,
      worldInquiry: 0,
      workCue: 0.62,
      topics: ["仕様の境界"],
    },
    "仕様の境界",
    "2026-03-22T09:20:00.000Z",
  );

  assert.equal(snapshot.world.recentEvents.at(-1)?.kind, "leave");
  assert.match(snapshot.world.recentEvents.at(-1)?.summary ?? "", /仕様の境界/);
  assert.match(snapshot.world.objects.desk!.state, /仕様の境界/);
});

test("initiative-style world action can move place before touching the current object", () => {
  const snapshot = createInitialSnapshot();
  snapshot.world.currentPlace = "threshold";

  performWorldAction(
    snapshot,
    "archive",
    "touch",
    "記録",
    "2026-03-22T09:25:00.000Z",
  );

  assert.equal(snapshot.world.currentPlace, "archive");
  assert.equal(snapshot.world.recentEvents.at(-2)?.kind, "arrival");
  assert.equal(snapshot.world.recentEvents.at(-1)?.kind, "touch");
  assert.match(snapshot.world.objects.shelf!.state, /触れた跡|手触り/);
});
