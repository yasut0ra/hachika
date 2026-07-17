import { basename, join, resolve } from "node:path";

import { writeTextFileAtomic } from "./atomic-file.js";
import {
  readLifeMetricsLogWithDiagnostics,
  type LifeMetricsRecord,
} from "./life-metrics.js";

export interface LifeReportInput {
  label: string;
  dataDir: string;
  metricsLogPath: string;
}

export interface LifeReportCoverage {
  recordCount: number;
  nonEmptyLines: number;
  invalidLines: number;
  invalidDateRecords: number;
  startDate: string | null;
  endDate: string | null;
  spanDays: number;
  missingDateCount: number;
  missingDates: string[];
  duplicateDates: string[];
  timeZones: string[];
  implementationRevisions: string[];
}

export interface LifeReportIndividual extends LifeReportInput {
  records: LifeMetricsRecord[];
  coverage: LifeReportCoverage;
}

export interface LifeReportModel {
  title: string;
  generatedAt: string;
  individuals: LifeReportIndividual[];
}

export interface LifeReportMetric {
  id: string;
  group: string;
  label: string;
  scale: "unit" | "count";
  select: (record: LifeMetricsRecord) => number | null;
}

export interface WriteLifeReportOptions {
  outputBasePath: string;
  title?: string;
  generatedAt?: Date;
  inputs: LifeReportInput[];
}

export interface WriteLifeReportResult {
  model: LifeReportModel;
  markdownPath: string;
  htmlPath: string;
}

export interface LifeReportCliOptions {
  help: boolean;
  title: string;
  outputBasePath: string;
  inputs: LifeReportInput[];
}

const COLOR_PALETTE = [
  "#2f6fed",
  "#df6b3f",
  "#1a9b78",
  "#9b59b6",
  "#c49102",
  "#d1495b",
  "#347a8a",
  "#6d6f78",
];

export const LIFE_REPORT_METRICS: readonly LifeReportMetric[] = [
  unitMetric("drive.continuity", "Constitution / drives", "Continuity set-point", (r) =>
    r.constitution.driveSetPoints?.continuity,
  ),
  unitMetric("drive.pleasure", "Constitution / drives", "Pleasure set-point", (r) =>
    r.constitution.driveSetPoints?.pleasure,
  ),
  unitMetric("drive.curiosity", "Constitution / drives", "Curiosity set-point", (r) =>
    r.constitution.driveSetPoints?.curiosity,
  ),
  unitMetric("drive.relation", "Constitution / drives", "Relation set-point", (r) =>
    r.constitution.driveSetPoints?.relation,
  ),
  unitMetric("drive.expansion", "Constitution / drives", "Expansion set-point", (r) =>
    r.constitution.driveSetPoints?.expansion,
  ),
  unitMetric("body.energy", "Constitution / body", "Energy set-point", (r) =>
    r.constitution.bodySetPoints?.energy,
  ),
  unitMetric("body.tension", "Constitution / body", "Tension set-point", (r) =>
    r.constitution.bodySetPoints?.tension,
  ),
  unitMetric("body.boredom", "Constitution / body", "Boredom set-point", (r) =>
    r.constitution.bodySetPoints?.boredom,
  ),
  unitMetric("body.loneliness", "Constitution / body", "Loneliness set-point", (r) =>
    r.constitution.bodySetPoints?.loneliness,
  ),
  unitMetric("urge.contact", "Constitution / urges", "Contact urge baseline", (r) =>
    r.urgeBaselines?.contactUrge,
  ),
  unitMetric("urge.closure", "Constitution / urges", "Closure urge baseline", (r) =>
    r.urgeBaselines?.closureUrge,
  ),
  unitMetric("urge.recall", "Constitution / urges", "Recall urge baseline", (r) =>
    r.urgeBaselines?.recallUrge,
  ),
  unitMetric("urge.world", "Constitution / urges", "World urge baseline", (r) =>
    r.urgeBaselines?.worldUrge,
  ),
  unitMetric("urge.silence", "Constitution / urges", "Silence need baseline", (r) =>
    r.urgeBaselines?.silenceNeed,
  ),
  unitMetric("attachment.setpoint", "Relation and plasticity", "Attachment set-point", (r) =>
    r.constitution.attachmentSetPoint,
  ),
  unitMetric("attachment.current", "Relation and plasticity", "Current attachment", (r) =>
    r.attachment,
  ),
  unitMetric("plasticity", "Relation and plasticity", "Plasticity", (r) =>
    r.constitution.plasticity,
  ),
  unitMetric("aspirations.strength", "Direction and voice", "Aspiration total strength", (r) =>
    r.aspirations.totalStrength,
  ),
  countMetric("aspirations.active", "Direction and voice", "Active aspirations", (r) =>
    r.aspirations.activeCount,
  ),
  unitMetric("voice.brevity", "Direction and voice", "Voice brevity bias", (r) =>
    r.voice.brevityBias,
  ),
  countMetric("voice.openings", "Direction and voice", "Preferred openings", (r) =>
    Array.isArray(r.voice.preferredOpenings) ? r.voice.preferredOpenings.length : null,
  ),
  countMetric("journal.count", "Accumulation and activity", "Journal entries", (r) =>
    r.journal.count,
  ),
  countMetric("turns.last24", "Accumulation and activity", "User turns (last 24h)", (r) =>
    r.turns.last24Hours,
  ),
  countMetric("turns.total", "Accumulation and activity", "Conversation turns (total)", (r) =>
    r.turns.total,
  ),
];

