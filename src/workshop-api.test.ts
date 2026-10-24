import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

import type { UiStatePayload } from "./ui-state.js";

// A real HTTP boundary: validation, guarded mutation, persistence and restart.
test("workshop HTTP gestures survive restart without masquerading as conversation", { timeout: 20_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "hachika-workshop-api-"));
  const repo = fileURLToPath(new URL("../", import.meta.url));
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  const base = `http://127.0.0.1:${port}`;
  let child: ChildProcess | null = null;
  let output = "";
  const start = async () => {
    child = spawn(process.execPath, [join(repo, "node_modules/tsx/dist/cli.mjs"), join(repo, "src/ui-server.ts")], {
      cwd: root,
      env: { ...process.env, OPENAI_API_KEY: "", HACHIKA_LOCAL_AI_BASE_URL: "", LOCAL_AI_BASE_URL: "",
        HACHIKA_DATA_DIR: join(root, "individual"), HACHIKA_UI_HOST: "127.0.0.1", HACHIKA_UI_PORT: String(port),
        HACHIKA_LOOP_INTERVAL_MS: "60000", HACHIKA_LOOP_IDLE_HOURS_PER_TICK: "", HACHIKA_UI_ALLOWED_HOSTS: "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (chunk) => { output += String(chunk); });
    child.stderr?.on("data", (chunk) => { output += String(chunk); });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (output.includes("Hachika resident loop started with UI")) return;
      if (child.exitCode !== null) throw new Error(`UI stopped: ${output}`);
      await delay(30);
    }
    throw new Error(`UI startup timed out: ${output}`);
  };
  const stop = async () => {
    if (!child || child.exitCode !== null) return;
    const ended = once(child, "exit");
    child.kill("SIGTERM");
    const timeout = globalThis.setTimeout(() => child?.kill("SIGKILL"), 3000);
    try { await ended; } finally { globalThis.clearTimeout(timeout); child = null; }
  };
  const post = (path: string, body: unknown, extraHeaders = {}) => fetch(`${base}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", ...extraHeaders }, body: JSON.stringify(body),
  });
  const state = async (): Promise<UiStatePayload> => (await fetch(`${base}/api/state`)).json() as Promise<UiStatePayload>;
  try {
    await symlink(join(repo, "ui"), join(root, "ui"), "dir");
    await start();
    const action = { kind: "offer", material: "paper", place: "studio", spot: "window", text: "窓の外を雨粒が流れている。" };
    const invalid = await post("/api/workshop/interact", { interactionId: "invalid", action: { ...action, text: "" } });
    assert.equal(invalid.status, 400);
    assert.equal(((await invalid.json()) as { error: string }).error, "workshop_text_invalid");
    const crossSite = await post("/api/workshop/interact", { interactionId: "blocked", action }, { Origin: "https://example.com" });
    assert.equal(crossSite.status, 403);
    assert.equal((await state()).workshop.materials.length, 0);

    assert.equal((await post("/api/workshop/interact", { interactionId: "paper-1", action })).status, 200);
    assert.equal((await post("/api/workshop/interact", { interactionId: "paper-1", action })).status, 200);
    assert.equal((await state()).workshop.materials.length, 1);
    assert.equal((await state()).workshop.materials[0]?.spot, "window");
    assert.equal((await post("/api/idle", { hours: 2 })).status, 200);
    const made = await state();
    const page = made.workshop.pages[0];
    assert.ok(page);
    assert.equal(page.fragments[0]?.text, action.text);
    assert.equal(made.summary.conversationCount, 0);
    assert.equal((await post("/api/workshop/interact", {
      interactionId: "bookmark-1", action: { kind: "bookmark", pageId: page.id, bookmarked: true },
    })).status, 200);
    const notebook = await fetch(`${base}/api/workshop/notebook`);
    assert.match(notebook.headers.get("Content-Disposition") ?? "", /hachika-notebook\.md/);
    assert.match(await notebook.text(), /窓の外を雨粒が流れている。/);
    assert.match(await readFile(join(root, "individual/artifacts/notebook.md"), "utf8"), /しおり/);
    assert.equal((await post("/api/idle", { hours: 1 })).status, 200);
    const shared = await state();
    const gift = shared.workshop.gifts[0];
    assert.ok(gift);
    assert.equal((await fetch(`${base}/api/workshop/gifts/${gift.id}`)).status, 409);
    assert.equal((await post("/api/workshop/interact", {
      interactionId: "receive-1", action: { kind: "receive", giftId: gift.id },
    })).status, 200);
    const receipt = (await state()).workshop.gifts[0]?.receivedAt;
    assert.ok(receipt);
    assert.equal((await post("/api/workshop/interact", {
      interactionId: "receive-1", action: { kind: "receive", giftId: gift.id },
    })).status, 200);
    assert.equal((await state()).workshop.gifts[0]?.receivedAt, receipt);
    const card = await fetch(`${base}/api/workshop/gifts/${gift.id}`);
    assert.equal(card.status, 200);
    assert.match(await card.text(), /窓の外を雨粒が流れている。/);
    assert.equal((await fetch(`${base}/api/workshop/gifts/missing`)).status, 404);
    assert.match(await (await fetch(`${base}/api/workshop/keepsakes`)).text(), /受け取った日時/);
    assert.match(await readFile(join(root, "individual/artifacts/received-gifts.md"), "utf8"), /窓の外を雨粒/);
    const marked = await state();
    await stop();
    output = "";
    await start();
    const restored = await state();
    assert.deepEqual(restored.workshop.pages, marked.workshop.pages);
    assert.deepEqual(restored.workshop.skills, marked.workshop.skills);
    assert.deepEqual(restored.workshop.gifts, marked.workshop.gifts);
    assert.equal(restored.workshop.materials[0]?.spot, "window");
    assert.equal(restored.summary.conversationCount, 0);
    assert.equal(restored.commitments.length, 0);
  } finally {
    await stop();
    await rm(root, { recursive: true, force: true });
  }
});
