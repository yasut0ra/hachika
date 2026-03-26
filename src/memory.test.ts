import assert from "node:assert/strict";
import test from "node:test";

import {
  extractTopics,
  isMeaningfulTopic,
  requiresConcreteTopicSupport,
  topPreferredTopics,
} from "./memory.js";
import { createInitialSnapshot } from "./state.js";

test("extractTopics drops discourse scaffolding and vague tail fragments", () => {
  const topics = extractTopics(
    "こんにちは。いい始まり方だね。急がずでいい。まずは、君が今いちばん気になっていることから聞かせて。何がいいかな。例えば？",
  );

  assert.ok(!topics.includes("まずは"));
  assert.ok(!topics.includes("いちばん"));
  assert.ok(!topics.includes("って"));
  assert.ok(!topics.includes("かな"));
  assert.ok(!topics.includes("例えば"));
});

test("extractTopics prefers compound concrete topics over split fragments", () => {
  const problemTopics = extractTopics("じゃあ会話の問題点を三つに分けたい。");
  const boundaryTopics = extractTopics("仕様の境界が未定で曖昧だ。");
  const worldviewTopics = extractTopics("あなたは世界観をどう見ている？");

  assert.ok(problemTopics.includes("問題点"));
  assert.ok(!problemTopics.includes("じゃあ"));
  assert.ok(boundaryTopics.includes("仕様の境界"));
  assert.ok(worldviewTopics.includes("世界観"));
});

test("isMeaningfulTopic rejects low-information conversational fragments", () => {
  assert.equal(isMeaningfulTopic("かな"), false);
  assert.equal(isMeaningfulTopic("って"), false);
  assert.equal(isMeaningfulTopic("まずは"), false);
  assert.equal(isMeaningfulTopic("どんな"), false);
  assert.equal(isMeaningfulTopic("自分"), true);
});

test("requiresConcreteTopicSupport marks abstract and self-referential topics as higher risk", () => {
  assert.equal(requiresConcreteTopicSupport("静けさ"), true);
  assert.equal(requiresConcreteTopicSupport("棚の残り"), true);
  assert.equal(requiresConcreteTopicSupport("ハチカ"), true);
  assert.equal(requiresConcreteTopicSupport("今の目的"), true);
  assert.equal(requiresConcreteTopicSupport("仕様の境界"), false);
  assert.equal(requiresConcreteTopicSupport("世界観"), false);
});

test("topPreferredTopics ignores previously stored low-information topics", () => {
  const snapshot = createInitialSnapshot();
  snapshot.preferences.かな = 0.8;
  snapshot.preferences.って = 0.7;
  snapshot.preferences.自分 = 0.6;

  const topics = topPreferredTopics(snapshot, 3);

  assert.deepEqual(topics, ["自分"]);
});
