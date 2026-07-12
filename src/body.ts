import { clamp01 } from "./state.js";
import type { HachikaSnapshot, PendingInitiative } from "./types.js";

export function settleBodyAfterInitiative(
  snapshot: HachikaSnapshot,
  pending: PendingInitiative,
): void {
  snapshot.body = {
    energy: clamp01(
      snapshot.body.energy - 0.04 + (pending.kind === "preserve_presence" ? 0.02 : 0),
    ),
    tension: clamp01(
      snapshot.body.tension - (pending.kind === "preserve_presence" ? 0.08 : 0.04),
    ),
    boredom: clamp01(
      snapshot.body.boredom -
        (pending.motive === "pursue_curiosity" || pending.motive === "continue_shared_work"
          ? 0.1
          : 0.05),
    ),
    loneliness: clamp01(
      snapshot.body.loneliness -
        (pending.motive === "deepen_relation" || pending.kind === "neglect_ping"
          ? 0.12
          : 0.04),
    ),
  };
}
