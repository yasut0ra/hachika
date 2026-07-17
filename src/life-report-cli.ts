import { resolveHachikaDataPaths } from "./data-paths.js";
import { loadDotEnv } from "./env.js";
import {
  lifeReportUsage,
  parseLifeReportCliArgs,
  writeLifeReport,
} from "./life-report.js";

loadDotEnv();

try {
  const dataPaths = resolveHachikaDataPaths();
  const options = parseLifeReportCliArgs(process.argv.slice(2), {
    defaultDataDir: dataPaths.dataDir,
  });

  if (options.help) {
    console.log(lifeReportUsage());
  } else {
    const result = await writeLifeReport({
      outputBasePath: options.outputBasePath,
      title: options.title,
      inputs: options.inputs,
    });
    const recordCount = result.model.individuals.reduce(
      (sum, individual) => sum + individual.coverage.recordCount,
      0,
    );

    console.log(`report markdown:${result.markdownPath}`);
    console.log(`report html:${result.htmlPath}`);
    console.log(
      `individuals:${result.model.individuals.length} records:${recordCount}`,
    );

    if (recordCount === 0) {
      console.error("[report] no valid metrics records found");
      process.exitCode = 1;
    }
  }
} catch (error) {
  console.error(
    `[report] error: ${error instanceof Error ? error.message : "life_report_failed"}`,
  );
  process.exitCode = 1;
}
