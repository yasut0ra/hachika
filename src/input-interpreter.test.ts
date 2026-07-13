import assert from "node:assert/strict";
import test from "node:test";

import {
  buildInputInterpretationPayload,
  createInputInterpreterFromEnv,
  describeInputInterpreter,
} from "./input-interpreter.js";
import { createInitialSnapshot } from "./state.js";

test("buildInputInterpretationPayload uses a concrete actor cue and includes discourse context", () => {
  const snapshot = createInitialSnapshot();
  snapshot.identity.summary = "まだ輪郭は薄いが、消えていない。";
  snapshot.identity.anchors = ["設計"];
  snapshot.world.currentPlace = "studio";
  snapshot.purpose.active = {
    kind: "continue_shared_work",
    topic: "仕様",
    summary: "「仕様」を前へ進めたい。",
    confidence: 0.62,
    progress: 0.3,
    createdAt: "2026-03-20T00:00:00.000Z",
    lastUpdatedAt: "2026-03-20T00:00:00.000Z",
    turnsActive: 1,
  };
  snapshot.preferences.設計 = 0.42;
  snapshot.discourse.hachikaName = {
    kind: "hachika_name",
    value: "ハチカ",
    confidence: 0.82,
    source: "relation_assignment",
    updatedAt: "2026-03-20T00:00:00.000Z",
  };
  snapshot.discourse.openRequests.push({
    target: "hachika_name",
    kind: "style",
    text: "ハチカ自身の名前を具体的に答えて。",
    askedAt: "2026-03-20T00:00:00.000Z",
    requestedBy: "user",
    responsibleParty: "hachika",
    status: "open",
    resolvedAt: null,
  });
  snapshot.traces.設計 = {
    topic: "設計",
    kind: "continuity_marker",
    status: "active",
    lastAction: "continued",
    summary: "「設計」は続きの目印として残っている。",
    sourceMotive: "seek_continuity",
    artifact: {
      memo: ["設計の続き"],
      fragments: [],
      decisions: [],
      nextSteps: ["設計をつなぎ直す"],
    },
    work: {
      focus: "設計をつなぎ直す",
      confidence: 0.64,
      blockers: [],
      staleAt: null,
    },
    salience: 0.62,
    mentions: 2,
    createdAt: "2026-03-20T00:00:00.000Z",
    lastUpdatedAt: "2026-03-20T00:00:00.000Z",
  };

  const payload = buildInputInterpretationPayload({
    input: "こんにちは",
    snapshot,
    localTopics: ["こんにちは"],
  });

  assert.equal(payload.input, "こんにちは");
  assert.notEqual(payload.actorCue, snapshot.identity.summary);
  assert.match(payload.actorCue, /いまは/);
  assert.match(payload.actorCue, /studio|机/);
  assert.equal(payload.discourse.hachikaName, "ハチカ");
  assert.equal(payload.discourse.openRequests[0]?.target, "hachika_name");
  assert.ok(payload.knownTopics.includes("設計"));
  assert.ok(payload.knownTopics.includes("仕様"));
});

test("createInputInterpreterFromEnv respects dedicated model override", () => {
  const interpreter = createInputInterpreterFromEnv({
    OPENAI_API_KEY: "test-key",
    OPENAI_MODEL: "gpt-5-mini",
    OPENAI_INTERPRETER_MODEL: "gpt-5.4-mini",
    OPENAI_BASE_URL: "https://api.openai.com/v1",
  });

  assert.equal(describeInputInterpreter(interpreter), "openai");
});
