import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  describeArtifactFiles,
  renderArtifactDocument,
  syncArtifacts,
} from "./artifacts.js";
import { createInitialSnapshot } from "./state.js";
import type { HachikaSnapshot, TraceEntry } from "./types.js";

test("renderArtifactDocument includes structured sections", () => {
  const snapshot = createInitialSnapshot();
  snapshot.body.energy = 0.08;
  const trace: TraceEntry = {
    topic: "設計",
    kind: "spec_fragment",
    status: "active",
    lastAction: "expanded",
    summary: "「設計」は「API を分ける」という断片として残す。",
    sourceMotive: "continue_shared_work",
    artifact: {
      memo: ["設計の要点を残す"],
      fragments: ["API を分ける"],
      decisions: [],
      nextSteps: ["責務ごとに整理する"],
    },
    work: {
      focus: "責務ごとに整理する",
      confidence: 0.68,
      blockers: ["境界が曖昧"],
      staleAt: "2026-03-21T01:00:00.000Z",
    },
    salience: 0.82,
    mentions: 2,
    createdAt: "2026-03-19T00:00:00.000Z",
    lastUpdatedAt: "2026-03-19T01:00:00.000Z",
  };

  const markdown = renderArtifactDocument(snapshot, trace);

  assert.match(markdown, /^# 設計/m);
  assert.match(markdown, /Status: active/);
  assert.match(markdown, /Lifecycle: live/);
  assert.match(markdown, /Last Action: expanded/);
  assert.match(markdown, /Tending: preserve/);
  assert.match(markdown, /Focus: 責務ごとに整理する/);
  assert.match(markdown, /Confidence: 0.68/);
  assert.match(markdown, /Blockers: 境界が曖昧/);
  assert.match(markdown, /Pending Next Step: 責務ごとに整理する/);
  assert.match(markdown, /Stale At: 2026-03-21T01:00:00.000Z/);
  assert.match(markdown, /Effective Stale At: 2026-03-21T03:00:00.000Z/);
  assert.match(markdown, /## Summary/);
  assert.match(markdown, /## Memo/);
  assert.match(markdown, /## Fragments/);
  assert.match(markdown, /## Next Steps/);
  assert.match(markdown, /API を分ける/);
});

test("syncArtifacts writes markdown files and index", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "hachika-artifacts-"));

  try {
    const snapshot = withTrace(createInitialSnapshot(), {
      topic: "設計",
      kind: "decision",
      status: "resolved",
      lastAction: "resolved",
      summary: "「設計」は「記録として保存した」という決定として残す。",
      sourceMotive: "leave_trace",
      artifact: {
        memo: ["設計の経緯を残す"],
        fragments: ["設計をまとめる"],
        decisions: ["記録として保存した"],
        nextSteps: [],
      },
      work: {
        focus: "記録として保存した",
        confidence: 0.94,
        blockers: [],
        staleAt: null,
      },
      lifecycle: {
        phase: "archived",
        archivedAt: "2026-03-19T02:00:00.000Z",
        reopenedAt: null,
        reopenCount: 0,
      },
      salience: 0.91,
      mentions: 3,
      createdAt: "2026-03-19T00:00:00.000Z",
      lastUpdatedAt: "2026-03-19T02:00:00.000Z",
    });
    snapshot.body.energy = 0.66;
    snapshot.body.boredom = 0.84;

    const result = await syncArtifacts(snapshot, tempDir);
    const described = describeArtifactFiles(snapshot, tempDir);

    assert.equal(result.files.length, 1);
    assert.equal(described.length, 1);
    assert.equal(described[0]?.tending, "steady");
    assert.equal(described[0]?.lifecyclePhase, "archived");
    assert.match(result.files[0]!.relativePath, /^archive\/trace-/);

    const artifactBody = await readFile(result.files[0]!.absolutePath, "utf8");
    const indexBody = await readFile(join(tempDir, "index.md"), "utf8");
    const archiveIndexBody = await readFile(join(tempDir, "archive", "index.md"), "utf8");

    assert.match(artifactBody, /Kind: decision/);
    assert.match(artifactBody, /Status: resolved/);
    assert.match(artifactBody, /Lifecycle: archived/);
    assert.match(artifactBody, /Last Action: resolved/);
    assert.match(artifactBody, /Tending: steady/);
    assert.match(artifactBody, /Focus: 記録として保存した/);
    assert.match(artifactBody, /Confidence: 0.94/);
    assert.match(artifactBody, /Effective Stale At: none/);
    assert.match(artifactBody, /## Decisions/);
    assert.match(artifactBody, /記録として保存した/);
    assert.match(indexBody, /Sections:/);
    assert.match(indexBody, /- deepen\/index\.md/);
    assert.match(indexBody, /- archive\/index\.md/);
    assert.match(indexBody, /## Archive/);
    assert.match(indexBody, /設計 \(decision\/resolved\) -> archive\/trace-/);
    assert.match(indexBody, /lifecycle: archived/);
    assert.match(indexBody, /last action: resolved/);
    assert.match(indexBody, /tending: steady/);
    assert.match(indexBody, /confidence: 0.94/);
    assert.match(archiveIndexBody, /^# Hachika Artifacts: Archive/m);
    assert.match(archiveIndexBody, /Root Index: \.\.\/index\.md/);
    assert.match(archiveIndexBody, /設計 \(decision\/resolved\) -> trace-/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("describeArtifactFiles surfaces a deepening tending mode", () => {
  const snapshot = withTrace(createInitialSnapshot(), {
    topic: "仕様",
    kind: "spec_fragment",
    status: "active",
    lastAction: "expanded",
    summary: "「仕様」は断片として残っている。",
    sourceMotive: "continue_shared_work",
    artifact: {
      memo: ["仕様を詰める"],
      fragments: ["境界を整理する"],
      decisions: [],
      nextSteps: ["責務を切り分ける"],
    },
    work: {
      focus: "責務を切り分ける",
      confidence: 0.48,
      blockers: ["責務が未定"],
      staleAt: "2026-03-18T01:00:00.000Z",
    },
    salience: 0.62,
    mentions: 2,
    createdAt: "2026-03-19T00:00:00.000Z",
    lastUpdatedAt: "2026-03-19T01:00:00.000Z",
  });
  snapshot.body.energy = 0.66;
  snapshot.body.boredom = 0.86;
  snapshot.body.tension = 0.16;

  const files = describeArtifactFiles(snapshot, join(tmpdir(), "hachika-artifacts-preview"));

  assert.equal(files[0]?.tending, "deepen");
  assert.equal(files[0]?.effectiveStaleAt, "2026-03-17T17:00:00.000Z");
});

test("syncArtifacts groups the index by tending order", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "hachika-artifacts-"));

  try {
    const snapshot = createInitialSnapshot();
    snapshot.body.energy = 0.66;
    snapshot.body.boredom = 0.86;
    snapshot.body.tension = 0.16;
    snapshot.traces.仕様 = {
      topic: "仕様",
      kind: "spec_fragment",
      status: "active",
      lastAction: "expanded",
      summary: "「仕様」は断片として残っている。",
      sourceMotive: "continue_shared_work",
      artifact: {
        memo: ["仕様を詰める"],
        fragments: ["境界を整理する"],
        decisions: [],
        nextSteps: ["責務を切り分ける"],
      },
      work: {
        focus: "責務を切り分ける",
        confidence: 0.48,
        blockers: ["責務が未定"],
        staleAt: "2026-03-18T01:00:00.000Z",
      },
      salience: 0.62,
      mentions: 2,
      createdAt: "2026-03-19T00:00:00.000Z",
      lastUpdatedAt: "2026-03-19T01:00:00.000Z",
    };
    snapshot.traces.設計 = {
      topic: "設計",
      kind: "decision",
      status: "resolved",
      lastAction: "resolved",
      summary: "「設計」は決定として残っている。",
      sourceMotive: "leave_trace",
      artifact: {
        memo: ["設計を残す"],
        fragments: ["API を分ける"],
        decisions: ["API を分ける"],
        nextSteps: [],
      },
      work: {
        focus: "API を分ける",
        confidence: 0.94,
        blockers: [],
        staleAt: null,
      },
      lifecycle: {
        phase: "archived",
        archivedAt: "2026-03-19T01:30:00.000Z",
        reopenedAt: null,
        reopenCount: 0,
      },
      salience: 0.54,
      mentions: 2,
      createdAt: "2026-03-19T00:00:00.000Z",
      lastUpdatedAt: "2026-03-19T01:30:00.000Z",
    };
    snapshot.lastInteractionAt = "2026-03-19T02:00:00.000Z";

    await syncArtifacts(snapshot, tempDir);
    const indexBody = await readFile(join(tempDir, "index.md"), "utf8");

    const deepenHeading = indexBody.indexOf("## Deepen");
    const archiveHeading = indexBody.indexOf("## Archive");
    const deepenEntry = indexBody.indexOf("仕様 (spec_fragment/active)");
    const archiveEntry = indexBody.indexOf("設計 (decision/resolved)");

    assert.ok(deepenHeading >= 0);
    assert.ok(archiveHeading >= 0);
    assert.ok(deepenHeading < archiveHeading);
    assert.ok(deepenEntry > deepenHeading);
    assert.ok(archiveEntry > archiveHeading);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("syncArtifacts writes per-tending index files even when a section is empty", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "hachika-artifacts-"));

  try {
    const snapshot = createInitialSnapshot();
    snapshot.lastInteractionAt = "2026-03-19T02:00:00.000Z";

    await syncArtifacts(snapshot, tempDir);

    const deepenIndexBody = await readFile(join(tempDir, "deepen", "index.md"), "utf8");
    const preserveIndexBody = await readFile(join(tempDir, "preserve", "index.md"), "utf8");
    const steadyIndexBody = await readFile(join(tempDir, "steady", "index.md"), "utf8");
    const archiveIndexBody = await readFile(join(tempDir, "archive", "index.md"), "utf8");

    assert.match(deepenIndexBody, /No deepen artifacts right now\./);
    assert.match(preserveIndexBody, /No preserve artifacts right now\./);
    assert.match(steadyIndexBody, /No steady artifacts right now\./);
    assert.match(archiveIndexBody, /No archived artifacts right now\./);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("syncArtifacts removes the old artifact file when a trace moves tending directories", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "hachika-artifacts-"));

  try {
    const first = withTrace(createInitialSnapshot(), {
      topic: "仕様",
      kind: "spec_fragment",
      status: "active",
      lastAction: "expanded",
      summary: "「仕様」は断片として残っている。",
      sourceMotive: "continue_shared_work",
      artifact: {
        memo: ["仕様を詰める"],
        fragments: ["境界を整理する"],
        decisions: [],
        nextSteps: ["責務を切り分ける"],
      },
      work: {
        focus: "責務を切り分ける",
        confidence: 0.48,
        blockers: ["責務が未定"],
        staleAt: "2026-03-18T01:00:00.000Z",
      },
      salience: 0.62,
      mentions: 2,
      createdAt: "2026-03-19T00:00:00.000Z",
      lastUpdatedAt: "2026-03-19T01:00:00.000Z",
    });
    first.body.energy = 0.66;
    first.body.boredom = 0.86;
    first.body.tension = 0.16;

    const initialSync = await syncArtifacts(first, tempDir);

    assert.equal(initialSync.files.length, 1);
    assert.match(initialSync.files[0]!.relativePath, /^deepen\/trace-/);

    const moved = structuredClone(first);
    moved.body.energy = 0.08;
    moved.body.boredom = 0.22;
    moved.body.tension = 0.38;
    moved.lastInteractionAt = "2026-03-19T02:00:00.000Z";

    const nextSync = await syncArtifacts(moved, tempDir);

    assert.equal(nextSync.files.length, 1);
    assert.match(nextSync.files[0]!.relativePath, /^preserve\/trace-/);
    assert.deepEqual(nextSync.removedFiles, [initialSync.files[0]!.relativePath]);
    await assert.rejects(readFile(initialSync.files[0]!.absolutePath, "utf8"));
    await readFile(nextSync.files[0]!.absolutePath, "utf8");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("syncArtifacts removes stale materialized files", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "hachika-artifacts-"));

  try {
    const first = withTrace(createInitialSnapshot(), {
      topic: "設計",
      kind: "spec_fragment",
      status: "active",
      lastAction: "expanded",
      summary: "「設計」は断片として残す。",
      sourceMotive: "continue_shared_work",
      artifact: {
        memo: ["設計を残す"],
        fragments: ["API を分ける"],
        decisions: [],
        nextSteps: ["続きを進める"],
      },
      work: {
        focus: "続きを進める",
        confidence: 0.61,
        blockers: [],
        staleAt: "2026-03-21T01:00:00.000Z",
      },
      salience: 0.74,
      mentions: 2,
      createdAt: "2026-03-19T00:00:00.000Z",
      lastUpdatedAt: "2026-03-19T01:00:00.000Z",
    });

    const initialSync = await syncArtifacts(first, tempDir);
    assert.equal(initialSync.files.length, 1);
    assert.match(initialSync.files[0]!.relativePath, /^(deepen|preserve|steady)\/trace-/);

    const second = createInitialSnapshot();
    second.lastInteractionAt = "2026-03-19T03:00:00.000Z";
    const nextSync = await syncArtifacts(second, tempDir);

    assert.equal(nextSync.files.length, 0);
    assert.equal(nextSync.removedFiles.length, 1);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

function withTrace(snapshot: HachikaSnapshot, trace: TraceEntry): HachikaSnapshot {
  const next = structuredClone(snapshot);
  next.traces[trace.topic] = trace;
  next.lastInteractionAt = trace.lastUpdatedAt;
  return next;
}
