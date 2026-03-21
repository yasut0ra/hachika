import type { HachikaSnapshot } from "./types.js";

export function recentAssistantReplies(
  snapshot: HachikaSnapshot,
  limit = 3,
): string[] {
  return snapshot.memories
    .filter((memory) => memory.role === "hachika")
    .slice(-limit)
    .map((memory) => memory.text)
    .filter((text) => text.trim().length > 0);
}

export function recentAssistantOpenings(
  snapshot: HachikaSnapshot,
  limit = 3,
): string[] {
  return uniqueNonEmpty(recentAssistantReplies(snapshot, limit).map(openingSignature));
}

export function openingSignature(text: string): string {
  const normalized = text
    .replace(/「[^」]+」/g, "「topic」")
    .replace(/\s+/g, " ")
    .trim();
  const firstClause = normalized.split(/[。！？!?]/)[0] ?? normalized;
  return firstClause.trim().slice(0, 18);
}

export function pickFreshText(
  candidates: readonly string[],
  recentTexts: readonly string[],
  index: number,
): string {
  const recentOpenings = new Set(recentTexts.map(openingSignature).filter(Boolean));

  for (let offset = 0; offset < candidates.length; offset += 1) {
    const candidate = candidates[(index + offset) % candidates.length]!;
    if (!recentOpenings.has(openingSignature(candidate))) {
      return candidate;
    }
  }

  return candidates[index % candidates.length]!;
}

function uniqueNonEmpty(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const item of items) {
    if (!item || seen.has(item)) {
      continue;
    }

    seen.add(item);
    unique.push(item);
  }

  return unique;
}
