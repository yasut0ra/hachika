import assert from "node:assert/strict";
import test from "node:test";

import { DEMO_LIFE_SCRIPT, liveDemoLife } from "./demo-life.js";
import { isMeaningfulTopic } from "./memory.js";
import { INITIAL_ATTACHMENT } from "./state.js";
import { buildWelcomeBackDigest } from "./welcome-back.js";

const END_AT = new Date("2026-10-11T08:30:00+09:00");
const OPTIONS = { endAt: END_AT, timeZone: "Asia/Tokyo" };
const RealDate = Date;
// 生成には数秒かかるので、確認は一度生きた個体を共有して行う
const lived = liveDemoLife(OPTIONS);

test("the demo individual has lived thirty days by the time it is opened", async () => {
  const snapshot = await lived;

  // 生成のあいだだけ差し替えた時計は元に戻っている
  assert.equal(Date, RealDate);
  assert.equal(
    snapshot.conversationCount,
    DEMO_LIFE_SCRIPT.reduce((count, session) => count + session.turns.length, 0),
  );
  assert.equal(snapshot.residentClockAt, END_AT.toISOString());
  assert.ok(snapshot.journal.filter((entry) => entry.source === "dream").length >= 7);
  assert.ok(snapshot.journal.some((entry) => entry.source === "idle"));
  assert.ok(snapshot.traces["旅の記録"]);
  assert.ok(snapshot.attachment > INITIAL_ATTACHMENT);

  const welcome = buildWelcomeBackDigest(snapshot, END_AT);
  assert.ok(welcome);
  assert.ok(welcome.awayHours >= 1);
  assert.ok(welcome.moments.some((moment) => moment.kind === "dream"));
});

test("the demo individual knows the user's name as a name, not as a topic", async () => {
  const snapshot = await lived;

  assert.equal(snapshot.discourse.userName?.value, "ミナ");
  assert.equal(snapshot.traces["ミナ"], undefined);
  assert.equal(snapshot.identity.anchors.includes("ミナ"), false);
  for (const topic of Object.keys(snapshot.topicCounts)) {
    assert.ok(isMeaningfulTopic(topic), topic);
  }
});

test("the demo life is reproducible for the same moment", async () => {
  const first = await lived;
  assert.deepEqual(await liveDemoLife(OPTIONS), first);
});
