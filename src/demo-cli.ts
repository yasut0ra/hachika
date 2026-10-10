import { existsSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { syncArtifacts } from "./artifacts.js";
import { resolveHachikaDataPaths } from "./data-paths.js";
import { liveDemoLife, resolveSystemTimeZone } from "./demo-life.js";
import { saveSnapshot } from "./persistence.js";

// npm run demo: 30日分を生きた個体を用意して、そのまま Web UI を開く。
// 2回目以降は同じ個体が暮らし続けるので、閉じていた時間も「おかえり」に残る
const DEMO_MARKER = ".hachika-demo";
const fresh = process.argv.includes("--fresh");
const timeZone = process.env.HACHIKA_METRICS_TIME_ZONE?.trim() || resolveSystemTimeZone();
const paths = resolveHachikaDataPaths({
  dataDir: process.env.HACHIKA_DEMO_DIR?.trim() || "demo/hachika",
});
const markerPath = join(paths.dataDir, DEMO_MARKER);

if (fresh && existsSync(paths.snapshotPath)) {
  // 実データを消さないよう、デモが作ったフォルダだけを作り直す
  if (!existsSync(markerPath)) {
    console.error(`[demo] ${paths.dataDir} はデモ用のフォルダではないので作り直しません`);
    process.exit(1);
  }

  for (const target of [
    paths.snapshotPath,
    paths.residentStatusPath,
    paths.metricsLogPath,
    paths.artifactsDir,
    paths.archiveSnapshotsDir,
  ]) {
    await rm(target, { recursive: true, force: true });
  }
}

if (!existsSync(paths.snapshotPath)) {
  console.log("[demo] 30日分の暮らしを生成しています…");
  const lived = await liveDemoLife({ endAt: new Date(), timeZone, individualId: "demo" });
  const saved = await saveSnapshot(paths.snapshotPath, lived);
  await syncArtifacts(saved, paths.artifactsDir);
  await writeFile(markerPath, "npm run demo が作った個体です。--fresh で作り直せます。\n", "utf8");
  console.log(
    `[demo] 会話${saved.conversationCount}回、夢${saved.journal.filter((entry) => entry.source === "dream").length}件、日誌${saved.journal.length}件の個体を用意しました`,
  );
} else {
  console.log("[demo] 前回の個体がそのまま暮らしています (作り直すときは npm run demo -- --fresh)");
}

process.env.HACHIKA_DATA_DIR = paths.dataDir;
process.env.HACHIKA_UI_PORT ||= "3044";
process.env.HACHIKA_INDIVIDUAL_ID ||= "demo";
process.env.HACHIKA_METRICS_TIME_ZONE = timeZone;

await import("./ui-server.js");
