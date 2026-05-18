import { describe, expect, test } from "vitest";
import {
  ageInDays,
  busiestDay,
  commas,
  formatTypeHistogram,
  heaviestFile,
  languageBreakdown,
  parseCommitTypes,
  renderFunStatsSection,
} from "./dogfood-render.mjs";

describe("parseCommitTypes", () => {
  test("counts conventional commit types, handling scopes and ! marker", () => {
    const subjects = [
      "feat: add foo",
      "fix(scope): bar",
      "feat!: breaking",
      "chore(release): 1.0.0",
    ];
    expect(parseCommitTypes(subjects)).toEqual({ feat: 2, fix: 1, chore: 1 });
  });

  test("ignores subjects without a recognizable type prefix", () => {
    expect(parseCommitTypes(["update readme", "WIP", "", "Merge branch foo"])).toEqual({});
  });
});

describe("formatTypeHistogram", () => {
  test("sorts by count descending and wraps types in backticks", () => {
    expect(formatTypeHistogram({ feat: 3, fix: 1, chore: 2 })).toBe(
      "3 `feat` · 2 `chore` · 1 `fix`",
    );
  });

  test("returns a fallback label when there are no recognized commits", () => {
    expect(formatTypeHistogram({})).toBe("no conventional commits");
  });
});

describe("busiestDay", () => {
  test("returns the weekday with the most commits (UTC)", () => {
    const timestamps = [
      "2026-05-17T10:00:00Z", // Sunday
      "2026-05-17T15:00:00Z", // Sunday
      "2026-05-17T22:00:00Z", // Sunday
      "2026-05-13T08:00:00Z", // Wednesday
      "2026-05-15T12:00:00Z", // Friday
    ];
    expect(busiestDay(timestamps)).toEqual({ day: "Sunday", count: 3 });
  });

  test("returns null when there are no commits", () => {
    expect(busiestDay([])).toBeNull();
  });
});

describe("commas", () => {
  test("formats integers with US thousands separators", () => {
    expect(commas(3252)).toBe("3,252");
    expect(commas(0)).toBe("0");
    expect(commas(1000000)).toBe("1,000,000");
  });
});

describe("ageInDays", () => {
  test("computes whole days between two unix-seconds timestamps", () => {
    const day = 86400;
    expect(ageInDays(1_700_000_000, 1_700_000_000 + 10 * day)).toBe(10);
  });

  test("rounds down partial days", () => {
    expect(ageInDays(1_700_000_000, 1_700_000_000 + 86399)).toBe(0);
  });

  test("clamps to 0 when `now` precedes `from` (clock skew)", () => {
    expect(ageInDays(1_700_000_000, 1_699_000_000)).toBe(0);
  });
});

describe("heaviestFile", () => {
  test("returns the file with the most lines", () => {
    const files = [
      { file: "a.ts", lines: 100, complexity: 5 },
      { file: "b.ts", lines: 250, complexity: 30 },
      { file: "c.ts", lines: 200, complexity: 50 },
    ];
    expect(heaviestFile(files)).toEqual({ file: "b.ts", lines: 250, complexity: 30 });
  });

  test("returns null on empty input", () => {
    expect(heaviestFile([])).toBeNull();
  });
});

describe("languageBreakdown", () => {
  test("renders dominant language by code with everything else rolled up", () => {
    const files = [
      { file: "src/a.ts", code: 800 },
      { file: "src/b.ts", code: 600 },
      { file: "README.md", code: 100 },
      { file: "package.json", code: 50 },
      { file: "src/c.ts", code: 450 },
    ];
    expect(languageBreakdown(files)).toBe("TypeScript 93%, other 7%");
  });

  test("returns 'no source files' for empty input", () => {
    expect(languageBreakdown([])).toBe("no source files");
  });

  test("collapses multiple non-dominant languages into 'other'", () => {
    const files = [
      { file: "x.js", code: 400 },
      { file: "y.py", code: 100 },
      { file: "z.go", code: 100 },
    ];
    expect(languageBreakdown(files)).toBe("JavaScript 67%, other 33%");
  });

  test("renders 'Lang 100%' when only one language is present", () => {
    expect(languageBreakdown([{ file: "a.ts", code: 100 }])).toBe("TypeScript 100%");
  });
});

describe("renderFunStatsSection", () => {
  const baseInput = {
    lastTag: "v1.0.0",
    release: {
      commitCount: 4,
      commitSubjects: ["feat: a", "fix: b", "feat: c", "refactor: d"],
      commitTimestamps: ["2026-05-17T10:00:00Z", "2026-05-17T11:00:00Z"],
      largestCommit: { sha: "abc1234", subject: "feat: big change", lines: 250 },
      netLines: { added: 312, removed: 47 },
      complexityDelta: { oldTotal: 392, newTotal: 386, change: -6 },
    },
    codebase: {
      fileCount: 17,
      totalCode: 3252,
      totalComplexity: 386,
      avgComplexityPerFile: 22.7,
      commentRatio: 0.14,
      heaviest: { file: "src/analyze.ts", lines: 1622, complexity: 254 },
      languages: "TypeScript 98%, other 2%",
      ageDays: 47,
    },
  };

  test("emits a two-section markdown block with the expected headings", () => {
    const out = renderFunStatsSection(baseInput);
    expect(out).toContain("### 📊 By the numbers");
    expect(out).toContain("**This release**");
    expect(out).toContain("**The codebase**");
  });

  test("renders release stats rows", () => {
    const out = renderFunStatsSection(baseInput);
    expect(out).toContain("4 since `v1.0.0`");
    expect(out).toContain("2 `feat` · 1 `fix` · 1 `refactor`");
    expect(out).toContain("`abc1234`");
    expect(out).toContain("+312 / −47");
    expect(out).toContain("392 → 386");
  });

  test("renders codebase stats rows", () => {
    const out = renderFunStatsSection(baseInput);
    expect(out).toContain("3,252");
    expect(out).toContain("avg 22.7/file");
    expect(out).toContain("`src/analyze.ts`");
    expect(out).toContain("1,622 lines");
    expect(out).toContain("TypeScript 98%");
    expect(out).toContain("14%");
    expect(out).toContain("47 days");
  });

  test("omits release section when no lastTag (first release)", () => {
    const out = renderFunStatsSection({ ...baseInput, lastTag: "", release: null });
    expect(out).not.toContain("**This release**");
    expect(out).toContain("**The codebase**");
  });

  test("omits the Δ complexity row when the delta is unavailable", () => {
    const release = { ...baseInput.release, complexityDelta: null };
    const out = renderFunStatsSection({ ...baseInput, release });
    expect(out).toContain("**This release**");
    expect(out).not.toContain("Δ complexity");
    expect(out).not.toContain("0 → 0");
  });
});
