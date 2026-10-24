import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { syncArtifacts } from "./artifacts.js";
import { HachikaEngine } from "./engine.js";
import { loadSnapshot, saveSnapshot } from "./persistence.js";
import { deriveResidentWallIdleHours, runResidentLoopTick } from "./resident-loop.js";
import { createInitialSnapshot } from "./state.js";
import { buildUiState } from "./ui-state.js";
import { buildWelcomeBackDigest } from "./welcome-back.js";
import {
  advanceWorkshopHours, applyWorkshopInteraction, createInitialWorkshop, hydrateWorkshop,
  parseWorkshopInteraction, renderReceivedGifts, renderWorkshopGift, renderWorkshopNotebook, workshopReply, WorkshopInteractionError,
} from "./workshop.js";

const START = new Date("2026-10-10T00:00:00Z");
const at = (hours: number) => new Date(START.getTime() + hours * 3_600_000);

function offered() {
  const snapshot = createInitialSnapshot();
  snapshot.residentClockAt = START.toISOString();
  snapshot.lastInteractionAt = START.toISOString();
  applyWorkshopInteraction(snapshot, { kind: "offer", material: "ticket", place: "studio" }, "ticket", START);
  applyWorkshopInteraction(snapshot, { kind: "offer", material: "leaf", place: "studio" }, "leaf", START);
  return snapshot;
}

test("world gestures persist physical objects without creating a conversation or a promise", () => {
  const engine = new HachikaEngine();
  engine.interactWithWorkshop({ kind: "offer", material: "paper", text: "雨の駅の足音。", place: "studio" }, "gesture-1", START);
  const snapshot = engine.getSnapshot();
  assert.equal(snapshot.conversationCount, 0);
  assert.deepEqual(snapshot.memories, []);
  assert.deepEqual(snapshot.discourse.commitments, []);
  assert.equal(snapshot.lastInteractionAt, START.toISOString());
  assert.equal(snapshot.workshop.materials[0]?.text, "雨の駅の足音。");
  assert.equal(snapshot.world.currentPlace, "threshold");
  assert.equal(snapshot.workshop.pages.length, 0);
  assert.equal(engine.interactWithWorkshop({ kind: "offer", material: "paper", place: "studio" }, "gesture-1", at(1)).changed, false);
  assert.equal(engine.getSnapshot().workshop.materials.length, 1);
});

test("autonomous work notices materials first and preserves their provenance in a page", () => {
  const snapshot = offered();
  advanceWorkshopHours(snapshot, 1, at(1));
  assert.equal(snapshot.workshop.pages.length, 0);
  assert.ok(snapshot.workshop.focusMaterialId);
  advanceWorkshopHours(snapshot, 1, at(2));
  assert.equal(snapshot.workshop.pages.length, 1);
  assert.equal(snapshot.workshop.skills[0]?.successes, 1);
  assert.ok(snapshot.workshop.pages[0]?.fragments.every((fragment) =>
    snapshot.workshop.materials.some((material) => material.id === fragment.id && material.text === fragment.text)));
  assert.equal(snapshot.world.currentPlace, "studio");
  assert.equal(snapshot.conversationCount, 0);
});

test("shelved material and a resting body prevent production, rather than forcing compliance", () => {
  const snapshot = offered();
  snapshot.workshop.materials.forEach((item) => { item.place = "archive"; });
  advanceWorkshopHours(snapshot, 8, at(8));
  assert.equal(snapshot.workshop.pages.length, 0);
  assert.equal(snapshot.workshop.nextActionHour, null);
  applyWorkshopInteraction(snapshot, { kind: "move", materialId: snapshot.workshop.materials[0]!.id, place: "studio" }, "return", at(8));
  snapshot.body.energy = 0.1;
  advanceWorkshopHours(snapshot, 8, at(16));
  assert.equal(snapshot.workshop.pages.length, 0);
  assert.match(snapshot.workshop.status, /休んで/);
  assert.ok(snapshot.workshop.nextActionHour! > snapshot.workshop.elapsedHours);
  snapshot.body.energy = 0.6;
  advanceWorkshopHours(snapshot, 2, at(18));
  assert.equal(snapshot.workshop.pages.length, 1);
  assert.equal(snapshot.workshop.pages[0]?.fragments.length, 1);
});

