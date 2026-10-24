import type { HachikaSnapshot, WorldPlaceId } from "./types.js";

// おかえり: 最後に話してから今までに、会話の外で起きたことを短くまとめる。
// snapshot を読むだけで、状態の力学には触れない (観測系)
export type WelcomeBackMomentKind =
  | "message"
  | "aspiration"
  | "dream"
  | "event"
  | "journal"
  | "activity";

export interface WelcomeBackMoment {
  at: string;
  kind: WelcomeBackMomentKind;
  text: string;
  place: WorldPlaceId | null;
}

export interface WelcomeBackDigest {
  since: string;
  generatedAt: string;
  awayHours: number;
  awayLabel: string;
  moments: WelcomeBackMoment[];
  omittedCount: number;
}

export const WELCOME_BACK_MIN_AWAY_HOURS = 1;
export const WELCOME_BACK_MAX_MOMENTS = 8;

// 数が多いときに残す優先度。自分から話しかけたことや夢は、静かな過ごし方より先に残す
const MOMENT_PRIORITY: Record<WelcomeBackMomentKind, number> = {
  message: 0,
  aspiration: 0,
  dream: 1,
  event: 1,
  journal: 2,
  activity: 3,
};

export function buildWelcomeBackDigest(
  snapshot: HachikaSnapshot,
  now: Date = new Date(),
): WelcomeBackDigest | null {
  const since = snapshot.lastInteractionAt;
  const sinceMs = since ? Date.parse(since) : Number.NaN;

  if (!since || !Number.isFinite(sinceMs)) {
    return null;
  }

  const awayHours = (now.getTime() - sinceMs) / (60 * 60 * 1000);
  if (awayHours < WELCOME_BACK_MIN_AWAY_HOURS) {
    return null;
  }

  const candidates = dedupeMoments(
    collectMoments(snapshot).filter((moment) => {
      const atMs = Date.parse(moment.at);
      return Number.isFinite(atMs) && atMs > sinceMs && atMs <= now.getTime();
    }),
  );
  const kept = [...candidates]
    .sort(
      (left, right) =>
        MOMENT_PRIORITY[left.kind] - MOMENT_PRIORITY[right.kind] ||
        Date.parse(right.at) - Date.parse(left.at),
    )
    .slice(0, WELCOME_BACK_MAX_MOMENTS)
    .sort((left, right) => Date.parse(left.at) - Date.parse(right.at));

  return {
    since,
    generatedAt: now.toISOString(),
    awayHours: Math.round(awayHours * 100) / 100,
    awayLabel: formatAwayDuration(awayHours),
    moments: kept,
    omittedCount: candidates.length - kept.length,
  };
}

export function formatAwayDuration(hours: number): string {
  const wholeHours = Math.max(1, Math.floor(hours));
  const days = Math.floor(wholeHours / 24);
  const restHours = wholeHours % 24;

  if (days === 0) {
    return `${wholeHours}時間`;
  }

  // 数日空いたら、時間の端数はもう語らない
  if (days >= 3 || restHours === 0) {
    return `${days}日`;
  }

  return `${days}日と${restHours}時間`;
}

function collectMoments(snapshot: HachikaSnapshot): WelcomeBackMoment[] {
  const moments: WelcomeBackMoment[] = [];

  for (const event of snapshot.workshop.events) {
    if (event.actor === "hachika") {
      moments.push({ at: event.at, kind: "activity", text: event.text, place: "studio" });
    }
  }

  for (const entry of snapshot.autonomousFeed) {
    moments.push({
      at: entry.timestamp,
      kind: "message",
      text: entry.text,
      place: null,
    });
  }

  for (const aspiration of snapshot.aspirations) {
    moments.push({
      at: aspiration.formedAt,
      kind: "aspiration",
      text: `「${aspiration.theme}」を、この先も続けていきたいと思うようになった。`,
      place: null,
    });
  }

  for (const entry of snapshot.journal) {
    moments.push({
      at: entry.writtenAt,
      kind: entry.source === "dream" ? "dream" : "journal",
      text: entry.text,
      place: null,
    });
  }

  for (const event of snapshot.world.recentEvents) {
    // 到着や光の移ろいは毎日繰り返すので、その日だけの出来事に絞る
    if (event.kind !== "occurrence") {
      continue;
    }

    moments.push({
      at: event.timestamp,
      kind: "event",
      text: event.summary,
      place: event.place,
    });
  }

  for (const activity of snapshot.initiative.history) {
    // 自分から話しかけた言葉は autonomousFeed 側で拾う
    if (activity.kind === "proactive_emission") {
      continue;
    }

    moments.push({
      at: activity.timestamp,
      kind: "activity",
      text: activity.summary,
      place: activity.place ?? null,
    });
  }

  return moments.filter((moment) => moment.text.trim().length > 0);
}

// 同じ文が続けて書かれていることがあるので、種類と文が同じものは最新の1件にまとめる
function dedupeMoments(moments: WelcomeBackMoment[]): WelcomeBackMoment[] {
  const latest = new Map<string, WelcomeBackMoment>();

  for (const moment of moments) {
    const key = `${moment.kind}\u0000${moment.text.trim()}`;
    const existing = latest.get(key);

    if (!existing || Date.parse(moment.at) > Date.parse(existing.at)) {
      latest.set(key, moment);
    }
  }

  return [...latest.values()];
}
