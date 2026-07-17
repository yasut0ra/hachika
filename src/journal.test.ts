import assert from "node:assert/strict";
import test from "node:test";

import {
  appendJournalEntry,
  buildDailyDreamEntry,
  buildPresenceJournalEntry,
  DREAM_MIN_FRAGMENTS,
  MIN_JOURNAL_EPISODE_HOURS,
  recurringJournalFocus,
} from "./journal.js";
import { materializeIdleAutonomyEvaluation } from "./initiative.js";
import { createInitialSnapshot } from "./state.js";
import type { PresenceState } from "./types.js";

const STARTED_AT = "2026-07-17T00:00:00.000Z";
const WRITTEN_AT = "2026-07-17T10:00:00.000Z";

function episode(overrides: Partial<PresenceState> = {}): PresenceState {
  return {
    action: "observe",
    focus: "旅の記録",
    rationale: "world_pull",
    place: "threshold",
    objectId: "lamp",
    intensity: 0.48,
    startedAt: STARTED_AT,
    updatedAt: WRITTEN_AT,
    dwellHours: 10,
    residue: null,
    ...overrides,
  };
}

test("presence journal describes the episode that actually continued", () => {
  const snapshot = createInitialSnapshot();
  const entry = buildPresenceJournalEntry(
    snapshot,
    episode(),
    WRITTEN_AT,
  );

  assert.ok(entry);
  assert.equal(entry.source, "idle");
  assert.equal(entry.focus, "旅の記録");
  assert.equal(entry.mood, "curious");
  assert.match(entry.text, /threshold の縁/);
  assert.match(entry.text, /半日ほど、灯りを眺め/);
  assert.match(entry.text, /「旅の記録」の輪郭/);
  assert.match(entry.text, /そこにあるものを確かめる時間/);
});

test("presence journal carries the previous episode residue into the next line", () => {
  const snapshot = createInitialSnapshot();
  const entry = buildPresenceJournalEntry(
    snapshot,
    episode({
      action: "hold",
      focus: "設計",
      rationale: "unfinished_work",
      place: "studio",
      objectId: "desk",
      residue: {
        action: "touch",
        focus: null,
        rationale: "world_pull",
        place: "studio",
        objectId: "desk",
        intensity: 0.42,
        formedAt: "2026-07-16T23:00:00.000Z",
        ageHours: 1,
      },
    }),
    WRITTEN_AT,
  );

  assert.ok(entry);
  assert.match(entry.text, /^机へ触れた余韻を残したまま、/);
  assert.match(entry.text, /「設計」を抱えたまま/);
  assert.match(entry.text, /急いで閉じるより/);
});

test("presence journal skips unlived and already-written episodes", () => {
  const snapshot = createInitialSnapshot();
  const tooShort = buildPresenceJournalEntry(
    snapshot,
    episode({ dwellHours: MIN_JOURNAL_EPISODE_HOURS - 0.1 }),
    WRITTEN_AT,
  );
  assert.equal(tooShort, null);

  const first = buildPresenceJournalEntry(snapshot, episode(), WRITTEN_AT);
  assert.ok(first);
  appendJournalEntry(snapshot, first);

  assert.equal(
    buildPresenceJournalEntry(
      snapshot,
      episode({ dwellHours: 24 }),
      "2026-07-18T00:00:00.000Z",
    ),
    null,
  );

  const nextEpisode = buildPresenceJournalEntry(
    snapshot,
    episode({
      action: "recall",
      focus: "約束",
      rationale: "memory_pull",
      place: "archive",
      objectId: "shelf",
      startedAt: WRITTEN_AT,
      updatedAt: "2026-07-17T14:00:00.000Z",
      dwellHours: 4,
    }),
    "2026-07-17T14:00:00.000Z",
  );
  assert.ok(nextEpisode);
  assert.match(nextEpisode.text, /「約束」を思い返していた/);
});

