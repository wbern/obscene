import pc from "picocolors";
import { RANKING_DEFS } from "./analyze.js";
import {
  colorRow,
  padLeft,
  padRight,
  tierLabel,
  tierSummary,
  truncate,
} from "./color.js";
import type {
  ComplexityDelta,
  CompositeOutput,
  ConfidenceInfo,
  ConfidenceLevel,
  CouplingOutput,
  HistoryCoverageInfo,
  HotspotDelta,
  HotspotsOutput,
  RankingOutput,
  ReawakenedSection,
  ReportOutput,
  SumOfCouplingEntry,
} from "./types.js";

const CONFIDENCE_PALETTE: Record<ConfidenceLevel, (s: string) => string> = {
  inconclusive: pc.gray,
  weak: pc.yellow,
  plausible: pc.cyan,
  acceptable: pc.green,
};

function formatConfidenceStamp(c: ConfidenceInfo): string[] {
  const color = CONFIDENCE_PALETTE[c.level];
  return [color(`Confidence: ${c.level.toUpperCase()} — ${c.reason}`)];
}

const RANKING_LABELS_BY_KEY: Record<string, string> = Object.fromEntries(
  RANKING_DEFS.map((d) => [d.key, d.label]),
);

export function formatReportTable(output: ReportOutput): string {
  const lines: string[] = [];
  const { summary, files } = output;

  lines.push(
    `Complexity Report — ${summary.fileCount} files, ${summary.totalComplexity} total complexity`,
  );
  lines.push(
    `Showing: ${summary.showing} | Avg complexity/file: ${summary.avgComplexityPerFile}`,
  );
  lines.push("");

  lines.push(
    padRight("File", 60) +
      padLeft("Code", 8) +
      padLeft("Complexity", 12) +
      padLeft("Density", 9) +
      padLeft("Comments", 10),
  );
  lines.push("─".repeat(99));

  for (const f of files) {
    lines.push(
      padRight(truncate(f.file, 58), 60) +
        padLeft(String(f.code), 8) +
        padLeft(String(f.complexity), 12) +
        padLeft(f.complexityDensity.toFixed(2), 9) +
        padLeft(String(f.comments), 10),
    );
  }

  lines.push("");
  lines.push(
    pc.dim(
      "Complexity=cyclomatic branch/loop count | Density=complexity/code | Comments=comment lines",
    ),
  );
  lines.push(
    pc.dim(
      "High complexity is expected for parsers, state machines, and business logic. Compare density across files, not raw values.",
    ),
  );
  lines.push(pc.dim("Docs: https://github.com/wbern/obscene#metrics"));

  return lines.join("\n");
}

interface RankingColumnDef {
  header: string;
  width: number;
  align: "left" | "right";
  value: (entry: RankingOutput["entries"][0]) => string;
}

function formatDeltaValue(d: ComplexityDelta | undefined): string {
  if (!d) return "·";
  if (d.oldComplexity === null || d.change === null) return "new";
  if (d.change === 0) return "0";
  return d.change > 0 ? `+${d.change}` : String(d.change);
}

function formatRecentAuthors(authors: string[], authorCount: number): string {
  const visible = authors.join(", ");
  return authorCount > authors.length
    ? `${visible} +${authorCount - authors.length}`
    : visible;
}

