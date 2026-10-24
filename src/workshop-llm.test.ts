import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { HachikaEngine } from "./engine.js";
import { loadSnapshot, saveSnapshot } from "./persistence.js";
import { runResidentLoopTick } from "./resident-loop.js";
import { createInitialSnapshot } from "./state.js";
import { advanceWorkshopHoursAsync, applyWorkshopInteraction, hydrateWorkshop } from "./workshop.js";
import { createWorkshopDirectorFromEnv, type WorkshopDirector, type WorkshopDirectorContext } from "./workshop-director.js";
import { executeWorkshopDraft, parseWorkshopProgram, WorkshopProgramError, type WorkshopProgram } from "./workshop-program.js";

const START = new Date("2026-10-10T00:00:00Z");
const at = (hours: number) => new Date(START.getTime() + hours * 3_600_000);
const program: WorkshopProgram = { version: 1, slots: [
  { kind: "any", take: "first_sentence" }, { kind: "any", take: "last_sentence" }, { kind: "any", take: "whole" },
], layout: "sequence", captionStyle: "story" };

function offered(count = 3) {
  const snapshot = createInitialSnapshot();
  snapshot.dynamics.trust = 0; // Keep gift sharing out of recipe scheduling checks.
  snapshot.residentClockAt = START.toISOString();
  for (let i = 0; i < count; i++) applyWorkshopInteraction(snapshot, { kind: "offer", material: "paper", place: "studio",
    text: `朝の足音${i}。夜の余白${i}。` }, `offer-${i}`, START);
  return snapshot;
}
function draft(context: WorkshopDirectorContext, plan = program) {
  return { decision: "create", title: "朝から夜へ", caption: "足音を先に、余白をあとに並べた。",
    materialIds: context.materials.slice(0, plan.slots.length).map((item) => item.id), reuseRecipeId: null,
    recipe: { name: "時間の小道", program: plan } };
}
function director(generate: (context: WorkshopDirectorContext) => unknown): WorkshopDirector {
  return { name: "test-llm", async propose(context) { return { draft: generate(context), provider: "test-llm", model: "test-model" }; } };
}

test("LLM invents an executable recipe and reuses it unchanged on different materials", async () => {
  const snapshot = offered();
  let calls = 0;
  const model = director((context) => {
    calls++;
    assert.equal(context.recipes.length, calls === 1 ? 0 : 1);
    if (calls === 1) return draft(context);
    return { ...draft(context), title: "別の朝から", recipe: null, reuseRecipeId: context.recipes[0]!.id };
  });
  await advanceWorkshopHoursAsync(snapshot, 1, at(1), model);
  assert.equal(calls, 0); // Looking and polling do not generate a page.
  await advanceWorkshopHoursAsync(snapshot, 1, at(2), model);
  const first = snapshot.workshop.pages[0]!;
  assert.equal(first.composition, "crafted");
  assert.equal(first.making?.origin, "invented");
  assert.deepEqual(first.fragments.map((item) => item.excerpt), ["朝の足音0。", "夜の余白1。", "朝の足音2。夜の余白2。"]);
  assert.equal(first.fragments[0]?.text, "朝の足音0。夜の余白0。");
  assert.equal(snapshot.workshop.recipes[0]?.successes, 1);
  assert.equal(snapshot.workshop.recipes[0]?.value, 0.5);
  snapshot.workshop.materials.forEach((item) => { item.place = "archive"; });
  for (let i = 0; i < 3; i++) applyWorkshopInteraction(snapshot, { kind: "offer", material: "paper", place: "studio",
    text: `春の窓${i}。冬の窓${i}。` }, `new-${i}`, at(2));
  await advanceWorkshopHoursAsync(snapshot, 2, at(4), model);
  const second = snapshot.workshop.pages[1]!;
  assert.equal(calls, 2);
  assert.equal(second.making?.origin, "reused");
  assert.equal(second.making?.recipeId, first.making?.recipeId);
  assert.deepEqual(second.making?.program, first.making?.program);
  assert.notEqual(second.fragments[0]?.id, first.fragments[0]?.id);
  assert.equal(second.fragments[0]?.excerpt, "春の窓0。");
  assert.equal(snapshot.workshop.recipes.length, 1);
  assert.equal(snapshot.workshop.recipes[0]?.successes, 2);
  applyWorkshopInteraction(snapshot, { kind: "bookmark", pageId: second.id, bookmarked: true }, "like", at(4));
  const value = snapshot.workshop.recipes[0]!.value;
  assert.ok(value > 0.5);
  applyWorkshopInteraction(snapshot, { kind: "bookmark", pageId: second.id, bookmarked: false }, "unlike", at(4));
  applyWorkshopInteraction(snapshot, { kind: "bookmark", pageId: second.id, bookmarked: true }, "like-again", at(4));
  assert.equal(snapshot.workshop.recipes[0]!.value, value);
  assert.equal(snapshot.conversationCount, 0);
  assert.equal(snapshot.memories.length, 0);
});

