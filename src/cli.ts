declare const __VERSION__: string;

import { existsSync, writeFileSync } from "node:fs";
import { Command } from "commander";
import {
  computeCoupling,
  computeDelta,
  computeHotspotsCore,
  computeSnapshot,
  couplingConfidence,
  detectDefaultBranch,
  detectIgnorePatterns,
  formatIgnoreFile,
  getChangedFiles,
  getChurn,
  getCoChanges,
  getCommitsInWindow,
  getComplexityDeltas,
  getHistoryCoverage,
  getTrackedFiles,
  readIgnoreFile,
  runScc,
  sliceCoreForDisplay,
  UNIVERSAL_IGNORE_GROUPS,
  withWorktreeAt,
} from "./analyze.js";
import {
  formatCompositeTable,
  formatCouplingTable,
  formatHotspotsTable,
  formatReportTable,
} from "./format.js";
import type {
  ComplexityDelta,
  CouplingOutput,
  DeltaInfo,
  HistoryCoverageInfo,
  HotspotDelta,
  HotspotSnapshot,
  HotspotsOutput,
  ReportOutput,
} from "./types.js";

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
  base?: string | boolean;
  fullDelta?: boolean;
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
    "complexity × churn. Complex code that changes often poses maintenance risk.\nMetric concept: McCabe cyclomatic complexity (1976) via scc · Strength: objective, language-agnostic · Limit: parsers and state machines score high naturally",
  nesting:
    "maxNesting × churn. Deeply nested code that changes often is harder to reason about.\nMetric concept: cognitive complexity research (SonarSource, G. Ann Campbell 2018) · Strength: catches hard-to-follow control flow · Limit: some patterns (error chains, config) legitimately nest deep",
  defects:
    "fixes × churn. Count of fix: commits touching the file × churn. High values can mean latent fragility, but they also flag features that got debugged thoroughly — read the fix-commit history before concluding which.\nMetric concept: change-history metrics (Moser, Pedrycz & Succi 2008) via conventional commits (fix: prefix) · Strength: direct fix-history signal · Limit: counts fix activity, not defects per se; requires consistent fix: convention",
  authors:
    "authors × churn. Files touched by many authors and changing often may lack clear ownership. MinAuth side-column counts contributors with <5% of file commits (Bird et al. FSE 2011) — '—' means the file has fewer than 2 commits, too few to call anyone *minor*.\nMetric concept: code ownership research (Bird et al. 2011, Microsoft); Co-authored-by trailers folded into author set to close the squash-merge gap · Strength: flags diffuse ownership risk · Limit: doesn't measure expertise depth, bot authors filtered automatically",
  composite:
    "Combined ranking using Reciprocal Rank Fusion (RRF) across all dimensions. Files appearing near the top of multiple rankings score highest.\nMetric concept: RRF (Cormack et al. 2009) · Strength: robust to outliers, no normalization needed · Limit: equal weight across all dimensions",
  tier: "Relative ranking within THIS codebase (top 50% = hot, next 30% = warm, bottom 20% = cool). NOT an absolute quality grade — a hot file is under heavy load, not necessarily broken.",
  corpus:
    "Aggregate stats for the analyzed file set (post-exclude — files filtered by .obsignore or --exclude are not counted). When totalComplexity is 0, the rankings reflect size and churn only; HOT/WARM/COOL become relative groupings rather than risk labels.",
  confidence:
    "Epistemic stamp on each ranking — INCONCLUSIVE / WEAK / PLAUSIBLE / ACCEPTABLE. These are engineering-judgment sample-size tiers, with the weak floor for defects matching code-maat's --min-revs default of 5. ACCEPTABLE is the ceiling — the tool never claims certainty about code quality, only that the sample supports the ranking. INCONCLUSIVE rankings are surfaced under skipped rather than ranked.",
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
    "Set when shared commits / max(churn) ≥ 0.9 — both files almost always change together over the window. Typical of generator/mirror pairs (README ↔ src/README, *.pb.go ↔ *.proto). The coupling signal is real but uninformative; treat the pair as a single unit from git's perspective.",
  confidence:
    "Epistemic stamp on the coupling table — INCONCLUSIVE / WEAK / PLAUSIBLE / ACCEPTABLE. Tied to the number of commits in the analysis window. The weak floor of 5 matches code-maat's --min-revs default (Adam Tornhill); higher tiers are engineering judgment. ACCEPTABLE means the sample supports the ranking; it never asserts the couplings themselves are bad.",
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
  .option(
    "--base [ref]",
    "delta mode: filter rankings to files changed since this ref (bare flag auto-detects main/master)",
  )
  .option(
    "--full-delta",
    "with --base, run the full hotspots pipeline against the base ref too and emit a structured before/after diff (slower; tier transitions, score deltas, new/deleted files)",
  )
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

function hasIgnoreFile(): boolean {
  return existsSync(".obsignore") || existsSync(".obsceneignore");
}

function warnIfNoIgnoreFile(): void {
  if (!hasIgnoreFile()) {
    process.stderr.write(
      "hint: no .obsignore found — run `obscene init` to generate one with recommended exclusions\n",
    );
  }
}