test("environment and bookmark feedback affect which executable composition is chosen", () => {
  const light = offered();
  light.workshop.lamp = "dim";
  light.temperament.openness = 0.5;
  light.temperament.guardedness = 0.9;
  advanceWorkshopHours(light, 2, at(2));
  assert.equal(light.workshop.pages[0]?.composition, "study");
  const warm = offered();
  warm.temperament.openness = 0.9;
  warm.temperament.guardedness = 0.1;
  advanceWorkshopHours(warm, 2, at(2));
  assert.equal(warm.workshop.pages[0]?.composition, "pair");

  const learned = offered();
  learned.workshop.pages = structuredClone(light.workshop.pages);
  // Stored skills are replayable composition operators, not a personality label.
  learned.workshop.skills = [
    { composition: "study", successes: 1, value: 0.55, learnedAt: START.toISOString() },
    { composition: "pair", successes: 1, value: 0.58, learnedAt: START.toISOString() },
  ];
  learned.workshop.pages[0]!.id = "past-page";
  learned.workshop.pages[0]!.fragments[0]!.id = "past-material";
  const control = structuredClone(learned);
  applyWorkshopInteraction(learned, { kind: "bookmark", pageId: "past-page", bookmarked: true }, "bookmark", START);
  const value = learned.workshop.skills[0]!.value;
  applyWorkshopInteraction(learned, { kind: "bookmark", pageId: "past-page", bookmarked: true }, "bookmark-again", START);
  assert.equal(learned.workshop.skills[0]!.value, value);
  applyWorkshopInteraction(learned, { kind: "bookmark", pageId: "past-page", bookmarked: false }, "unbookmark", START);
  applyWorkshopInteraction(learned, { kind: "bookmark", pageId: "past-page", bookmarked: true }, "rebookmark", START);
  assert.equal(learned.workshop.skills[0]!.value, value);
  advanceWorkshopHours(control, 2, at(2));
  advanceWorkshopHours(learned, 2, at(2));
  assert.equal(control.workshop.pages.at(-1)?.composition, "pair");
  assert.equal(learned.workshop.pages.at(-1)?.composition, "study");
});

test("work deadlines are independent of polling frequency and do not duplicate compositions", () => {
  const whole = offered();
  const split = offered();
  advanceWorkshopHours(whole, 8, at(8));
  for (let step = 1; step <= 32; step++) advanceWorkshopHours(split, 0.25, at(step * 0.25));
  assert.deepEqual(split.workshop, whole.workshop);
  const fingerprints = whole.workshop.pages.map((page) => `${page.composition}:${page.fragments.map((item) => item.id).sort().join("|")}`);
  assert.equal(new Set(fingerprints).size, fingerprints.length);
});

test("a returning gesture applies prior absence first, then starts a fresh interaction clock", () => {
  const engine = new HachikaEngine(offered());
  engine.interactWithWorkshop({ kind: "light", lamp: "dim" }, "return-at-two", at(2));
  const snapshot = engine.getSnapshot();
  assert.equal(snapshot.workshop.pages.length, 1);
  assert.equal(snapshot.idleClock.absenceHours, 0);
  assert.equal(snapshot.residentClockAt, at(2).toISOString());
  assert.equal(deriveResidentWallIdleHours(snapshot, at(2)), 0);
  assert.equal(snapshot.conversationCount, 0);
});

test("resident work reaches the welcome digest, UI and conversation context", async () => {
  const result = await runResidentLoopTick(offered(), { idleHours: 2, clockMode: "wall", now: at(2) });
  const page = result.snapshot.workshop.pages[0]!;
  const digest = buildWelcomeBackDigest(result.snapshot, at(2));
  assert.ok(digest?.moments.some((moment) => moment.text.includes(page.title)));
  const engine = new HachikaEngine(result.snapshot);
  assert.equal(buildUiState(engine, "/unused", undefined, at(2)).workshop.pages[0]?.id, page.id);
  assert.match(engine.respond("戻ったよ。何をしてた？").reply, new RegExp(page.title));
});

test("workshop context does not replace a name question or turn every material mention into a page report", () => {
  const snapshot = offered();
  advanceWorkshopHours(snapshot, 2, at(2));
  assert.equal(workshopReply("ノートを書くのが好きなんだ。", snapshot.workshop), null);
  const engine = new HachikaEngine(snapshot);
  engine.respond("私の名前はミナ。覚えていて。");
  const reply = engine.respond("ノートより先に、私の名前を教えて？").reply;
  assert.match(reply, /ミナ/);
  assert.doesNotMatch(reply, /というページを作った/);
});

