import { tokenizeJapanese, type MorphToken } from "./japanese-morphology.js";

// 話題の抽出と判定。形態素解析の品詞から名詞句だけを候補にし、
// 単独では話題にならない語 (会話そのもの・時・あいさつ) を外す。
// 精度は src/fixtures/topic-eval.json と `npm run eval:topics` で測る
export const TOPIC_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "this",
  "that",
  "you",
  "your",
  "are",
  "was",
  "were",
  "from",
  "have",
  "has",
  "into",
  "about",
  "just",
  "hello",
  "thanks",
  "then",
  "them",
  "they",
  "me",
  "my",
  "好き",
  "嫌い",
  "いい",
  "面白い",
  "助かる",
  "嬉しい",
  "つまらない",
  "最悪",
  "邪魔",
  "うるさい",
  "だし",
  "納得",
  "例えば",
  "たとえば",
  "なんでも",
  "なんでも聞",
  "なんでも聞いて",
  "ありがとう",
  "こんにちは",
  "こんばんは",
  "おはよう",
  "はじめまして",
  "よろしく",
  "お願い",
  "お願いします",
  "前回",
  "続き",
  "覚えて",
  "覚え",
  "として",
  "てい",
  "あなた",
  "君",
  "きみ",
  "私",
  "わたし",
  "私たち",
  "する",
  "して",
  "した",
  "いる",
  "ある",
  "こと",
  "それ",
  "これ",
  "その",
  "この",
  "あの",
  "そう",
  "どんな",
  "なんか",
  "じゃあ",
  "ひとつ",
  "二つ",
  "三つ",
  "分け",
  "会話",
  "話",
  "言い方",
  "雰囲気",
  "温度",
  "感じ",
  "ごめん",
  "さっき",
  "落ち",
  "着い",
  "て話",
  "かな",
  "って",
  "まずは",
  "いちばん",
  "ちゃんと",
  "ひとまず",
  "ここから",
  "始まり",
  "へー",
  "ふーん",
  "うん",
  "はい",
  "いや",
  "よかった",
  "お疲れ",
  "おつかれ",
  "ここ",
  "ため",
  "よう",
  "もの",
  "ので",
  "から",
  "まで",
  "です",
  "ます",
  "ない",
  "しない",
  "たい",
  "もう",
  "もっと",
  "少し",
  "もう少し",
  "では",
  "には",
  "へ",
  "を",
  "に",
  "が",
  "は",
  "と",
  "も",
  "で",
  "の",
]);

// 名詞ではあるが、単独では話題にならない語。「宇宙の話」のような複合語では外して前の名詞を残す
const LIGHT_NOUNS = new Set([
  "話",
  "話題",
  "意味",
  "別",
  "気",
  "一緒",
  "続き",
  "流れ",
  "感じ",
  "言い方",
  "雰囲気",
  "温度",
  "会話",
  "質問",
  "返事",
  "こと",
  "もの",
  "方",
  "人",
  "時",
  "日",
  "事",
  "物",
  "所",
  "前",
  "後",
  "次",
  "今",
  "中",
  "上",
  "下",
  "外",
  "間",
  "先",
  "度",
  "回",
  "点",
  "面",
  "側",
  "分",
  "目",
  "手",
  "他",
  "ほか",
  "みんな",
  "皆",
  "何",
  "誰",
  "久しぶり",
  "本当",
  "ほんと",
  "普通",
  "最初",
  "最後",
  "最近",
  "場合",
  "部分",
  "様子",
  "必要",
  "全部",
  "全然",
  "気持ち",
  "ため",
  "わけ",
  "はず",
  "つもり",
  "ところ",
]);

