import assert from "node:assert/strict";
import test from "node:test";

import {
  decideGenerationRetry,
  evaluateGeneratedTextQuality,
  scoreGeneratedTextQuality,
  summarizeRecentGenerationQuality,
} from "./generation-quality.js";
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

test("summarizeRecentGenerationQuality derives adaptive style notes from recent drift", () => {
  const snapshot = createInitialSnapshot();
  snapshot.generationHistory = [
    {
      timestamp: "2026-03-20T12:00:00.000Z",
      mode: "reply",
      source: "llm",
      provider: "openai",
      model: "gpt-5.4-mini",
      fallbackUsed: true,
      focus: "仕様",
      fallbackOverlap: 0.72,
      openerEcho: true,
      abstractTermRatio: 0.22,
      concreteDetailScore: 0.12,
      focusMentioned: false,
      summary: "overlap:0.72 abstract:0.22 concrete:0.12 echo:yes focus:no",
    },
  ];

  const summary = summarizeRecentGenerationQuality(snapshot);

  assert.equal(summary.count, 1);
  assert.ok(summary.styleNotes.some((note) => note.includes("fallback 依存")));
  assert.ok(summary.styleNotes.some((note) => note.includes("抽象語")));
  assert.ok(summary.styleNotes.some((note) => note.includes("出だし")));
});

test("decideGenerationRetry asks for a retry when wording is abstract and repetitive", () => {
  const decision = decideGenerationRetry({
    quality: {
      fallbackOverlap: 0.78,
      openerEcho: true,
      abstractTermRatio: 0.24,
      concreteDetailScore: 0.12,
      focusMentioned: false,
      summary: "overlap:0.78 abstract:0.24 concrete:0.12 echo:yes focus:no",
    },
    primaryFocus: "仕様",
    mode: "reply",
    socialTurn: false,
  });

  assert.equal(decision.shouldRetry, true);
  assert.ok(decision.notes.some((note) => note.includes("fallback")));
  assert.ok(decision.notes.some((note) => note.includes("抽象的")));
  assert.ok(decision.notes.some((note) => note.includes("primary focus")));
});

test("scoreGeneratedTextQuality prefers concrete focused wording over abstract echoing wording", () => {
  const weakScore = scoreGeneratedTextQuality({
    fallbackOverlap: 0.74,
    openerEcho: true,
    abstractTermRatio: 0.22,
    concreteDetailScore: 0.1,
    focusMentioned: false,
    summary: "weak",
  });
  const strongScore = scoreGeneratedTextQuality({
    fallbackOverlap: 0.18,
    openerEcho: false,
    abstractTermRatio: 0.06,
    concreteDetailScore: 0.62,
    focusMentioned: true,
    summary: "strong",
  });

  assert.ok(strongScore > weakScore);
});
