import pc from "picocolors";
import {
  colorRow,
  padLeft,
  padRight,
  tierLabel,
  tierSummary,
  truncate,
} from "./color.js";
import type {
  CompositeOutput,
  CouplingOutput,
  HotspotsOutput,
  RankingOutput,
  ReportOutput,
} from "./types.js";

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

function getRankingColumns(key: string): RankingColumnDef[] {
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
        header: "Dfcts",
        width: 6,
        align: "right",
        value: (e) => String(e.metricValue),
      },
      {
        header: "DfDns",
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
    ],
  };

  const tierCol: RankingColumnDef = {
    header: "Tier",
    width: 12,
    align: "right",
    value: (e) => tierLabel(e.tier),
  };

  return [...base, ...(metricCols[key] ?? []), tierCol];
}

const METRIC_EMOJI: Record<string, string> = {
  complexity: "🧬",
  nesting: "📏",
  defects: "🐛",
  authors: "👥",
};

function formatRankingTable(
  key: string,
  ranking: RankingOutput,
  description?: string,
): string[] {
  const lines: string[] = [];
  const cols = getRankingColumns(key);
  const emoji = METRIC_EMOJI[key];
  const prefix = emoji ? `${emoji} ` : "";

  const title = ranking.label.toUpperCase().replace("CHURN", "🔄 CHURN");
  lines.push(
    `${prefix}${title} — Total score: ${ranking.totalScore.toLocaleString()}`,
  );
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

export function formatHotspotsTable(output: HotspotsOutput): string {
  const lines: string[] = [];
  const { churnWindow, rankings } = output;

  lines.push(`Hotspots — ${churnWindow} churn window`);
  lines.push("");

  const keys = Object.keys(rankings);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    lines.push(...formatRankingTable(key, rankings[key], output.guide[key]));

    if (i < keys.length - 1) {
      lines.push("");
      lines.push("· · ·");
      lines.push("");
    }
  }

  if (output.skipped) {
    for (const [key, info] of Object.entries(output.skipped)) {
      lines.push("");
      const label = key.charAt(0).toUpperCase() + key.slice(1);
      lines.push(`${label} \u00D7 Churn \u2014 skipped (${info.reason})`);
      if (info.suggestion) {
        lines.push(`  ${info.suggestion}`);
      }
    }
  }

  lines.push("");
  lines.push(
    pc.dim(
      "Score=metric\u00D7churn | Tiers are relative to THIS codebase, not absolute quality grades.",
    ),
  );
  lines.push(
    pc.dim(
      "High scores flag review candidates, not bad code \u2014 stable complex files (parsers, engines) score high naturally.",
    ),
  );
  lines.push(pc.dim("Docs: https://github.com/wbern/obscene#metrics"));

  return lines.join("\n");
}

export function formatCouplingTable(output: CouplingOutput): string {
  const lines: string[] = [];
  const { tierCounts, totalScore, churnWindow, couplings } = output;

  lines.push(
    `Coupling — ${churnWindow} churn window | Min shared: ${output.minCochanges} | Total score: ${totalScore.toLocaleString()}`,
  );
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

  for (const c of couplings) {
    const rawRow =
      padRight(truncate(c.file1, 33), 35) +
      padRight(truncate(c.file2, 33), 35) +
      padLeft(String(c.cochanges), 7) +
      padLeft(`${c.degree.toFixed(1)}%`, 8) +
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

  return lines.join("\n");
}

export function formatCompositeTable(output: CompositeOutput): string {
  const lines: string[] = [];

  lines.push("═".repeat(84));
  lines.push(
    `★ ${output.label.toUpperCase()} — Total score: ${output.totalScore.toLocaleString()}`,
  );
  lines.push(
    ...tierSummary(output.tierCounts, output.showing, output.totalEntries),
  );
  lines.push("");

  lines.push(
    padRight("File", 50) +
      padLeft("Score", 9) +
      padLeft("Churn", 7) +
      padLeft("Dims", 6) +
      padLeft("Tier", 12),
  );
  lines.push("─".repeat(84));

  for (const entry of output.entries) {
    const rawRow =
      padRight(truncate(entry.file, 48), 50) +
      padLeft(entry.score.toFixed(4), 9) +
      padLeft(String(entry.churn), 7) +
      padLeft(`${entry.dimensionCount}/${output.totalDimensions}`, 6) +
      padLeft(tierLabel(entry.tier), 12);
    lines.push(colorRow(entry.tier, rawRow));
  }

  return lines.join("\n");
}