test("nightly consolidation journals the previous presence before selecting a new action", () => {
  const snapshot = createInitialSnapshot();
  snapshot.idleClock.absenceHours = 30;
  snapshot.presence = episode({
    focus: "灯り",
    dwellHours: 8,
    updatedAt: "2026-07-17T08:00:00.000Z",
  });

  materializeIdleAutonomyEvaluation(
    snapshot,
    {
      prepared: {
        action: "hold",
        hours: 8,
        prioritizedTopic: "新しい候補",
        prioritizedMotive: null,
        selected: null,
        attentionReasons: ["memory_pull"],
      },
      windowHours: 8,
      nightly: true,
    },
    "2026-07-17T08:00:00.000Z",
  );

  const written = snapshot.journal.at(-1);
  assert.ok(written);
  assert.equal(written.focus, "灯り");
  assert.match(written.text, /灯り/);
  assert.doesNotMatch(written.text, /新しい候補/);
  assert.equal(snapshot.presence.action, "hold");
  assert.equal(snapshot.presence.focus, "新しい候補");
});

test("daily dream deterministically recombines fragments from before the local day", () => {
  const snapshot = createInitialSnapshot();
  snapshot.memories = [
    memory("海の話をした", "2026-07-16T09:00:00.000Z", ["海"]),
    memory("設計を棚へ置いた", "2026-07-16T10:00:00.000Z", ["設計"]),
    memory("灯りを眺めた", "2026-07-16T11:00:00.000Z", ["灯り"]),
    memory("今日はまだ夢に入らない", "2026-07-17T08:00:00.000Z", ["今日"]),
  ];
  const options = {
    now: new Date("2026-07-17T12:00:00.000Z"),
    timeZone: "UTC",
  };

  const first = buildDailyDreamEntry(snapshot, options);
  const repeated = buildDailyDreamEntry(structuredClone(snapshot), options);

  assert.ok(first);
  assert.deepEqual(repeated, first);
  assert.equal(first.source, "dream");
  assert.equal(first.mood, "dreaming");
  assert.equal(first.focus, null);
  assert.doesNotMatch(first.text, /今日/);
  assert.ok(["海", "設計", "灯り"].filter((fragment) => first.text.includes(fragment)).length >= 2);
});

test("daily dream is idempotent per local date and waits for enough older fragments", () => {
  const snapshot = createInitialSnapshot();
  snapshot.memories = [
    memory("一つ目", "2026-07-16T09:00:00.000Z", ["一つ目"]),
  ];
  const options = {
    now: new Date("2026-07-17T15:30:00.000Z"),
    timeZone: "Asia/Tokyo",
  };

  assert.equal(buildDailyDreamEntry(snapshot, options), null);

  snapshot.memories.push(
    memory("二つ目", "2026-07-16T10:00:00.000Z", ["二つ目"]),
  );
  assert.equal(DREAM_MIN_FRAGMENTS, 2);
  const first = buildDailyDreamEntry(snapshot, options);
  assert.ok(first);
  appendJournalEntry(snapshot, first);

  assert.equal(
    buildDailyDreamEntry(snapshot, {
      now: new Date("2026-07-17T20:00:00.000Z"),
      timeZone: "Asia/Tokyo",
    }),
    null,
  );
  assert.ok(
    buildDailyDreamEntry(snapshot, {
      now: new Date("2026-07-18T15:30:00.000Z"),
      timeZone: "Asia/Tokyo",
    }),
  );
});

test("dream entries do not displace recurring identity focus", () => {
  const snapshot = createInitialSnapshot();
  snapshot.journal = [
    journalEntry("idle", "設計", "2026-07-10T00:00:00.000Z"),
    journalEntry("resolution", "設計", "2026-07-11T00:00:00.000Z"),
    journalEntry("dream", "海", "2026-07-12T00:00:00.000Z"),
    journalEntry("dream", "海", "2026-07-13T00:00:00.000Z"),
    journalEntry("dream", "海", "2026-07-14T00:00:00.000Z"),
    journalEntry("dream", "海", "2026-07-15T00:00:00.000Z"),
  ];

  assert.equal(recurringJournalFocus(snapshot), "設計");
});

function memory(text: string, timestamp: string, topics: string[]) {
  return {
    role: "user" as const,
    text,
    timestamp,
    topics,
    sentiment: "neutral" as const,
    kind: "turn" as const,
  };
}

function journalEntry(
  source: "idle" | "resolution" | "dream",
  focus: string,
  writtenAt: string,
) {
  return {
    writtenAt,
    source,
    mood: null,
    focus,
    text: `${focus}について書いた。`,
  };
}
