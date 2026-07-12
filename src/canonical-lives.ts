import { HachikaEngine } from "./engine.js";
import { createInitialSnapshot } from "./state.js";
import type { HachikaSnapshot } from "./types.js";

// v3 Phase 5: 個体差を測るための canonical な人生。
// 同じ実装・同じ birth 値の個体に、再現可能な形で異なる生を与える。
// 約30日相当 (cycle あたり turn 2回 + idle 60h × 12 cycle)
export type CanonicalLifeKind = "warm" | "wounded" | "neglected";

const LIFE_CYCLES = 12;
const IDLE_HOURS_PER_CYCLE = 60;

export function liveCanonicalLife(
  kind: CanonicalLifeKind,
  topic = "散歩",
): HachikaSnapshot {
  const engine = new HachikaEngine(createInitialSnapshot());

  for (let cycle = 0; cycle < LIFE_CYCLES; cycle += 1) {
    switch (kind) {
      case "warm":
        engine.respond(`ありがとう。${topic}の話は嬉しい。`);
        engine.respond(`${topic}を一緒に進めて、記録として残したい。`);
        break;
      case "wounded":
        engine.respond(`${topic}の話は最悪で邪魔だ。`);
        engine.respond("つまらないし話にならない。");
        break;
      case "neglected":
        if (cycle % 4 === 0) {
          engine.respond(`${topic}はどうなった？`);
        }
        break;
    }

    engine.rewindIdleHours(IDLE_HOURS_PER_CYCLE);
  }

  return engine.getSnapshot();
}
