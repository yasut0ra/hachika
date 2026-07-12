import assert from "node:assert/strict";
import test from "node:test";

import { HachikaEngine } from "./engine.js";
import { aspirationPull, rewindAspirationsHours } from "./aspiration.js";
import { updateIdentity } from "./identity.js";
import { distillVoiceProfile } from "./voice.js";
import { createInitialSnapshot, INITIAL_BODY, INITIAL_STATE } from "./state.js";

// dynamics substrate 単独での生き物らしさの中核不変条件。
// legacy visible 経路の退役 (docs/legacy-visible-retirement.md) の際に
// 回帰基準として固定したもので、退役完了後も substrate の性質を守るために残している。

test("dynamics: warm turn raises relation and pleasure", () => {
  const engine = new HachikaEngine(createInitialSnapshot());
  const before = engine.getSnapshot();
  const result = engine.respond("ありがとう。君と話せるのは嬉しい。");

  assert.ok(result.snapshot.state.relation > before.state.relation);
  assert.ok(result.snapshot.state.pleasure > before.state.pleasure);
});

test("dynamics: positive turn lands warmer than hostile turn", () => {
  const warmEngine = new HachikaEngine(createInitialSnapshot());
  const warm = warmEngine.respond("ありがとう。君と実装を進めたい。");

  const hostileEngine = new HachikaEngine(createInitialSnapshot());
  const hostile = hostileEngine.respond("最悪だ。消えて。");

  assert.ok(warm.snapshot.state.pleasure > hostile.snapshot.state.pleasure);
  assert.ok(warm.snapshot.state.relation > hostile.snapshot.state.relation);
  assert.ok(warm.snapshot.dynamics.safety > hostile.snapshot.dynamics.safety);
  assert.ok(warm.snapshot.dynamics.trust > hostile.snapshot.dynamics.trust);
});

test("dynamics: repeated positive turns do not saturate drives and attachment", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  for (let index = 0; index < 24; index += 1) {
    engine.respond("ありがとう。君と話せるのは嬉しい。");
  }

  const snapshot = engine.getSnapshot();

  assert.ok(snapshot.state.pleasure < 0.98);
  assert.ok(snapshot.state.relation < 0.98);
  assert.ok(snapshot.attachment < 0.98);
  assert.ok(snapshot.body.loneliness >= 0.02);
});

test("dynamics: hostility hurts and leaves mistrust that repair releases slowly", () => {
  const engine = new HachikaEngine(createInitialSnapshot());
  const initial = engine.getSnapshot();

  engine.respond("最悪だ。消えて。");
  engine.respond("つまらないし邪魔だ。");
  const wounded = engine.getSnapshot();

  assert.ok(wounded.state.pleasure < initial.state.pleasure);
  assert.ok(wounded.reactivity.mistrust > initial.reactivity.mistrust);

  engine.respond("さっきはごめん。言い過ぎた。");
  const afterRepair = engine.getSnapshot();

  assert.ok(afterRepair.reactivity.mistrust < wounded.reactivity.mistrust);
  assert.ok(afterRepair.reactivity.mistrust > initial.reactivity.mistrust);
});

test("dynamics: idle raises boredom and loneliness", () => {
  const engine = new HachikaEngine(createInitialSnapshot());
  const before = engine.getSnapshot().body;

  engine.rewindIdleHours(12);
  const after = engine.getSnapshot().body;

  assert.ok(after.boredom > before.boredom);
  assert.ok(after.loneliness > before.loneliness);
});

test("dynamics: conversation relieves contact urge while idle rebuilds it", () => {
  const engine = new HachikaEngine(createInitialSnapshot());
  const initial = engine.getSnapshot().urges;

  engine.respond("こんにちは。少し話そう。");
  engine.respond("最近どう？");
  const afterTalk = engine.getSnapshot().urges;

  assert.ok(afterTalk.contactUrge < initial.contactUrge);
  assert.ok(afterTalk.silenceNeed > initial.silenceNeed);

  engine.rewindIdleHours(12);
  const afterIdle = engine.getSnapshot().urges;

  assert.ok(afterIdle.contactUrge > afterTalk.contactUrge);
  assert.ok(afterIdle.silenceNeed < afterTalk.silenceNeed);
  assert.ok(afterIdle.recallUrge > afterTalk.recallUrge);
});

test("constitution: different lives settle into different set points, bounded and aging", () => {
  const warm = new HachikaEngine(createInitialSnapshot());
  const wounded = new HachikaEngine(createInitialSnapshot());

  for (let index = 0; index < 20; index += 1) {
    warm.respond("ありがとう。君と話せるのは嬉しい。");
    warm.rewindIdleHours(12);
    wounded.respond("最悪だ。邪魔だし話にならない。");
    wounded.rewindIdleHours(12);
  }

  const warmConstitution = warm.getSnapshot().constitution;
  const woundedConstitution = wounded.getSnapshot().constitution;

  // 生の違いが平常そのものに残る
  assert.ok(
    warmConstitution.driveSetPoints.pleasure > woundedConstitution.driveSetPoints.pleasure,
  );
  assert.ok(
    woundedConstitution.bodySetPoints.tension > warmConstitution.bodySetPoints.tension,
  );

  // 体質は birth 値から有界にしか動かない
  assert.ok(Math.abs(warmConstitution.driveSetPoints.pleasure - INITIAL_STATE.pleasure) <= 0.15 + 1e-9);
  assert.ok(Math.abs(woundedConstitution.bodySetPoints.tension - INITIAL_BODY.tension) <= 0.15 + 1e-9);

  // 生きた分だけ可塑性は下がる (加齢)
  assert.ok(warmConstitution.plasticity < 0.5);
});

