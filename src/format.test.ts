import { describe, expect, it } from "vitest";
import {
  formatCompositeTable,
  formatCouplingTable,
  formatHotspotsTable,
  formatReportTable,
} from "./format.js";
import type {
  CompositeOutput,
  ConfidenceInfo,
  CouplingOutput,
  HotspotDelta,
  HotspotsOutput,
  ReportOutput,
} from "./types.js";

const STUB_CONFIDENCE: ConfidenceInfo = {
  level: "plausible",
  reason: "stub",
  inputs: {
    metric: "stub",
    value: 10,
    thresholds: { weak: 3, plausible: 10, acceptable: 30 },
  },
  source: "stub",
};

const STUB_INCONCLUSIVE: ConfidenceInfo = {
  level: "inconclusive",
  reason: "stub",
  inputs: {
    metric: "stub",
    value: 0,
    thresholds: { weak: 3, plausible: 10, acceptable: 30 },
  },
  source: "stub",
};

describe("formatReportTable", () => {
  it("formats report output as a table", () => {
    const output: ReportOutput = {
      generated: "2026-01-01T00:00:00.000Z",
      guide: {},
      summary: {
        totalComplexity: 50,
        totalCode: 300,
        totalLines: 400,
        fileCount: 2,
        avgComplexityPerFile: 25,
        showing: 2,
      },
      files: [
        {
          file: "src/foo.ts",
          code: 200,
          lines: 250,
          complexity: 30,
          comments: 10,
          complexityDensity: 0.15,
        },
        {
          file: "src/bar.ts",
          code: 100,
          lines: 150,
          complexity: 20,
          comments: 5,
          complexityDensity: 0.2,
        },
      ],
    };

    const result = formatReportTable(output);

    expect(result).toContain("Complexity Report");
    expect(result).toContain("2 files");
    expect(result).toContain("50 total complexity");
    expect(result).toContain("src/foo.ts");
    expect(result).toContain("src/bar.ts");
    expect(result).toContain("0.15");
    expect(result).toContain("0.20");
    expect(result).toContain("Showing: 2");
    expect(result).toContain("Compare density across files");
    expect(result).toContain("Docs: https://github.com/wbern/obscene#metrics");
  });

  it("truncates long file paths", () => {
    const output: ReportOutput = {
      generated: "2026-01-01T00:00:00.000Z",
      guide: {},
      summary: {
        totalComplexity: 10,
        totalCode: 100,
        totalLines: 120,
        fileCount: 1,
        avgComplexityPerFile: 10,
        showing: 1,
      },
      files: [
        {
          file: "src/very/deeply/nested/directory/structure/with/many/levels/component.ts",
          code: 100,
          lines: 120,
          complexity: 10,
          comments: 5,
          complexityDensity: 0.1,
        },
      ],
    };

    const result = formatReportTable(output);

    // Should contain truncation marker
    expect(result).toContain("…");
  });
});