test("the interpreter rejects absent, duplicate, shelved, mismatched and empty inputs", () => {
  const snapshot = offered();
  const context = { materials: snapshot.workshop.materials } as WorkshopDirectorContext;
  const valid = draft(context);
  const run = (candidate: unknown) => executeWorkshopDraft(candidate, snapshot.workshop.materials, []);
  assert.throws(() => run({ ...valid, materialIds: ["invented", ...valid.materialIds.slice(1)] }), /material_unavailable/);
  assert.throws(() => run({ ...valid, materialIds: [valid.materialIds[0], valid.materialIds[0], valid.materialIds[2]] }), /draft_invalid/);
  assert.throws(() => run({ ...valid, recipe: { name: "x", program: { ...program, slots: [{ kind: "leaf", take: "whole" }, ...program.slots.slice(1)] } } }), /slot_kind_mismatch/);
  assert.throws(() => run({ ...valid, recipe: null, reuseRecipeId: "unknown" }), /recipe_missing/);
  assert.throws(() => parseWorkshopProgram({ ...program, slots: [{ kind: "any", take: "eval" }] }), WorkshopProgramError);
  snapshot.workshop.materials[0]!.place = "archive";
  assert.throws(() => run(valid), /material_unavailable/);
  snapshot.workshop.materials[0]!.place = "studio";
  snapshot.workshop.materials[0]!.text = "。";
  assert.throws(() => run(valid), /excerpt_empty/);
});

test("bad proposals and provider failures create no template fallback or learned recipe", async () => {
  for (const model of [director((context) => ({ ...draft(context), materialIds: ["missing"] })),
    { name: "broken", async propose() { throw new Error("private provider response"); } }]) {
    const snapshot = offered();
    const before = structuredClone(snapshot.workshop.materials);
    await advanceWorkshopHoursAsync(snapshot, 2, at(2), model);
    assert.equal(snapshot.workshop.pages.length, 0);
    assert.equal(snapshot.workshop.recipes.length, 0);
    assert.equal(snapshot.workshop.skills.length, 0);
    assert.deepEqual(snapshot.workshop.materials.map((item) => [item.id, item.text, item.uses]), before.map((item) => [item.id, item.text, item.uses]));
    assert.equal(snapshot.workshop.lastGeneration?.outcome, "error");
    assert.ok(snapshot.workshop.lastGeneration?.error);
    assert.ok(snapshot.workshop.nextActionHour! > snapshot.workshop.elapsedHours);
    assert.ok(!JSON.stringify(snapshot).includes("private provider response"));
  }
});

test("rest prevents model calls, wait preserves sources, and long catch-up bounds generation", async () => {
  const snapshot = offered();
  let calls = 0;
  const model = director(() => { calls++; return { decision: "wait", note: "今日は余白を見ている。" }; });
  snapshot.body.energy = 0.1;
  await advanceWorkshopHoursAsync(snapshot, 20, at(20), model);
  assert.equal(calls, 0);
  snapshot.body.energy = 0.6;
  await advanceWorkshopHoursAsync(snapshot, 2, at(22), model);
  assert.equal(calls, 1);
  assert.equal(snapshot.workshop.lastGeneration?.outcome, "wait");
  assert.equal(snapshot.workshop.status, "今日は余白を見ている。");
  assert.ok(snapshot.workshop.materials.every((item) => item.uses === 0));
  const long = offered(16);
  calls = 0;
  const many = director((context) => {
    calls++;
    const plan = { ...program, slots: [program.slots[0]!] };
    return { ...draft(context, plan), materialIds: [context.focusMaterialId] };
  });
  await advanceWorkshopHoursAsync(long, 1000, at(1000), many);
  assert.equal(calls, 4);
  assert.equal(long.workshop.pages.length, 4);
  assert.equal(long.workshop.recipes.length, 1);
  assert.ok(long.workshop.nextActionHour! > long.workshop.elapsedHours);
});