function getRankingColumns(
  key: string,
  includeDelta: boolean,
  recentWindowDays?: number,
): RankingColumnDef[] {
  const base: RankingColumnDef[] = [
    {
      header: "File",
      width: 50,
      align: "left",
      value: (e) => truncate(e.file, 48),
    },
    {
      header: "Score",
      width: 8,
      align: "right",
      value: (e) => e.score.toLocaleString(),
    },
    {
      header: "%",
      width: 7,
      align: "right",
      value: (e) => e.percentOfTotal.toFixed(1),
    },
    {
      header: "Churn",
      width: 7,
      align: "right",
      value: (e) => String(e.churn),
    },
  ];

  const metricCols: Record<string, RankingColumnDef[]> = {
    complexity: [
      {
        header: "Cmplx",
        width: 7,
        align: "right",
        value: (e) => String(e.metricValue),
      },
      {
        header: "Dens",
        width: 7,
        align: "right",
        value: (e) => (e.metricDensity ?? 0).toFixed(2),
      },
    ],
    nesting: [
      {
        header: "Nest",
        width: 6,
        align: "right",
        value: (e) => String(e.metricValue),
      },
    ],
    defects: [
      {
        header: "Fixes",
        width: 6,
        align: "right",
        value: (e) => String(e.metricValue),
      },
      {
        header: "FxDns",
        width: 7,
        align: "right",
        value: (e) => (e.metricDensity ?? 0).toFixed(4),
      },
    ],
    authors: [
      {
        header: "Auth",
        width: 6,
        align: "right",
        value: (e) => String(e.metricValue),
      },
      {
        // MinAuth: contributors with < 5% of file commits (Bird et al.,
        // FSE 2011). Renders "—" when the file has < 2 commits (Greiler
        // 2015 floor) — too few commits to call anyone *minor*.
        header: "MinAuth",
        width: 9,
        align: "right",
        value: (e) =>
          e.minorAuthors === null || e.minorAuthors === undefined
            ? "—"
            : String(e.minorAuthors),
      },
    ],
  };

  const tierCol: RankingColumnDef = {
    header: "Tier",
    width: 12,
    align: "right",
    value: (e) => tierLabel(e.tier),
  };

  const deltaCol: RankingColumnDef = {
    header: "Δ",
    width: 7,
    align: "right",
    value: (e) => formatDeltaValue(e.complexityDelta),
  };

  const recentCols: RankingColumnDef[] =
    recentWindowDays !== undefined
      ? [
          {
            header: ` ${recentWindowDays}d-cmts`,
            width: 12,
            align: "left",
            value: (e) => ` ${e.recent ? String(e.recent.commits) : "·"}`,
          },
          {
            header: `${recentWindowDays}d-auths`,
            width: 24,
            align: "left",
            value: (e) =>
              e.recent
                ? truncate(
                    formatRecentAuthors(e.recent.authors, e.recent.authorCount),
                    22,
                  )
                : "—",
          },
        ]
      : [];

  return [
    ...base,
    ...(metricCols[key] ?? []),
    ...(includeDelta ? [deltaCol] : []),
    ...recentCols,
    tierCol,
  ];
}

const METRIC_EMOJI: Record<string, string> = {
  complexity: "🧬",
  nesting: "📏",
  defects: "🔧",
  authors: "👥",
};

function formatRankingTable(
  key: string,
  ranking: RankingOutput,
  description: string | undefined,
  includeDelta: boolean,
): string[] {
  const lines: string[] = [];
  const recentWindowDays = ranking.entries.find((e) => e.recent)?.recent
    ?.windowDays;
  const cols = getRankingColumns(key, includeDelta, recentWindowDays);
  const emoji = METRIC_EMOJI[key];
  const prefix = emoji ? `${emoji} ` : "";

  const title = ranking.label.toUpperCase().replace("CHURN", "🔄 CHURN");
  lines.push(
    `${prefix}${title} — Total score: ${ranking.totalScore.toLocaleString()}`,
  );
  lines.push(...formatConfidenceStamp(ranking.confidence));
  if (description) {
    for (const line of description.split("\n")) {
      lines.push(pc.dim(line));
    }
  }
  lines.push(
    ...tierSummary(ranking.tierCounts, ranking.showing, ranking.totalEntries),
  );
  lines.push("");

  const headerLine = cols
    .map((c) =>
      c.align === "left"
        ? padRight(c.header, c.width)
        : padLeft(c.header, c.width),
    )
    .join("");
  lines.push(headerLine);

  const totalWidth = cols.reduce((sum, c) => sum + c.width, 0);
  lines.push("─".repeat(totalWidth));

  for (const entry of ranking.entries) {
    const rowParts = cols.map((c) => {
      const val = c.value(entry);
      return c.align === "left"
        ? padRight(val, c.width)
        : padLeft(val, c.width);
    });
    const rawRow = rowParts.join("");
    lines.push(colorRow(entry.tier, rawRow));
  }

  return lines;
}