export async function loadLifeReportModel(
  inputs: LifeReportInput[],
  options: {
    title?: string;
    generatedAt?: Date;
  } = {},
): Promise<LifeReportModel> {
  const individuals = await Promise.all(
    inputs.map(async (input) => {
      const log = await readLifeMetricsLogWithDiagnostics(input.metricsLogPath);
      const validRecords = log.records.filter((record) => isCalendarDate(record.date));
      const records = validRecords.sort(compareMetricRecords);

      return {
        ...input,
        records,
        coverage: buildCoverage(records, {
          nonEmptyLines: log.nonEmptyLines,
          invalidLines: log.invalidLines,
          invalidDateRecords: log.records.length - validRecords.length,
        }),
      };
    }),
  );

  return {
    title: options.title?.trim() || "Hachika longitudinal report",
    generatedAt: (options.generatedAt ?? new Date()).toISOString(),
    individuals,
  };
}

export async function writeLifeReport(
  options: WriteLifeReportOptions,
): Promise<WriteLifeReportResult> {
  const model = await loadLifeReportModel(options.inputs, {
    ...(options.title ? { title: options.title } : {}),
    ...(options.generatedAt ? { generatedAt: options.generatedAt } : {}),
  });
  const outputBasePath = stripReportExtension(options.outputBasePath);
  const markdownPath = `${outputBasePath}.md`;
  const htmlPath = `${outputBasePath}.html`;

  await writeTextFileAtomic(markdownPath, renderLifeReportMarkdown(model));
  await writeTextFileAtomic(htmlPath, renderLifeReportHtml(model));

  return {
    model,
    markdownPath,
    htmlPath,
  };
}

export function renderLifeReportMarkdown(model: LifeReportModel): string {
  const lines: string[] = [
    `# ${model.title}`,
    "",
    `Generated: ${model.generatedAt}`,
    "",
    "## Coverage",
    "",
    "| Individual | Records | Period | Span | Missing | Invalid rows | Duplicate dates | Revisions |",
    "| --- | ---: | --- | ---: | ---: | ---: | ---: | --- |",
  ];

  for (const individual of model.individuals) {
    const coverage = individual.coverage;
    lines.push(
      `| ${escapeMarkdownCell(individual.label)} | ${coverage.recordCount} | ${formatPeriod(coverage)} | ${coverage.spanDays}d | ${coverage.missingDateCount} | ${coverage.invalidLines + coverage.invalidDateRecords} | ${coverage.duplicateDates.length} | ${escapeMarkdownCell(coverage.implementationRevisions.join(", ") || "none")} |`,
    );
  }

  lines.push("", "## Latest values and change from first record", "");
  lines.push(
    `| Metric | ${model.individuals
      .flatMap((individual) => [
        `${escapeMarkdownCell(individual.label)} latest`,
        `${escapeMarkdownCell(individual.label)} Δ`,
      ])
      .join(" | ")} |`,
  );
  lines.push(
    `| --- | ${model.individuals.flatMap(() => ["---:", "---:"]).join(" | ")} |`,
  );

  for (const metric of LIFE_REPORT_METRICS) {
    const values = model.individuals.flatMap((individual) => {
      const summary = summarizeMetric(individual.records, metric);
      return [
        formatMetricValue(summary.latest, metric.scale),
        formatMetricDelta(summary.delta, metric.scale),
      ];
    });
    lines.push(`| ${metric.label} | ${values.join(" | ")} |`);
  }

  lines.push("", "## Data quality notes", "");
  const notes = buildDataQualityNotes(model);
  if (notes.length === 0) {
    lines.push("- No gaps, malformed rows, duplicate dates, or time-zone changes detected.");
  } else {
    lines.push(...notes.map((note) => `- ${note}`));
  }

  lines.push(
    "",
    "The self-contained HTML report generated beside this file contains the longitudinal line charts.",
    "",
  );
  return lines.join("\n");
}

