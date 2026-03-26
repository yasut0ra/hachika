import assert from "node:assert/strict";
import test from "node:test";

import { evaluateGeneratedTextQuality } from "./generation-quality.js";
import { createInitialSnapshot } from "./state.js";

test("evaluateGeneratedTextQuality tracks fallback overlap and opener echo", () => {
  const snapshot = createInitialSnapshot();
  snapshot.memories.push({
    role: "hachika",
    text: "まずはそのくらいの軽さでいい。こちらも温度を見ている。",
    timestamp: "2026-03-19T11:58:00.000Z",
    topics: [],
    sentiment: "neutral",
  });

  const quality = evaluateGeneratedTextQuality({
    text: "まずはそのくらいの軽さでいい。仕様の責務を一つずつ分けたい。",
    fallbackText: "仕様を分けたい。責務を整理したい。",
    previousSnapshot: snapshot,
    primaryFocus: "仕様",
  });

  assert.ok(quality.fallbackOverlap > 0);
  assert.equal(quality.openerEcho, true);
  assert.equal(quality.focusMentioned, true);
  assert.match(quality.summary, /overlap:/);
});

test("evaluateGeneratedTextQuality can see abstract-heavy wording with low concrete detail", () => {
  const snapshot = createInitialSnapshot();

  const quality = evaluateGeneratedTextQuality({
    text: "静けさと境界の流れだけを見ていたい。",
    fallbackText: "静けさを見ていたい。",
    previousSnapshot: snapshot,
    primaryFocus: null,
  });

  assert.ok(quality.abstractTermRatio > 0.2);
  assert.ok(quality.concreteDetailScore < 0.3);
  assert.equal(quality.focusMentioned, null);
});
