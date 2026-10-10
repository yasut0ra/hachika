import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { initSync, TokenizerBuilder, type Tokenizer } from "lindera-wasm-ipadic";

// 日本語の形態素解析 (IPADIC)。話題抽出が品詞を見られるようにする。
// 辞書は WASM に埋め込まれているので、オフラインで決定的に動く。
// lindera-wasm-ipadic を差し替えるときは、このモジュールだけを変えればよい
export interface MorphToken {
  surface: string;
  // IPADIC の品詞。辞書にない語は "UNK"
  pos: string;
  pos1: string;
  pos2: string;
  baseForm: string;
}

let tokenizer: Tokenizer | null = null;
let wasmMemory: ReturnType<typeof initSync>["memory"] | null = null;

export function tokenizeJapanese(text: string): MorphToken[] {
  const tokens = getTokenizer().tokenize(text);
  const result: MorphToken[] = [];

  for (const token of tokens) {
    const details = token.details;
    result.push({
      surface: token.surface,
      pos: details[0] ?? "UNK",
      pos1: details[1] ?? "*",
      pos2: details[2] ?? "*",
      baseForm: details[6] && details[6] !== "*" ? details[6] : token.surface,
    });
    // token は WASM 側のメモリを持つ。GC 任せにすると常駐中にメモリが膨らみ続けるので即座に解放する
    token.free();
  }

  return result;
}

function getTokenizer(): Tokenizer {
  if (tokenizer) {
    return tokenizer;
  }

  const require = createRequire(import.meta.url);
  wasmMemory = initSync({
    module: readFileSync(require.resolve("lindera-wasm-ipadic/lindera_wasm_ipadic_bg.wasm")),
  }).memory;
  const builder = new TokenizerBuilder();
  builder.setDictionary("embedded://ipadic");
  builder.setMode("normal");
  // build() は builder を消費するので、builder 側の free は不要
  tokenizer = builder.build();
  return tokenizer;
}

// 解析器が確保している WASM メモリの大きさ。token の解放漏れを検出するテスト用
export function morphologyMemoryBytes(): number {
  getTokenizer();
  return wasmMemory?.buffer.byteLength ?? 0;
}
