import { describe, expect, it } from "vitest";
import {
  formatCompositeTable,
  formatCouplingTable,
  formatHotspotsTable,
  formatReportTable,
} from "./format.js";
import type {
  CompositeOutput,
  CouplingOutput,
  HotspotsOutput,
  ReportOutput,
} from "./types.js";

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
      guide: {},
      churnWindow: "3 months",
      rankings: {
        complexity: {
          label: "Complexity \u00D7 Churn",
          scoreFormula: "complexity \u00D7 churn",
          totalScore: 1000,
          tierCounts: { danger: 1, watch: 1, stable: 0 },
          totalEntries: 2,
          showing: 2,
          entries: [
            {
              file: "src/foo.ts",
              score: 750,
              percentOfTotal: 75,
              tier: "danger",
              churn: 15,
              metricValue: 50,
              metricDensity: 0.25,
            },
            {
              file: "src/bar.ts",
              score: 250,
              percentOfTotal: 25,
              tier: "watch",
              churn: 10,
              metricValue: 25,
              metricDensity: 0.25,
            },
          ],
        },
      },
    };

    const result = formatHotspotsTable(output);

    expect(result).toContain("Hotspots");
    expect(result).toContain("3 months");
    expect(result).toContain("Complexity \u00D7 Churn");
    expect(result).toContain("1,000");
    expect(result).toContain("src/foo.ts");
    expect(result).toContain("src/bar.ts");
    expect(result).toContain("Showing: 2 of 2");
    // Emoji tier labels
    expect(result).toContain("🔴");
    expect(result).toContain("DANGER");
    expect(result).toContain("🟡");
    expect(result).toContain("WATCH");
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
          tierCounts: { danger: 1, watch: 0, stable: 0 },
          totalEntries: 1,
          showing: 1,
          entries: [
            {
              file: "src/foo.ts",
              score: 500,
              percentOfTotal: 100,
              tier: "danger",
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
          tierCounts: { danger: 1, watch: 0, stable: 0 },
          totalEntries: 1,
          showing: 1,
          entries: [
            {
              file: "src/foo.ts",
              score: 50,
              percentOfTotal: 100,
              tier: "danger",
              churn: 10,
              metricValue: 5,
            },
          ],
        },
      },
    };

    const result = formatHotspotsTable(output);

    expect(result).toContain("Complexity \u00D7 Churn");
    expect(result).toContain("Nesting \u00D7 Churn");
    // Nesting table should have Nest column
    expect(result).toContain("Nest");
  });

  it("shows stable tier with green emoji", () => {
    const output: HotspotsOutput = {
      generated: "2026-01-01T00:00:00.000Z",
      guide: {},
      churnWindow: "3 months",
      rankings: {
        complexity: {
          label: "Complexity \u00D7 Churn",
          scoreFormula: "complexity \u00D7 churn",
          totalScore: 100,
          tierCounts: { danger: 0, watch: 0, stable: 1 },
          totalEntries: 1,
          showing: 1,
          entries: [
            {
              file: "src/calm.ts",
              score: 100,
              percentOfTotal: 100,
              tier: "stable",
              churn: 20,
              metricValue: 5,
              metricDensity: 0.1,
            },
          ],
        },
      },
    };

    const result = formatHotspotsTable(output);

    expect(result).toContain("🟢");
    expect(result).toContain("stable");
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
          tierCounts: { danger: 1, watch: 0, stable: 0 },
          totalEntries: 1,
          showing: 1,
          entries: [
            {
              file: "src/big.ts",
              score: 10000000000,
              percentOfTotal: 100,
              tier: "danger",
              churn: 100000,
              metricValue: 100000,
              metricDensity: 1.0,
            },
          ],
        },
      },
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
          tierCounts: { danger: 1, watch: 0, stable: 0 },
          totalEntries: 1,
          showing: 1,
          entries: [
            {
              file: "src/very/deeply/nested/directory/structure/component.ts",
              score: 500,
              percentOfTotal: 100,
              tier: "danger",
              churn: 10,
              metricValue: 50,
              metricDensity: 0.5,
            },
          ],
        },
      },
    };

    const result = formatHotspotsTable(output);

    expect(result).toContain("…");
  });

  it("renders defects table with DfDns column", () => {
    const output: HotspotsOutput = {
      generated: "2026-01-01T00:00:00.000Z",
      guide: {},
      churnWindow: "3 months",
      rankings: {
        defects: {
          label: "Defects \u00D7 Churn",
          scoreFormula: "defects \u00D7 churn",
          totalScore: 30,
          tierCounts: { danger: 1, watch: 0, stable: 0 },
          totalEntries: 1,
          showing: 1,
          entries: [
            {
              file: "src/buggy.ts",
              score: 30,
              percentOfTotal: 100,
              tier: "danger",
              churn: 10,
              metricValue: 3,
              metricDensity: 0.03,
            },
          ],
        },
      },
    };

    const result = formatHotspotsTable(output);

    expect(result).toContain("Dfcts");
    expect(result).toContain("DfDns");
    expect(result).toContain("0.0300");
  });

  it("renders authors table with Auth column", () => {
    const output: HotspotsOutput = {
      generated: "2026-01-01T00:00:00.000Z",
      guide: {},
      churnWindow: "3 months",
      rankings: {
        authors: {
          label: "Authors \u00D7 Churn",
          scoreFormula: "authors \u00D7 churn",
          totalScore: 20,
          tierCounts: { danger: 1, watch: 0, stable: 0 },
          totalEntries: 1,
          showing: 1,
          entries: [
            {
              file: "src/shared.ts",
              score: 20,
              percentOfTotal: 100,
              tier: "danger",
              churn: 10,
              metricValue: 2,
            },
          ],
        },
      },
    };

    const result = formatHotspotsTable(output);

    expect(result).toContain("Auth");
    expect(result).toContain("Authors \u00D7 Churn");
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
          tierCounts: { danger: 1, watch: 0, stable: 0 },
          totalEntries: 1,
          showing: 1,
          entries: [
            {
              file: "src/foo.ts",
              score: 100,
              percentOfTotal: 100,
              tier: "danger",
              churn: 10,
              metricValue: 10,
            },
          ],
        },
      },
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
          label: "Defects \u00D7 Churn",
          scoreFormula: "defects \u00D7 churn",
          totalScore: 10,
          tierCounts: { danger: 1, watch: 0, stable: 0 },
          totalEntries: 1,
          showing: 1,
          entries: [
            {
              file: "src/foo.ts",
              score: 10,
              percentOfTotal: 100,
              tier: "danger",
              churn: 5,
              metricValue: 2,
            },
          ],
        },
      },
    };

    const result = formatHotspotsTable(output);

    expect(result).toContain("0.0000");
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
          tierCounts: { danger: 1, watch: 0, stable: 0 },
          totalEntries: 1,
          showing: 1,
          entries: [
            {
              file: "src/foo.ts",
              score: 42,
              percentOfTotal: 100,
              tier: "danger",
              churn: 7,
              metricValue: 6,
            },
          ],
        },
      },
    };

    const result = formatHotspotsTable(output);

    expect(result).toContain("Custom Metric");
    expect(result).toContain("Score");
    expect(result).toContain("Tier");
    // No metric-specific columns
    expect(result).not.toContain("Cmplx");
    expect(result).not.toContain("Nest");
    expect(result).not.toContain("Auth");
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
      tierCounts: { danger: 1, watch: 1, stable: 0 },
      totalCouplings: 2,
      showing: 2,
      couplings: [
        {
          file1: "src/auth.ts",
          file2: "lib/session.ts",
          cochanges: 10,
          degree: 83.3,
          totalComplexity: 45,
          couplingScore: 10,
          percentOfTotal: 66.7,
          tier: "danger",
        },
        {
          file1: "src/api.ts",
          file2: "lib/http.ts",
          cochanges: 5,
          degree: 50.0,
          totalComplexity: 30,
          couplingScore: 5,
          percentOfTotal: 33.3,
          tier: "watch",
        },
      ],
    };

    const result = formatCouplingTable(output);

    expect(result).toContain("Coupling");
    expect(result).toContain("3 months");
    expect(result).toContain("Min shared: 2");
    expect(result).toContain("🔴");
    expect(result).toContain("DANGER");
    expect(result).toContain("🟡");
    expect(result).toContain("WATCH");
    expect(result).toContain("src/auth.ts");
    expect(result).toContain("lib/session.ts");
    expect(result).toContain("Showing: 2 of 2");
    expect(result).toContain("Shared=co-changed commits");
    expect(result).toContain("Degree=shared/min(churn)");
  });

  it("shows stable tier with green emoji", () => {
    const output: CouplingOutput = {
      generated: "2026-01-01T00:00:00.000Z",
      guide: {},
      churnWindow: "3 months",
      minCochanges: 1,
      totalScore: 3,
      tierCounts: { danger: 0, watch: 0, stable: 1 },
      totalCouplings: 1,
      showing: 1,
      couplings: [
        {
          file1: "src/a.ts",
          file2: "lib/b.ts",
          cochanges: 3,
          degree: 30.0,
          totalComplexity: 10,
          couplingScore: 3,
          percentOfTotal: 100,
          tier: "stable",
        },
      ],
    };

    const result = formatCouplingTable(output);

    expect(result).toContain("🟢");
    expect(result).toContain("stable");
  });

  it("truncates long file paths", () => {
    const output: CouplingOutput = {
      generated: "2026-01-01T00:00:00.000Z",
      guide: {},
      churnWindow: "3 months",
      minCochanges: 1,
      totalScore: 5,
      tierCounts: { danger: 1, watch: 0, stable: 0 },
      totalCouplings: 1,
      showing: 1,
      couplings: [
        {
          file1: "src/very/deeply/nested/directory/structure/component.ts",
          file2: "lib/another/very/deeply/nested/directory/service.ts",
          cochanges: 5,
          degree: 50.0,
          totalComplexity: 20,
          couplingScore: 5,
          percentOfTotal: 100,
          tier: "danger",
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
      tierCounts: { danger: 1, watch: 1, stable: 0 },
      totalEntries: 2,
      showing: 2,
      entries: [
        {
          file: "src/foo.ts",
          score: 0.3,
          percentOfTotal: 60,
          tier: "danger",
          churn: 15,
          dimensionCount: 4,
        },
        {
          file: "src/bar.ts",
          score: 0.2,
          percentOfTotal: 40,
          tier: "watch",
          churn: 8,
          dimensionCount: 2,
        },
      ],
    };

    const result = formatCompositeTable(output);

    expect(result).toContain("Combined");
    expect(result).toContain("src/foo.ts");
    expect(result).toContain("src/bar.ts");
    expect(result).toContain("Dims");
    expect(result).toContain("🔴");
    expect(result).toContain("DANGER");
    expect(result).toContain("🟡");
    expect(result).toContain("WATCH");
    expect(result).toContain("Showing: 2 of 2");
  });
});