function formatFullDeltaSection(fd: HotspotDelta): string[] {
  const lines: string[] = [];
  lines.push("");
  lines.push(pc.cyan(`Full Delta — ${fd.base} → ${fd.head}`));
  lines.push(
    pc.dim(
      "Tier transitions are relative percentile bands — a file can shift tiers " +
        "because its absolute score moved OR because the rest of the corpus " +
        "moved around it. scoreChanges carries the absolute delta.",
    ),
  );

  const { enteredHot, enteredWarm, exitedHot, exitedWarm } = fd.tierTransitions;
  if (
    enteredHot.length === 0 &&
    enteredWarm.length === 0 &&
    exitedHot.length === 0 &&
    exitedWarm.length === 0 &&
    fd.newFiles.length === 0 &&
    fd.deletedFiles.length === 0
  ) {
    lines.push(pc.dim("No tier transitions, no new/deleted files."));
  } else {
    const pushFileList = (label: string, files: string[]): void => {
      if (files.length === 0) return;
      lines.push(label);
      for (const f of files.slice(0, 10)) lines.push(`    ${truncate(f, 80)}`);
      if (files.length > 10) {
        lines.push(pc.dim(`    … and ${files.length - 10} more`));
      }
    };
    pushFileList(pc.red(`  ↑ entered HOT (${enteredHot.length}):`), enteredHot);
    pushFileList(
      pc.yellow(`  ↑ entered WARM (${enteredWarm.length}):`),
      enteredWarm,
    );
    pushFileList(
      pc.green(`  ↓ cooled out of HOT (${exitedHot.length}):`),
      exitedHot,
    );
    pushFileList(
      pc.green(`  ↓ cooled out of WARM (${exitedWarm.length}):`),
      exitedWarm,
    );
    pushFileList(
      pc.cyan(`  + new files (${fd.newFiles.length}):`),
      fd.newFiles,
    );
    pushFileList(
      pc.cyan(`  − deleted files (${fd.deletedFiles.length}):`),
      fd.deletedFiles,
    );
  }

  const cx = fd.perDimensionDeltas.complexity;
  const fc = fd.perDimensionDeltas.fileCount;
  const cxSign = cx.change > 0 ? "+" : "";
  const fcSign = fc.change > 0 ? "+" : "";
  lines.push("");
  lines.push(
    pc.dim(
      `Corpus: complexity ${cx.oldTotal} → ${cx.newTotal} (${cxSign}${cx.change}) · ` +
        `files ${fc.oldTotal} → ${fc.newTotal} (${fcSign}${fc.change})`,
    ),
  );
  return lines;
}

function formatReawakenedSection(section: ReawakenedSection): string[] {
  const lines: string[] = [];
  const { windowDays, minDormancyMultiple, minDormancyDays, entries } = section;
  lines.push(
    pc.magenta(
      `Reawakened — dormant ≥ ${minDormancyMultiple}× window (${minDormancyDays}d) then touched again`,
    ),
  );
  lines.push(
    pc.dim(
      `  Window: ${windowDays}d · Rule: gap between last pre-window commit and first in-window commit ≥ ${minDormancyDays}d`,
    ),
  );
  lines.push("");
  const header = `  ${padRight("File", 40)}  ${padLeft("Dormancy", 12)}  ${padLeft("×Window", 10)}  ${padLeft("Cx", 6)}  ${padLeft("Churn", 6)}`;
  lines.push(pc.dim(header));
  for (const e of entries) {
    lines.push(
      `  ${padRight(truncate(e.file, 40), 40)}  ${padLeft(`${e.dormancyDays}d`, 12)}  ${padLeft(`${e.dormancyMultiple}×`, 10)}  ${padLeft(String(e.complexity), 6)}  ${padLeft(String(e.churn), 6)}`,
    );
  }
  return lines;
}

