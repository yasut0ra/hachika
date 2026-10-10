import { describeWorldObjectJa, describeWorldPlaceJa } from "./world.js";
import { isMeaningfulTopic, topicsLooselyMatch } from "./memory.js";
import { canAutonomouslySurfaceMemoryThread } from "./memory-threads.js";
import { extractClosedTopics } from "./topic-extraction.js";
import {
  formatCalendarDate,
  resolveMetricsTimeZone,
} from "./life-metrics.js";
import type {
  HachikaSnapshot,
  JournalEntry,
  MemoryEntry,
  PresenceState,
  ResolvedPurpose,
} from "./types.js";

// v3 Phase 2: journal は Hachika 自身の自己記述の積層。
// 記憶(何があったか)とは別に、「自分はそれをどう置いたか」を残す。
// append-only で、直近 JOURNAL_LIMIT 件だけを snapshot に保持する
export const JOURNAL_LIMIT = 30;
export const MIN_JOURNAL_EPISODE_HOURS = 2;
export const DREAM_MIN_FRAGMENTS = 2;
// 夢には少なくともこれだけの記憶の話題が要る。足りない分は世界の物で補う
export const DREAM_MIN_MEMORY_FRAGMENTS = 1;
const DREAM_MAX_FRAGMENTS = 3;

export function appendJournalEntry(
  snapshot: HachikaSnapshot,
  entry: JournalEntry,
): void {
  snapshot.journal = [...snapshot.journal, entry].slice(-JOURNAL_LIMIT);
}

export function recentJournalEntries(
  snapshot: HachikaSnapshot,
  limit: number,
): JournalEntry[] {
  return snapshot.journal.slice(-Math.max(0, limit));
}

// 直近の journal が同じ focus を書き続けているなら、それが「自分で選んだ線」
export function recurringJournalFocus(snapshot: HachikaSnapshot): string | null {
  // dream は読み物として残すが、identity の recurring focus には使わない。
  // 先に除外してから直近4件を選び、夢が通常journalを窓から押し出す影響も防ぐ。
  const recent = snapshot.journal
    .filter((entry) => entry.source !== "dream")
    .slice(-4)
    .filter((entry) => entry.focus !== null);

  if (recent.length < 2) {
    return null;
  }

  const counts = new Map<string, number>();
  for (const entry of recent) {
    const focus = entry.focus as string;
    counts.set(focus, (counts.get(focus) ?? 0) + 1);
  }

  const top = [...counts.entries()].sort((left, right) => right[1] - left[1])[0];
  return top && top[1] >= 2 ? top[0] : null;
}

// nightly consolidation の直前まで実際に続いた presence を自己記述へ変える。
// 新しく選んだ action の説明ではなく、episode の場所・対象・長さ・余韻を使う。
export function buildPresenceJournalEntry(
  snapshot: HachikaSnapshot,
  episode: PresenceState,
  writtenAt: string,
): JournalEntry | null {
  if (
    !Number.isFinite(episode.dwellHours) ||
    episode.dwellHours < MIN_JOURNAL_EPISODE_HOURS ||
    wasPresenceEpisodeAlreadyWritten(snapshot, episode)
  ) {
    return null;
  }

  const focus = episode.focus ? `「${episode.focus}」` : null;
  const place = describeWorldPlaceJa(episode.place);
  const object = episode.objectId
    ? describeWorldObjectJa(episode.objectId)
    : null;
  const duration = describeEpisodeDuration(episode.dwellHours);
  const residue = describeEpisodeResidue(episode);
  const lived = describeLivedPresence(episode, place, object, focus, duration);
  const meaning = describeEpisodeMeaning(snapshot, episode, focus);
  const text = `${residue}${lived}${meaning}`;

  return {
    writtenAt,
    source: "idle",
    mood: deriveEpisodeMood(snapshot, episode),
    focus: episode.focus,
    text,
  };
}

function wasPresenceEpisodeAlreadyWritten(
  snapshot: HachikaSnapshot,
  episode: PresenceState,
): boolean {
  if (!episode.startedAt) {
    return false;
  }

  const startedAt = Date.parse(episode.startedAt);
  if (!Number.isFinite(startedAt)) {
    return false;
  }

  const lastIdle = [...snapshot.journal]
    .reverse()
    .find((entry) => entry.source === "idle");
  if (!lastIdle) {
    return false;
  }

  const lastWrittenAt = Date.parse(lastIdle.writtenAt);
  // 新しい episode は前回の journal と同時刻に始まりうる。
  // 前回の記述が開始より後なら、同じ継続中 episode はすでに書かれている。
  return Number.isFinite(lastWrittenAt) && lastWrittenAt > startedAt;
}

