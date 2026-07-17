import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import { buildDailyLifeMetricsRecord } from "./life-metrics.js";
import {
  loadLifeReportModel,
  parseLifeReportCliArgs,
  renderLifeReportHtml,
  renderLifeReportMarkdown,
  writeLifeReport,
} from "./life-report.js";
import { createInitialSnapshot } from "./state.js";

test("life report summarizes coverage, gaps, invalid rows, and individual deltas", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "hachika-life-report-"));
  const aDir = join(rootDir, "a");
  const bDir = join(rootDir, "b");
  const aPath = join(aDir, "metrics-log.jsonl");
  const bPath = join(bDir, "metrics-log.jsonl");

  try {
    const aFirst = metricRecord("2026-07-17T12:00:00.000Z", 0.5, "rev-a");
    const aLatest = metricRecord("2026-07-19T12:00:00.000Z", 0.56, "rev-a");
    const bFirst = metricRecord("2026-07-18T12:00:00.000Z", 0.4, "rev-b");
    const bLatest = metricRecord("2026-07-19T12:00:00.000Z", 0.37, "rev-b");
    await writeJsonLines(aPath, [aFirst, "{broken", aLatest]);
    await writeJsonLines(bPath, [bFirst, bLatest]);

    const model = await loadLifeReportModel(
      [
        { label: "A", dataDir: aDir, metricsLogPath: aPath },
        { label: "B", dataDir: bDir, metricsLogPath: bPath },
      ],
      {
        title: "90-day experiment",
        generatedAt: new Date("2026-07-20T00:00:00.000Z"),
      },
    );

    assert.equal(model.individuals[0]?.coverage.recordCount, 2);
    assert.equal(model.individuals[0]?.coverage.invalidLines, 1);
    assert.equal(model.individuals[0]?.coverage.spanDays, 3);
    assert.equal(model.individuals[0]?.coverage.missingDateCount, 1);
    assert.deepEqual(model.individuals[0]?.coverage.missingDates, ["2026-07-18"]);
    assert.deepEqual(model.individuals[1]?.coverage.implementationRevisions, ["rev-b"]);

    const markdown = renderLifeReportMarkdown(model);
    assert.match(markdown, /# 90-day experiment/);
    assert.match(markdown, /A: 1 malformed or unsupported JSONL line/);
    assert.match(markdown, /A: 1 missing day.*2026-07-18/);
    assert.match(markdown, /Relation set-point \| 0\.560 \| \+0\.060 \| 0\.370 \| −0\.030/);

    const html = renderLifeReportHtml(model);
    assert.match(html, /<!doctype html>/);
    assert.match(html, /<svg viewBox="0 0 560 190"/);
    assert.match(html, /90-day experiment/);
    assert.match(html, /2026-07-17/);
    assert.match(html, /2026-07-19/);
    assert.doesNotMatch(html, /<script|<link[^>]+stylesheet|https?:\/\//u);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("life report flags duplicate dates, invalid dates, and time-zone changes", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "hachika-life-report-quality-"));
  const metricsLogPath = join(rootDir, "metrics-log.jsonl");
  const first = metricRecord("2026-07-17T12:00:00.000Z", 0.5, "rev-a");
  const duplicate = metricRecord("2026-07-17T18:00:00.000Z", 0.51, "rev-a");
  duplicate.timeZone = "Asia/Tokyo";
  const invalidDate = metricRecord("2026-07-18T12:00:00.000Z", 0.52, "rev-a");
  invalidDate.date = "not-a-date";

  try {
    await writeJsonLines(metricsLogPath, [first, duplicate, invalidDate]);
    const model = await loadLifeReportModel([
      { label: "A", dataDir: rootDir, metricsLogPath },
    ]);
    const coverage = model.individuals[0]?.coverage;

    assert.equal(coverage?.recordCount, 2);
    assert.equal(coverage?.invalidDateRecords, 1);
    assert.deepEqual(coverage?.duplicateDates, ["2026-07-17"]);
    assert.deepEqual(coverage?.timeZones, ["UTC", "Asia/Tokyo"]);
    const markdown = renderLifeReportMarkdown(model);
    assert.match(markdown, /record\(s\) with invalid calendar dates skipped/);
    assert.match(markdown, /duplicate dates: 2026-07-17/);
    assert.match(markdown, /time-zone changed: UTC, Asia\/Tokyo/);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("writeLifeReport creates Markdown and self-contained HTML beside one output base", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "hachika-life-report-write-"));
  const dataDir = join(rootDir, "individual");
  const metricsLogPath = join(dataDir, "metrics-log.jsonl");

  try {
    await writeJsonLines(metricsLogPath, [
      metricRecord("2026-07-17T12:00:00.000Z", 0.5, "rev-a"),
    ]);
    const result = await writeLifeReport({
      outputBasePath: join(rootDir, "reports", "life.html"),
      generatedAt: new Date("2026-07-20T00:00:00.000Z"),
      inputs: [{ label: "A", dataDir, metricsLogPath }],
    });

    assert.equal(result.markdownPath, join(rootDir, "reports", "life.md"));
    assert.equal(result.htmlPath, join(rootDir, "reports", "life.html"));
    assert.match(await readFile(result.markdownPath, "utf8"), /## Coverage/);
    assert.match(await readFile(result.htmlPath, "utf8"), /<svg/);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("report CLI accepts repeatable labeled individuals and a shared output", () => {
  const cwd = resolve("/tmp", "hachika-report-workspace");
  const options = parseLifeReportCliArgs(
    [
      "--individual",
      "A=individuals/a",
      "--individual=B=individuals/b",
      "--output",
      "reports/compare.html",
      "--title=Comparison",
    ],
    {
      cwd,
      defaultDataDir: join(cwd, "data"),
    },
  );

  assert.equal(options.title, "Comparison");
  assert.equal(options.outputBasePath, join(cwd, "reports", "compare"));
  assert.deepEqual(
    options.inputs.map((input) => [input.label, input.metricsLogPath]),
    [
      ["A", join(cwd, "individuals/a/metrics-log.jsonl")],
      ["B", join(cwd, "individuals/b/metrics-log.jsonl")],
    ],
  );
});

test("report CLI defaults to HACHIKA_DATA_DIR and rejects duplicate labels", () => {
  const cwd = resolve("/tmp", "hachika-report-default");
  const dataDir = join(cwd, "individuals", "a");
  const defaults = parseLifeReportCliArgs([], { cwd, defaultDataDir: dataDir });

  assert.equal(defaults.inputs[0]?.label, "a");
  assert.equal(defaults.inputs[0]?.metricsLogPath, join(dataDir, "metrics-log.jsonl"));
  assert.throws(
    () =>
      parseLifeReportCliArgs(
        ["--individual", "A=a", "--individual", "A=b"],
        { cwd, defaultDataDir: dataDir },
      ),
    /report_label_duplicate:A/,
  );
});

function metricRecord(
  timestamp: string,
  relationSetPoint: number,
  implementationRevision: string,
) {
  const snapshot = createInitialSnapshot();
  snapshot.constitution.driveSetPoints.relation = relationSetPoint;
  snapshot.attachment = relationSetPoint + 0.05;
  snapshot.journal = [
    {
      writtenAt: timestamp,
      source: "idle",
      mood: "curious",
      focus: "report",
      text: "記録する。",
    },
  ];
  snapshot.conversationCount = 3;
  return buildDailyLifeMetricsRecord(snapshot, {
    now: new Date(timestamp),
    timeZone: "UTC",
    implementationRevision,
  });
}

async function writeJsonLines(
  filePath: string,
  entries: Array<ReturnType<typeof metricRecord> | string>,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    `${entries
      .map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry)))
      .join("\n")}\n`,
    "utf8",
  );
}
