import type {
  CouplingOutput,
  HotspotsOutput,
  ReportOutput,
  Tier,
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
    "Complexity=cyclomatic branch/loop count | Density=complexity/code | Comments=comment lines",
  );
  lines.push(
    "High complexity is expected for parsers, state machines, and business logic. Compare density across files, not raw values.",
  );
  lines.push("Docs: https://github.com/wbern/obscene#metrics");

  return lines.join("\n");
}

export function formatHotspotsTable(output: HotspotsOutput): string {
  const lines: string[] = [];
  const { tierCounts, totalScore, churnWindow, hotspots } = output;

  lines.push(
    `Hotspots — ${churnWindow} churn window | Total score: ${totalScore.toLocaleString()}`,
  );
  pushTierSummary(lines, tierCounts, output.showing, output.totalHotspots);

  lines.push(
    padRight("File", 50) +
      padLeft("Score", 8) +
      padLeft("%", 7) +
      padLeft("Churn", 7) +
      padLeft("Cmplx", 7) +
      padLeft("Dens", 7) +
      padLeft("Dfcts", 6) +
      padLeft("Nest", 6) +
      padLeft("Auth", 6) +
      padLeft("Tier", 8),
  );
  lines.push("─".repeat(112));

  for (const h of hotspots) {
    lines.push(
      padRight(truncate(h.file, 48), 50) +
        padLeft(h.hotspotScore.toLocaleString(), 8) +
        padLeft(h.percentOfTotal.toFixed(1), 7) +
        padLeft(String(h.churn), 7) +
        padLeft(String(h.complexity), 7) +
        padLeft(h.complexityDensity.toFixed(2), 7) +
        padLeft(String(h.defects), 6) +
        padLeft(String(h.maxNesting), 6) +
        padLeft(String(h.authors), 6) +
        padLeft(tierLabel(h.tier), 8),
    );
  }

  lines.push("");
  lines.push(
    "Score=complexity\u00D7churn | Dens=complexity/code | Dfcts=fix commits | Nest=max indent depth | Auth=unique authors",
  );
  lines.push(
    "Tiers are relative to THIS codebase, not absolute quality grades. A 'danger' file in a clean codebase may be fine.",
  );
  lines.push(
    "High scores flag review candidates, not bad code — stable complex files (parsers, engines) score high naturally.",
  );
  lines.push("Docs: https://github.com/wbern/obscene#metrics");

  return lines.join("\n");
}

export function formatCouplingTable(output: CouplingOutput): string {
  const lines: string[] = [];
  const { tierCounts, totalScore, churnWindow, couplings } = output;

  lines.push(
    `Coupling — ${churnWindow} churn window | Min shared: ${output.minCochanges} | Total score: ${totalScore.toLocaleString()}`,
  );
  pushTierSummary(lines, tierCounts, output.showing, output.totalCouplings);

  lines.push(
    padRight("File 1", 35) +
      padRight("File 2", 35) +
      padLeft("Shared", 7) +
      padLeft("Degree", 8) +
      padLeft("Cmplx", 7) +
      padLeft("Tier", 8),
  );
  lines.push("─".repeat(100));

  for (const c of couplings) {
    lines.push(
      padRight(truncate(c.file1, 33), 35) +
        padRight(truncate(c.file2, 33), 35) +
        padLeft(String(c.cochanges), 7) +
        padLeft(`${c.degree.toFixed(1)}%`, 8) +
        padLeft(String(c.totalComplexity), 7) +
        padLeft(tierLabel(c.tier), 8),
    );
  }

  lines.push("");
  lines.push(
    "Shared=co-changed commits | Degree=shared/min(churn)\u00D7100 | Cmplx=sum of both files",
  );
  lines.push(
    "Tiers are relative to THIS codebase, not absolute quality grades. High coupling may be intentional and fine.",
  );
  lines.push(
    "Same-directory pairs excluded. Commits touching >20 files skipped. Only cross-directory dependencies shown.",
  );
  lines.push("Docs: https://github.com/wbern/obscene#metrics");

  return lines.join("\n");
}

function pushTierSummary(
  lines: string[],
  tierCounts: Record<Tier, number>,
  showing: number,
  total: number,
): void {
  lines.push(
    `Tiers: ${tierCounts.danger} danger, ${tierCounts.watch} watch, ${tierCounts.stable} stable`,
  );
  lines.push(`Showing: ${showing} of ${total}`);
  lines.push("");
}

function tierLabel(tier: Tier): string {
  if (tier === "danger") return "DANGER";
  if (tier === "watch") return "WATCH";
  return "stable";
}

function padRight(s: string, n: number): string {
  /* v8 ignore next -- truncation ensures s < n in all call sites */
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function padLeft(s: string, n: number): string {
  return s.length >= n ? s : " ".repeat(n - s.length) + s;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `…${s.slice(s.length - max + 1)}`;
}