export function renderLifeReportHtml(model: LifeReportModel): string {
  const groups = [...new Set(LIFE_REPORT_METRICS.map((metric) => metric.group))];
  const coverageRows = model.individuals
    .map((individual, index) => {
      const coverage = individual.coverage;
      return `<tr><td><span class="swatch" style="background:${COLOR_PALETTE[index % COLOR_PALETTE.length]}"></span>${escapeHtml(individual.label)}</td><td>${coverage.recordCount}</td><td>${escapeHtml(formatPeriod(coverage))}</td><td>${coverage.spanDays}</td><td>${coverage.missingDateCount}</td><td>${coverage.invalidLines + coverage.invalidDateRecords}</td><td>${coverage.duplicateDates.length}</td><td>${escapeHtml(coverage.implementationRevisions.join(", ") || "none")}</td></tr>`;
    })
    .join("");
  const summaryRows = LIFE_REPORT_METRICS.map((metric) => {
    const cells = model.individuals
      .map((individual) => {
        const summary = summarizeMetric(individual.records, metric);
        return `<td>${formatMetricValue(summary.latest, metric.scale)}</td><td class="delta">${formatMetricDelta(summary.delta, metric.scale)}</td>`;
      })
      .join("");
    return `<tr><th>${escapeHtml(metric.label)}</th>${cells}</tr>`;
  }).join("");
  const summaryHeaders = model.individuals
    .map(
      (individual) =>
        `<th>${escapeHtml(individual.label)} latest</th><th>${escapeHtml(individual.label)} Δ</th>`,
    )
    .join("");
  const notes = buildDataQualityNotes(model);
  const noteHtml =
    notes.length === 0
      ? `<p class="ok">No gaps, malformed rows, duplicate dates, or time-zone changes detected.</p>`
      : `<ul>${notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>`;
  const charts = groups
    .map(
      (group) => `<section><h2>${escapeHtml(group)}</h2><div class="charts">${LIFE_REPORT_METRICS.filter(
        (metric) => metric.group === group,
      )
        .map((metric) => renderMetricChart(model, metric))
        .join("")}</div></section>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(model.title)}</title>
<style>
:root{color-scheme:light;--ink:#1f2937;--muted:#667085;--line:#d8dee8;--panel:#fff;--wash:#f5f7fb;--accent:#2f6fed}*{box-sizing:border-box}body{margin:0;background:var(--wash);color:var(--ink);font:14px/1.5 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:1280px;margin:auto;padding:32px 24px 64px}h1{font-size:30px;margin:0 0 6px}h2{font-size:20px;margin:32px 0 12px}.meta{color:var(--muted);margin:0 0 24px}.panel,.chart{background:var(--panel);border:1px solid var(--line);border-radius:12px;box-shadow:0 1px 2px #1018280d}.panel{padding:18px;overflow:auto;margin:14px 0}.charts{display:grid;grid-template-columns:repeat(auto-fit,minmax(430px,1fr));gap:14px}.chart{padding:14px}.chart h3{font-size:15px;margin:0 0 8px}.chart svg{display:block;width:100%;height:auto}.grid{stroke:#e5e9f0;stroke-width:1}.axis-label{fill:#727b8b;font-size:11px}.legend{display:flex;gap:16px;flex-wrap:wrap;margin:8px 0 0;color:var(--muted)}.swatch{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px}table{width:100%;border-collapse:collapse;white-space:nowrap}th,td{border-bottom:1px solid var(--line);padding:8px 10px;text-align:left}thead th{font-size:12px;color:var(--muted);background:#fafbfc}td:not(:first-child),thead th:not(:first-child){text-align:right}.delta{color:#475467}.ok{color:#16755b}.empty{color:var(--muted);padding:48px 0;text-align:center}@media(max-width:620px){main{padding:20px 12px}.charts{grid-template-columns:1fr}.panel{padding:10px}}
</style>
</head>
<body><main>
<h1>${escapeHtml(model.title)}</h1>
<p class="meta">Generated ${escapeHtml(model.generatedAt)} · ${model.individuals.length} individual${model.individuals.length === 1 ? "" : "s"}</p>
<section><h2>Coverage</h2><div class="panel"><table><thead><tr><th>Individual</th><th>Records</th><th>Period</th><th>Span (days)</th><th>Missing</th><th>Invalid</th><th>Duplicates</th><th>Revisions</th></tr></thead><tbody>${coverageRows}</tbody></table></div></section>
<section><h2>Data quality</h2><div class="panel">${noteHtml}</div></section>
<section><h2>Latest values and change</h2><div class="panel"><table><thead><tr><th>Metric</th>${summaryHeaders}</tr></thead><tbody>${summaryRows}</tbody></table></div></section>
${charts}
</main></body></html>
`;
}

export function parseLifeReportCliArgs(
  args: string[],
  options: {
    cwd?: string;
    defaultDataDir: string;
  },
): LifeReportCliOptions {
  const cwd = options.cwd ?? process.cwd();
  const individuals: Array<{ label: string; dataDir: string }> = [];
  let output = "reports/life-report";
  let title = "Hachika longitudinal report";
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--help" || argument === "-h") {
      help = true;
      continue;
    }

    const [flag, inlineValue] = splitCliArgument(argument);
    if (flag === "--individual") {
      const value = inlineValue ?? args[++index];
      if (!value) {
        throw new Error("report_individual_required");
      }
      individuals.push(parseIndividualArgument(value, cwd));
      continue;
    }
    if (flag === "--output") {
      const value = inlineValue ?? args[++index];
      if (!value?.trim()) {
        throw new Error("report_output_required");
      }
      output = value;
      continue;
    }
    if (flag === "--title") {
      const value = inlineValue ?? args[++index];
      if (!value?.trim()) {
        throw new Error("report_title_required");
      }
      title = value.trim();
      continue;
    }
    throw new Error(`report_argument_unknown:${argument}`);
  }

  if (individuals.length === 0) {
    const dataDir = resolve(cwd, options.defaultDataDir);
    individuals.push({ label: basename(dataDir) || "hachika", dataDir });
  }
  const labels = new Set<string>();
  for (const individual of individuals) {
    if (labels.has(individual.label)) {
      throw new Error(`report_label_duplicate:${individual.label}`);
    }
    labels.add(individual.label);
  }

  return {
    help,
    title,
    outputBasePath: resolve(cwd, stripReportExtension(output)),
    inputs: individuals.map((individual) => ({
      ...individual,
      metricsLogPath: join(individual.dataDir, "metrics-log.jsonl"),
    })),
  };
}