describe("formatHotspotsTable", () => {
  it("formats multi-ranking output with emoji tier labels", () => {
    const output: HotspotsOutput = {
      generated: "2026-01-01T00:00:00.000Z",
      guide: {
        complexity:
          "complexity × churn. Ranks files by combined risk: complex code that changes often.",
      },
      churnWindow: "3 months",
      rankings: {
        complexity: {
          label: "Complexity \u00D7 Churn",
          scoreFormula: "complexity \u00D7 churn",
          totalScore: 1000,
          tierCounts: { hot: 1, warm: 1, cool: 0 },
          totalEntries: 2,
          showing: 2,
          confidence: STUB_CONFIDENCE,
          entries: [
            {
              file: "src/foo.ts",
              score: 750,
              percentOfTotal: 75,
              tier: "hot",
              churn: 15,
              metricValue: 50,
              metricDensity: 0.25,
            },
            {
              file: "src/bar.ts",
              score: 250,
              percentOfTotal: 25,
              tier: "warm",
              churn: 10,
              metricValue: 25,
              metricDensity: 0.25,
            },
          ],
        },
      },
      corpus: { fileCount: 1, totalComplexity: 50 },
    };

    const result = formatHotspotsTable(output);

    expect(result).toContain("Hotspots");
    expect(result).toContain("3 months");
    // Section headers are uppercased with metric emojis
    expect(result).toContain("🧬 COMPLEXITY \u00D7 🔄 CHURN");
    expect(result).toContain("1,000");
    expect(result).toContain("src/foo.ts");
    expect(result).toContain("src/bar.ts");
    expect(result).toContain("Showing: 2 of 2");
    // Guide description appears under section header
    expect(result).toContain("Ranks files by combined risk");
    // Emoji tier labels
    expect(result).toContain("🔥");
    expect(result).toContain("HOT");
    expect(result).toContain("☀️");
    expect(result).toContain("WARM");
    // Column headers
    expect(result).toContain("Cmplx");
    expect(result).toContain("Dens");
    // Legend
    expect(result).toContain("not absolute quality grades");
    expect(result).toContain("Docs: https://github.com/wbern/obscene#metrics");
  });

  it("renders multiple ranking tables", () => {
    const output: HotspotsOutput = {
      generated: "2026-01-01T00:00:00.000Z",
      guide: {},
      churnWindow: "3 months",
      rankings: {
        complexity: {
          label: "Complexity \u00D7 Churn",
          scoreFormula: "complexity \u00D7 churn",
          totalScore: 500,
          tierCounts: { hot: 1, warm: 0, cool: 0 },
          totalEntries: 1,
          showing: 1,
          confidence: STUB_CONFIDENCE,
          entries: [
            {
              file: "src/foo.ts",
              score: 500,
              percentOfTotal: 100,
              tier: "hot",
              churn: 10,
              metricValue: 50,
              metricDensity: 0.25,
            },
          ],
        },
        nesting: {
          label: "Nesting \u00D7 Churn",
          scoreFormula: "maxNesting \u00D7 churn",
          totalScore: 50,
          tierCounts: { hot: 1, warm: 0, cool: 0 },
          totalEntries: 1,
          showing: 1,
          confidence: STUB_CONFIDENCE,
          entries: [
            {
              file: "src/foo.ts",
              score: 50,
              percentOfTotal: 100,
              tier: "hot",
              churn: 10,
              metricValue: 5,
            },
          ],
        },
      },
      corpus: { fileCount: 1, totalComplexity: 50 },
    };

    const result = formatHotspotsTable(output);

    // Section headers are uppercased with metric emojis
    expect(result).toContain("🧬 COMPLEXITY \u00D7 🔄 CHURN");
    expect(result).toContain("📏 NESTING \u00D7 🔄 CHURN");
    // Nesting table should have Nest column
    expect(result).toContain("Nest");
    // Visual separator between ranking tables
    expect(result).toContain("· · ·");
  });

  it("shows cool tier with green emoji", () => {
    const output: HotspotsOutput = {
      generated: "2026-01-01T00:00:00.000Z",
      guide: {},
      churnWindow: "3 months",
      rankings: {
        complexity: {
          label: "Complexity \u00D7 Churn",
          scoreFormula: "complexity \u00D7 churn",
          totalScore: 100,
          tierCounts: { hot: 0, warm: 0, cool: 1 },
          totalEntries: 1,
          showing: 1,
          confidence: STUB_CONFIDENCE,
          entries: [
            {
              file: "src/calm.ts",
              score: 100,
              percentOfTotal: 100,
              tier: "cool",
              churn: 20,
              metricValue: 5,
              metricDensity: 0.1,
            },
          ],
        },
      },
      corpus: { fileCount: 1, totalComplexity: 50 },
    };

    const result = formatHotspotsTable(output);

    expect(result).toContain("🧊");
    expect(result).toContain("COOL");
  });

  it("handles large scores that overflow column width", () => {
    const output: HotspotsOutput = {
      generated: "2026-01-01T00:00:00.000Z",
      guide: {},
      churnWindow: "3 months",
      rankings: {
        complexity: {
          label: "Complexity \u00D7 Churn",
          scoreFormula: "complexity \u00D7 churn",
          totalScore: 10000000000,
          tierCounts: { hot: 1, warm: 0, cool: 0 },
          totalEntries: 1,
          showing: 1,
          confidence: STUB_CONFIDENCE,
          entries: [
            {
              file: "src/big.ts",
              score: 10000000000,
              percentOfTotal: 100,
              tier: "hot",
              churn: 100000,
              metricValue: 100000,
              metricDensity: 1.0,
            },
          ],
        },
      },
      corpus: { fileCount: 1, totalComplexity: 50 },
    };

    const result = formatHotspotsTable(output);

    expect(result).toContain("10,000,000,000");
    expect(result).toContain("src/big.ts");
  });

  it("truncates long file paths in hotspots", () => {
    const output: HotspotsOutput = {
      generated: "2026-01-01T00:00:00.000Z",
      guide: {},
      churnWindow: "3 months",
      rankings: {
        complexity: {
          label: "Complexity \u00D7 Churn",
          scoreFormula: "complexity \u00D7 churn",
          totalScore: 500,
          tierCounts: { hot: 1, warm: 0, cool: 0 },
          totalEntries: 1,
          showing: 1,
          confidence: STUB_CONFIDENCE,
          entries: [
            {
              file: "src/very/deeply/nested/directory/structure/component.ts",
              score: 500,
              percentOfTotal: 100,
              tier: "hot",
              churn: 10,
              metricValue: 50,
              metricDensity: 0.5,
            },
          ],
        },
      },
      corpus: { fileCount: 1, totalComplexity: 50 },
    };

    const result = formatHotspotsTable(output);

    expect(result).toContain("…");
  });

  it("renders defects table with FxDns column", () => {
    const output: HotspotsOutput = {
      generated: "2026-01-01T00:00:00.000Z",
      guide: {},
      churnWindow: "3 months",
      rankings: {
        defects: {
          label: "Fix Activity \u00D7 Churn",
          scoreFormula: "fixes \u00D7 churn",
          totalScore: 30,
          tierCounts: { hot: 1, warm: 0, cool: 0 },
          totalEntries: 1,
          showing: 1,
          confidence: STUB_CONFIDENCE,
          entries: [
            {
              file: "src/buggy.ts",
              score: 30,
              percentOfTotal: 100,
              tier: "hot",
              churn: 10,
              metricValue: 3,
              metricDensity: 0.03,
            },
          ],
        },
      },
      corpus: { fileCount: 1, totalComplexity: 50 },
    };

    const result = formatHotspotsTable(output);

    expect(result).toContain("Fixes");
    expect(result).toContain("FxDns");
    expect(result).toContain("0.0300");
  });

  it("renders authors table with Auth and MinAuth columns", () => {
    const output: HotspotsOutput = {
      generated: "2026-01-01T00:00:00.000Z",
      guide: {},
      churnWindow: "3 months",
      rankings: {
        authors: {
          label: "Authors \u00D7 Churn",
          scoreFormula: "authors \u00D7 churn",
          totalScore: 40,
          tierCounts: { hot: 2, warm: 0, cool: 0 },
          totalEntries: 2,
          showing: 2,
          confidence: STUB_CONFIDENCE,
          entries: [
            {
              file: "src/shared.ts",
              score: 20,
              percentOfTotal: 50,
              tier: "hot",
              churn: 10,
              metricValue: 2,
              minorAuthors: 3,
            },
            {
              file: "src/once.ts",
              score: 20,
              percentOfTotal: 50,
              tier: "hot",
              churn: 1,
              metricValue: 1,
              minorAuthors: null,
            },
          ],
        },
      },
      corpus: { fileCount: 2, totalComplexity: 50 },
    };

    const result = formatHotspotsTable(output);

    expect(result).toContain("Auth");
    expect(result).toContain("MinAuth");
    expect(result).toContain("—");
    expect(result).toContain("👥 AUTHORS × 🔄 CHURN");
  });

  it("renders MinAuth as em dash when minorAuthors is undefined", () => {
    const output: HotspotsOutput = {
      generated: "2026-01-01T00:00:00.000Z",
      guide: {},
      churnWindow: "3 months",
      rankings: {
        authors: {
          label: "Authors × Churn",
          scoreFormula: "authors × churn",
          totalScore: 20,
          tierCounts: { hot: 1, warm: 0, cool: 0 },
          totalEntries: 1,
          showing: 1,
          confidence: STUB_CONFIDENCE,
          entries: [
            {
              file: "src/shared.ts",
              score: 20,
              percentOfTotal: 100,
              tier: "hot",
              churn: 10,
              metricValue: 2,
            },
          ],
        },
      },
      corpus: { fileCount: 1, totalComplexity: 50 },
    };

    const result = formatHotspotsTable(output);

    expect(result).toContain("MinAuth");
    expect(result).toContain("—");
    expect(result).toContain("👥 AUTHORS \u00D7 🔄 CHURN");
  });

  it("handles complexity entries without metricDensity", () => {
    const output: HotspotsOutput = {
      generated: "2026-01-01T00:00:00.000Z",
      guide: {},
      churnWindow: "3 months",
      rankings: {
        complexity: {
          label: "Complexity \u00D7 Churn",
          scoreFormula: "complexity \u00D7 churn",
          totalScore: 100,
          tierCounts: { hot: 1, warm: 0, cool: 0 },
          totalEntries: 1,
          showing: 1,
          confidence: STUB_CONFIDENCE,
          entries: [
            {
              file: "src/foo.ts",
              score: 100,
              percentOfTotal: 100,
              tier: "hot",
              churn: 10,
              metricValue: 10,
            },
          ],
        },
      },
      corpus: { fileCount: 1, totalComplexity: 50 },
    };

    const result = formatHotspotsTable(output);

    expect(result).toContain("0.00");
  });

  it("handles defects entries without metricDensity", () => {
    const output: HotspotsOutput = {
      generated: "2026-01-01T00:00:00.000Z",
      guide: {},
      churnWindow: "3 months",
      rankings: {
        defects: {
          label: "Fix Activity \u00D7 Churn",
          scoreFormula: "fixes \u00D7 churn",
          totalScore: 10,
          tierCounts: { hot: 1, warm: 0, cool: 0 },
          totalEntries: 1,
          showing: 1,
          confidence: STUB_CONFIDENCE,
          entries: [
            {
              file: "src/foo.ts",
              score: 10,
              percentOfTotal: 100,
              tier: "hot",
              churn: 5,
              metricValue: 2,
            },
          ],
        },
      },
      corpus: { fileCount: 1, totalComplexity: 50 },
    };

    const result = formatHotspotsTable(output);

    expect(result).toContain("0.0000");
  });

  it("synthesizes a skip label for unknown ranking keys", () => {
    const output: HotspotsOutput = {
      generated: "2026-01-01T00:00:00.000Z",
      guide: {},
      churnWindow: "3 months",
      rankings: {},
      skipped: {
        someOther: {
          reason: "insufficient data",
          confidence: STUB_INCONCLUSIVE,
        },
      },
      corpus: { fileCount: 1, totalComplexity: 50 },
    };

    const result = formatHotspotsTable(output);

    expect(result).toContain("SomeOther × Churn — skipped");
  });

  it("renders unknown ranking key with base columns only", () => {
    const output: HotspotsOutput = {
      generated: "2026-01-01T00:00:00.000Z",
      guide: {},
      churnWindow: "3 months",
      rankings: {
        unknown: {
          label: "Custom Metric",
          scoreFormula: "custom \u00D7 churn",
          totalScore: 42,
          tierCounts: { hot: 1, warm: 0, cool: 0 },
          totalEntries: 1,
          showing: 1,
          confidence: STUB_CONFIDENCE,
          entries: [
            {
              file: "src/foo.ts",
              score: 42,
              percentOfTotal: 100,
              tier: "hot",
              churn: 7,
              metricValue: 6,
            },
          ],
        },
      },
      corpus: { fileCount: 1, totalComplexity: 50 },
    };

    const result = formatHotspotsTable(output);

    expect(result).toContain("CUSTOM METRIC");
    expect(result).toContain("Score");
    expect(result).toContain("Tier");
    // No metric-specific columns
    expect(result).not.toContain("Cmplx");
    expect(result).not.toContain("Nest");
    expect(result).not.toContain("Auth");
  });

  it("renders skip messages for skipped rankings", () => {
    const output: HotspotsOutput = {
      generated: "2026-01-01T00:00:00.000Z",
      guide: {},
      churnWindow: "3 months",
      rankings: {
        complexity: {
          label: "Complexity \u00D7 Churn",
          scoreFormula: "complexity \u00D7 churn",
          totalScore: 500,
          tierCounts: { hot: 1, warm: 0, cool: 0 },
          totalEntries: 1,
          showing: 1,
          confidence: STUB_CONFIDENCE,
          entries: [
            {
              file: "src/foo.ts",
              score: 500,
              percentOfTotal: 100,
              tier: "hot",
              churn: 10,
              metricValue: 50,
              metricDensity: 0.25,
            },
          ],
        },
      },
      skipped: {
        defects: {
          reason: "insufficient data (2 fix: commits, need 5+)",
          suggestion:
            "Adopt conventional commits with fix: prefix. See conventionalcommits.org",
          confidence: STUB_INCONCLUSIVE,
        },
      },
      corpus: { fileCount: 1, totalComplexity: 50 },
    };

    const result = formatHotspotsTable(output);

    expect(result).toContain("Fix Activity");
    expect(result).toContain("skipped");
    expect(result).toContain("fix:");
    expect(result).toContain("conventionalcommits.org");
  });

  it("emits a soft-framing banner when the corpus has zero complexity", () => {
    const output: HotspotsOutput = {
      generated: "2026-01-01T00:00:00.000Z",
      guide: {},
      churnWindow: "3 months",
      rankings: {
        complexity: {
          label: "Complexity × Churn",
          scoreFormula: "complexity × churn",
          totalScore: 10,
          tierCounts: { hot: 1, warm: 0, cool: 0 },
          totalEntries: 1,
          showing: 1,
          confidence: STUB_CONFIDENCE,
          entries: [
            {
              file: "README.md",
              score: 10,
              percentOfTotal: 100,
              tier: "hot",
              churn: 10,
              metricValue: 0,
              metricDensity: 0,
            },
          ],
        },
      },
      corpus: { fileCount: 5, totalComplexity: 0 },
    };

    const result = formatHotspotsTable(output);

    expect(result).toContain("no measurable code complexity");
    expect(result).toContain("not risk labels");
  });

  it("omits the soft-framing banner when complexity is present", () => {
    const output: HotspotsOutput = {
      generated: "2026-01-01T00:00:00.000Z",
      guide: {},
      churnWindow: "3 months",
      rankings: {
        complexity: {
          label: "Complexity × Churn",
          scoreFormula: "complexity × churn",
          totalScore: 10,
          tierCounts: { hot: 1, warm: 0, cool: 0 },
          totalEntries: 1,
          showing: 1,
          confidence: STUB_CONFIDENCE,
          entries: [
            {
              file: "src/foo.ts",
              score: 10,
              percentOfTotal: 100,
              tier: "hot",
              churn: 5,
              metricValue: 2,
              metricDensity: 0.1,
            },
          ],
        },
      },
      corpus: { fileCount: 5, totalComplexity: 120 },
    };

    const result = formatHotspotsTable(output);

    expect(result).not.toContain("no measurable code complexity");
  });

  it("omits the soft-framing banner when corpus has no files", () => {
    const output: HotspotsOutput = {
      generated: "2026-01-01T00:00:00.000Z",
      guide: {},
      churnWindow: "3 months",
      rankings: {},
      corpus: { fileCount: 0, totalComplexity: 0 },
    };

    const result = formatHotspotsTable(output);

    expect(result).not.toContain("no measurable code complexity");
  });

  it("omits the soft-framing banner when corpus is absent", () => {
    const output: HotspotsOutput = {
      generated: "2026-01-01T00:00:00.000Z",
      guide: {},
      churnWindow: "3 months",
      rankings: {},
    };

    const result = formatHotspotsTable(output);

    expect(result).not.toContain("no measurable code complexity");
  });

  it("rewrites the footer line when corpus has zero complexity", () => {
    const output: HotspotsOutput = {
      generated: "2026-01-01T00:00:00.000Z",
      guide: {},
      churnWindow: "3 months",
      rankings: {},
      corpus: { fileCount: 5, totalComplexity: 0 },
    };

    const result = formatHotspotsTable(output);

    expect(result).not.toContain("parsers, engines");
    expect(result).toContain("change often and are sizable");
  });

  it("keeps the parsers/engines footer when complexity is present", () => {
    const output: HotspotsOutput = {
      generated: "2026-01-01T00:00:00.000Z",
      guide: {},
      churnWindow: "3 months",
      rankings: {},
      corpus: { fileCount: 5, totalComplexity: 120 },
    };

    const result = formatHotspotsTable(output);

    expect(result).toContain("parsers, engines");
  });

  it("renders a delta header when delta metadata is present", () => {
    const output: HotspotsOutput = {
      generated: "2026-01-01T00:00:00.000Z",
      guide: {},
      churnWindow: "3 months",
      delta: {
        base: "main",
        head: "HEAD",
        changedFiles: ["src/a.ts", "src/b.ts"],
      },
      rankings: {
        complexity: {
          label: "Complexity × Churn",
          scoreFormula: "complexity × churn",
          totalScore: 10,
          tierCounts: { hot: 1, warm: 0, cool: 0 },
          totalEntries: 1,
          showing: 1,
          confidence: STUB_CONFIDENCE,
          entries: [
            {
              file: "src/a.ts",
              score: 10,
              percentOfTotal: 100,
              tier: "hot",
              churn: 5,
              metricValue: 2,
              metricDensity: 0.1,
            },
          ],
        },
      },
      corpus: { fileCount: 2, totalComplexity: 120 },
    };

    const result = formatHotspotsTable(output);

    expect(result).toContain("Delta —");
    expect(result).toContain("2 files changed since main");
    expect(result).toContain("Hotspots — 3 months");
  });

  it("uses singular 'file' in delta header for a single change", () => {
    const output: HotspotsOutput = {
      generated: "2026-01-01T00:00:00.000Z",
      guide: {},
      churnWindow: "3 months",
      delta: {
        base: "abc123",
        head: "HEAD",
        changedFiles: ["src/a.ts"],
      },
      rankings: {},
      corpus: { fileCount: 1, totalComplexity: 10 },
    };

    const result = formatHotspotsTable(output);

    expect(result).toContain("1 file changed since abc123");
    expect(result).not.toContain("1 files");
  });

  it("renders a fallback notice when the user asked for full-delta and got B", () => {
    const output: HotspotsOutput = {
      generated: "2026-01-01T00:00:00.000Z",
      guide: {},
      churnWindow: "3 months",
      delta: {
        base: "main",
        head: "HEAD",
        changedFiles: ["src/a.ts"],
        fallback: { from: "full-delta", reason: "worktree alloc failed" },
      },
      rankings: {},
      corpus: { fileCount: 1, totalComplexity: 10 },
    };

    const result = formatHotspotsTable(output);

    expect(result).toContain("full-delta unavailable");
    expect(result).toContain("worktree alloc failed");
  });

  it("renders the empty-delta message and skips rankings when nothing changed", () => {
    const output: HotspotsOutput = {
      generated: "2026-01-01T00:00:00.000Z",
      guide: {},
      churnWindow: "3 months",
      delta: { base: "main", head: "HEAD", changedFiles: [] },
      rankings: {},
      corpus: { fileCount: 0, totalComplexity: 0 },
    };

    const result = formatHotspotsTable(output);

    expect(result).toContain("0 files changed since main");
    expect(result).toContain("No changes — nothing to rank.");
    // The normal "Hotspots — churn window" header should NOT render
    expect(result).not.toContain("Hotspots — 3 months");
  });

  it("renders a Δ column when ranking entries carry complexityDelta", () => {
    const output: HotspotsOutput = {
      generated: "2026-01-01T00:00:00.000Z",
      guide: {},
      churnWindow: "3 months",
      delta: {
        base: "main",
        head: "HEAD",
        changedFiles: ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"],
      },
      rankings: {
        complexity: {
          label: "Complexity × Churn",
          scoreFormula: "complexity × churn",
          totalScore: 100,
          tierCounts: { hot: 4, warm: 0, cool: 0 },
          totalEntries: 4,
          showing: 4,
          confidence: STUB_CONFIDENCE,
          entries: [
            {
              file: "src/a.ts",
              score: 30,
              percentOfTotal: 30,
              tier: "hot",
              churn: 3,
              metricValue: 10,
              metricDensity: 0.1,
              complexityDelta: {
                oldComplexity: 5,
                newComplexity: 17,
                change: 12,
              },
            },
            {
              file: "src/b.ts",
              score: 20,
              percentOfTotal: 20,
              tier: "hot",
              churn: 2,
              metricValue: 10,
              metricDensity: 0.1,
              complexityDelta: {
                oldComplexity: 10,
                newComplexity: 7,
                change: -3,
              },
            },
            {
              file: "src/c.ts",
              score: 20,
              percentOfTotal: 20,
              tier: "hot",
              churn: 2,
              metricValue: 10,
              metricDensity: 0.1,
              complexityDelta: {
                oldComplexity: null,
                newComplexity: 8,
                change: null,
              },
            },
            {
              file: "src/d.ts",
              score: 30,
              percentOfTotal: 30,
              tier: "hot",
              churn: 3,
              metricValue: 10,
              metricDensity: 0.1,
              complexityDelta: {
                oldComplexity: 4,
                newComplexity: 4,
                change: 0,
              },
            },
          ],
        },
      },
      corpus: { fileCount: 4, totalComplexity: 36 },
    };

    const result = formatHotspotsTable(output);

    expect(result).toContain("Δ");
    expect(result).toContain("+12");
    expect(result).toContain("-3");
    expect(result).toContain("new");
    // Unchanged complexity renders as plain "0"
    expect(result).toMatch(/\s+0\s+/);
  });

  it("falls back to '·' for ranking entries missing a complexityDelta when the column is on", () => {
    const output: HotspotsOutput = {
      generated: "2026-01-01T00:00:00.000Z",
      guide: {},
      churnWindow: "3 months",
      delta: {
        base: "main",
        head: "HEAD",
        changedFiles: ["src/a.ts", "src/b.ts"],
      },
      rankings: {
        complexity: {
          label: "Complexity × Churn",
          scoreFormula: "complexity × churn",
          totalScore: 20,
          tierCounts: { hot: 2, warm: 0, cool: 0 },
          totalEntries: 2,
          showing: 2,
          confidence: STUB_CONFIDENCE,
          entries: [
            {
              file: "src/a.ts",
              score: 10,
              percentOfTotal: 50,
              tier: "hot",
              churn: 5,
              metricValue: 2,
              metricDensity: 0.1,
              complexityDelta: {
                oldComplexity: 1,
                newComplexity: 3,
                change: 2,
              },
            },
            {
              file: "src/b.ts",
              score: 10,
              percentOfTotal: 50,
              tier: "hot",
              churn: 5,
              metricValue: 2,
              metricDensity: 0.1,
              // No complexityDelta — this entry triggers the '·' fallback.
            },
          ],
        },
      },
      corpus: { fileCount: 2, totalComplexity: 4 },
    };

    const result = formatHotspotsTable(output);
    expect(result).toContain("+2");
    expect(result).toContain("·");
  });

  it("omits the Δ column when delta is set but entries have no complexityDelta", () => {
    const output: HotspotsOutput = {
      generated: "2026-01-01T00:00:00.000Z",
      guide: {},
      churnWindow: "3 months",
      delta: {
        base: "main",
        head: "HEAD",
        changedFiles: ["src/a.ts"],
      },
      rankings: {
        complexity: {
          label: "Complexity × Churn",
          scoreFormula: "complexity × churn",
          totalScore: 10,
          tierCounts: { hot: 1, warm: 0, cool: 0 },
          totalEntries: 1,
          showing: 1,
          confidence: STUB_CONFIDENCE,
          entries: [
            {
              file: "src/a.ts",
              score: 10,
              percentOfTotal: 100,
              tier: "hot",
              churn: 5,
              metricValue: 2,
              metricDensity: 0.1,
            },
          ],
        },
      },
      corpus: { fileCount: 1, totalComplexity: 10 },
    };

    const result = formatHotspotsTable(output);

    // Δ column header should not appear when no entry has delta data —
    // this is the fallback-after-warning path.
    const headerLine = result.split("\n").find((l) => l.includes("Score"));
    expect(headerLine).not.toContain("Δ");
  });

  it("warns in the footer when the corpus is unfiltered", () => {
    const output: HotspotsOutput = {
      generated: "2026-01-01T00:00:00.000Z",
      guide: {},
      churnWindow: "3 months",
      rankings: {
        complexity: {
          label: "Complexity × Churn",
          scoreFormula: "complexity × churn",
          totalScore: 10,
          tierCounts: { hot: 1, warm: 0, cool: 0 },
          totalEntries: 1,
          showing: 1,
          confidence: STUB_CONFIDENCE,
          entries: [
            {
              file: "pnpm-lock.yaml",
              score: 10,
              percentOfTotal: 100,
              tier: "hot",
              churn: 5,
              metricValue: 2,
              metricDensity: 0.1,
            },
          ],
        },
      },
      corpus: { fileCount: 1, totalComplexity: 10, filtered: false },
    };

    const result = formatHotspotsTable(output);
    expect(result).toContain("Corpus unfiltered");
    expect(result).toContain("obscene init");
  });

  it("omits the unfiltered-corpus footer when filtered is true", () => {
    const output: HotspotsOutput = {
      generated: "2026-01-01T00:00:00.000Z",
      guide: {},
      churnWindow: "3 months",
      rankings: {
        complexity: {
          label: "Complexity × Churn",
          scoreFormula: "complexity × churn",
          totalScore: 10,
          tierCounts: { hot: 1, warm: 0, cool: 0 },
          totalEntries: 1,
          showing: 1,
          confidence: STUB_CONFIDENCE,
          entries: [
            {
              file: "src/a.ts",
              score: 10,
              percentOfTotal: 100,
              tier: "hot",
              churn: 5,
              metricValue: 2,
              metricDensity: 0.1,
            },
          ],
        },
      },
      corpus: { fileCount: 1, totalComplexity: 10, filtered: true },
    };

    const result = formatHotspotsTable(output);
    expect(result).not.toContain("Corpus unfiltered");
  });
});

