import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { syncArtifacts } from "../src/artifacts.js";
import { writeTextFileAtomic } from "../src/atomic-file.js";
import { commitSnapshot, loadSnapshot } from "../src/persistence.js";
import { buildSelectiveMemoryReset } from "../src/selective-reset.js";

const statePath = resolve(process.cwd(), "data/hachika-state.json");
const artifactsPath = resolve(process.cwd(), "data/artifacts");
const timestamp = new Date().toISOString();
const backupStamp = timestamp.replaceAll(":", "-").replaceAll(".", "-");
const backupPath = resolve(
  process.cwd(),
  `data/backups/hachika-state-pre-selective-reset-${backupStamp}.json`,
);

const raw = await readFile(statePath, "utf8");
const current = await loadSnapshot(statePath);
const reset = buildSelectiveMemoryReset(current, timestamp);

await writeTextFileAtomic(backupPath, raw);
const committed = await commitSnapshot(statePath, reset.snapshot, current.revision);

if (!committed.ok) {
  throw new Error(
    `state revision conflict: expected ${current.revision}, found ${committed.snapshot.revision}`,
  );
}

await syncArtifacts(committed.snapshot, artifactsPath);

console.log(
  JSON.stringify(
    {
      backupPath,
      revision: committed.snapshot.revision,
      conversationCount: committed.snapshot.conversationCount,
      recoveredUserName: reset.recoveredUserName,
      hachikaName: committed.snapshot.discourse.hachikaName?.value ?? null,
      retainedMemories: reset.retainedMemories,
      retainedClaims: reset.retainedClaims,
      traces: Object.keys(committed.snapshot.traces).length,
      identityAnchors: committed.snapshot.identity.anchors,
      activePurpose: committed.snapshot.purpose.active,
    },
    null,
    2,
  ),
);