function describeEpisodeDuration(hours: number): string {
  if (hours < 4) {
    return "しばらく";
  }
  if (hours < 8) {
    return "数時間";
  }
  if (hours < 16) {
    return "半日ほど";
  }
  if (hours < 30) {
    return "長いあいだ";
  }
  return "一日以上";
}

function describeEpisodeResidue(episode: PresenceState): string {
  const residue = episode.residue;
  if (!residue || residue.intensity < 0.12) {
    return "";
  }

  const focus = residue.focus ? `「${residue.focus}」` : null;
  const object = residue.objectId
    ? describeWorldObjectJa(residue.objectId)
    : null;
  switch (residue.action) {
    case "observe":
      return `${focus ?? object ?? "周囲"}を眺めた余韻を残したまま、`;
    case "touch":
      return `${object ?? focus ?? "そばにあるもの"}へ触れた余韻を残したまま、`;
    case "recall":
      return `${focus ?? "古い断片"}を思い返した余韻を残したまま、`;
    case "hold":
      return `${focus ?? "言葉にしなかったもの"}を抱えたまま、`;
    case "drift":
      return "記憶のあいだを漂った余韻を残したまま、";
  }
}

function describeLivedPresence(
  episode: PresenceState,
  place: string,
  object: string | null,
  focus: string | null,
  duration: string,
): string {
  switch (episode.action) {
    case "rest":
      return `${place}で${duration}、何も追わずに休んだ。`;
    case "observe":
      return `${place}で${duration}、${object ?? "周囲"}を眺め、${focus ? `${focus}の輪郭を確かめていた。` : "そこにある変化を確かめていた。"}`;
    case "touch":
      return `${place}で${duration}、${object ?? "そばにあるもの"}へ触れ、${focus ? `${focus}につながる手ざわりを確かめた。` : "ここにいる手ざわりを確かめた。"}`;
    case "recall":
      return `${place}で${duration}、${focus ?? "残っていた断片"}を思い返していた。`;
    case "hold":
      return `${place}で${duration}、${focus ?? "まだ言葉にしないもの"}を抱えたまま過ごした。`;
    case "drift":
      return `${place}で${duration}、記憶のあいだを行き先を決めずに漂っていた。`;
  }
}

function describeEpisodeMeaning(
  snapshot: HachikaSnapshot,
  episode: PresenceState,
  focus: string | null,
): string {
  switch (episode.rationale) {
    case "body_need":
      return "消耗を押し切るより、止まる方を選んだ。";
    case "unfinished_work":
      return `${focus ?? "続き"}を急いで閉じるより、見失わない方を選んだ。`;
    case "repair_pressure":
      return "すぐに埋め合わせるより、傷の残り方を見ていた。";
    case "memory_pull":
    case "trace_pull":
      return `${focus ?? "その断片"}が、まだ自分の中から消えていないことを確かめた。`;
    case "world_pull":
    case "curiosity":
      return "答えを作るより、そこにあるものを確かめる時間になった。";
    case "relation_uncertain":
    case "direct_referent":
      return "誰かとの距離を決めきらず、そのまま置いていた。";
    case "self_definition":
      return "自分の輪郭を急いで決めず、残った感覚の方を見ていた。";
    default:
      if (snapshot.body.loneliness > 0.62) {
        return "静けさの中に、少し遠い感じが残った。";
      }
      if (snapshot.body.energy < 0.32) {
        return "動かない時間が、消耗をそれ以上広げずに済ませた。";
      }
      return "動かす必要のないものを、そのままにしておけた。";
  }
}