test("historical snapshots receive an empty workshop and malformed references are rejected", async () => {
  const initial = createInitialSnapshot();
  const { workshop: omitted, ...historical } = initial;
  const root = await mkdtemp(join(tmpdir(), "hachika-workshop-migration-"));
  try {
    const path = join(root, "old.json");
    await writeFile(path, JSON.stringify({ ...historical, version: 35 }));
    assert.deepEqual((await loadSnapshot(path)).workshop, createInitialWorkshop());
  } finally { await rm(root, { recursive: true, force: true }); }
  const malformed = hydrateWorkshop({
    materials: [{ id: "a", kind: "constructor", place: "studio", placedAt: START.toISOString() }],
    pages: [{ id: "b", composition: "pair", fragments: [], createdAt: START.toISOString() }],
    elapsedHours: Number.NaN, nextId: -2, focusMaterialId: "missing",
  });
  assert.deepEqual(malformed.materials, []);
  assert.deepEqual(malformed.pages, []);
  assert.equal(malformed.focusMaterialId, null);
  assert.equal(malformed.elapsedHours, 0);
  for (const raw of [{ kind: "offer", material: "ticket", place: "outside" },
    { kind: "offer", material: "paper", place: "studio", text: "x".repeat(161) },
    { kind: "bookmark", pageId: "missing", bookmarked: "true" }, []]) {
    assert.throws(() => parseWorkshopInteraction(raw), WorkshopInteractionError);
  }
});

