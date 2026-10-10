import assert from "node:assert/strict";
import test from "node:test";

import { morphologyMemoryBytes, tokenizeJapanese } from "./japanese-morphology.js";

test("tokenizeJapanese returns parts of speech from the embedded dictionary", () => {
  const tokens = tokenizeJapanese("短いSFが好き");

  assert.deepEqual(
    tokens.map((token) => [token.surface, token.pos, token.pos1]),
    [
      ["短い", "形容詞", "自立"],
      ["SF", "UNK", "*"],
      ["が", "助詞", "格助詞"],
      ["好き", "名詞", "形容動詞語幹"],
    ],
  );
  assert.equal(tokens[0]?.baseForm, "短い");
});

test("tokenizing repeatedly does not grow the analyzer memory", () => {
  const sentence = "旅の記録を一緒に三章へ整理したい。今日は第一章の見出しまで。";
  tokenizeJapanese(sentence);
  const before = morphologyMemoryBytes();

  // 常駐プロセスは数十日この解析器を使い続ける。token を解放し忘れると、ここで数十MB増える
  for (let index = 0; index < 10_000; index += 1) {
    tokenizeJapanese(sentence);
  }

  assert.ok(
    morphologyMemoryBytes() - before < 4 * 1024 * 1024,
    `analyzer memory grew by ${morphologyMemoryBytes() - before} bytes`,
  );
});
