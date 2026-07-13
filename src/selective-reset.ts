import { reseedDynamicsFromVisibleState } from "./dynamics.js";
import {
  extractDeclaredUserName,
  extractLocalTopics,
  isMeaningfulTopic,
} from "./memory.js";
import { createInitialSnapshot } from "./state.js";
import type {
  DiscourseClaim,
  HachikaSnapshot,
  MemoryEntry,
} from "./types.js";

const CONTAMINATED_TOPIC_PATTERN =
  /インターン|広告アルゴリズム|機械学習モデル|広告配信|DSP|FDE|35万円/u;
const RETAINED_USER_CONTEXT_PATTERN =
  /SF|短編集|本|読め|非日常|場所|ところ|色々更新|いろいろ更新/u;
const RETAINED_HACHIKA_CONTEXT_PATTERN =
  /場所をもう少し広げ|「やすとら」という名前|色々更新した/u;
const LOW_INFORMATION_PATTERN =
  /^(?:そうそう|はいはい|うん|はい|お話ししましょう(?: また)?|じゃあね)$/u;
const MIGRATION_TOPIC_STOPWORDS = new Set([
  "結構",
  "読める",
  "手頃",
  "ハマ",
  "日常",
  "味わえる",
  "どこか",
  "書き込",
  "差し込",
  "という",
  "現状",
  "まわり",
  "色々",
  "受け取",
]);

export interface SelectiveResetSummary {
  snapshot: HachikaSnapshot;
  recoveredUserName: string | null;
  retainedMemories: number;
  retainedClaims: number;
}

export function buildSelectiveMemoryReset(
  current: HachikaSnapshot,
  timestamp = new Date().toISOString(),
): SelectiveResetSummary {
  const next = createInitialSnapshot();
  const recoveredName = recoverDeclaredUserName(current);
  const recentClaims = current.discourse.recentClaims
    .filter(isRetainableClaim)
    .map((claim) => structuredClone(claim))
    .slice(-8);

  next.revision = current.revision;
  next.conversationCount = current.conversationCount;
  next.constitution = structuredClone(current.constitution);
  next.temperament = structuredClone(current.temperament);
  next.voice = structuredClone(current.voice);

  // Transient feelings return to this individual body's learned set points.
  next.state = { ...next.constitution.driveSetPoints };
  next.body = { ...next.constitution.bodySetPoints };
  next.urges = { ...next.constitution.urgeSetPoints };
  next.attachment = next.constitution.attachmentSetPoint;
  reseedDynamicsFromVisibleState(next);

  next.lastInteractionAt = timestamp;
  next.discourse.recentClaims = recentClaims;
  if (recoveredName) {
    next.discourse.userName = {
      kind: "user_name",
      value: recoveredName.value,
      confidence: 1,
      source: "user_assertion",
      updatedAt: recoveredName.timestamp,
    };
  }

  next.memories = collectRetainedMemories(current, recentClaims, recoveredName).slice(-16);
  rebuildLightweightTopicIndex(next);

  return {
    snapshot: next,
    recoveredUserName: recoveredName?.value ?? null,
    retainedMemories: next.memories.length,
    retainedClaims: recentClaims.length,
  };
}

function recoverDeclaredUserName(
  snapshot: HachikaSnapshot,
): { value: string; timestamp: string } | null {
  for (const memory of [...snapshot.memories].reverse()) {
    if (memory.role !== "user") {
      continue;
    }

    const value = extractDeclaredUserName(memory.text);
    if (value) {
      return { value, timestamp: memory.timestamp };
    }
  }

  return null;
}

function isRetainableClaim(claim: DiscourseClaim): boolean {
  const text = claim.text.normalize("NFKC").trim();
  return (
    text.length >= 4 &&
    !CONTAMINATED_TOPIC_PATTERN.test(text) &&
    !LOW_INFORMATION_PATTERN.test(text) &&
    RETAINED_USER_CONTEXT_PATTERN.test(text)
  );
}

function collectRetainedMemories(
  current: HachikaSnapshot,
  claims: DiscourseClaim[],
  recoveredName: { value: string; timestamp: string } | null,
): MemoryEntry[] {
  const retained: MemoryEntry[] = [];

  for (const claim of claims) {
    retained.push({
      role: "user",
      text: claim.text,
      timestamp: claim.updatedAt,
      topics: topicsForMemory(claim.text),
      sentiment: "positive",
      kind: "turn",
      weight: 1,
    });
  }

  for (const memory of current.memories) {
    if (CONTAMINATED_TOPIC_PATTERN.test(memory.text)) {
      continue;
    }

    const declaredName = memory.role === "user" ? extractDeclaredUserName(memory.text) : null;
    const keepUserName =
      declaredName !== null && recoveredName !== null && declaredName === recoveredName.value;
    const keepHachikaContext =
      memory.role === "hachika" && RETAINED_HACHIKA_CONTEXT_PATTERN.test(memory.text);

    if (!keepUserName && !keepHachikaContext) {
      continue;
    }

    retained.push({
      ...structuredClone(memory),
      topics: topicsForMemory(memory.text),
      kind: "turn",
      weight: 1,
    });
  }

  const unique = new Map<string, MemoryEntry>();
  for (const memory of retained) {
    unique.set(`${memory.role}\u0000${memory.text}`, memory);
  }

  return [...unique.values()].sort((left, right) =>
    left.timestamp.localeCompare(right.timestamp),
  );
}

function topicsForMemory(text: string): string[] {
  return extractLocalTopics(text)
    .filter(
      (topic) =>
        isMeaningfulTopic(topic) &&
        !MIGRATION_TOPIC_STOPWORDS.has(topic) &&
        !/[。、]/u.test(topic),
    )
    .slice(0, 6);
}

function rebuildLightweightTopicIndex(snapshot: HachikaSnapshot): void {
  for (const memory of snapshot.memories) {
    if (memory.role !== "user") {
      continue;
    }

    for (const topic of memory.topics) {
      snapshot.topicCounts[topic] = (snapshot.topicCounts[topic] ?? 0) + 1;
      if (RETAINED_USER_CONTEXT_PATTERN.test(memory.text)) {
        snapshot.preferences[topic] = Math.max(snapshot.preferences[topic] ?? 0, 0.16);
      }
    }
  }
}