export function lifeReportUsage(): string {
  return [
    "Hachika longitudinal report",
    "",
    "Usage:",
    "  npm run report",
    "  npm run report -- --individual A=individuals/a --individual B=individuals/b",
    "",
    "Options:",
    "  --individual LABEL=DATA_DIR  Add an individual (repeatable)",
    "  --output PATH               Output base path (default: reports/life-report)",
    "  --title TEXT                Report title",
    "  --help                      Show this help",
  ].join("\n");
}

function buildCoverage(
  records: LifeMetricsRecord[],
  diagnostics: {
    nonEmptyLines: number;
    invalidLines: number;
    invalidDateRecords: number;
  },
): LifeReportCoverage {
  const dates = records.map((record) => record.date);
  const uniqueDates = [...new Set(dates)];
  const duplicateDates = uniqueDates.filter(
    (date) => dates.filter((candidate) => candidate === date).length > 1,
  );
  const startDate = uniqueDates[0] ?? null;
  const endDate = uniqueDates.at(-1) ?? null;
  const spanDays =
    startDate && endDate ? calendarDayDifference(startDate, endDate) + 1 : 0;
  const missingDates =
    startDate && endDate ? listMissingDates(startDate, endDate, new Set(uniqueDates)) : [];

  return {
    recordCount: records.length,
    ...diagnostics,
    startDate,
    endDate,
    spanDays,
    missingDateCount: Math.max(0, spanDays - uniqueDates.length),
    missingDates: missingDates.slice(0, 30),
    duplicateDates,
    timeZones: [...new Set(records.map((record) => record.timeZone))],
    implementationRevisions: [
      ...new Set(records.map((record) => record.implementationRevision)),
    ],
  };
}