const CONTENT_NOUN_CLASSES = new Set(["一般", "固有名詞", "サ変接続"]);
const BREAKING_NOUN_CLASSES = new Set([
  "代名詞",
  "非自立",
  "特殊",
  "引用文字列",
  "動詞非自立的",
  "接続詞的",
]);
const FUNCTION_POS = new Set(["助詞", "助動詞", "接続詞", "感動詞", "記号", "フィラー"]);
const VERBALIZING_VERBS = new Set(["する", "できる", "される", "させる"]);
const LATIN_ONLY = /^[a-z0-9][a-z0-9 ._+#-]*$/u;
// 英字で打たれた相づち (yaa, hmm, lol など) は話題にしない
const LATIN_INTERJECTION =
  /^(?:y+a+|y+e+a*h*|y+e+s+|y+e+p+|n+o+|o+h*|a+h*|u+m+|h+m+|w+|l+o+l+|o+k+|k+|z+|(?:h+a+)+|(?:h+e+)+|w+o+w+)$/u;
const HIRAGANA_ONLY = /^[ぁ-ゖー]+$/u;
const KATAKANA_OR_KANJI = /[ァ-ヺー一-龠々]/u;
const SENTENCE_BREAK = /[。！？!?\n]/u;
const MAX_TOPICS = 6;
const MEMO_LIMIT = 8192;

interface NounUnit {
  surface: string;
  // 複合語を構成する内容語 (「インターン選考」なら インターン と 選考)。照合にだけ使う
  parts: string[];
  content: boolean;
  // 時の名詞や「第一章」のような数のまとまり。「夜の散歩」の前半としてだけ使う
  modifier: boolean;
  verbal: boolean;
}

const extractionMemo = new Map<string, readonly string[]>();
const termsMemo = new Map<string, readonly string[]>();
const meaningfulMemo = new Map<string, boolean>();

export function extractTopics(text: string): string[] {
  const memoized = extractionMemo.get(text);
  if (memoized) {
    return [...memoized];
  }

  const topics = extractTopicsUncached(text);
  remember(extractionMemo, text, topics);
  return [...topics];
}

export function isMeaningfulTopic(topic: string): boolean {
  const normalized = normalizeTopic(topic);
  const memoized = meaningfulMemo.get(normalized);
  if (memoized !== undefined) {
    return memoized;
  }

  const meaningful = judgeMeaningfulTopic(normalized);
  remember(meaningfulMemo, normalized, meaningful);
  return meaningful;
}

// 照合用: 話題に加えて、複合語を構成する内容語も返す。
// 「インターン選考」と「インターン業務」が同じ流れだと分かるようにするためで、話題としては保存しない
export function extractTopicTerms(text: string): string[] {
  const memoized = termsMemo.get(text);
  if (memoized) {
    return [...memoized];
  }

  const terms = extractTopics(text);

  for (const unit of readTextUnits(text).units) {
    for (const part of unit.parts) {
      const normalized = normalizeTopic(part);
      if (!terms.includes(normalized) && isMeaningfulTopic(normalized)) {
        terms.push(normalized);
      }
    }
  }

  remember(termsMemo, text, terms);
  return [...terms];
}

// 会話の中でその話題を閉じる言い方。「ダイエットはやめよう」のような生活の話は含めず、
// 話すこと自体を終える表現に限る
const TOPIC_CLOSURE_PATTERNS = [
  /(?:話|話題)(?:は|も|を|って)?もう(?:いい|十分|結構|終わり|おしまい|やめ)/u,
  /(?:話|話題)(?:は|も)?(?:終わり|おしまい)(?:に|だ|です|で|$)/u,
  /終わりにし(?:て|よう|たい)/u,
  /(?:について|のこと)はもう(?:いい|十分|結構)/u,
  /はもう(?:いい|十分|結構)(?:よ(?!ね)|や|から|です|$|!)/u,
  /(?:話|話題)(?:は|を)?やめ(?:よう|て|に)/u,
  /(?:話|話題)を(?:変え|かえ)/u,
  /(?:話したくない|話さなくていい|聞きたくない|触れないで|触れなくていい)/u,
] as const;

// 「その更新の話はもう終わりにして」の「更新」のように、閉じられた話題を返す。
// 閉じる言い方を含む文の話題だけを数えるので、「別の話をしよう。猫の話がしたい」の猫は閉じない
export function extractClosedTopics(text: string): string[] {
  const closed: string[] = [];

  for (const clause of text.normalize("NFKC").split(/[。!?\n]+/u)) {
    if (!TOPIC_CLOSURE_PATTERNS.some((pattern) => pattern.test(clause))) {
      continue;
    }

    for (const topic of extractTopics(clause)) {
      if (!closed.includes(topic)) {
        closed.push(topic);
      }
    }
  }

  return closed;
}

export function isTopicStopword(value: string): boolean {
  return TOPIC_STOPWORDS.has(value);
}

function extractTopicsUncached(text: string): string[] {
  const { units, links } = readTextUnits(text);
  const candidates: string[] = [];
  const linkedRight = new Set<number>();

  for (const [left, right] of links) {
    const leftUnit = units[left]!;
    const rightUnit = units[right]!;

    if (!rightUnit.content || rightUnit.verbal) {
      // 「宇宙の話」「海の近く」は後ろが話題にならないので、前の名詞だけを残す
      continue;
    }

    // 「海の近くの町」のように位置や時の語を挟む連なりは、ひとまとまりで残す
    const anchor = leftUnit.modifier
      ? links.find(([, previousRight]) => previousRight === left)?.[0]
      : undefined;
    if (anchor !== undefined && units[anchor]!.content) {
      candidates.push(`${units[anchor]!.surface}の${leftUnit.surface}の${rightUnit.surface}`);
    } else if (leftUnit.content || leftUnit.modifier) {
      candidates.push(`${leftUnit.surface}の${rightUnit.surface}`);
    }

    candidates.push(rightUnit.surface);
    linkedRight.add(right);
  }

  for (const [index, unit] of units.entries()) {
    if (unit.content && !unit.verbal && !linkedRight.has(index)) {
      candidates.push(unit.surface);
    }
  }

  // 「整理したい」のような動作は、ほかに名詞の話題がないときだけ話題として扱う
  if (!candidates.some((candidate) => isMeaningfulTopic(candidate))) {
    for (const unit of units) {
      if (unit.content && unit.verbal) {
        candidates.push(unit.surface);
      }
    }
  }

  const topics: string[] = [];
  for (const candidate of candidates) {
    const normalized = normalizeTopic(candidate);

    if (!topics.includes(normalized) && isMeaningfulTopic(normalized)) {
      topics.push(normalized);
    }

    if (topics.length >= MAX_TOPICS) {
      break;
    }
  }

  return topics;
}

// 空白をまたいで名詞句をつなげない (解析器は空白を落とすので、先に区切る)
function readTextUnits(text: string): { units: NounUnit[]; links: Array<[number, number]> } {
  const units: NounUnit[] = [];
  const links: Array<[number, number]> = [];

  for (const chunk of text.normalize("NFKC").split(/\s+/u)) {
    if (!chunk) {
      continue;
    }

    const read = readNounUnits(tokenizeJapanese(chunk));
    const offset = units.length;
    units.push(...read.units);
    links.push(
      ...read.links.map(([left, right]): [number, number] => [left + offset, right + offset]),
    );
  }

  return { units, links };
}

// 連続する名詞を一つの名詞句にまとめ、「AのB」のつながりを記録する
function readNounUnits(tokens: MorphToken[]): {
  units: NounUnit[];
  links: Array<[number, number]>;
} {
  const units: NounUnit[] = [];
  const links: Array<[number, number]> = [];
  let current: { tokens: MorphToken[]; surface: string } | null = null;
  let pendingLinkFrom: number | null = null;

  const flush = (next: MorphToken | undefined) => {
    if (!current) {
      return;
    }

    const last = current.tokens.at(-1)!;
    const content = current.tokens.some(isContentToken) || hasDerivedNounSuffix(current.tokens);
    units.push({
      surface: current.surface,
      parts: readUnitParts(current.tokens),
      content,
      modifier:
        !content &&
        current.tokens.some(
          (token) =>
            token.pos1 === "副詞可能" ||
            token.pos1 === "数" ||
            token.pos === "接頭詞" ||
            isNumericUnknown(token),
        ),
      verbal:
        last.pos1 === "サ変接続" &&
        next?.pos === "動詞" &&
        VERBALIZING_VERBS.has(next.baseForm),
    });
    current = null;
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    const next = tokens[index + 1];

    if (joinsNounUnit(token, current !== null, next)) {
      if (current === null && pendingLinkFrom !== null) {
        links.push([pendingLinkFrom, units.length]);
      }
      pendingLinkFrom = null;
      current ??= { tokens: [], surface: "" };
      current.tokens.push(token);
      // 「ミナさん」の敬称は話題の名前に含めない
      if (!(token.pos1 === "接尾" && token.pos2 === "人名")) {
        current.surface += token.surface;
      }
      continue;
    }

    const hadUnit = current !== null;
    flush(token);
    pendingLinkFrom =
      hadUnit && token.pos === "助詞" && token.pos1 === "連体化" ? units.length - 1 : null;
  }

  flush(undefined);
  return { units, links };
}

function joinsNounUnit(
  token: MorphToken,
  inUnit: boolean,
  next: MorphToken | undefined,
): boolean {
  if (token.pos === "UNK") {
    // 記号 (？など) は名詞句に入れない。数字は「6週間」のような数のまとまりを作る
    return (
      isContentUnknown(token.surface) ||
      isNumericUnknown(token) ||
      (inUnit && /^[0-9a-z]+$/iu.test(token.surface))
    );
  }

  if (token.pos === "接頭詞") {
    return next?.pos === "名詞" || next?.pos === "UNK";
  }

  if (token.pos !== "名詞" || BREAKING_NOUN_CLASSES.has(token.pos1)) {
    return false;
  }

  if (token.pos1 === "副詞可能") {
    // 「朝ごはん」「夏休み」のような一字の時の語だけが、直後の名詞と一語になる。
    // 「最近仕事が忙しい」の「最近」は文全体にかかるので、仕事とはつながない
    return (
      inUnit ||
      (next?.pos === "名詞" && token.surface.length === 1) ||
      (next?.pos === "助詞" && next.pos1 === "連体化")
    );
  }

  if (token.pos1 === "形容動詞語幹" || token.pos1 === "ナイ形容詞語幹") {
    // 「睡眠不足」の後半や「問題点」の前半にはなるが、「元気」「好き」単独では話題にしない
    return inUnit || next?.pos === "名詞";
  }

  if (token.pos1 === "接尾" || token.pos1 === "数") {
    return inUnit || token.pos1 === "数";
  }

  return true;
}

function isContentToken(token: MorphToken): boolean {
  if (token.pos === "UNK") {
    return isContentUnknown(token.surface);
  }

  return (
    token.pos === "名詞" &&
    CONTENT_NOUN_CLASSES.has(token.pos1) &&
    !LIGHT_NOUNS.has(token.surface) &&
    !(HIRAGANA_ONLY.test(token.surface) && token.surface.length <= 2)
  );
}

// 「問題点」「安全性」のように、語幹に接尾辞がついて名詞になったもの
function hasDerivedNounSuffix(tokens: MorphToken[]): boolean {
  return tokens.some(
    (token, index) =>
      index > 0 &&
      token.pos === "名詞" &&
      token.pos1 === "接尾" &&
      token.pos2 !== "助数詞" &&
      token.pos2 !== "人名" &&
      tokens[index - 1]!.pos === "名詞" &&
      tokens[index - 1]!.pos1 !== "数" &&
      !LIGHT_NOUNS.has(tokens[index - 1]!.surface),
  );
}

function readUnitParts(tokens: MorphToken[]): string[] {
  if (tokens.length < 2) {
    return [];
  }

  const parts: string[] = [];
  let part = "";

  for (const token of tokens) {
    if (isContentToken(token)) {
      if (part) {
        parts.push(part);
      }
      part = token.surface;
    } else if (part && token.pos1 === "接尾" && token.pos2 !== "人名") {
      part += token.surface;
    } else if (part) {
      parts.push(part);
      part = "";
    }
  }

  if (part) {
    parts.push(part);
  }

  return parts.filter((candidate) => candidate.length >= 2);
}

function isNumericUnknown(token: MorphToken): boolean {
  return token.pos === "UNK" && /^[0-9]+$/u.test(token.surface);
}

function isContentUnknown(surface: string): boolean {
  const normalized = surface.toLowerCase();

  if (LATIN_ONLY.test(normalized)) {
    return isLatinTopic(normalized);
  }

  return KATAKANA_OR_KANJI.test(surface);
}

function isLatinTopic(normalized: string): boolean {
  return (
    normalized.length >= 2 &&
    !/^[0-9 ._+#-]+$/u.test(normalized) &&
    !TOPIC_STOPWORDS.has(normalized) &&
    !LATIN_INTERJECTION.test(normalized)
  );
}

function judgeMeaningfulTopic(normalized: string): boolean {
  if (
    !normalized ||
    normalized.length > 40 ||
    SENTENCE_BREAK.test(normalized) ||
    TOPIC_STOPWORDS.has(normalized) ||
    LIGHT_NOUNS.has(normalized) ||
    /^[0-9]+$/u.test(normalized)
  ) {
    return false;
  }

  if (LATIN_ONLY.test(normalized)) {
    return isLatinTopic(normalized);
  }

  if (HIRAGANA_ONLY.test(normalized) && normalized.length <= 2) {
    return false;
  }

  const tokens = tokenizeJapanese(normalized);
  const first = tokens[0];
  const last = tokens.at(-1);

  if (!first || !last || FUNCTION_POS.has(first.pos)) {
    return false;
  }

  if (
    !(last.pos === "UNK" || last.pos === "名詞") ||
    (last.pos === "名詞" && BREAKING_NOUN_CLASSES.has(last.pos1))
  ) {
    return false;
  }

  // ひらがなだけの語は辞書の普通名詞 (ごはん等) のときだけ。「ありま」のような切れ端は人名にも読めてしまう
  if (HIRAGANA_ONLY.test(normalized)) {
    return tokens.length === 1 && first.pos === "名詞" && first.pos1 === "一般";
  }

  return tokens.some(isContentToken) || hasDerivedNounSuffix(tokens);
}

function normalizeTopic(topic: string): string {
  return topic.normalize("NFKC").trim().toLowerCase();
}

function remember<T>(memo: Map<string, T>, key: string, value: T): void {
  if (memo.size >= MEMO_LIMIT) {
    memo.clear();
  }

  memo.set(key, value);
}