function warnHistoryCoverage(months: number): HistoryCoverageInfo {
  const coverage = getHistoryCoverage(months);
  if (coverage.underCovered) {
    process.stderr.write(
      `warning: git history covers ~${coverage.spanDays}d, but --months window is ${coverage.windowDays}d — ` +
        "count-based confidence won't reflect time-based trust on a young repo\n",
    );
  }
  return coverage;
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

function attachComplexityDeltas(
  rankings: HotspotsOutput["rankings"],
  composite: HotspotsOutput["composite"],
  deltas: Map<string, ComplexityDelta>,
): void {
  for (const ranking of Object.values(rankings)) {
    for (const entry of ranking.entries) {
      const d = deltas.get(entry.file);
      if (d) entry.complexityDelta = d;
    }
  }
  if (composite) {
    for (const entry of composite.entries) {
      const d = deltas.get(entry.file);
      if (d) entry.complexityDelta = d;
    }
  }
}

function resolveBaseRef(raw: string | boolean): string {
  if (typeof raw === "string") return raw;
  // Commander emits `true` for bare `--base` with no value. (`false` is not
  // a value the parser produces for this flag shape, but the type union from
  // commander includes it.)
  const detected = detectDefaultBranch();
  if (!detected) {
    throw new Error(
      "--base used without a ref but no default branch found (looked for main, master). " +
        "Specify the base ref explicitly, e.g. --base <branch-or-sha>.",
    );
  }
  return detected;
}

function runHotspots(opts: HotspotsOpts): void {
  warnIfNoIgnoreFile();
  const filtered = hasIgnoreFile();
  const top = parseInt(opts.top, 10);
  const months = parseInt(opts.months, 10);
  const historyCoverage = warnHistoryCoverage(months);
  const allExcludes = resolveExcludes(opts.exclude);
  let files = runScc(allExcludes);

  if (opts.fullDelta && opts.base === undefined) {
    throw new Error(
      "--full-delta requires --base. Specify a base ref, e.g. --base main --full-delta.",
    );
  }

  let delta: DeltaInfo | undefined;
  let fullDelta: HotspotDelta | undefined;
  let modeCHeadCore: ReturnType<typeof computeHotspotsCore> | undefined;
  if (opts.base !== undefined) {
    const baseRef = resolveBaseRef(opts.base);
    const changed = getChangedFiles(baseRef);
    if (changed.size === 0) {
      process.stderr.write(`No files changed since ${baseRef}.\n`);
      const empty: HotspotsOutput = {
        generated: new Date().toISOString(),
        guide: HOTSPOTS_GUIDE,
        churnWindow: `${months} months`,
        historyCoverage,
        delta: { base: baseRef, head: "HEAD", changedFiles: [] },
        rankings: {},
        corpus: { fileCount: 0, totalComplexity: 0, filtered },
      };
      if (opts.format === "table") {
        process.stdout.write(`${formatHotspotsTable(empty)}\n`);
      } else {
        process.stdout.write(`${JSON.stringify(empty, null, 2)}\n`);
      }
      return;
    }
    delta = {
      base: baseRef,
      head: "HEAD",
      changedFiles: [...changed].sort(),
    };

    if (opts.fullDelta) {
      // Mode C: full corpus on both sides. Don't filter `files`; the user
      // wants whole-codebase rankings plus a cross-snapshot diff.
      try {
        const baseSnapshot = withWorktreeAt(baseRef, (path) =>
          computeSnapshot({ months, excludes: allExcludes, cwd: path }),
        );
        modeCHeadCore = computeHotspotsCore(files, months, 0);
        const headSnapshot: HotspotSnapshot = {
          files,
          rankings: modeCHeadCore.rankings,
          skipped: modeCHeadCore.skipped,
          composite: modeCHeadCore.composite,
          corpus: modeCHeadCore.corpus,
        };
        fullDelta = computeDelta(baseRef, "HEAD", baseSnapshot, headSnapshot);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(
          `warning: full-delta unavailable (${message}). ` +
            "Falling back to filtered rankings.\n",
        );
        files = files.filter((f) => changed.has(f.file));
        modeCHeadCore = undefined;
        // Surface the downgrade in the structured output so JSON consumers
        // don't silently get a B-shape payload when they asked for C.
        delta.fallback = { from: "full-delta", reason: message };
      }
    } else {
      files = files.filter((f) => changed.has(f.file));
    }
  }

  const { rankings, skipped, composite, corpus } = modeCHeadCore
    ? sliceCoreForDisplay(modeCHeadCore, top)
    : computeHotspotsCore(files, months, top);

  if (delta && fullDelta === undefined) {
    const newComplexity = new Map<string, number>();
    const fileList: string[] = [];
    for (const f of files) {
      newComplexity.set(f.file, f.complexity);
      fileList.push(f.file);
    }
    try {
      const deltas = getComplexityDeltas(delta.base, fileList, newComplexity);
      attachComplexityDeltas(rankings, composite, deltas);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `warning: complexity delta unavailable (${message}). ` +
          "Falling back to filtered rankings without per-file deltas.\n",
      );
    }
  }

  const output: HotspotsOutput = {
    generated: new Date().toISOString(),
    guide: HOTSPOTS_GUIDE,
    churnWindow: `${months} months`,
    historyCoverage,
    delta,
    fullDelta,
    rankings,
    skipped: Object.keys(skipped).length > 0 ? skipped : undefined,
    composite,
    corpus: { ...corpus, filtered },
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
  const historyCoverage = warnHistoryCoverage(months);
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
    historyCoverage,
    minCochanges,
    totalScore,
    tierCounts,
    tiers: tierCounts,
    totalCouplings: couplings.length,
    showing: limited.length,
    couplings: limited,
    confidence: couplingConfidence(getCommitsInWindow(months)),
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
