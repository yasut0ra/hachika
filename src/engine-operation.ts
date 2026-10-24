import { runWithConflictRetry } from "./conflict-retry.js";
import type { HachikaEngine } from "./engine.js";

// Keep async work separate from the engine refreshed by UI polling. Publish a
// working copy only after CAS succeeds; a retry reloads the actual current state.
export async function runEngineOperation<T>(currentEngine: HachikaEngine, options: {
  operate: (working: HachikaEngine) => Promise<T> | T;
  refresh: (working: HachikaEngine) => Promise<void>;
  persist: (working: HachikaEngine) => Promise<boolean>;
  shouldPersist?: (result: T) => boolean;
}) {
  let working = currentEngine.createWorkingCopy();
  const outcome = await runWithConflictRetry<T>({
    operate: async () => {
      working = currentEngine.createWorkingCopy();
      await options.refresh(working);
      return options.operate(working);
    },
    persist: async (result) => !options.shouldPersist || options.shouldPersist(result) ? options.persist(working) : true,
  });
  if (outcome.ok) {
    working.annotateLastRetryAttempts(outcome.attempts);
    currentEngine.syncSnapshot(working.getSnapshot(), working);
  } else {
    await options.refresh(currentEngine);
  }
  return outcome;
}
