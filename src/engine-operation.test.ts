import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { HachikaEngine } from "./engine.js";
import { runEngineOperation } from "./engine-operation.js";
import { commitSnapshot, loadSnapshot, saveSnapshot } from "./persistence.js";
import type { WorkshopDirector } from "./workshop-director.js";

test("polling during LLM work cannot erase the page, and a concurrent gesture survives CAS retry", async () => {
  for (const concurrent of [false, true]) {
    const dir = await mkdtemp(join(tmpdir(), "hachika-engine-operation-"));
    const path = join(dir, "snapshot.json");
    const now = new Date("2026-10-10T00:00:00Z");
    const birth = new HachikaEngine();
    birth.interactWithWorkshop({ kind: "offer", material: "paper", place: "studio", text: "朝の音。夜の音。" }, "paper", now);
    await saveSnapshot(path, birth.getSnapshot());
    const uiEngine = new HachikaEngine(await loadSnapshot(path));
    const refresh = async (working: HachikaEngine) => working.syncSnapshot(await loadSnapshot(path));
    const persist = async (working: HachikaEngine) => {
      const committed = await commitSnapshot(path, working.getSnapshot());
      working.syncSnapshot(committed.snapshot);
      return committed.ok;
    };
    let ready!: () => void;
    let resume!: () => void;
    const made = new Promise<void>((resolve) => { ready = resolve; });
    const gate = new Promise<void>((resolve) => { resume = resolve; });
    let calls = 0;
    const model: WorkshopDirector = { name: "test", async propose(context) {
      return { provider: "test", model: "model", draft: { decision: "create", title: "二つの音", caption: "朝だけを残した。",
        materialIds: [context.materials[0]!.id], reuseRecipeId: null, recipe: { name: "最初の音", program: {
          version: 1, slots: [{ kind: "any", take: "first_sentence" }], layout: "sequence", captionStyle: "observation",
        } } } };
    } };
    let operation: ReturnType<typeof runEngineOperation<string>> | null = null;
    try {
      operation = runEngineOperation(uiEngine, { refresh, persist, operate: async (working) => {
        calls++;
        await working.rewindIdleHoursAsync(2, { workshopDirector: model, now });
        assert.equal(working.getSnapshot().workshop.pages.length, 1);
        if (calls === 1) { ready(); await gate; } // Another async stage after making a page.
        return "made";
      } });
      await made;
      await refresh(uiEngine); // GET /api/state refreshes the shared display engine.
      assert.equal(uiEngine.getSnapshot().workshop.pages.length, 0);
      if (concurrent) {
        const other = await runEngineOperation(uiEngine, { refresh, persist, operate: (working) =>
          working.interactWithWorkshop({ kind: "offer", material: "leaf", place: "studio" }, "leaf", now) });
        assert.equal(other.ok, true);
      }
      resume();
      const outcome = await operation;
      assert.equal(outcome.ok, true);
      assert.equal(outcome.attempts, concurrent ? 2 : 1);
      const saved = await loadSnapshot(path);
      assert.equal(saved.workshop.pages.length, 1);
      assert.equal(saved.workshop.recipes.length, 1);
      assert.equal(saved.workshop.materials.length, concurrent ? 2 : 1);
      assert.equal(saved.workshop.materials[0]?.uses, 1);
      assert.equal(saved.conversationCount, 0);
      assert.equal(uiEngine.getSnapshot().revision, saved.revision);
      assert.deepEqual(uiEngine.getSnapshot().workshop, saved.workshop);
    } finally {
      resume();
      await operation;
      await rm(dir, { recursive: true, force: true });
    }
  }
});