test("recipes, source cuts and generation provenance survive v38 persistence; corrupt cuts are rejected", async () => {
  const snapshot = offered();
  await advanceWorkshopHoursAsync(snapshot, 2, at(2), director(draft));
  const dir = await mkdtemp(join(tmpdir(), "hachika-llm-workshop-"));
  const path = join(dir, "state.json");
  try {
    await saveSnapshot(path, snapshot);
    const loaded = await loadSnapshot(path);
    assert.equal(loaded.version, 38);
    assert.deepEqual(loaded.workshop, snapshot.workshop);
    const raw = JSON.parse(await readFile(path, "utf8"));
    raw.workshop.pages[0].fragments[0].excerpt = "this was never on the desk";
    await writeFile(path, JSON.stringify(raw));
    const repaired = await loadSnapshot(path);
    assert.equal(repaired.workshop.pages.length, 0);
    assert.equal(repaired.workshop.recipes.length, 1);
    const old = hydrateWorkshop({ ...snapshot.workshop, pages: [], recipes: undefined, lastGeneration: undefined });
    assert.equal(old.recipes.length, 0);
    assert.equal(old.lastGeneration, null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("resident work and returning gestures use the LLM path without a separate autonomy director", async () => {
  let calls = 0;
  const model = director((context) => { calls++; return draft(context); });
  const resident = await runResidentLoopTick(offered(), { idleHours: 2, clockMode: "wall", now: at(2), workshopDirector: model });
  assert.equal(calls, 1);
  assert.equal(resident.snapshot.workshop.pages[0]?.making?.provider, "test-llm");
  const engine = new HachikaEngine(offered());
  await engine.interactWithWorkshopAsync({ kind: "light", lamp: "dim" }, "return", { workshopDirector: model, now: at(2) });
  assert.equal(calls, 2);
  const after = engine.getSnapshot();
  assert.equal(after.workshop.pages[0]?.composition, "crafted");
  assert.equal(after.residentClockAt, at(2).toISOString());
  assert.equal(after.conversationCount, 0);
  await engine.interactWithWorkshopAsync({ kind: "light", lamp: "dim" }, "return", { workshopDirector: model, now: at(8) });
  assert.equal(calls, 2);
});

test("the OpenAI-compatible workshop adapter sends world context and honours role models", async () => {
  let sent: { model: string; messages: Array<{ content: string }> } | null = null;
  const snapshot = offered();
  const context: WorkshopDirectorContext = { materials: snapshot.workshop.materials, focusMaterialId: snapshot.workshop.materials[0]!.id,
    lamp: "dim", body: snapshot.body, temperament: snapshot.temperament, recipes: [], recentPages: [] };
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    sent = JSON.parse(Buffer.concat(chunks).toString());
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(draft(context)) } }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const model = createWorkshopDirectorFromEnv({ OPENAI_API_KEY: "test-key", OPENAI_MODEL: "default-model",
      OPENAI_WORKSHOP_MODEL: "workshop-model", OPENAI_BASE_URL: `http://127.0.0.1:${address.port}/v1` });
    assert.ok(model);
    const proposal = await model.propose(context);
    assert.equal(proposal?.model, "workshop-model");
    assert.equal(proposal?.provider, "openai");
    const payload = sent as unknown as { model: string; messages: Array<{ content: string }> };
    assert.equal(payload.model, "workshop-model");
    assert.deepEqual(JSON.parse(payload.messages[1]!.content).materials, context.materials);
    assert.equal(JSON.parse(payload.messages[1]!.content).lamp, "dim");
    assert.equal(createWorkshopDirectorFromEnv({}), null);
    assert.equal(createWorkshopDirectorFromEnv({ HACHIKA_LOCAL_AI_BASE_URL: "http://127.0.0.1:1234/v1", HACHIKA_LOCAL_AI_WORKSHOP_MODEL: "off" }), null);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});