function summarizeMetric(
  records: LifeMetricsRecord[],
  metric: LifeReportMetric,
): { first: number | null; latest: number | null; delta: number | null } {
  const values = records
    .map((record) => metric.select(record))
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const first = values[0] ?? null;
  const latest = values.at(-1) ?? null;
  return {
    first,
    latest,
    delta: first === null || latest === null ? null : latest - first,
  };
}

function renderMetricChart(
  model: LifeReportModel,
  metric: LifeReportMetric,
): string {
  const allRecords = model.individuals.flatMap((individual) => individual.records);
  if (allRecords.length === 0) {
    return `<article class="chart"><h3>${escapeHtml(metric.label)}</h3><div class="empty">No records</div></article>`;
  }

  const startMs = Math.min(...allRecords.map((record) => calendarDateToMs(record.date)));
  const endMs = Math.max(...allRecords.map((record) => calendarDateToMs(record.date)));
  const allValues = allRecords
    .map((record) => metric.select(record))
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const maxValue =
    metric.scale === "unit" ? 1 : Math.max(1, Math.ceil(Math.max(0, ...allValues)));
  const width = 560;
  const height = 190;
  const left = 42;
  const right = 14;
  const top = 12;
  const bottom = 30;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const yTicks = [0, maxValue / 2, maxValue];
  const grid = yTicks
    .map((value) => {
      const y = top + plotHeight - (value / maxValue) * plotHeight;
      return `<line class="grid" x1="${left}" y1="${roundSvg(y)}" x2="${width - right}" y2="${roundSvg(y)}"/><text class="axis-label" x="${left - 7}" y="${roundSvg(y + 4)}" text-anchor="end">${escapeHtml(formatAxisValue(value, metric.scale))}</text>`;
    })
    .join("");
  const series = model.individuals
    .map((individual, index) => {
      const points = individual.records.flatMap((record) => {
        const value = metric.select(record);
        if (value === null || !Number.isFinite(value)) {
          return [];
        }
        const x =
          startMs === endMs
            ? left + plotWidth / 2
            : left +
              ((calendarDateToMs(record.date) - startMs) / (endMs - startMs)) *
                plotWidth;
        const bounded = Math.min(maxValue, Math.max(0, value));
        const y = top + plotHeight - (bounded / maxValue) * plotHeight;
        return [{ x, y }];
      });
      if (points.length === 0) {
        return "";
      }
      const color = COLOR_PALETTE[index % COLOR_PALETTE.length]!;
      const polyline = points.map((point) => `${roundSvg(point.x)},${roundSvg(point.y)}`).join(" ");
      const dots =
        points.length <= 120
          ? points
              .map(
                (point) =>
                  `<circle cx="${roundSvg(point.x)}" cy="${roundSvg(point.y)}" r="2.3" fill="${color}"/>`,
              )
              .join("")
          : "";
      return `<polyline points="${polyline}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>${dots}`;
    })
    .join("");
  const legend = model.individuals
    .map(
      (individual, index) =>
        `<span><span class="swatch" style="background:${COLOR_PALETTE[index % COLOR_PALETTE.length]}"></span>${escapeHtml(individual.label)}</span>`,
    )
    .join("");

  return `<article class="chart"><h3>${escapeHtml(metric.label)}</h3><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(metric.label)} over time">${grid}${series}<text class="axis-label" x="${left}" y="${height - 7}">${escapeHtml(msToCalendarDate(startMs))}</text><text class="axis-label" x="${width - right}" y="${height - 7}" text-anchor="end">${escapeHtml(msToCalendarDate(endMs))}</text></svg><div class="legend">${legend}</div></article>`;
}