export function formatHotspotsTable(output: HotspotsOutput): string {
  const lines: string[] = [];
  const { churnWindow, churnMode, rankings, corpus, delta, fullDelta } = output;

  if (delta) {
    lines.push(
      pc.cyan(
        `Delta — ${delta.changedFiles.length} file${
          delta.changedFiles.length === 1 ? "" : "s"
        } changed since ${delta.base}`,
      ),
    );
    if (delta.fallback) {
      lines.push(
        pc.yellow(
          `  ⚠ full-delta unavailable — showing filtered view. Reason: ${delta.fallback.reason}`,
        ),
      );
    }
    if (delta.changedFiles.length === 0) {
      lines.push("");
      lines.push(pc.dim("No changes — nothing to rank."));
      return lines.join("\n");
    }
  }
  if (fullDelta) {
    lines.push(...formatFullDeltaSection(fullDelta));
  }
  const modeSuffix = churnMode === "lines" ? " (line-based)" : "";
  lines.push(`Hotspots — ${churnWindow} churn window${modeSuffix}`);
  if (corpus && corpus.fileCount > 0 && corpus.totalComplexity === 0) {
    lines.push("");
    lines.push(
      pc.yellow(
        "Note: no measurable code complexity detected across this corpus (cyclomatic = 0).",
      ),
    );
    lines.push(
      pc.yellow(
        "Rankings reflect size and churn only — HOT/WARM/COOL are relative groupings, not risk labels.",
      ),
    );
  }
  lines.push("");

  const includeDelta =
    delta !== undefined &&
    Object.values(rankings).some((r) =>
      r.entries.some((e) => e.complexityDelta !== undefined),
    );
  const keys = Object.keys(rankings);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    lines.push(
      ...formatRankingTable(
        key,
        rankings[key],
        output.guide[key],
        includeDelta,
      ),
    );

    if (i < keys.length - 1) {
      lines.push("");
      lines.push("· · ·");
      lines.push("");
    }
  }

  if (output.skipped) {
    for (const [key, info] of Object.entries(output.skipped)) {
      lines.push("");
      const label =
        RANKING_LABELS_BY_KEY[key] ??
        `${key.charAt(0).toUpperCase() + key.slice(1)} \u00D7 Churn`;
      lines.push(`${label} \u2014 skipped (${info.reason})`);
      if (info.suggestion) {
        lines.push(`  ${info.suggestion}`);
      }
    }
  }

  if (output.reawakened) {
    lines.push("");
    lines.push("\u00B7 \u00B7 \u00B7");
    lines.push("");
    lines.push(...formatReawakenedSection(output.reawakened));
  }

  lines.push("");
  lines.push(
    pc.dim(
      "Score=metric\u00D7churn | Tiers are relative to THIS codebase, not absolute quality grades.",
    ),
  );
  const zeroComplexityCorpus =
    corpus !== undefined &&
    corpus.fileCount > 0 &&
    corpus.totalComplexity === 0;
  lines.push(
    pc.dim(
      zeroComplexityCorpus
        ? "High scores flag files that change often and are sizable \u2014 neither is bad in itself."
        : "High scores flag review candidates, not bad code \u2014 stable complex files (parsers, engines) score high naturally.",
    ),
  );
  lines.push(pc.dim("Docs: https://github.com/wbern/obscene#metrics"));

  if (corpus?.filtered === false) {
    lines.push("");
    lines.push(
      pc.yellow(
        "⚠ Corpus unfiltered — no .obsignore found. Lockfiles, generated " +
          "code, and vendored dependencies may dominate these rankings.",
      ),
    );
    lines.push(
      pc.dim("  Run `obscene init` to generate a starter .obsignore."),
    );
  }

  return lines.join("\n");
}

export function formatCouplingTable(output: CouplingOutput): string {
  const lines: string[] = [];
  const { tierCounts, totalScore, churnWindow, couplings } = output;

  lines.push(
    `Coupling — ${churnWindow} churn window | Min shared: ${output.minCochanges} | Total score: ${totalScore.toLocaleString()}`,
  );
  lines.push(...formatConfidenceStamp(output.confidence));
  lines.push(...tierSummary(tierCounts, output.showing, output.totalCouplings));

  lines.push(
    padRight("File 1", 35) +
      padRight("File 2", 35) +
      padLeft("Shared", 7) +
      padLeft("Degree", 8) +
      padLeft("Cmplx", 7) +
      padLeft("Tier", 12),
  );
  lines.push("─".repeat(104));

  let anyDeleted = false;
  let anyLockstep = false;
  for (const c of couplings) {
    if (c.file1Deleted || c.file2Deleted) anyDeleted = true;
    if (c.lockstep) anyLockstep = true;
    const file1Cell = c.file1Deleted
      ? `\u2020 ${truncate(c.file1, 31)}`
      : truncate(c.file1, 33);
    const file2Cell = c.file2Deleted
      ? `\u2020 ${truncate(c.file2, 31)}`
      : truncate(c.file2, 33);
    const degreeText = c.lockstep
      ? `${c.degree.toFixed(1)}\u21c4`
      : `${c.degree.toFixed(1)}%`;
    const rawRow =
      padRight(file1Cell, 35) +
      padRight(file2Cell, 35) +
      padLeft(String(c.cochanges), 7) +
      padLeft(degreeText, 8) +
      padLeft(String(c.totalComplexity), 7) +
      padLeft(tierLabel(c.tier), 12);
    lines.push(colorRow(c.tier, rawRow));
  }

  lines.push("");
  lines.push(
    pc.dim(
      "Shared=co-changed commits | Degree=shared/min(churn)\u00D7100 | Cmplx=sum of both files",
    ),
  );
  if (anyDeleted) {
    lines.push(
      pc.dim("\u2020 = file no longer present at HEAD (deleted or renamed)"),
    );
  }
  if (anyLockstep) {
    lines.push(
      pc.dim(
        "\u21c4 = lockstep pair (both files only ever changed together \u2014 signal is real but uninformative)",
      ),
    );
  }
  lines.push(
    pc.dim(
      "Tiers are relative to THIS codebase, not absolute quality grades. High coupling may be intentional and fine.",
    ),
  );
  lines.push(
    pc.dim(
      "Same-directory pairs excluded. Commits touching >20 files skipped. Only cross-directory dependencies shown.",
    ),
  );
  lines.push(pc.dim("Docs: https://github.com/wbern/obscene#metrics"));

  if (output.sumOfCoupling && output.sumOfCoupling.length > 0) {
    lines.push("");
    lines.push(
      ...formatSumOfCouplingSection(output.sumOfCoupling, output.confidence),
    );
  }

  return lines.join("\n");
}