describe("formatCouplingTable", () => {
  it("formats coupling output with emoji tier labels", () => {
    const output: CouplingOutput = {
      generated: "2026-01-01T00:00:00.000Z",
      guide: {},
      churnWindow: "3 months",
      minCochanges: 2,
      totalScore: 15,
      tierCounts: { hot: 1, warm: 1, cool: 0 },
      totalCouplings: 2,
      showing: 2,
      confidence: STUB_CONFIDENCE,
      couplings: [
        {
          file1: "src/auth.ts",
          file2: "lib/session.ts",
          cochanges: 10,
          degree: 83.3,
          totalComplexity: 45,
          couplingScore: 10,
          percentOfTotal: 66.7,
          tier: "hot",
        },
        {
          file1: "src/api.ts",
          file2: "lib/http.ts",
          cochanges: 5,
          degree: 50.0,
          totalComplexity: 30,
          couplingScore: 5,
          percentOfTotal: 33.3,
          tier: "warm",
        },
      ],
    };

    const result = formatCouplingTable(output);

    expect(result).toContain("Coupling");
    expect(result).toContain("3 months");
    expect(result).toContain("Min shared: 2");
    expect(result).toContain("🔥");
    expect(result).toContain("HOT");
    expect(result).toContain("☀️");
    expect(result).toContain("WARM");
    expect(result).toContain("src/auth.ts");
    expect(result).toContain("lib/session.ts");
    expect(result).toContain("Showing: 2 of 2");
    expect(result).toContain("Shared=co-changed commits");
    expect(result).toContain("Degree=shared/min(churn)");
  });

  it("shows cool tier with green emoji", () => {
    const output: CouplingOutput = {
      generated: "2026-01-01T00:00:00.000Z",
      guide: {},
      churnWindow: "3 months",
      minCochanges: 1,
      totalScore: 3,
      tierCounts: { hot: 0, warm: 0, cool: 1 },
      totalCouplings: 1,
      showing: 1,
      confidence: STUB_CONFIDENCE,
      couplings: [
        {
          file1: "src/a.ts",
          file2: "lib/b.ts",
          cochanges: 3,
          degree: 30.0,
          totalComplexity: 10,
          couplingScore: 3,
          percentOfTotal: 100,
          tier: "cool",
        },
      ],
    };

    const result = formatCouplingTable(output);

    expect(result).toContain("🧊");
    expect(result).toContain("COOL");
  });

  it("marks deleted files with a dagger and includes legend", () => {
    const output: CouplingOutput = {
      generated: "2026-01-01T00:00:00.000Z",
      guide: {},
      churnWindow: "3 months",
      minCochanges: 1,
      totalScore: 8,
      tierCounts: { hot: 1, warm: 0, cool: 1 },
      totalCouplings: 2,
      showing: 2,
      confidence: STUB_CONFIDENCE,
      couplings: [
        {
          file1: "src/old-removed.ts",
          file2: "lib/current.ts",
          cochanges: 5,
          degree: 50.0,
          totalComplexity: 0,
          couplingScore: 5,
          percentOfTotal: 62.5,
          tier: "hot",
          file1Deleted: true,
        },
        {
          file1: "src/live-a.ts",
          file2: "src/gone-b.ts",
          cochanges: 3,
          degree: 30.0,
          totalComplexity: 10,
          couplingScore: 3,
          percentOfTotal: 37.5,
          tier: "cool",
          file2Deleted: true,
        },
      ],
    };

    const result = formatCouplingTable(output);

    expect(result).toContain("† src/old-removed.ts");
    expect(result).toContain("† src/gone-b.ts");
    expect(result).toContain("file no longer present at HEAD");
  });

  it("marks lockstep pairs with an arrow and includes legend", () => {
    const output: CouplingOutput = {
      generated: "2026-01-01T00:00:00.000Z",
      guide: {},
      churnWindow: "3 months",
      minCochanges: 1,
      totalScore: 4,
      tierCounts: { hot: 1, warm: 0, cool: 0 },
      totalCouplings: 1,
      showing: 1,
      confidence: STUB_CONFIDENCE,
      couplings: [
        {
          file1: "src/twin-a.ts",
          file2: "src/twin-b.ts",
          cochanges: 4,
          degree: 100,
          totalComplexity: 10,
          couplingScore: 4,
          percentOfTotal: 100,
          tier: "hot",
          lockstep: true,
        },
      ],
    };

    const result = formatCouplingTable(output);

    expect(result).toContain("⇄");
    expect(result).toContain("lockstep pair");
  });

  it("omits the deleted-file legend when no file is deleted", () => {
    const output: CouplingOutput = {
      generated: "2026-01-01T00:00:00.000Z",
      guide: {},
      churnWindow: "3 months",
      minCochanges: 1,
      totalScore: 5,
      tierCounts: { hot: 1, warm: 0, cool: 0 },
      totalCouplings: 1,
      showing: 1,
      confidence: STUB_CONFIDENCE,
      couplings: [
        {
          file1: "src/a.ts",
          file2: "src/b.ts",
          cochanges: 5,
          degree: 50.0,
          totalComplexity: 20,
          couplingScore: 5,
          percentOfTotal: 100,
          tier: "hot",
        },
      ],
    };

    const result = formatCouplingTable(output);

    expect(result).not.toContain("no longer present at HEAD");
    expect(result).not.toContain("†");
  });

  it("truncates long file paths", () => {
    const output: CouplingOutput = {
      generated: "2026-01-01T00:00:00.000Z",
      guide: {},
      churnWindow: "3 months",
      minCochanges: 1,
      totalScore: 5,
      tierCounts: { hot: 1, warm: 0, cool: 0 },
      totalCouplings: 1,
      showing: 1,
      confidence: STUB_CONFIDENCE,
      couplings: [
        {
          file1: "src/very/deeply/nested/directory/structure/component.ts",
          file2: "lib/another/very/deeply/nested/directory/service.ts",
          cochanges: 5,
          degree: 50.0,
          totalComplexity: 20,
          couplingScore: 5,
          percentOfTotal: 100,
          tier: "hot",
        },
      ],
    };

    const result = formatCouplingTable(output);

    expect(result).toContain("…");
  });
});

