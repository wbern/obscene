declare const __VERSION__: string;

import { Command } from "commander";
import {
  computeAllRankings,
  computeComposite,
  computeCoupling,
  getAuthors,
  getChurn,
  getCoChanges,
  getDefects,
  getNestingDepths,
  runScc,
} from "./analyze.js";
import {
  formatCompositeTable,
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

const REPORT_GUIDE: Record<string, string> = {
  complexity:
    "Cyclomatic complexity (branch/loop count). NOT a quality judgment — a 500-line parser will naturally score high. Compare density, not raw values.",
  complexityDensity:
    "Complexity per line of code. Normalizes for file size. >0.25 suggests dense logic worth reviewing; <0.10 is typical for straightforward code.",
  comments:
    "Comment line count. Low comments in high-density files may indicate under-documented logic. High comments alone is not a problem.",
};

const HOTSPOTS_GUIDE: Record<string, string> = {
  rankings:
    "Four independent ranking tables, each scoring files by a different metric × churn. A file may rank high in one dimension but not others.",
  complexity:
    "complexity × churn. Ranks files by combined risk: complex code that changes often.",
  nesting:
    "maxNesting × churn. Deeply nested code that changes often is harder to reason about.",
  defects:
    "defects × churn. Files with fix: commits that also churn heavily may contain latent bugs.",
  authors:
    "authors × churn. Files touched by many authors and changing often may lack clear ownership.",
  composite:
    "Combined ranking using Reciprocal Rank Fusion (RRF) across all dimensions. Files appearing near the top of multiple rankings score highest.",
  tier: "Relative ranking within THIS codebase (top 50% = hot, next 30% = warm, bottom 20% = cool). NOT an absolute quality grade — a hot file is under heavy load, not necessarily broken.",
};

const COUPLING_GUIDE: Record<string, string> = {
  cochanges:
    "Times both files appeared in the same commit. Higher values suggest a dependency between the files. Same-directory pairs are excluded — only cross-directory pairs are shown.",
  degree:
    "Percentage: shared commits / min(churn of file1, file2) × 100. Shows how tightly coupled the pair is relative to their individual change rates. 100% means every change to the less-active file also touched the other.",
  totalComplexity:
    "Sum of both files' cyclomatic complexity. Highlights coupled pairs where the involved code is also complex — hidden dependency + high complexity compounds maintenance risk.",
  tier: "Relative ranking within THIS codebase's coupling pairs (top 50% = hot, next 30% = warm, bottom 20% = cool). NOT an absolute quality grade. 'hot' means this pair co-changes more than most — it may be intentional and fine.",
};

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
    guide: REPORT_GUIDE,
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
  const rankings = computeAllRankings(
    files,
    churn,
    defects,
    nestingDepths,
    authors,
    top,
  );

  const composite = computeComposite(rankings, churn, top);

  const output: HotspotsOutput = {
    generated: new Date().toISOString(),
    guide: HOTSPOTS_GUIDE,
    churnWindow: `${months} months`,
    rankings,
    composite,
  };

  if (opts.format === "table") {
    process.stdout.write(`${formatHotspotsTable(output)}\n`);
    if (composite.entries.length > 0) {
      process.stdout.write(`\n${formatCompositeTable(composite)}\n`);
    }
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

  const tierCounts = { hot: 0, warm: 0, cool: 0 };
  for (const c of couplings) {
    tierCounts[c.tier]++;
  }

  const totalScore = couplings.reduce((sum, c) => sum + c.couplingScore, 0);

  const output: CouplingOutput = {
    generated: new Date().toISOString(),
    guide: COUPLING_GUIDE,
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
