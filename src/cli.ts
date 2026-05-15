declare const __VERSION__: string;

import { existsSync, writeFileSync } from "node:fs";
import { Command } from "commander";
import {
  computeAllRankings,
  computeComposite,
  computeCoupling,
  detectIgnorePatterns,
  formatIgnoreFile,
  getAuthors,
  getChurn,
  getCoChanges,
  getDefects,
  getNestingDepths,
  getTrackedFiles,
  readIgnoreFile,
  runScc,
  UNIVERSAL_IGNORE_GROUPS,
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
    "complexity × churn. Complex code that changes often poses maintenance risk.\nSource: McCabe cyclomatic complexity (1976) via scc · Strength: objective, language-agnostic · Limit: parsers and state machines score high naturally",
  nesting:
    "maxNesting × churn. Deeply nested code that changes often is harder to reason about.\nSource: cognitive complexity research (SonarSource, G. Ann Campbell 2018) · Strength: catches hard-to-follow control flow · Limit: some patterns (error chains, config) legitimately nest deep",
  defects:
    "fixes × churn. Count of fix: commits touching the file × churn. High values can mean latent fragility, but they also flag features that got debugged thoroughly — read the fix-commit history before concluding which.\nSource: change-history metrics (Moser, Pedrycz & Succi 2008) via conventional commits (fix: prefix) · Strength: direct fix-history signal · Limit: counts fix activity, not defects per se; requires consistent fix: convention",
  authors:
    "authors × churn. Files touched by many authors and changing often may lack clear ownership.\nSource: code ownership research (Bird et al. 2011, Microsoft) · Strength: flags diffuse ownership risk · Limit: doesn't measure expertise depth, bot authors filtered automatically",
  composite:
    "Combined ranking using Reciprocal Rank Fusion (RRF) across all dimensions. Files appearing near the top of multiple rankings score highest.\nSource: RRF (Cormack et al. 2009) · Strength: robust to outliers, no normalization needed · Limit: equal weight across all dimensions",
  tier: "Relative ranking within THIS codebase (top 50% = hot, next 30% = warm, bottom 20% = cool). NOT an absolute quality grade — a hot file is under heavy load, not necessarily broken.",
  corpus:
    "Aggregate stats for the analyzed file set (post-exclude — files filtered by .obsignore or --exclude are not counted). When totalComplexity is 0, the rankings reflect size and churn only; HOT/WARM/COOL become relative groupings rather than risk labels.",
};

const COUPLING_GUIDE: Record<string, string> = {
  cochanges:
    "Times both files appeared in the same commit. Higher values suggest a dependency between the files. Same-directory pairs are excluded — only cross-directory pairs are shown.",
  degree:
    "Percentage: shared commits / min(churn of file1, file2) × 100. Shows how tightly coupled the pair is relative to their individual change rates. 100% means every change to the less-active file also touched the other.",
  totalComplexity:
    "Sum of both files' cyclomatic complexity. Highlights coupled pairs where the involved code is also complex — hidden dependency + high complexity compounds maintenance risk.",
  tier: "Relative ranking within THIS codebase's coupling pairs (top 50% = hot, next 30% = warm, bottom 20% = cool). NOT an absolute quality grade. 'hot' means this pair co-changes more than most — it may be intentional and fine.",
  deleted:
    "file1Deleted / file2Deleted are set when the file is no longer present at HEAD (deleted or renamed away). The coupling signal is historical — the pair is not actionable in the current tree.",
  lockstep:
    "Set when both files' total churn equals their co-change count over the window — i.e. they only ever changed together. The 100% degree is real but uninformative; treat the pair as a single unit from git's perspective.",
};

function addSharedOptions(cmd: Command): Command {
  return cmd
    .option("--top <n>", "limit to top N entries (0 = all)", "20")
    .option("--format <type>", "output format: json | table", "json")
    .option(
      "--exclude <patterns...>",
      "additional file patterns to exclude (also reads .obsignore / .obsceneignore)",
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

// init command
program
  .command("init")
  .description("generate a starter .obsignore based on project structure")
  .action(() => {
    try {
      runInit();
    } catch (err: unknown) {
      exitWithError(err);
    }
  });

function resolveExcludes(cliExcludes?: string[]): string[] {
  return [...readIgnoreFile(), ...(cliExcludes ?? [])];
}

function warnIfNoIgnoreFile(): void {
  if (!existsSync(".obsignore") && !existsSync(".obsceneignore")) {
    process.stderr.write(
      "hint: no .obsignore found — run `obscene init` to generate one with recommended exclusions\n",
    );
  }
}

function runReport(opts: SharedOpts): void {
  warnIfNoIgnoreFile();
  const top = parseInt(opts.top, 10);
  const allExcludes = resolveExcludes(opts.exclude);
  const files = runScc(allExcludes);

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
  warnIfNoIgnoreFile();
  const top = parseInt(opts.top, 10);
  const months = parseInt(opts.months, 10);
  const allExcludes = resolveExcludes(opts.exclude);
  const files = runScc(allExcludes);
  const churn = getChurn(months);
  const defects = getDefects(months);
  const authors = getAuthors(months);
  const nestingDepths = getNestingDepths(files.map((f) => f.file));
  const { rankings, skipped } = computeAllRankings(
    files,
    churn,
    defects,
    nestingDepths,
    authors,
    top,
  );

  const composite = computeComposite(rankings, churn, top);

  let corpusTotalComplexity = 0;
  for (const f of files) corpusTotalComplexity += f.complexity;

  const output: HotspotsOutput = {
    generated: new Date().toISOString(),
    guide: HOTSPOTS_GUIDE,
    churnWindow: `${months} months`,
    rankings,
    skipped: Object.keys(skipped).length > 0 ? skipped : undefined,
    composite,
    corpus: {
      fileCount: files.length,
      totalComplexity: corpusTotalComplexity,
    },
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
  warnIfNoIgnoreFile();
  const top = parseInt(opts.top, 10);
  const months = parseInt(opts.months, 10);
  const minCochanges = parseInt(opts.minCochanges, 10);
  const allExcludes = resolveExcludes(opts.exclude);
  const files = runScc(allExcludes);
  const churn = getChurn(months);
  const cochanges = getCoChanges(months, allExcludes);

  const complexityMap = new Map<string, number>();
  for (const f of files) {
    complexityMap.set(f.file, f.complexity);
  }

  const trackedFiles = getTrackedFiles();
  const couplings = computeCoupling(
    cochanges,
    churn,
    complexityMap,
    minCochanges,
    trackedFiles,
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

function runInit(): void {
  if (existsSync(".obsignore")) {
    throw new Error(
      ".obsignore already exists. Remove it first to regenerate.",
    );
  }
  if (existsSync(".obsceneignore")) {
    throw new Error(
      ".obsceneignore already exists. Remove it first to regenerate.",
    );
  }

  const detected = detectIgnorePatterns();
  const content = formatIgnoreFile(detected);
  writeFileSync(".obsignore", content);

  const universalCount = UNIVERSAL_IGNORE_GROUPS.reduce(
    (sum, g) => sum + g.patterns.length,
    0,
  );

  process.stderr.write(
    `Created .obsignore with ${universalCount} universal exclusions`,
  );
  if (detected.length > 0) {
    process.stderr.write(` + ${detected.length} detected patterns:\n`);
    for (const p of detected) {
      process.stderr.write(`  ${p.pattern.padEnd(20)} ${p.comment}\n`);
    }
  } else {
    process.stderr.write(" (no project-specific patterns detected)\n");
  }
}

function exitWithError(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
}

program.parse();