describe("formatCompositeTable", () => {
  it("renders composite table with dimension count and tier labels", () => {
    const output: CompositeOutput = {
      label: "Combined",
      scoreFormula: "reciprocal rank fusion across all dimensions",
      totalScore: 0.5,
      tierCounts: { hot: 1, warm: 1, cool: 0 },
      totalDimensions: 4,
      totalEntries: 2,
      showing: 2,
      confidence: STUB_CONFIDENCE,
      entries: [
        {
          file: "src/foo.ts",
          score: 0.3,
          percentOfTotal: 60,
          tier: "hot",
          churn: 15,
          dimensionCount: 4,
        },
        {
          file: "src/bar.ts",
          score: 0.2,
          percentOfTotal: 40,
          tier: "warm",
          churn: 8,
          dimensionCount: 2,
        },
      ],
    };

    const result = formatCompositeTable(output);

    // Star prefix + uppercase label for composite emphasis
    expect(result).toContain("★ COMBINED");
    expect(result).toContain("src/foo.ts");
    expect(result).toContain("src/bar.ts");
    expect(result).toContain("Dims");
    expect(result).toContain("🔥");
    expect(result).toContain("HOT");
    expect(result).toContain("☀️");
    expect(result).toContain("WARM");
    expect(result).toContain("Showing: 2 of 2");
    // Emphasis separator line before composite header
    expect(result).toContain("═");
  });

  it("renders a Δ column in the composite table when entries carry deltas", () => {
    const output: CompositeOutput = {
      label: "Combined",
      scoreFormula: "reciprocal rank fusion across all dimensions",
      totalScore: 0.5,
      tierCounts: { hot: 1, warm: 1, cool: 1 },
      totalDimensions: 4,
      totalEntries: 3,
      showing: 3,
      confidence: STUB_CONFIDENCE,
      entries: [
        {
          file: "src/grew.ts",
          score: 0.3,
          percentOfTotal: 60,
          tier: "hot",
          churn: 15,
          dimensionCount: 4,
          complexityDelta: { oldComplexity: 8, newComplexity: 15, change: 7 },
        },
        {
          file: "src/shrank.ts",
          score: 0.15,
          percentOfTotal: 30,
          tier: "warm",
          churn: 5,
          dimensionCount: 3,
          complexityDelta: { oldComplexity: 12, newComplexity: 7, change: -5 },
        },
        {
          file: "src/added.ts",
          score: 0.05,
          percentOfTotal: 10,
          tier: "cool",
          churn: 2,
          dimensionCount: 2,
          complexityDelta: {
            oldComplexity: null,
            newComplexity: 3,
            change: null,
          },
        },
      ],
    };

    const result = formatCompositeTable(output);

    const headerLine = result.split("\n").find((l) => l.includes("Score"));
    expect(headerLine).toContain("Δ");
    expect(result).toContain("+7");
    expect(result).toContain("-5");
    expect(result).toContain("new");
  });

  it("falls back to '·' for composite entries missing a complexityDelta when the column is on", () => {
    const output: CompositeOutput = {
      label: "Combined",
      scoreFormula: "rrf",
      totalScore: 0.2,
      tierCounts: { hot: 1, warm: 1, cool: 0 },
      totalDimensions: 4,
      totalEntries: 2,
      showing: 2,
      confidence: STUB_CONFIDENCE,
      entries: [
        {
          file: "src/with-delta.ts",
          score: 0.1,
          percentOfTotal: 50,
          tier: "hot",
          churn: 5,
          dimensionCount: 4,
          complexityDelta: { oldComplexity: 2, newComplexity: 5, change: 3 },
        },
        {
          file: "src/no-delta.ts",
          score: 0.1,
          percentOfTotal: 50,
          tier: "warm",
          churn: 3,
          dimensionCount: 2,
          // No complexityDelta — triggers the composite '·' fallback.
        },
      ],
    };

    const result = formatCompositeTable(output);

    expect(result).toContain("+3");
    expect(result).toContain("·");
  });

  it("renders unchanged-complexity cell as '0' in the composite Δ column", () => {
    const output: CompositeOutput = {
      label: "Combined",
      scoreFormula: "rrf",
      totalScore: 0.1,
      tierCounts: { hot: 0, warm: 0, cool: 1 },
      totalDimensions: 4,
      totalEntries: 1,
      showing: 1,
      confidence: STUB_CONFIDENCE,
      entries: [
        {
          file: "src/same.ts",
          score: 0.1,
          percentOfTotal: 100,
          tier: "cool",
          churn: 2,
          dimensionCount: 1,
          complexityDelta: { oldComplexity: 6, newComplexity: 6, change: 0 },
        },
      ],
    };

    const result = formatCompositeTable(output);

    // Header includes Δ, row shows 0 (no '+' or '-')
    const headerLine = result.split("\n").find((l) => l.includes("Score"));
    expect(headerLine).toContain("Δ");
    expect(result).toMatch(/\s+0\s+/);
  });
});