function formatSumOfCouplingSection(
  entries: SumOfCouplingEntry[],
  confidence: ConfidenceInfo,
): string[] {
  const lines: string[] = [];
  lines.push("─".repeat(68));
  lines.push(
    `${pc.bold("Sum of Coupling")} ${pc.dim("(experimental — not independently validated)")} — files whose couplings concentrate the most cross-dir change traffic`,
  );
  lines.push(...formatConfidenceStamp(confidence));
  lines.push("");
  lines.push(
    padRight("File", 40) +
      padLeft("Partners", 10) +
      padLeft("Strength", 10) +
      padLeft("Tier", 8),
  );
  lines.push("─".repeat(68));
  let anyDeleted = false;
  for (const e of entries) {
    const label = e.fileDeleted ? `† ${e.file}` : e.file;
    if (e.fileDeleted) anyDeleted = true;
    const row =
      padRight(truncate(label, 38), 40) +
      padLeft(String(e.partners), 10) +
      padLeft(String(e.strength), 10) +
      padLeft(tierLabel(e.tier), 8);
    lines.push(colorRow(e.tier, row));
  }
  lines.push("");
  if (anyDeleted) {
    lines.push(
      pc.dim(
        "† = file no longer present at HEAD (deleted or renamed away); coupling signal is historical.",
      ),
    );
  }
  lines.push(
    pc.dim(
      "Partners=distinct cross-dir co-change partners | Strength=Σ pair cochange counts (= code-maat's SoC analysis, filtered to cross-dir pairs and ≤20-file commits).",
    ),
  );
  lines.push(
    pc.dim(
      'Navigation aid: high strength means "worth a look at this file\'s couplings", not "this file is defect-prone".',
    ),
  );
  lines.push(
    pc.dim(
      "EXPERIMENTAL: NOT independently validated against defect data; may change, be reframed, or be removed.",
    ),
  );
  return lines;
}

// Trailing space on HOT pads to the 4-char width of WARM/COOL so compact
// rows align without a separate padLeft call.
function tierTag(tier: "hot" | "warm" | "cool"): string {
  if (tier === "hot") return "HOT ";
  if (tier === "warm") return "WARM";
  return "COOL";
}

function historySuffix(output: {
  historyCoverage?: HistoryCoverageInfo;
}): string {
  const hc = output.historyCoverage;
  if (!hc?.underCovered) return "";
  return ` [history covers ~${hc.spanDays}d, window ${hc.windowDays}d]`;
}

function pluralizeCommits(n: number): string {
  return `${n} commit${n === 1 ? "" : "s"}`;
}

export function formatHotspotsCompact(output: HotspotsOutput): string {
  const lines: string[] = [];
  const composite = output.composite;
  const corpus = output.corpus;
  const corpusStr = corpus
    ? `${corpus.fileCount} files, ${corpus.totalComplexity} total complexity`
    : "";
  const header =
    `Hotspot landscape (composite RRF, ${output.churnWindow} window` +
    (corpusStr ? `, ${corpusStr}` : "") +
    historySuffix(output) +
    "):";
  lines.push(header);

  if (!composite || composite.entries.length === 0) {
    lines.push("(no composite ranking — insufficient signal)");
    return lines.join("\n");
  }

  lines.push(
    `Confidence: ${composite.confidence.level.toUpperCase()} — ${composite.confidence.reason}`,
  );
  const recentWindowDays = composite.entries.find((e) => e.recent)?.recent
    ?.windowDays;
  for (const entry of composite.entries) {
    let row = `${tierTag(entry.tier)}  ${padRight(entry.file, 50)}  ${padLeft(
      `${entry.percentOfTotal.toFixed(1)}%`,
      6,
    )}  ${padLeft(pluralizeCommits(entry.churn), 12)}  ${
      entry.dimensionCount
    }/${composite.totalDimensions} dims`;
    if (recentWindowDays !== undefined) {
      const cmts = entry.recent ? String(entry.recent.commits) : "·";
      const auths = entry.recent
        ? formatRecentAuthors(entry.recent.authors, entry.recent.authorCount)
        : "—";
      row += `  ${recentWindowDays}d: ${padLeft(cmts, 3)} cmts, ${auths}`;
    }
    lines.push(row);
  }
  lines.push("");
  lines.push(
    "For volume-weighted churn: --churn-mode lines. For co-change pairs: obscene coupling.",
  );
  return lines.join("\n");
}