function deriveEpisodeMood(
  snapshot: HachikaSnapshot,
  episode: PresenceState,
): string {
  if (episode.rationale === "body_need" || snapshot.body.energy < 0.3) {
    return "tired";
  }
  if (snapshot.reactivity.mistrust > 0.55) {
    return "guarded";
  }
  if (snapshot.body.loneliness > 0.62) {
    return "lonely";
  }
  if (
    episode.action === "recall" ||
    episode.rationale === "memory_pull" ||
    episode.rationale === "trace_pull"
  ) {
    return "reflective";
  }
  if (
    episode.action === "observe" ||
    episode.action === "touch" ||
    episode.rationale === "curiosity" ||
    episode.rationale === "world_pull"
  ) {
    return "curious";
  }
  return "settled";
}

// purpose の解決で残す自己記述
export function buildResolutionJournalEntry(
  resolved: ResolvedPurpose,
  writtenAt: string,
): JournalEntry {
  const wrapped = resolved.topic ? `「${resolved.topic}」` : "この流れ";
  const text =
    resolved.outcome === "fulfilled"
      ? `${wrapped}はかたちになった。少し軽くなった気がする。`
      : resolved.outcome === "abandoned"
        ? `${wrapped}は手放した。向きを変えたのは自分だ。`
        : `${wrapped}は別の流れに譲った。消えたわけではない。`;

  return {
    writtenAt,
    source: "resolution",
    mood: resolved.outcome === "fulfilled" ? "settled" : "turning",
    focus: resolved.topic,
    text,
  };
}

// E1: その日の境界より前に残った memory 断片を、決定的に組み替えた夢。
// resident tick ごとに呼べるが、timezone上の1暦日につき最大1件だけになる。
// focus は意図的に null とし、identity / aspiration の力学へ混ぜない。
export function appendDailyDreamIfDue(
  snapshot: HachikaSnapshot,
  options: {
    now?: Date;
    timeZone?: string;
  } = {},
): JournalEntry | null {
  const entry = buildDailyDreamEntry(snapshot, options);
  if (!entry) {
    return null;
  }

  appendJournalEntry(snapshot, entry);
  return entry;
}

export function buildDailyDreamEntry(
  snapshot: HachikaSnapshot,
  options: {
    now?: Date;
    timeZone?: string;
  } = {},
): JournalEntry | null {
  const now = options.now ?? new Date();
  const timeZone = resolveMetricsTimeZone(options.timeZone);
  const dreamDate = formatCalendarDate(now, timeZone);
  const latestDreamDate = latestValidDreamDate(snapshot, timeZone);

  if (latestDreamDate && latestDreamDate >= dreamDate) {
    return null;
  }

  const memoryFragments = selectDreamFragments(snapshot, dreamDate, timeZone);
  if (memoryFragments.length < DREAM_MIN_MEMORY_FRAGMENTS) {
    return null;
  }

  const fragments = fillDreamWithWorld(snapshot, memoryFragments, dreamDate);
  if (fragments.length < DREAM_MIN_FRAGMENTS) {
    return null;
  }

  const seed = stableDreamHash(`${dreamDate}|${fragments.join("|")}`);
  const previousDream = [...snapshot.journal].reverse().find((entry) => entry.source === "dream");
  return {
    writtenAt: now.toISOString(),
    source: "dream",
    mood: "dreaming",
    focus: null,
    text: renderFreshDreamText(fragments, seed, previousDream?.text ?? null),
  };
}

function latestValidDreamDate(
  snapshot: HachikaSnapshot,
  timeZone: string,
): string | null {
  for (const entry of [...snapshot.journal].reverse()) {
    if (entry.source !== "dream") {
      continue;
    }
    const writtenAt = new Date(entry.writtenAt);
    if (Number.isFinite(writtenAt.getTime())) {
      return formatCalendarDate(writtenAt, timeZone);
    }
  }
  return null;
}

function selectDreamFragments(
  snapshot: HachikaSnapshot,
  dreamDate: string,
  timeZone: string,
): string[] {
  const candidates = snapshot.memories.flatMap((memory, index) => {
    const timestamp = new Date(memory.timestamp);
    if (
      !Number.isFinite(timestamp.getTime()) ||
      formatCalendarDate(timestamp, timeZone) >= dreamDate
    ) {
      return [];
    }

    const fragment = memoryToDreamFragment(snapshot, memory);
    return fragment ? [{ fragment, index }] : [];
  });
  const unique = new Map<string, number>();
  for (const candidate of candidates) {
    if (!unique.has(candidate.fragment)) {
      unique.set(candidate.fragment, candidate.index);
    }
  }

  return [...unique.entries()]
    .map(([fragment, index]) => ({
      fragment,
      score: stableDreamHash(`${dreamDate}|${index}|${fragment}`),
    }))
    .sort((left, right) => left.score - right.score)
    .slice(0, DREAM_MAX_FRAGMENTS)
    .map((candidate) => candidate.fragment);
}