describe("formatHotspotsTable fullDelta section", () => {
  function baseFullDelta(over: Partial<HotspotDelta> = {}): HotspotDelta {
    return {
      base: "main",
      head: "HEAD",
      newFiles: [],
      deletedFiles: [],
      tierTransitions: {
        enteredHot: [],
        enteredWarm: [],
        exitedHot: [],
        exitedWarm: [],
      },
      scoreChanges: [],
      perDimensionDeltas: {
        complexity: { oldTotal: 100, newTotal: 100, change: 0 },
        fileCount: { oldTotal: 10, newTotal: 10, change: 0 },
      },
      ...over,
    };
  }

  function outputWithFullDelta(fd: HotspotDelta): HotspotsOutput {
    return {
      generated: "2026-01-01T00:00:00.000Z",
      guide: {},
      churnWindow: "3 months",
      rankings: {},
      corpus: { fileCount: 0, totalComplexity: 0 },
      fullDelta: fd,
    };
  }

  it("renders an empty state when nothing transitioned or moved", () => {
    const out = formatHotspotsTable(outputWithFullDelta(baseFullDelta()));
    expect(out).toContain("Full Delta — main → HEAD");
    expect(out).toContain("No tier transitions, no new/deleted files.");
    expect(out).toContain("complexity 100 → 100 (0)");
    expect(out).toContain("files 10 → 10 (0)");
  });

  it("renders all four tier transitions and signed corpus deltas", () => {
    const fd = baseFullDelta({
      tierTransitions: {
        enteredHot: ["a.ts"],
        enteredWarm: ["b.ts"],
        exitedHot: ["c.ts"],
        exitedWarm: ["d.ts"],
      },
      perDimensionDeltas: {
        complexity: { oldTotal: 100, newTotal: 150, change: 50 },
        fileCount: { oldTotal: 10, newTotal: 12, change: 2 },
      },
    });
    const out = formatHotspotsTable(outputWithFullDelta(fd));
    expect(out).toContain("entered HOT (1)");
    expect(out).toContain("a.ts");
    expect(out).toContain("entered WARM (1)");
    expect(out).toContain("b.ts");
    expect(out).toContain("cooled out of HOT (1)");
    expect(out).toContain("c.ts");
    expect(out).toContain("cooled out of WARM (1)");
    expect(out).toContain("d.ts");
    expect(out).toContain("complexity 100 → 150 (+50)");
    expect(out).toContain("files 10 → 12 (+2)");
  });

  it("lists new and deleted files, with overflow ellipsis past 10", () => {
    const many = Array.from({ length: 12 }, (_, i) => `new${i}.ts`);
    const manyDeleted = Array.from({ length: 11 }, (_, i) => `old${i}.ts`);
    const fd = baseFullDelta({
      newFiles: many,
      deletedFiles: manyDeleted,
    });
    const out = formatHotspotsTable(outputWithFullDelta(fd));
    expect(out).toContain("new files (12)");
    expect(out).toContain("new0.ts");
    expect(out).toContain("… and 2 more");
    expect(out).toContain("deleted files (11)");
    expect(out).toContain("… and 1 more");
  });

  it("truncates tier-transition lists past 10 entries", () => {
    const manyHot = Array.from({ length: 13 }, (_, i) => `hot${i}.ts`);
    const fd = baseFullDelta({
      tierTransitions: {
        enteredHot: manyHot,
        enteredWarm: [],
        exitedHot: [],
        exitedWarm: [],
      },
    });
    const out = formatHotspotsTable(outputWithFullDelta(fd));
    expect(out).toContain("entered HOT (13)");
    expect(out).toContain("hot0.ts");
    expect(out).toContain("… and 3 more");
  });

  it("renders short new/deleted lists inline without ellipsis", () => {
    const fd = baseFullDelta({
      newFiles: ["x.ts"],
      deletedFiles: ["y.ts"],
    });
    const out = formatHotspotsTable(outputWithFullDelta(fd));
    expect(out).toContain("new files (1)");
    expect(out).toContain("x.ts");
    expect(out).toContain("deleted files (1)");
    expect(out).toContain("y.ts");
    expect(out).not.toContain("more");
  });
});