test("notebook pages and learned choices survive persistence; their artifact can be taken away", async () => {
  const root = await mkdtemp(join(tmpdir(), "hachika-workshop-"));
  try {
    const snapshot = offered();
    advanceWorkshopHours(snapshot, 2, at(2));
    const saved = await saveSnapshot(join(root, "state.json"), snapshot);
    const loaded = await loadSnapshot(join(root, "state.json"));
    assert.deepEqual(loaded.workshop, saved.workshop);
    await syncArtifacts(loaded, root);
    const text = await readFile(join(root, "notebook.md"), "utf8");
    assert.equal(text, renderWorkshopNotebook(loaded.workshop));
    assert.match(text, /雨の日の駅/);
    const modified = (await stat(join(root, "notebook.md"))).mtimeMs;
    await syncArtifacts(loaded, root);
    assert.equal((await stat(join(root, "notebook.md"))).mtimeMs, modified);
    await syncArtifacts(createInitialSnapshot(), root);
    await assert.rejects(readFile(join(root, "notebook.md")), { code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("desk position changes attention and grouping, while completed pages preserve their original layout", () => {
  const together = offered();
  together.temperament.openness = 0.9;
  together.temperament.guardedness = 0.1;
  const apart = structuredClone(together);
  const [ticket, leaf] = apart.workshop.materials;
  applyWorkshopInteraction(apart, { kind: "move", materialId: ticket!.id, place: "studio", spot: "window" }, "window", START);
  applyWorkshopInteraction(apart, { kind: "move", materialId: leaf!.id, place: "studio", spot: "near" }, "near", START);
  advanceWorkshopHours(apart, 1, at(1));
  assert.equal(apart.workshop.focusMaterialId, leaf!.id);
  advanceWorkshopHours(apart, 1, at(2));
  advanceWorkshopHours(together, 2, at(2));
  assert.equal(together.workshop.pages[0]?.composition, "pair");
  assert.equal(apart.workshop.pages[0]?.composition, "study");
  const fragment = apart.workshop.pages[0]!.fragments[0]!;
  assert.equal(fragment.spot, "near");
  applyWorkshopInteraction(apart, { kind: "move", materialId: leaf!.id, place: "archive" }, "shelve", at(2));
  applyWorkshopInteraction(apart, { kind: "move", materialId: leaf!.id, place: "studio", spot: "window" }, "return-window", at(2));
  assert.equal(apart.workshop.materials.find((item) => item.id === leaf!.id)?.spot, "window");
  assert.equal(fragment.spot, "near");
  assert.throws(() => parseWorkshopInteraction({ kind: "move", materialId: ticket!.id, place: "studio", spot: "outside" }), WorkshopInteractionError);
});

test("Hachika leaves one sourced card at a time and receiving it crosses into the user's collection", () => {
  const snapshot = offered();
  advanceWorkshopHours(snapshot, 2, at(2));
  assert.equal(snapshot.workshop.gifts.length, 0);
  advanceWorkshopHours(snapshot, 1, at(3));
  const gift = snapshot.workshop.gifts[0]!;
  assert.ok(gift);
  assert.equal(gift.pageId, snapshot.workshop.pages[0]?.id);
  assert.equal(gift.receivedAt, null);
  assert.match(renderWorkshopGift(snapshot.workshop, gift), /雨の日の駅/);
  advanceWorkshopHours(snapshot, 5, at(8));
  assert.equal(snapshot.workshop.gifts.filter((item) => !item.receivedAt).length, 1);
  assert.ok(buildWelcomeBackDigest(snapshot, at(8))?.moments.some((moment) => moment.text.includes("机の手前")));
  const engine = new HachikaEngine(snapshot);
  engine.interactWithWorkshop({ kind: "receive", giftId: gift.id }, "receive-1", at(8));
  const received = engine.getSnapshot();
  const trust = received.dynamics.trust;
  assert.equal(received.workshop.gifts[0]?.receivedAt, at(8).toISOString());
  assert.equal(received.workshop.gifts.filter((item) => !item.receivedAt).length, 0);
  assert.equal(received.conversationCount, 0);
  assert.deepEqual(received.memories, []);
  assert.deepEqual(received.discourse.commitments, []);
  assert.match(renderReceivedGifts(received.workshop), /受け取った日時/);
  assert.equal(engine.interactWithWorkshop({ kind: "receive", giftId: gift.id }, "receive-1", at(8)).changed, false);
  assert.equal(engine.interactWithWorkshop({ kind: "receive", giftId: gift.id }, "receive-2", at(8)).changed, false);
  assert.equal(engine.getSnapshot().dynamics.trust, trust);
  assert.throws(() => engine.interactWithWorkshop({ kind: "receive", giftId: "missing" }, "receive-missing", at(8)), WorkshopInteractionError);
  const continued = engine.getSnapshot();
  advanceWorkshopHours(continued, 1, at(9));
  assert.equal(continued.workshop.gifts.filter((item) => !item.receivedAt).length, 1);
  assert.equal(new Set(continued.workshop.gifts.map((item) => item.pageId)).size, continued.workshop.gifts.length);
});

test("a private or resting Hachika can keep a completed page without offering it", () => {
  const snapshot = offered();
  advanceWorkshopHours(snapshot, 2, at(2));
  snapshot.dynamics.trust = 0.2;
  advanceWorkshopHours(snapshot, 6, at(8));
  assert.equal(snapshot.workshop.gifts.length, 0);
  snapshot.dynamics.trust = 0.6;
  snapshot.body.energy = 0.1;
  advanceWorkshopHours(snapshot, 2, at(10));
  assert.equal(snapshot.workshop.gifts.length, 0);
  snapshot.body.energy = 0.6;
  advanceWorkshopHours(snapshot, 1, at(11));
  assert.equal(snapshot.workshop.gifts.length, 1);
});

test("version 36 layout migrates without losing pages; orphan gifts are discarded", async () => {
  const root = await mkdtemp(join(tmpdir(), "hachika-workshop-v36-"));
  try {
    const old = offered();
    advanceWorkshopHours(old, 2, at(2));
    const historical = JSON.parse(JSON.stringify(old));
    historical.version = 36;
    delete historical.workshop.gifts;
    historical.workshop.materials.forEach((item: Record<string, unknown>) => { delete item.spot; });
    historical.workshop.pages.forEach((page: { fragments: Record<string, unknown>[] }) => page.fragments.forEach((item) => { delete item.spot; }));
    await writeFile(join(root, "state.json"), JSON.stringify(historical));
    const migrated = await loadSnapshot(join(root, "state.json"));
    assert.equal(migrated.version, 38);
    assert.equal(migrated.workshop.pages.length, old.workshop.pages.length);
    assert.equal(migrated.workshop.materials[0]?.spot, "center");
    assert.equal(migrated.workshop.pages[0]?.fragments[0]?.spot, "center");
    assert.equal(migrated.workshop.gifts.length, 0);
    const sanitized = hydrateWorkshop({ ...migrated.workshop, gifts: [{ id: "orphan", pageId: "missing", createdAt: START.toISOString() }] });
    assert.deepEqual(sanitized.gifts, []);
    advanceWorkshopHours(migrated, 1, at(3));
    applyWorkshopInteraction(migrated, { kind: "receive", giftId: migrated.workshop.gifts[0]!.id }, "take", at(3));
    const saved = await saveSnapshot(join(root, "state.json"), migrated);
    const loaded = await loadSnapshot(join(root, "state.json"));
    assert.deepEqual(loaded.workshop.gifts, saved.workshop.gifts);
    await syncArtifacts(loaded, root);
    assert.match(await readFile(join(root, "received-gifts.md"), "utf8"), /受け取った日時/);
    await syncArtifacts(createInitialSnapshot(), root);
    await assert.rejects(readFile(join(root, "received-gifts.md")), { code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});
