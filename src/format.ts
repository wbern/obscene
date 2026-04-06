import type { HotspotsOutput, ReportOutput } from "./types.js";

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

  return lines.join("\n");
}

export function formatHotspotsTable(output: HotspotsOutput): string {
  const lines: string[] = [];
  const { tierCounts, totalScore, churnWindow, hotspots } = output;

  lines.push(
    `Hotspots — ${churnWindow} churn window | Total score: ${totalScore.toLocaleString()}`,
  );
  lines.push(
    `Tiers: ${tierCounts.danger} danger, ${tierCounts.watch} watch, ${tierCounts.stable} stable`,
  );
  lines.push(`Showing: ${output.showing} of ${output.totalHotspots}`);
  lines.push("");

  lines.push(
    padRight("File", 50) +
      padLeft("Score", 8) +
      padLeft("%", 7) +
      padLeft("Churn", 7) +
      padLeft("Cmplx", 7) +
      padLeft("Density", 9) +
      padLeft("Tier", 8),
  );
  lines.push("─".repeat(96));

  for (const h of hotspots) {
    const tierLabel =
      h.tier === "danger" ? "DANGER" : h.tier === "watch" ? "WATCH" : "stable";
    lines.push(
      padRight(truncate(h.file, 48), 50) +
        padLeft(h.hotspotScore.toLocaleString(), 8) +
        padLeft(h.percentOfTotal.toFixed(1), 7) +
        padLeft(String(h.churn), 7) +
        padLeft(String(h.complexity), 7) +
        padLeft(h.complexityDensity.toFixed(2), 9) +
        padLeft(tierLabel, 8),
    );
  }

  return lines.join("\n");
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
