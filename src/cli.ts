declare const __VERSION__: string;

import { Command } from "commander";
import { runScc, getChurn, computeHotspots } from "./analyze.js";
import { formatReportTable, formatHotspotsTable } from "./format.js";
import type { ReportOutput, HotspotsOutput } from "./types.js";

const program = new Command();

program
  .name("obscene")
  .description(
    "Identify hotspot files — complex code that changes frequently",
  )
  .version(__VERSION__);

interface SharedOpts {
  top: string;
  format: string;
  exclude?: string[];
}

interface HotspotsOpts extends SharedOpts {
  months: string;
}

function addSharedOptions(cmd: Command): Command {
  return cmd
    .option("--top <n>", "limit to top N entries (0 = all)", "20")
    .option("--format <type>", "output format: json | table", "json")
    .option(
      "--exclude <patterns...>",
      "additional file patterns to exclude (e.g. *.generated.*)",
    );
}

// report command
addSharedOptions(
  program.command("report").description("per-file complexity data"),
).action((opts: SharedOpts) => {
  try {
    runReport(opts);
  } catch (err: unknown) {
    exitWithError(err);
  }
});

// hotspots command (default)
addSharedOptions(
  program
    .command("hotspots", { isDefault: true })
    .description("churn × complexity hotspot analysis (default)"),
)
  .option("--months <n>", "churn window in months", "3")
  .action((opts: HotspotsOpts) => {
    try {
      runHotspots(opts);
    } catch (err: unknown) {
      exitWithError(err);
    }
  });

function runReport(opts: SharedOpts): void {
  const top = parseInt(opts.top, 10);
  const files = runScc(opts.exclude);

  const totals = files.reduce(
    (acc, f) => ({
      totalComplexity: acc.totalComplexity + f.complexity,
      totalCode: acc.totalCode + f.code,
      totalLines: acc.totalLines + f.lines,
    }),
    { totalComplexity: 0, totalCode: 0, totalLines: 0 },
  );

  const limited = top > 0 ? files.slice(0, top) : files;

  const output: ReportOutput = {
    generated: new Date().toISOString(),
    summary: {
      ...totals,
      fileCount: files.length,
      avgComplexityPerFile:
        files.length > 0
          ? Math.round((totals.totalComplexity / files.length) * 10) / 10
          : 0,
      showing: limited.length,
    },
    files: limited,
  };

  if (opts.format === "table") {
    process.stdout.write(formatReportTable(output) + "\n");
  } else {
    process.stdout.write(JSON.stringify(output, null, 2) + "\n");
  }
}

function runHotspots(opts: HotspotsOpts): void {
  const top = parseInt(opts.top, 10);
  const months = parseInt(opts.months, 10);
  const files = runScc(opts.exclude);
  const churn = getChurn(months);
  const hotspots = computeHotspots(files, churn);

  const limited = top > 0 ? hotspots.slice(0, top) : hotspots;

  const tierCounts = { danger: 0, watch: 0, stable: 0 };
  for (const h of hotspots) {
    tierCounts[h.tier]++;
  }

  const totalScore = hotspots.reduce((sum, h) => sum + h.hotspotScore, 0);

  const output: HotspotsOutput = {
    generated: new Date().toISOString(),
    churnWindow: `${months} months`,
    totalScore,
    tierCounts,
    totalHotspots: hotspots.length,
    showing: limited.length,
    hotspots: limited,
  };

  if (opts.format === "table") {
    process.stdout.write(formatHotspotsTable(output) + "\n");
  } else {
    process.stdout.write(JSON.stringify(output, null, 2) + "\n");
  }
}

function exitWithError(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
}

program.parse();