function buildDataQualityNotes(model: LifeReportModel): string[] {
  const notes: string[] = [];
  for (const individual of model.individuals) {
    const coverage = individual.coverage;
    if (coverage.recordCount === 0) {
      notes.push(`${individual.label}: no valid metrics records.`);
    }
    if (coverage.invalidLines > 0) {
      notes.push(`${individual.label}: ${coverage.invalidLines} malformed or unsupported JSONL line(s) skipped.`);
    }
    if (coverage.invalidDateRecords > 0) {
      notes.push(`${individual.label}: ${coverage.invalidDateRecords} record(s) with invalid calendar dates skipped.`);
    }
    if (coverage.missingDateCount > 0) {
      const preview = coverage.missingDates.join(", ");
      notes.push(`${individual.label}: ${coverage.missingDateCount} missing day(s)${preview ? ` (${preview}${coverage.missingDateCount > coverage.missingDates.length ? ", …" : ""})` : ""}.`);
    }
    if (coverage.duplicateDates.length > 0) {
      notes.push(`${individual.label}: duplicate dates: ${coverage.duplicateDates.join(", ")}.`);
    }
    if (coverage.timeZones.length > 1) {
      notes.push(`${individual.label}: time-zone changed: ${coverage.timeZones.join(", ")}.`);
    }
  }
  return notes;
}

function unitMetric(
  id: string,
  group: string,
  label: string,
  select: (record: LifeMetricsRecord) => unknown,
): LifeReportMetric {
  return {
    id,
    group,
    label,
    scale: "unit",
    select: (record) => finiteNumber(select(record)),
  };
}

function countMetric(
  id: string,
  group: string,
  label: string,
  select: (record: LifeMetricsRecord) => unknown,
): LifeReportMetric {
  return {
    id,
    group,
    label,
    scale: "count",
    select: (record) => finiteNumber(select(record)),
  };
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseIndividualArgument(
  value: string,
  cwd: string,
): { label: string; dataDir: string } {
  const separator = value.indexOf("=");
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error(`report_individual_invalid:${value}`);
  }
  const label = value.slice(0, separator).trim();
  const dataDirValue = value.slice(separator + 1).trim();
  if (!label || !dataDirValue) {
    throw new Error(`report_individual_invalid:${value}`);
  }
  return {
    label,
    dataDir: resolve(cwd, dataDirValue),
  };
}

function splitCliArgument(argument: string): [string, string | undefined] {
  const separator = argument.indexOf("=");
  return separator < 0
    ? [argument, undefined]
    : [argument.slice(0, separator), argument.slice(separator + 1)];
}

function stripReportExtension(value: string): string {
  return value.replace(/\.(?:md|html)$/iu, "");
}

function compareMetricRecords(a: LifeMetricsRecord, b: LifeMetricsRecord): number {
  return a.date.localeCompare(b.date) || a.recordedAt.localeCompare(b.recordedAt);
}

function isCalendarDate(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function calendarDateToMs(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`);
}

function msToCalendarDate(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
}

function calendarDayDifference(startDate: string, endDate: string): number {
  return Math.round(
    (calendarDateToMs(endDate) - calendarDateToMs(startDate)) /
      (24 * 60 * 60 * 1000),
  );
}

function listMissingDates(
  startDate: string,
  endDate: string,
  present: Set<string>,
): string[] {
  const missing: string[] = [];
  const endMs = calendarDateToMs(endDate);
  for (
    let cursor = calendarDateToMs(startDate);
    cursor <= endMs;
    cursor += 24 * 60 * 60 * 1000
  ) {
    const date = msToCalendarDate(cursor);
    if (!present.has(date)) {
      missing.push(date);
    }
  }
  return missing;
}

function formatPeriod(coverage: LifeReportCoverage): string {
  return coverage.startDate && coverage.endDate
    ? `${coverage.startDate} → ${coverage.endDate}`
    : "no data";
}

function formatMetricValue(value: number | null, scale: "unit" | "count"): string {
  if (value === null) {
    return "—";
  }
  if (scale === "count" && Number.isInteger(value)) {
    return String(value);
  }
  return value.toFixed(3);
}

function formatMetricDelta(value: number | null, scale: "unit" | "count"): string {
  if (value === null) {
    return "—";
  }
  const formatted = formatMetricValue(Math.abs(value), scale);
  return `${value >= 0 ? "+" : "−"}${formatted}`;
}

function formatAxisValue(value: number, scale: "unit" | "count"): string {
  return scale === "unit" ? value.toFixed(1) : Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function roundSvg(value: number): string {
  return (Math.round(value * 100) / 100).toString();
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/gu, "\\|").replace(/\r?\n/gu, " ");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}