export function formatReportCompact(output: ReportOutput): string {
  const lines: string[] = [];
  const { summary, files } = output;
  lines.push(
    `Complexity report — ${summary.fileCount} files, ${summary.totalComplexity} total complexity, ${summary.avgComplexityPerFile} avg/file (showing ${summary.showing}):`,
  );
  for (const f of files) {
    lines.push(
      `${padRight(f.file, 50)}  complexity=${padLeft(
        String(f.complexity),
        5,
      )}  density=${f.complexityDensity.toFixed(2)}  code=${f.code}`,
    );
  }
  return lines.join("\n");
}

export function formatCouplingCompact(output: CouplingOutput): string {
  const lines: string[] = [];
  const header =
    `Coupling — ${output.churnWindow} window, min shared: ${output.minCochanges}` +
    historySuffix(output) +
    `:`;
  lines.push(header);

  if (output.couplings.length === 0) {
    lines.push("(no pairs above thresholds)");
    return lines.join("\n");
  }

  lines.push(
    `Confidence: ${output.confidence.level.toUpperCase()} — ${output.confidence.reason}`,
  );
  for (const c of output.couplings) {
    const pair = `${c.file1} ↔ ${c.file2}`;
    const degreeTag = c.lockstep ? "⇄" : "%";
    lines.push(
      `${tierTag(c.tier)}  ${padRight(pair, 70)}  ${padLeft(
        `${c.cochanges} shared`,
        10,
      )}  ${padLeft(`${c.degree.toFixed(1)}${degreeTag}`, 8)}`,
    );
  }
  return lines.join("\n");
}

export function formatCompositeTable(output: CompositeOutput): string {
  const lines: string[] = [];

  const includeDelta = output.entries.some(
    (e) => e.complexityDelta !== undefined,
  );
  const recentWindowDays = output.entries.find((e) => e.recent)?.recent
    ?.windowDays;
  const recentExtra = recentWindowDays !== undefined ? 12 + 24 : 0;
  const width = (includeDelta ? 91 : 84) + recentExtra;

  lines.push("═".repeat(width));
  lines.push(
    `★ ${output.label.toUpperCase()} — Total score: ${output.totalScore.toLocaleString()}`,
  );
  lines.push(...formatConfidenceStamp(output.confidence));
  lines.push(
    ...tierSummary(output.tierCounts, output.showing, output.totalEntries),
  );
  lines.push("");

  let header =
    padRight("File", 50) +
    padLeft("Score", 9) +
    padLeft("Churn", 7) +
    padLeft("Dims", 6);
  if (includeDelta) header += padLeft("Δ", 7);
  if (recentWindowDays !== undefined) {
    header += padRight(` ${recentWindowDays}d-cmts`, 12);
    header += padRight(`${recentWindowDays}d-auths`, 24);
  }
  header += padLeft("Tier", 12);
  lines.push(header);
  lines.push("─".repeat(width));

  for (const entry of output.entries) {
    let rawRow =
      padRight(truncate(entry.file, 48), 50) +
      padLeft(entry.score.toFixed(4), 9) +
      padLeft(String(entry.churn), 7) +
      padLeft(`${entry.dimensionCount}/${output.totalDimensions}`, 6);
    if (includeDelta)
      rawRow += padLeft(formatDeltaValue(entry.complexityDelta), 7);
    if (recentWindowDays !== undefined) {
      rawRow += padRight(
        ` ${entry.recent ? String(entry.recent.commits) : "·"}`,
        12,
      );
      rawRow += padRight(
        entry.recent
          ? truncate(
              formatRecentAuthors(
                entry.recent.authors,
                entry.recent.authorCount,
              ),
              22,
            )
          : "—",
        24,
      );
    }
    rawRow += padLeft(tierLabel(entry.tier), 12);
    lines.push(colorRow(entry.tier, rawRow));
  }

  return lines.join("\n");
}