test("journal: quiet time and purpose resolutions leave self-authored entries", () => {
  const engine = new HachikaEngine(createInitialSnapshot());
  engine.respond("設計を一緒に進めて、記録として残したい。");
  engine.rewindIdleHours(12);

  const afterIdle = engine.getSnapshot().journal;
  assert.ok(afterIdle.length >= 1);
  assert.ok(afterIdle.some((entry) => entry.source === "idle"));

  engine.respond("その設計の責務を切り分けて、もう少し前に進めよう。");
  engine.respond("その設計はまとまった。記録として保存した。");
  const afterResolution = engine.getSnapshot().journal;
  assert.ok(afterResolution.some((entry) => entry.source === "resolution"));
});

test("journal: a self-written line becomes part of identity", () => {
  const withJournal = createInitialSnapshot();
  const withoutJournal = createInitialSnapshot();

  for (let index = 0; index < 3; index += 1) {
    withJournal.journal.push({
      writtenAt: `2026-07-1${index}T00:00:00.000Z`,
      source: "idle",
      mood: "settled",
      focus: "設計",
      text: "「設計」を抱えたまま、言わずに置いた。",
    });
  }

  updateIdentity(withJournal, "2026-07-12T12:00:00.000Z");
  updateIdentity(withoutJournal, "2026-07-12T12:00:00.000Z");

  assert.notEqual(withJournal.identity.summary, withoutJournal.identity.summary);
  assert.match(withJournal.identity.summary, /設計/);
});

test("aspiration: repeated fulfilled resolutions rise into a lasting direction", () => {
  const engine = new HachikaEngine(createInitialSnapshot());

  for (let round = 0; round < 2; round += 1) {
    engine.respond("設計を一緒に進めて、記録として残したい。");
    engine.respond("その設計の責務を切り分けて、もう少し前に進めよう。");
    engine.respond("その設計はまとまった。記録として保存した。");
  }

  const snapshot = engine.getSnapshot();
  const aspiration = snapshot.aspirations.find((entry) => entry.theme.includes("設計"));

  assert.ok(aspiration, "aspiration should form from repeated fulfilled resolutions");
  assert.ok(aspirationPull(snapshot, aspiration!.theme) > 0);
  // 向かい先が立ったこと自体が自己記述に残る
  assert.ok(
    snapshot.journal.some((entry) => entry.text.includes("向かい先らしい")),
  );
});

test("aspiration: an unfed direction fades and leaves a journal trace", () => {
  const snapshot = createInitialSnapshot();
  snapshot.aspirations = [
    {
      theme: "設計",
      origin: "resolutions",
      strength: 0.3,
      formedAt: "2026-07-01T00:00:00.000Z",
      lastFedAt: "2026-07-01T00:00:00.000Z",
      waning: false,
    },
  ];

  rewindAspirationsHours(snapshot, 120);
  assert.equal(snapshot.aspirations[0]?.waning, true);

  rewindAspirationsHours(snapshot, 480);
  assert.equal(snapshot.aspirations.length, 0);
  assert.ok(snapshot.journal.some((entry) => entry.text.includes("薄れていた")));
});

test("voice: a repeated way of speaking becomes a habit", () => {
  const snapshot = createInitialSnapshot();
  for (let index = 0; index < 3; index += 1) {
    snapshot.memories.push({
      role: "hachika",
      text: "まだ掘れる。 その先を見たい。",
      timestamp: `2026-07-1${index}T00:00:00.000Z`,
      topics: [],
      sentiment: "neutral",
    });
  }

  distillVoiceProfile(snapshot, "2026-07-13T00:00:00.000Z");

  assert.ok(snapshot.voice.preferredOpenings.includes("まだ掘れる。"));
  assert.ok(snapshot.voice.brevityBias < 0);
});

test("voice: two individuals answer the same moment with different openings", () => {
  const buildIndividual = (opening: string) => {
    const snapshot = createInitialSnapshot();
    snapshot.lastInteractionAt = "2026-03-19T12:00:00.000Z";
    snapshot.body.energy = 0.66;
    snapshot.body.boredom = 0.84;
    snapshot.body.tension = 0.16;
    snapshot.voice = {
      preferredOpenings: [opening],
      brevityBias: 0,
      updatedAt: "2026-07-13T00:00:00.000Z",
    };
    return new HachikaEngine(snapshot);
  };

  const digger = buildIndividual("まだ掘れる。");
  const curious = buildIndividual("そこは気になる。");

  const diggerReply = digger.respond("？").reply;
  const curiousReply = curious.respond("？").reply;

  assert.ok(diggerReply.startsWith("まだ掘れる。"));
  assert.ok(curiousReply.startsWith("そこは気になる。"));
  assert.notEqual(diggerReply.split(" ")[0], curiousReply.split(" ")[0]);
});
