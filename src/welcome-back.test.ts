import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { HachikaEngine } from "./engine.js";
import { createInitialSnapshot } from "./state.js";
import type { HachikaSnapshot, InitiativeActivity } from "./types.js";
import { buildUiState } from "./ui-state.js";
import {
  buildWelcomeBackDigest,
  formatAwayDuration,
  WELCOME_BACK_MAX_MOMENTS,
} from "./welcome-back.js";

const SINCE = "2026-10-08T12:00:00.000Z";
const NOW = new Date("2026-10-10T09:00:00.000Z");

test("there is no welcome back before the first conversation or after a short pause", () => {
  const newborn = createInitialSnapshot();
  assert.equal(buildWelcomeBackDigest(newborn, NOW), null);

  const snapshot = createInitialSnapshot();
  snapshot.lastInteractionAt = "2026-10-10T08:30:00.000Z";
  assert.equal(buildWelcomeBackDigest(snapshot, NOW), null);
});

test("welcome back tells what happened outside the conversation, in order", () => {
  const snapshot = createAwaySnapshot();
  snapshot.journal.push(
    journal("2026-10-08T11:00:00.000Z", "idle", "話す前のことなので数えない。"),
    journal("2026-10-08T22:00:00.000Z", "idle", "入口の縁で半日ほど、何も追わずに休んだ。"),
    journal("2026-10-09T15:05:00.000Z", "dream", "「海」と「灯り」の位置が入れ替わっていた。"),
  );
  snapshot.world.recentEvents.push(
    {
      timestamp: "2026-10-09T15:00:00.000Z",
      kind: "occurrence",
      place: "threshold",
      summary: "灯りが一度だけ小さく瞬いた。",
    },
    {
      timestamp: "2026-10-09T16:00:00.000Z",
      kind: "arrival",
      place: "archive",
      summary: "静かな時間のあと、archiveへ寄る。",
    },
  );
  snapshot.autonomousFeed.push({
    id: "feed-1",
    timestamp: "2026-10-10T01:00:00.000Z",
    mode: "proactive",
    source: "resident_loop",
    text: "旅の記録の続き、まだ机に置いてある。",
    motive: "continue_shared_work",
    topic: "旅の記録",
    traceTopic: "旅の記録",
    place: "studio",
    worldAction: "touch",
  });
  snapshot.initiative.history.push(
    activity("2026-10-09T06:00:00.000Z", "idle_consolidation", "静かな時間に灯りへ触れていた。"),
    activity("2026-10-10T01:00:00.000Z", "proactive_emission", "自分から流れをつなぎ直そうとした。"),
  );
  snapshot.aspirations.push({
    theme: "旅の記録",
    origin: "resolutions",
    strength: 0.4,
    formedAt: "2026-10-09T20:00:00.000Z",
    lastFedAt: "2026-10-09T20:00:00.000Z",
    waning: false,
  });

  const digest = buildWelcomeBackDigest(snapshot, NOW);

  assert.ok(digest);
  assert.equal(digest.since, SINCE);
  assert.equal(digest.awayHours, 45);
  assert.equal(digest.awayLabel, "1日と21時間");
  assert.equal(digest.omittedCount, 0);
  assert.deepEqual(
    digest.moments.map((moment) => [moment.kind, moment.text]),
    [
      ["journal", "入口の縁で半日ほど、何も追わずに休んだ。"],
      ["activity", "静かな時間に灯りへ触れていた。"],
      ["event", "灯りが一度だけ小さく瞬いた。"],
      ["dream", "「海」と「灯り」の位置が入れ替わっていた。"],
      ["aspiration", "「旅の記録」を、この先も続けていきたいと思うようになった。"],
      ["message", "旅の記録の続き、まだ机に置いてある。"],
    ],
  );
  assert.equal(digest.moments[2]?.place, "threshold");
});

test("repeated identical entries are told once", () => {
  const snapshot = createAwaySnapshot();
  for (const minute of ["00", "01", "02", "03"]) {
    snapshot.journal.push(
      journal(`2026-10-09T16:${minute}:00.000Z`, "idle", "「仕様」を抱えたまま、言わずに置いた。"),
    );
  }

  const digest = buildWelcomeBackDigest(snapshot, NOW);

  assert.equal(digest?.moments.length, 1);
  assert.equal(digest?.moments[0]?.at, "2026-10-09T16:03:00.000Z");
});

test("a long absence keeps messages and dreams before quiet activities", () => {
  const snapshot = createAwaySnapshot();
  for (let hour = 0; hour < 12; hour += 1) {
    snapshot.initiative.history.push(
      activity(
        `2026-10-09T${String(hour).padStart(2, "0")}:00:00.000Z`,
        "idle_reactivation",
        `静かな時間の${hour}番目の過ごし方。`,
      ),
    );
  }
  snapshot.journal.push(journal("2026-10-08T13:00:00.000Z", "dream", "古い夢。"));
  snapshot.autonomousFeed.push({
    id: "feed-1",
    timestamp: "2026-10-08T14:00:00.000Z",
    mode: "proactive",
    source: "resident_loop",
    text: "まだそこにいる?",
    motive: "deepen_relation",
    topic: null,
    traceTopic: null,
    place: null,
    worldAction: null,
  });

  const digest = buildWelcomeBackDigest(snapshot, NOW);

  assert.ok(digest);
  assert.equal(digest.moments.length, WELCOME_BACK_MAX_MOMENTS);
  assert.equal(digest.omittedCount, 14 - WELCOME_BACK_MAX_MOMENTS);
  assert.equal(digest.moments[0]?.text, "古い夢。");
  assert.equal(digest.moments[1]?.text, "まだそこにいる?");
  assert.equal(digest.moments.at(-1)?.text, "静かな時間の11番目の過ごし方。");
});

test("away durations read naturally", () => {
  assert.equal(formatAwayDuration(1.2), "1時間");
  assert.equal(formatAwayDuration(23.9), "23時間");
  assert.equal(formatAwayDuration(24), "1日");
  assert.equal(formatAwayDuration(50.5), "2日と2時間");
  assert.equal(formatAwayDuration(80), "3日");
});

test("the web ui state carries the welcome back digest", () => {
  const snapshot = createAwaySnapshot();
  snapshot.journal.push(journal("2026-10-09T15:05:00.000Z", "dream", "夢の断片。"));
  const engine = new HachikaEngine(snapshot);

  const ui = buildUiState(engine, mkdtempSync(join(tmpdir(), "hachika-ui-welcome-")), undefined, NOW);

  assert.equal(ui.welcomeBack?.since, SINCE);
  assert.equal(ui.welcomeBack?.moments[0]?.kind, "dream");
});

function createAwaySnapshot(): HachikaSnapshot {
  const snapshot = createInitialSnapshot();
  snapshot.lastInteractionAt = SINCE;
  snapshot.world.recentEvents = [];
  snapshot.initiative.history = [];
  return snapshot;
}

function journal(writtenAt: string, source: "idle" | "dream", text: string) {
  return {
    writtenAt,
    source,
    mood: source === "dream" ? "dreaming" : "settled",
    focus: null,
    text,
  };
}

function activity(
  timestamp: string,
  kind: InitiativeActivity["kind"],
  summary: string,
): InitiativeActivity {
  return {
    kind,
    autonomyAction: kind === "proactive_emission" ? "speak" : "hold",
    timestamp,
    motive: null,
    topic: null,
    traceTopic: null,
    blocker: null,
    place: "threshold",
    worldAction: null,
    maintenanceAction: null,
    reopened: false,
    hours: null,
    summary,
  };
}
