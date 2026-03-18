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

  const markdown = renderArtifactDocument(trace);

  assert.match(markdown, /^# 設計/m);
  assert.match(markdown, /Status: active/);
  assert.match(markdown, /Last Action: expanded/);
  assert.match(markdown, /Focus: 責務ごとに整理する/);
  assert.match(markdown, /Confidence: 0.68/);
  assert.match(markdown, /Blockers: 境界が曖昧/);
  assert.match(markdown, /Pending Next Step: 責務ごとに整理する/);
  assert.match(markdown, /Stale At: 2026-03-21T01:00:00.000Z/);
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
      salience: 0.91,
      mentions: 3,
      createdAt: "2026-03-19T00:00:00.000Z",
      lastUpdatedAt: "2026-03-19T02:00:00.000Z",
    });

    const result = await syncArtifacts(snapshot, tempDir);
    const described = describeArtifactFiles(snapshot, tempDir);

    assert.equal(result.files.length, 1);
    assert.equal(described.length, 1);

    const artifactBody = await readFile(result.files[0]!.absolutePath, "utf8");
    const indexBody = await readFile(join(tempDir, "index.md"), "utf8");

    assert.match(artifactBody, /Kind: decision/);
    assert.match(artifactBody, /Status: resolved/);
    assert.match(artifactBody, /Last Action: resolved/);
    assert.match(artifactBody, /Focus: 記録として保存した/);
    assert.match(artifactBody, /Confidence: 0.94/);
    assert.match(artifactBody, /## Decisions/);
    assert.match(artifactBody, /記録として保存した/);
    assert.match(indexBody, /設計 \(decision\/resolved\)/);
    assert.match(indexBody, /last action: resolved/);
    assert.match(indexBody, /confidence: 0.94/);
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
