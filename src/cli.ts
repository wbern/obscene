declare const __VERSION__: string;

import { Command } from "commander";
import {
  computeCoupling,
  computeHotspots,
  getAuthors,
  getChurn,
  getCoChanges,
  getDefects,
  getNestingDepths,
  runScc,
} from "./analyze.js";
import {
  formatCouplingTable,
  formatHotspotsTable,
  formatReportTable,
} from "./format.js";
import type { CouplingOutput, HotspotsOutput, ReportOutput } from "./types.js";

const program = new Command();

program
  .name("obscene")
  .description("Identify hotspot files — complex code that changes frequently")
  .version(__VERSION__);

interface SharedOpts {
  top: string;
  format: string;
  exclude?: string[];
}

interface HotspotsOpts extends SharedOpts {
  months: string;
}

interface CouplingOpts extends SharedOpts {
  months: string;
  minCochanges: string;
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

// coupling command
addSharedOptions(
  program
    .command("coupling")
    .description(
      "temporal coupling — files that change together across directories",
    ),
)
  .option("--months <n>", "churn window in months", "3")
  .option("--min-cochanges <n>", "minimum shared commits to include", "2")
  .action((opts: CouplingOpts) => {
    try {
      runCoupling(opts);
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
    process.stdout.write(`${formatReportTable(output)}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  }
}

function runHotspots(opts: HotspotsOpts): void {
  const top = parseInt(opts.top, 10);
  const months = parseInt(opts.months, 10);
  const files = runScc(opts.exclude);
  const churn = getChurn(months);
  const defects = getDefects(months);
  const authors = getAuthors(months);
  const nestingDepths = getNestingDepths(files.map((f) => f.file));
  const hotspots = computeHotspots(
    files,
    churn,
    defects,
    nestingDepths,
    authors,
  );

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
    process.stdout.write(`${formatHotspotsTable(output)}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  }
}

function runCoupling(opts: CouplingOpts): void {
  const top = parseInt(opts.top, 10);
  const months = parseInt(opts.months, 10);
  const minCochanges = parseInt(opts.minCochanges, 10);
  const files = runScc(opts.exclude);
  const churn = getChurn(months);
  const cochanges = getCoChanges(months, opts.exclude);

  const complexityMap = new Map<string, number>();
  for (const f of files) {
    complexityMap.set(f.file, f.complexity);
  }

  const couplings = computeCoupling(
    cochanges,
    churn,
    complexityMap,
    minCochanges,
  );

  const limited = top > 0 ? couplings.slice(0, top) : couplings;

  const tierCounts = { danger: 0, watch: 0, stable: 0 };
  for (const c of couplings) {
    tierCounts[c.tier]++;
  }

  const totalScore = couplings.reduce((sum, c) => sum + c.couplingScore, 0);

  const output: CouplingOutput = {
    generated: new Date().toISOString(),
    churnWindow: `${months} months`,
    minCochanges,
    totalScore,
    tierCounts,
    totalCouplings: couplings.length,
    showing: limited.length,
    couplings: limited,
  };

  if (opts.format === "table") {
    process.stdout.write(`${formatCouplingTable(output)}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  }
}

function exitWithError(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
}

program.parse();
