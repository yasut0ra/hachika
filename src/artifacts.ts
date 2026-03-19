import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import {
  deriveEffectiveTraceStaleAt,
  deriveTraceTendingMode,
  readTraceLifecycle,
  sortedTraces,
} from "./traces.js";
import type {
  HachikaSnapshot,
  TraceAction,
  TraceEntry,
  TraceLifecyclePhase,
  TraceStatus,
  TraceTendingMode,
} from "./types.js";

const INDEX_FILE_NAME = "index.md";
const TRACE_FILE_PREFIX = "trace-";
const TENDING_ORDER: readonly TraceTendingMode[] = ["deepen", "preserve", "steady"];

export interface ArtifactFile {
  topic: string;
  kind: TraceEntry["kind"];
  status: TraceStatus;
  lastAction: TraceAction;
  lifecyclePhase: TraceLifecyclePhase;
  archivedAt: string | null;
  reopenedAt: string | null;
  reopenCount: number;
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
    const tending = deriveTraceTendingMode(snapshot, trace);
    const lifecycle = readTraceLifecycle(trace);
    const fileName = buildTraceFileName(trace);
    const relativePath =
      lifecycle.phase === "archived"
        ? join("archive", fileName)
        : join(tending, fileName);
    const absolutePath = join(root, relativePath);

    return {
      topic: trace.topic,
      kind: trace.kind,
      status: trace.status,
      lastAction: trace.lastAction,
      lifecyclePhase: lifecycle.phase,
      archivedAt: lifecycle.archivedAt,
      reopenedAt: lifecycle.reopenedAt,
      reopenCount: lifecycle.reopenCount,
      tending,
      focus: trace.work.focus,
      confidence: trace.work.confidence,
      blockers: trace.work.blockers,
      pendingNextStep: trace.artifact.nextSteps[0] ?? null,
      staleAt: trace.work.staleAt,
      effectiveStaleAt: deriveEffectiveTraceStaleAt(snapshot, trace),
      updatedAt: trace.lastUpdatedAt,
      fileName,
      absolutePath,
      relativePath,
    };
  });
}

