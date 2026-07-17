import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { loadSnapshot } from "./persistence.js";
import { createInitialSnapshot } from "./state.js";

const CURRENT_SNAPSHOT_VERSION = createInitialSnapshot().version;

test("migration fixtures hydrate representative historical snapshots into the current version", async (t) => {
  await t.test("version 13 preserves early memory and identity while adding later layers", async () => {
    const snapshot = await loadFixture("version-13.json");

    assert.equal(snapshot.version, CURRENT_SNAPSHOT_VERSION);
    assert.equal(snapshot.revision, 0);
    assert.equal(snapshot.conversationCount, 7);
    assert.ok(snapshot.attachment > createInitialSnapshot().attachment);
    assert.equal(snapshot.memories[0]?.text, "海辺の話を覚えていて");
    assert.deepEqual(snapshot.identity.anchors, ["海辺"]);
    assert.equal(snapshot.discourse.hachikaName?.value, "ハチカ");
    assert.deepEqual(snapshot.constitution, createInitialSnapshot().constitution);
    assert.deepEqual(snapshot.presence, createInitialSnapshot().presence);
  });

  await t.test("version 24 preserves world and discourse ownership data", async () => {
    const snapshot = await loadFixture("version-24.json");

    assert.equal(snapshot.version, CURRENT_SNAPSHOT_VERSION);
    assert.equal(snapshot.revision, 7);
    assert.equal(snapshot.world.currentPlace, "studio");
    assert.equal(snapshot.world.clockHour, 14.5);
    assert.equal(snapshot.dynamics.trust, 0.62);
    assert.equal(snapshot.discourse.userName?.value, "やすとら");
    assert.equal(snapshot.discourse.recentClaims[0]?.text, "私は静かな場所が好き");
    assert.equal(snapshot.discourse.openQuestions[0]?.askedBy, "user");
    assert.equal(snapshot.discourse.openQuestions[0]?.answerExpectedFrom, "hachika");
    assert.deepEqual(snapshot.journal, []);
    assert.deepEqual(snapshot.aspirations, []);
  });

  await t.test("version 32 preserves v3 history and defaults residue age", async () => {
    const snapshot = await loadFixture("version-32.json");

    assert.equal(snapshot.version, CURRENT_SNAPSHOT_VERSION);
    assert.equal(snapshot.revision, 12);
    assert.equal(snapshot.conversationCount, 42);
    assert.equal(snapshot.constitution.plasticity, 0.41);
    assert.equal(snapshot.journal[0]?.text, "手紙の続きを、棚の近くでまだ抱えている。");
    assert.equal(snapshot.aspirations[0]?.theme, "手紙");
    assert.deepEqual(snapshot.voice.preferredOpenings, ["少しだけ"]);
    assert.equal(snapshot.presence.action, "recall");
    assert.equal(snapshot.presence.residue?.action, "touch");
    assert.equal(snapshot.presence.residue?.ageHours, 0);
    assert.equal(snapshot.memoryThreadEvents[0]?.phase, "parked");
    assert.deepEqual(snapshot.identity.anchors, ["手紙"]);
  });
});

function loadFixture(name: string) {
  return loadSnapshot(
    fileURLToPath(new URL(`./fixtures/snapshots/${name}`, import.meta.url)),
  );
}
