import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";

import {
  deriveEffectiveTraceStaleAt,
  deriveTraceTendingMode,
  sortedTraces,
} from "./traces.js";
import type {
  HachikaSnapshot,
  TraceAction,
  TraceEntry,
  TraceStatus,
  TraceTendingMode,
} from "./types.js";

const INDEX_FILE_NAME = "index.md";
const TRACE_FILE_PREFIX = "trace-";

export interface ArtifactFile {
  topic: string;
  kind: TraceEntry["kind"];
  status: TraceStatus;
  lastAction: TraceAction;
  tending: TraceTendingMode;
  focus: string | null;
  confidence: number;
  blockers: string[];
  pendingNextStep: string | null;
  staleAt: string | null;
  effectiveStaleAt: string | null;
  updatedAt: string;
  fileName: string;
  absolutePath: string;
  relativePath: string;
}

export interface ArtifactSyncResult {
  files: ArtifactFile[];
  removedFiles: string[];
}

export function describeArtifactFiles(
  snapshot: HachikaSnapshot,
  artifactsDir: string,
): ArtifactFile[] {
  const root = resolve(artifactsDir);

  return sortedTraces(snapshot, 64).map((trace) => {
    const fileName = buildTraceFileName(trace);
    const absolutePath = join(root, fileName);

    return {
      topic: trace.topic,
      kind: trace.kind,
      status: trace.status,
      lastAction: trace.lastAction,
      tending: deriveTraceTendingMode(snapshot, trace),
      focus: trace.work.focus,
      confidence: trace.work.confidence,
      blockers: trace.work.blockers,
      pendingNextStep: trace.artifact.nextSteps[0] ?? null,
      staleAt: trace.work.staleAt,
      effectiveStaleAt: deriveEffectiveTraceStaleAt(snapshot, trace),
      updatedAt: trace.lastUpdatedAt,
      fileName,
      absolutePath,
      relativePath: relative(process.cwd(), absolutePath) || fileName,
    };
  });
}

export async function syncArtifacts(
  snapshot: HachikaSnapshot,
  artifactsDir: string,
): Promise<ArtifactSyncResult> {
  const root = resolve(artifactsDir);
  const files = describeArtifactFiles(snapshot, root);
  const currentFileNames = new Set(files.map((file) => file.fileName));

  await mkdir(root, { recursive: true });

  for (const file of files) {
    const trace = snapshot.traces[file.topic];

    if (!trace) {
      continue;
    }

    await writeFile(file.absolutePath, renderArtifactDocument(snapshot, trace), "utf8");
  }

  await writeFile(join(root, INDEX_FILE_NAME), renderArtifactIndex(snapshot, files), "utf8");

  const removedFiles: string[] = [];
  const entries = await readdir(root, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    if (!entry.name.startsWith(TRACE_FILE_PREFIX) || !entry.name.endsWith(".md")) {
      continue;
    }

    if (currentFileNames.has(entry.name)) {
      continue;
    }

    await unlink(join(root, entry.name));
    removedFiles.push(entry.name);
  }

  return {
    files,
    removedFiles,
  };
}

function renderArtifactIndex(
  snapshot: HachikaSnapshot,
  files: ArtifactFile[],
): string {
  const lines = ["# Hachika Artifacts", ""];

  if (files.length === 0) {
    lines.push("No materialized traces yet.");
    lines.push("");
    lines.push(`Updated: ${snapshot.lastInteractionAt ?? "never"}`);
    return `${lines.join("\n")}\n`;
  }

  lines.push(`Updated: ${snapshot.lastInteractionAt ?? "unknown"}`);
  lines.push("");

  for (const file of files) {
    const trace = snapshot.traces[file.topic];

    if (!trace) {
      continue;
    }

    lines.push(
      `- ${trace.topic} (${trace.kind}/${trace.status}) -> ${basename(file.relativePath)}`,
    );
    lines.push(`  - last action: ${trace.lastAction}`);
    lines.push(`  - tending: ${file.tending}`);
    lines.push(`  - focus: ${trace.work.focus ?? "none"}`);
    lines.push(`  - confidence: ${trace.work.confidence.toFixed(2)}`);
    if (trace.work.blockers.length > 0) {
      lines.push(`  - blockers: ${trace.work.blockers.join(" / ")}`);
    }
    lines.push(`  - ${trace.summary}`);
    if (trace.artifact.nextSteps[0]) {
      lines.push(`  - pending next step: ${trace.artifact.nextSteps[0]}`);
    }
    if (trace.work.staleAt) {
      lines.push(`  - stale at: ${trace.work.staleAt}`);
    }
    if (file.effectiveStaleAt && file.effectiveStaleAt !== trace.work.staleAt) {
      lines.push(`  - effective stale at: ${file.effectiveStaleAt}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export function renderArtifactDocument(
  snapshot: HachikaSnapshot,
  trace: TraceEntry,
): string {
  const lines = [`# ${trace.topic}`, ""];
  const tending = deriveTraceTendingMode(snapshot, trace);

  lines.push(`- Kind: ${trace.kind}`);
  lines.push(`- Status: ${trace.status}`);
  lines.push(`- Last Action: ${trace.lastAction}`);
  lines.push(`- Tending: ${tending}`);
  lines.push(`- Source Motive: ${trace.sourceMotive}`);
  lines.push(`- Focus: ${trace.work.focus ?? "none"}`);
  lines.push(`- Confidence: ${trace.work.confidence.toFixed(2)}`);
  lines.push(`- Blockers: ${trace.work.blockers.length > 0 ? trace.work.blockers.join(" | ") : "none"}`);
  lines.push(`- Salience: ${trace.salience.toFixed(2)}`);
  lines.push(`- Mentions: ${trace.mentions}`);
  lines.push(`- Created: ${trace.createdAt}`);
  lines.push(`- Updated: ${trace.lastUpdatedAt}`);
  lines.push(`- Pending Next Step: ${trace.artifact.nextSteps[0] ?? "none"}`);
  lines.push(`- Stale At: ${trace.work.staleAt ?? "none"}`);
  lines.push(`- Effective Stale At: ${deriveEffectiveTraceStaleAt(snapshot, trace) ?? "none"}`);
  lines.push("");
  lines.push("## Summary");
  lines.push(trace.summary);
  lines.push("");

  appendArtifactSection(lines, "Memo", trace.artifact.memo);
  appendArtifactSection(lines, "Fragments", trace.artifact.fragments);
  appendArtifactSection(lines, "Decisions", trace.artifact.decisions);
  appendArtifactSection(lines, "Next Steps", trace.artifact.nextSteps);

  return `${lines.join("\n")}\n`;
}

function appendArtifactSection(
  lines: string[],
  heading: string,
  items: string[],
): void {
  if (items.length === 0) {
    return;
  }

  lines.push(`## ${heading}`);

  for (const item of items) {
    lines.push(`- ${item}`);
  }

  lines.push("");
}

function buildTraceFileName(trace: TraceEntry): string {
  const slug = slugifyTopic(trace.topic);
  const hash = hashTopic(trace.topic);
  const suffix = slug.length > 0 ? `${slug}-${hash}` : hash;

  return `${TRACE_FILE_PREFIX}${suffix}.md`;
}

function slugifyTopic(topic: string): string {
  const normalized = topic
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized.slice(0, 32);
}

function hashTopic(topic: string): string {
  let hash = 2166136261;

  for (const character of topic) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}
