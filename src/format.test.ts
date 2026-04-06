import { describe, expect, it } from "vitest";
import {
  formatCouplingTable,
  formatHotspotsTable,
  formatReportTable,
} from "./format.js";
import type { CouplingOutput, HotspotsOutput, ReportOutput } from "./types.js";

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
  it("formats hotspot output as a table", () => {
    const output: HotspotsOutput = {
      generated: "2026-01-01T00:00:00.000Z",
      guide: {},
      churnWindow: "3 months",
      totalScore: 1000,
      tierCounts: { danger: 1, watch: 1, stable: 0 },
      totalHotspots: 2,
      showing: 2,
      hotspots: [
        {
          file: "src/foo.ts",
          code: 200,
          lines: 250,
          complexity: 50,
          comments: 10,
          complexityDensity: 0.25,
          churn: 15,
          hotspotScore: 750,
          percentOfTotal: 75,
          tier: "danger",
          defects: 3,
          defectDensity: 0.015,
          maxNesting: 4,
          authors: 2,
        },
        {
          file: "src/bar.ts",
          code: 100,
          lines: 150,
          complexity: 25,
          comments: 5,
          complexityDensity: 0.25,
          churn: 10,
          hotspotScore: 250,
          percentOfTotal: 25,
          tier: "watch",
          defects: 1,
          defectDensity: 0.01,
          maxNesting: 2,
          authors: 1,
        },
      ],
    };

    const result = formatHotspotsTable(output);

    expect(result).toContain("Hotspots");
    expect(result).toContain("3 months");
    expect(result).toContain("1,000");
    expect(result).toContain("1 danger");
    expect(result).toContain("1 watch");
    expect(result).toContain("0 stable");
    expect(result).toContain("DANGER");
    expect(result).toContain("WATCH");
    expect(result).toContain("src/foo.ts");
    expect(result).toContain("src/bar.ts");
    expect(result).toContain("Showing: 2 of 2");
    expect(result).toContain("Dfcts");
    expect(result).toContain("Nest");
    expect(result).toContain("Auth");

    // Legend
    expect(result).toContain("Score=complexity\u00D7churn");
    expect(result).toContain("Dfcts=fix commits");
    expect(result).toContain("Nest=max indent depth");
    expect(result).toContain("Auth=unique authors");
    expect(result).toContain("not absolute quality grades");
    expect(result).toContain("Docs: https://github.com/wbern/obscene#metrics");
  });

  it("shows stable tier label in lowercase", () => {
    const output: HotspotsOutput = {
      generated: "2026-01-01T00:00:00.000Z",
      guide: {},
      churnWindow: "3 months",
      totalScore: 100,
      tierCounts: { danger: 0, watch: 0, stable: 1 },
      totalHotspots: 1,
      showing: 1,
      hotspots: [
        {
          file: "src/calm.ts",
          code: 50,
          lines: 60,
          complexity: 5,
          comments: 2,
          complexityDensity: 0.1,
          churn: 20,
          hotspotScore: 100,
          percentOfTotal: 100,
          tier: "stable",
          defects: 0,
          defectDensity: 0,
          maxNesting: 0,
          authors: 0,
        },
      ],
    };

    const result = formatHotspotsTable(output);

    expect(result).toContain("stable");
  });

  it("handles large scores that overflow column width", () => {
    const output: HotspotsOutput = {
      generated: "2026-01-01T00:00:00.000Z",
      guide: {},
      churnWindow: "3 months",
      totalScore: 10000000000,
      tierCounts: { danger: 1, watch: 0, stable: 0 },
      totalHotspots: 1,
      showing: 1,
      hotspots: [
        {
          file: "src/big.ts",
          code: 100000,
          lines: 120000,
          complexity: 100000,
          comments: 50000,
          complexityDensity: 1.0,
          churn: 100000,
          hotspotScore: 10000000000,
          percentOfTotal: 100,
          tier: "danger",
          defects: 0,
          defectDensity: 0,
          maxNesting: 0,
          authors: 0,
        },
      ],
    };

    const result = formatHotspotsTable(output);

    // Score "10,000,000,000" exceeds the 8-char column width
    expect(result).toContain("10,000,000,000");
    expect(result).toContain("src/big.ts");
  });

  it("truncates long file paths in hotspots", () => {
    const output: HotspotsOutput = {
      generated: "2026-01-01T00:00:00.000Z",
      guide: {},
      churnWindow: "3 months",
      totalScore: 500,
      tierCounts: { danger: 1, watch: 0, stable: 0 },
      totalHotspots: 1,
      showing: 1,
      hotspots: [
        {
          file: "src/very/deeply/nested/directory/structure/component.ts",
          code: 100,
          lines: 120,
          complexity: 50,
          comments: 5,
          complexityDensity: 0.5,
          churn: 10,
          hotspotScore: 500,
          percentOfTotal: 100,
          tier: "danger",
          defects: 0,
          defectDensity: 0,
          maxNesting: 0,
          authors: 0,
        },
      ],
    };

    const result = formatHotspotsTable(output);

    expect(result).toContain("…");
  });
});

describe("formatCouplingTable", () => {
  it("formats coupling output with all expected content", () => {
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
    expect(result).toContain("1 danger");
    expect(result).toContain("1 watch");
    expect(result).toContain("0 stable");
    expect(result).toContain("DANGER");
    expect(result).toContain("WATCH");
    expect(result).toContain("src/auth.ts");
    expect(result).toContain("lib/session.ts");
    expect(result).toContain("Showing: 2 of 2");
    expect(result).toContain("Shared=co-changed commits");
    expect(result).toContain("Degree=shared/min(churn)");
  });

  it("shows stable tier in lowercase", () => {
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

    expect(result).toContain("stable");
    expect(result).not.toContain("STABLE");
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
