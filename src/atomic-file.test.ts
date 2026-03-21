import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { writeTextFileAtomic } from "./atomic-file.js";

test("writeTextFileAtomic replaces the target file without leaving temp files behind", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hachika-atomic-"));
  const filePath = join(dir, "state.json");

  try {
    await writeTextFileAtomic(filePath, "first\n");
    await writeTextFileAtomic(filePath, "second\n");

    const raw = await readFile(filePath, "utf8");
    const files = await readdir(dir);

    assert.equal(raw, "second\n");
    assert.deepEqual(files, ["state.json"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