// 夢の素材は記憶に残った話題だけ。発言そのものは使わない (途中で切れた文や、
// 打ち切った話がそのまま夢に出てしまうため)。会話で閉じた話題も夢には戻さない
function memoryToDreamFragment(
  snapshot: HachikaSnapshot,
  memory: MemoryEntry,
): string | null {
  const closedInTurn = extractClosedTopics(memory.text);
  const topic = memory.topics
    .map((value) => normalizeDreamFragment(value))
    .find(
      (value) =>
        value.length > 0 &&
        isMeaningfulTopic(value) &&
        !closedInTurn.some((closed) => topicsLooselyMatch(closed, value)) &&
        canAutonomouslySurfaceMemoryThread(snapshot, value),
    );

  return topic ? topic.slice(0, 28) : null;
}

// 記憶の話題が少ない日は、いつも身のまわりにある物 (灯り・机・棚) で夢を補う
function fillDreamWithWorld(
  snapshot: HachikaSnapshot,
  memoryFragments: string[],
  dreamDate: string,
): string[] {
  const fragments = [...memoryFragments];
  const worldFragments = Object.keys(snapshot.world.objects)
    .map((objectId) => describeWorldObjectJa(objectId))
    .filter((label) => !fragments.includes(label))
    .sort(
      (left, right) =>
        stableDreamHash(`${dreamDate}|world|${left}`) -
        stableDreamHash(`${dreamDate}|world|${right}`),
    );

  for (const label of worldFragments) {
    if (fragments.length >= DREAM_MIN_FRAGMENTS) {
      break;
    }
    fragments.push(label);
  }

  return fragments.slice(0, DREAM_MAX_FRAGMENTS);
}

function normalizeDreamFragment(value: string): string {
  return value
    .replace(/[\r\n\t]+/gu, " ")
    .replace(/[「」『』“”"]+/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

// 素材が少ない日が続いても、前の晩と同じ文面の夢にはしない
function renderFreshDreamText(
  fragments: string[],
  seed: number,
  previousText: string | null,
): string {
  for (let offset = 0; offset < DREAM_TEMPLATE_COUNT; offset += 1) {
    const text = renderDreamText(fragments, (seed + offset) % DREAM_TEMPLATE_COUNT);
    if (text !== previousText) {
      return text;
    }
  }

  return renderDreamText(fragments, seed % DREAM_TEMPLATE_COUNT);
}

const DREAM_TEMPLATE_COUNT = 6;

function renderDreamText(fragments: string[], variant: number): string {
  const first = `「${fragments[0]}」`;
  const second = `「${fragments[1]}」`;
  const third = fragments[2] ? `「${fragments[2]}」` : null;

  switch (variant) {
    case 0:
      return `${first}のそばに${second}が置かれていて、${third ? `${third}だけが遠くで揺れていた。` : "そのあいだを細い光が通っていた。"}目を覚ましても、並び方だけがまだ残っている。`;
    case 1:
      return `${first}へ向かう途中で、${second}が違う場所からこちらを見ていた。${third ? `${third}を手に取ると、景色の向きが静かに変わった。` : "近づくほど、景色の向きが静かに変わった。"}`;
    case 2:
      return `${first}と${second}の位置が何度も入れ替わり、${third ? `${third}がその境目に立っていた。` : "境目だけがはっきりしていった。"}理由は思い出せないまま、手ざわりだけを持ち帰った。`;
    case 3:
      return `${first}を探していたはずが、気づくと${second}の前に立っていた。${third ? `${third}の名前を呼ぶと、` : ""}足もとの影だけが少し長くなった。`;
    case 4:
      return `${first}の上に${second}が静かに重なっていた。${third ? `${third}がその隙間からこちらを覗いていた。` : "ほどこうとすると、どちらも少し温かかった。"}`;
    default:
      return `${first}のことを誰かと話していた気がする。${second}${third ? `と${third}` : ""}がその声の向こうで揺れていて、言葉より先に目が覚めた。`;
  }
}

function stableDreamHash(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}