export async function syncArtifacts(
  snapshot: HachikaSnapshot,
  artifactsDir: string,
): Promise<ArtifactSyncResult> {
  const root = resolve(artifactsDir);
  const files = describeArtifactFiles(snapshot, root);
  const currentRelativePaths = new Set(files.map((file) => file.relativePath));

  await mkdir(root, { recursive: true });

  for (const file of files) {
    const trace = snapshot.traces[file.topic];

    if (!trace) {
      continue;
    }

    await mkdir(dirname(file.absolutePath), { recursive: true });
    await writeFile(file.absolutePath, renderArtifactDocument(snapshot, trace), "utf8");
  }

  await writeFile(join(root, INDEX_FILE_NAME), renderArtifactIndex(snapshot, files), "utf8");

  for (const tending of TENDING_ORDER) {
    const tendingDir = join(root, tending);
    const tendingFiles = files.filter(
      (file) => file.lifecyclePhase === "live" && file.tending === tending,
    );

    await mkdir(tendingDir, { recursive: true });
    await writeFile(
      join(tendingDir, INDEX_FILE_NAME),
      renderTendingArtifactIndex(snapshot, tending, tendingFiles),
      "utf8",
    );
  }

  const archiveDir = join(root, "archive");
  const archivedFiles = files.filter((file) => file.lifecyclePhase === "archived");
  await mkdir(archiveDir, { recursive: true });
  await writeFile(
    join(archiveDir, INDEX_FILE_NAME),
    renderArchiveArtifactIndex(snapshot, archivedFiles),
    "utf8",
  );

  const removedFiles: string[] = [];
  const existingRelativePaths = await listMaterializedTracePaths(root);

  for (const relativePath of existingRelativePaths) {
    if (currentRelativePaths.has(relativePath)) {
      continue;
    }

    await unlink(join(root, relativePath));
    removedFiles.push(relativePath);
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
  lines.push("Sections:");
  for (const tending of TENDING_ORDER) {
    lines.push(`- ${tending}/index.md`);
  }
  lines.push("- archive/index.md");
  lines.push("");

  for (const tending of TENDING_ORDER) {
    const sectionFiles = files.filter(
      (file) => file.lifecyclePhase === "live" && file.tending === tending,
    );

    if (sectionFiles.length === 0) {
      continue;
    }

    lines.push(`## ${formatTendingHeading(tending)}`);
    lines.push("");

    for (const file of sectionFiles) {
      const trace = snapshot.traces[file.topic];

      if (!trace) {
        continue;
      }

      appendArtifactIndexEntry(lines, trace, file, file.relativePath);
    }

    lines.push("");
  }

  const archivedFiles = files.filter((file) => file.lifecyclePhase === "archived");
  if (archivedFiles.length > 0) {
    lines.push("## Archive");
    lines.push("");
    for (const file of archivedFiles) {
      const trace = snapshot.traces[file.topic];

      if (!trace) {
        continue;
      }

      appendArtifactIndexEntry(lines, trace, file, file.relativePath);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function renderTendingArtifactIndex(
  snapshot: HachikaSnapshot,
  tending: TraceTendingMode,
  files: ArtifactFile[],
): string {
  const lines = [`# Hachika Artifacts: ${formatTendingHeading(tending)}`, ""];

  lines.push(`Updated: ${snapshot.lastInteractionAt ?? "unknown"}`);
  lines.push("Root Index: ../index.md");
  lines.push("");

  if (files.length === 0) {
    lines.push(`No ${tending} artifacts right now.`);
    lines.push("");
    return `${lines.join("\n")}\n`;
  }

  for (const file of files) {
    const trace = snapshot.traces[file.topic];

    if (!trace) {
      continue;
    }

    appendArtifactIndexEntry(lines, trace, file, file.fileName);
  }

  return `${lines.join("\n")}\n`;
}

function renderArchiveArtifactIndex(
  snapshot: HachikaSnapshot,
  files: ArtifactFile[],
): string {
  const lines = ["# Hachika Artifacts: Archive", ""];

  lines.push(`Updated: ${snapshot.lastInteractionAt ?? "unknown"}`);
  lines.push("Root Index: ../index.md");
  lines.push("");

  if (files.length === 0) {
    lines.push("No archived artifacts right now.");
    lines.push("");
    return `${lines.join("\n")}\n`;
  }

  for (const file of files) {
    const trace = snapshot.traces[file.topic];

    if (!trace) {
      continue;
    }

    appendArtifactIndexEntry(lines, trace, file, file.fileName);
  }

  return `${lines.join("\n")}\n`;
}

function appendArtifactIndexEntry(
  lines: string[],
  trace: TraceEntry,
  file: ArtifactFile,
  pathLabel: string,
): void {
  lines.push(`- ${trace.topic} (${trace.kind}/${trace.status}) -> ${pathLabel}`);
  lines.push(`  - lifecycle: ${file.lifecyclePhase}`);
  lines.push(`  - last action: ${trace.lastAction}`);
  lines.push(`  - tending: ${file.tending}`);
  if (file.archivedAt) {
    lines.push(`  - archived at: ${file.archivedAt}`);
  }
  if (file.reopenedAt) {
    lines.push(`  - reopened at: ${file.reopenedAt}`);
  }
  if (file.reopenCount > 0) {
    lines.push(`  - reopen count: ${file.reopenCount}`);
  }
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

async function listMaterializedTracePaths(
  root: string,
  currentDir = root,
): Promise<string[]> {
  const entries = await readdir(currentDir, { withFileTypes: true });
  const relativePaths: string[] = [];

  for (const entry of entries) {
    const absolutePath = join(currentDir, entry.name);

    if (entry.isDirectory()) {
      relativePaths.push(...await listMaterializedTracePaths(root, absolutePath));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (!entry.name.startsWith(TRACE_FILE_PREFIX) || !entry.name.endsWith(".md")) {
      continue;
    }

    relativePaths.push(relative(root, absolutePath) || entry.name);
  }

  return relativePaths;
}

export function renderArtifactDocument(
  snapshot: HachikaSnapshot,
  trace: TraceEntry,
): string {
  const lines = [`# ${trace.topic}`, ""];
  const tending = deriveTraceTendingMode(snapshot, trace);
  const lifecycle = readTraceLifecycle(trace);

  lines.push(`- Kind: ${trace.kind}`);
  lines.push(`- Status: ${trace.status}`);
  lines.push(`- Lifecycle: ${lifecycle.phase}`);
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
  lines.push(`- Archived At: ${lifecycle.archivedAt ?? "none"}`);
  lines.push(`- Reopened At: ${lifecycle.reopenedAt ?? "none"}`);
  lines.push(`- Reopen Count: ${lifecycle.reopenCount}`);
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

function formatTendingHeading(tending: TraceTendingMode): string {
  switch (tending) {
    case "deepen":
      return "Deepen";
    case "preserve":
      return "Preserve";
    case "steady":
      return "Steady";
  }
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
