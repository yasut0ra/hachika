import assert from "node:assert/strict";
import test from "node:test";

import { HachikaEngine } from "./engine.js";
import { getLegacyBlendScale, setLegacyBlendScale } from "./legacy-visible.js";
import { createInitialSnapshot } from "./state.js";

// LEGACY_BLEND_SCALE = 0 (dynamics 経路のみ) でも、生き物らしさの中核不変条件が
// 成立することを固定する。legacy 経路退役 (docs/legacy-visible-retirement.md) の回帰基準。
function withDynamicsOnly<T>(run: () => T): T {
  const original = getLegacyBlendScale();
  setLegacyBlendScale(0);
  try {
    return run();
  } finally {
    setLegacyBlendScale(original);
  }
}

// NOTE: derive の固定点が INITIAL_STATE と揃うまでは「絶対値が上がる」までは保証せず、
// hostile との差分不変条件で substrate の応答性を固定する (docs/legacy-visible-retirement.md Phase 2)
test("dynamics-only: positive turn lands warmer than hostile turn", () => {
  withDynamicsOnly(() => {
    const warmEngine = new HachikaEngine(createInitialSnapshot());
    const warm = warmEngine.respond("ありがとう。君と実装を進めたい。");

    const hostileEngine = new HachikaEngine(createInitialSnapshot());
    const hostile = hostileEngine.respond("最悪だ。消えて。");

    assert.ok(warm.snapshot.state.pleasure > hostile.snapshot.state.pleasure);
    assert.ok(warm.snapshot.state.relation > hostile.snapshot.state.relation);
    assert.ok(warm.snapshot.dynamics.safety > hostile.snapshot.dynamics.safety);
    assert.ok(warm.snapshot.dynamics.trust > hostile.snapshot.dynamics.trust);
  });
});

test("dynamics-only: repeated positive turns do not saturate drives and attachment", () => {
  withDynamicsOnly(() => {
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
});

test("dynamics-only: hostility hurts and leaves mistrust that repair releases slowly", () => {
  withDynamicsOnly(() => {
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
});

test("dynamics-only: idle raises boredom and loneliness", () => {
  withDynamicsOnly(() => {
    const engine = new HachikaEngine(createInitialSnapshot());
    const before = engine.getSnapshot().body;

    engine.rewindIdleHours(12);
    const after = engine.getSnapshot().body;

    assert.ok(after.boredom > before.boredom);
    assert.ok(after.loneliness > before.loneliness);
  });
});
