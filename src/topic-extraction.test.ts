import assert from "node:assert/strict";
import test from "node:test";

import { extractLocalTopics } from "./memory.js";
import {
  extractClosedTopics,
  extractTopics,
  extractTopicTerms,
  isMeaningfulTopic,
} from "./topic-extraction.js";
import {
  evaluateTopicExtraction,
  evaluateTopicJudgement,
  loadTopicEvalSet,
} from "./topic-eval.js";

test("topic extraction stays above the evaluation baseline", () => {
  const set = loadTopicEvalSet();
  const extraction = evaluateTopicExtraction(set.turns, extractLocalTopics);
  const judgement = evaluateTopicJudgement(set, isMeaningfulTopic);

  // 形態素解析を入れる前は precision 0.452 / recall 0.857 / judgement 0.455 だった
  assert.ok(extraction.precision >= 0.95, `precision ${extraction.precision}`);
  assert.ok(extraction.recall >= 0.95, `recall ${extraction.recall}`);
  assert.ok(judgement.accuracy >= 0.95, `judgement ${judgement.accuracy}`);
});

test("function words and inflection fragments never become topics", () => {
  for (const text of [
    "なんなの、について って。そんな話はもういいよ",
    "意味がわからないじゃん",
    "気になることはありますか",
    "そうだよね",
    "yaa",
    "じゃあ最初の話に戻りましょう",
    "少し離れるね。戻ったら続きを聞かせて。",
  ]) {
    assert.deepEqual(extractTopics(text), [], text);
  }
});

test("noun phrases keep their compounds and drop conversational heads", () => {
  assert.deepEqual(extractTopics("仕様の境界を整理して"), ["仕様の境界", "境界", "仕様"]);
  assert.deepEqual(extractTopics("宇宙の話が好き"), ["宇宙"]);
  assert.deepEqual(extractTopics("じゃあ会話の問題点を三つに分けたい。"), ["問題点"]);
  assert.deepEqual(extractTopics("6週間の予定"), ["6週間の予定", "予定"]);
  assert.deepEqual(extractTopics("朝ごはんはパンだった"), ["朝ごはん", "パン"]);
  assert.ok(extractTopics("東京タワーに行ったことある？").includes("東京タワー"));
});

test("spaces and punctuation break noun phrases", () => {
  assert.deepEqual(extractTopics("memory architecture を設計したい。"), [
    "memory",
    "architecture",
  ]);
  assert.deepEqual(extractTopics("猫？"), ["猫"]);
});

test("honorifics are not part of a remembered name", () => {
  assert.deepEqual(extractTopics("「ミナさん」じゃなくて、ミナと呼んで。"), ["ミナ"]);
});

test("a verbal noun becomes a topic only when nothing else is named", () => {
  assert.deepEqual(extractTopics("転職するか迷ってる"), ["転職"]);
  assert.equal(extractTopics("旅の記録を整理したい").includes("整理"), false);
});

test("stored noise is judged apart from real topics", () => {
  for (const noise of ["について", "そんな", "じゃん", "ありま", "yaa", "最初話", "とら", "意味", "元気"]) {
    assert.equal(isMeaningfulTopic(noise), false, noise);
  }

  for (const topic of ["旅の記録", "sf", "sf短編集", "猫", "ごはん", "問題点", "東京タワー"]) {
    assert.equal(isMeaningfulTopic(topic), true, topic);
  }
});

test("matching terms expose the parts of a compound without storing them as topics", () => {
  assert.deepEqual(extractTopics("インターン選考"), ["インターン選考"]);
  assert.deepEqual(extractTopicTerms("インターン選考"), ["インターン選考", "インターン", "選考"]);
});

test("closing a topic in conversation is told apart from talking about it", () => {
  assert.deepEqual(extractClosedTopics("その「更新」についての話はもう終わりにしてほしい"), ["更新"]);
  assert.deepEqual(extractClosedTopics("更新の話はもういいよ"), ["更新"]);
  assert.deepEqual(extractClosedTopics("仕事の話題を変えよう"), ["仕事"]);

  for (const text of [
    "別の話をしよう。猫の話がしたい",
    "旅の話はいいね",
    "ダイエットはやめよう",
    "更新についていい情報がある",
    "仕事が終わりそう",
  ]) {
    assert.deepEqual(extractClosedTopics(text), [], text);
  }
});
