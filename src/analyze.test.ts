import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assignTiers,
  computeAllRankings,
  computeComposite,
  computeCorrelations,
  computeCoupling,
  computeDelta,
  computeHotspotsCore,
  computeSnapshot,
  couplingConfidence,
  detectDefaultBranch,
  detectIgnorePatterns,
  formatIgnoreFile,
  getAuthorCommitCounts,
  getChangedFiles,
  getChurn,
  getCoChanges,
  getCommitsInWindow,
  getComplexityDeltas,
  getDefects,
  getHistoryCoverage,
  getNestingDepths,
  getTrackedFiles,
  readIgnoreFile,
  runScc,
  runSccOnFiles,
  sliceCoreForDisplay,
  spearmanRho,
  UNIVERSAL_IGNORE_GROUPS,
  withWorktreeAt,
} from "./analyze.js";
import type {
  CompositeOutput,
  ConfidenceInfo,
  FileMetrics,
  HotspotSnapshot,
  RankingOutput,
  Tier,
} from "./types.js";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
  spawnSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
  mkdtempSync: vi.fn(),
  rmSync: vi.fn(),
}));

import { execSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";

const mockExecSync = vi.mocked(execSync);
const mockSpawnSync = vi.mocked(spawnSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockExistsSync = vi.mocked(existsSync);
const mockMkdtempSync = vi.mocked(mkdtempSync);
const mockRmSync = vi.mocked(rmSync);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("readIgnoreFile", () => {
  it("reads patterns from .obsignore", () => {
    mockReadFileSync.mockImplementation((path: unknown) => {
      if (path === ".obsignore") return "*.generated.*\nvendor/**\n";
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });

    const result = readIgnoreFile();

    expect(result).toEqual(["*.generated.*", "vendor/**"]);
  });

  it("falls back to .obsceneignore when .obsignore is missing", () => {
    mockReadFileSync.mockImplementation((path: unknown) => {
      if (path === ".obsceneignore") return "dist/**\n";
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });

    const result = readIgnoreFile();

    expect(result).toEqual(["dist/**"]);
  });

  it("returns empty array when neither file exists", () => {
    mockReadFileSync.mockImplementation(() => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });

    const result = readIgnoreFile();

    expect(result).toEqual([]);
  });

  it("skips comment lines and blank lines", () => {
    mockReadFileSync.mockImplementation((path: unknown) => {
      if (path === ".obsignore")
        return "# This is a comment\n\n  \n*.gen.*\n# Another comment\nvendor/**\n";
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });

    const result = readIgnoreFile();

    expect(result).toEqual(["*.gen.*", "vendor/**"]);
  });

  it("trims leading and trailing whitespace from patterns", () => {
    mockReadFileSync.mockImplementation((path: unknown) => {
      if (path === ".obsignore") return "  *.gen.*  \n  vendor/**  \n";
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });

    const result = readIgnoreFile();

    expect(result).toEqual(["*.gen.*", "vendor/**"]);
  });

  it("rethrows non-ENOENT errors", () => {
    mockReadFileSync.mockImplementation(() => {
      throw Object.assign(new Error("EACCES: permission denied"), {
        code: "EACCES",
      });
    });

    expect(() => readIgnoreFile()).toThrow("EACCES: permission denied");
  });

  it("uses .obsignore when both files exist", () => {
    mockReadFileSync.mockImplementation((path: unknown) => {
      if (path === ".obsignore") return "from-obsignore\n";
      if (path === ".obsceneignore") return "from-obsceneignore\n";
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });

    const result = readIgnoreFile();

    expect(result).toEqual(["from-obsignore"]);
  });
});

describe("runScc", () => {
  it("parses scc JSON output into FileMetrics sorted by complexity", () => {
    const sccOutput = JSON.stringify([
      {
        Name: "TypeScript",
        Files: [
          {
            Location: "src/foo.ts",
            Code: 100,
            Lines: 120,
            Complexity: 10,
            Comment: 5,
          },
          {
            Location: "src/bar.ts",
            Code: 200,
            Lines: 250,
            Complexity: 30,
            Comment: 20,
          },
        ],
      },
    ]);

    mockExecSync.mockReturnValue(Buffer.from(sccOutput));

    const result = runScc();

    expect(result).toHaveLength(2);
    expect(result[0].file).toBe("src/bar.ts");
    expect(result[0].complexity).toBe(30);
    expect(result[0].complexityDensity).toBe(0.15);
    expect(result[1].file).toBe("src/foo.ts");
    expect(result[1].complexity).toBe(10);
  });

  it("does not exclude test files by default (opt-in via .obsignore)", () => {
    const sccOutput = JSON.stringify([
      {
        Name: "TypeScript",
        Files: [
          {
            Location: "src/foo.test.ts",
            Code: 50,
            Lines: 60,
            Complexity: 5,
            Comment: 2,
          },
          {
            Location: "src/foo.spec.ts",
            Code: 50,
            Lines: 60,
            Complexity: 5,
            Comment: 2,
          },
          {
            Location: "src/__tests__/bar.ts",
            Code: 50,
            Lines: 60,
            Complexity: 5,
            Comment: 2,
          },
          {
            Location: "src/__mocks__/baz.ts",
            Code: 50,
            Lines: 60,
            Complexity: 5,
            Comment: 2,
          },
          {
            Location: "src/foo.stories.ts",
            Code: 50,
            Lines: 60,
            Complexity: 5,
            Comment: 2,
          },
          {
            Location: "src/types.d.ts",
            Code: 50,
            Lines: 60,
            Complexity: 5,
            Comment: 2,
          },
          {
            Location: "src/test-setup.ts",
            Code: 50,
            Lines: 60,
            Complexity: 5,
            Comment: 2,
          },
          {
            Location: "src/test-utils.ts",
            Code: 50,
            Lines: 60,
            Complexity: 5,
            Comment: 2,
          },
          {
            Location: "src/test-helpers.ts",
            Code: 50,
            Lines: 60,
            Complexity: 5,
            Comment: 2,
          },
          {
            Location: "src/integration.test.foo.ts",
            Code: 50,
            Lines: 60,
            Complexity: 5,
            Comment: 2,
          },
          {
            Location: "src/real.ts",
            Code: 100,
            Lines: 120,
            Complexity: 10,
            Comment: 5,
          },
        ],
      },
    ]);

    mockExecSync.mockReturnValue(Buffer.from(sccOutput));

    const result = runScc();

    expect(result).toHaveLength(11);
    expect(result.map((f) => f.file)).toContain("src/foo.test.ts");
    expect(result.map((f) => f.file)).toContain("src/real.ts");
  });

  it("does not exclude lock files and package manifests by default (opt-in via .obsignore)", () => {
    const sccOutput = JSON.stringify([
      {
        Name: "JSON",
        Files: [
          {
            Location: "package.json",
            Code: 30,
            Lines: 40,
            Complexity: 0,
            Comment: 0,
          },
          {
            Location: "libs/ui/package.json",
            Code: 20,
            Lines: 25,
            Complexity: 0,
            Comment: 0,
          },
          {
            Location: "package-lock.json",
            Code: 5000,
            Lines: 6000,
            Complexity: 0,
            Comment: 0,
          },
          {
            Location: "pnpm-lock.yaml",
            Code: 3000,
            Lines: 4000,
            Complexity: 0,
            Comment: 0,
          },
          {
            Location: "yarn.lock",
            Code: 4000,
            Lines: 5000,
            Complexity: 0,
            Comment: 0,
          },
          {
            Location: "bun.lock",
            Code: 2000,
            Lines: 3000,
            Complexity: 0,
            Comment: 0,
          },
        ],
      },
      {
        Name: "TypeScript",
        Files: [
          {
            Location: "src/real.ts",
            Code: 100,
            Lines: 120,
            Complexity: 10,
            Comment: 5,
          },
        ],
      },
    ]);

    mockExecSync.mockReturnValue(Buffer.from(sccOutput));

    const result = runScc();

    expect(result).toHaveLength(7);
    expect(result.map((f) => f.file)).toContain("package.json");
    expect(result.map((f) => f.file)).toContain("src/real.ts");
  });

  it("applies custom exclude patterns", () => {
    const sccOutput = JSON.stringify([
      {
        Name: "TypeScript",
        Files: [
          {
            Location: "src/generated.api.ts",
            Code: 100,
            Lines: 120,
            Complexity: 10,
            Comment: 5,
          },
          {
            Location: "src/real.ts",
            Code: 100,
            Lines: 120,
            Complexity: 10,
            Comment: 5,
          },
        ],
      },
    ]);

    mockExecSync.mockReturnValue(Buffer.from(sccOutput));

    const result = runScc(["*.generated.*", "**generated**"]);

    expect(result).toHaveLength(1);
    expect(result[0].file).toBe("src/real.ts");
  });

  it("handles files with zero code lines", () => {
    const sccOutput = JSON.stringify([
      {
        Name: "TypeScript",
        Files: [
          {
            Location: "src/empty.ts",
            Code: 0,
            Lines: 5,
            Complexity: 0,
            Comment: 5,
          },
        ],
      },
    ]);

    mockExecSync.mockReturnValue(Buffer.from(sccOutput));

    const result = runScc();

    expect(result).toHaveLength(1);
    expect(result[0].complexityDensity).toBe(0);
  });

  it("normalizes backslash paths from scc on Windows", () => {
    const sccOutput = JSON.stringify([
      {
        Name: "TypeScript",
        Files: [
          {
            Location: "src\\utils\\foo.ts",
            Code: 100,
            Lines: 120,
            Complexity: 10,
            Comment: 5,
          },
          {
            Location: ".\\src\\bar.ts",
            Code: 100,
            Lines: 120,
            Complexity: 10,
            Comment: 5,
          },
        ],
      },
    ]);

    mockExecSync.mockReturnValue(Buffer.from(sccOutput));

    const result = runScc();

    expect(result[0].file).toBe("src/utils/foo.ts");
    expect(result[1].file).toBe("src/bar.ts");
  });

  it("strips ./ prefix from paths", () => {
    const sccOutput = JSON.stringify([
      {
        Name: "TypeScript",
        Files: [
          {
            Location: "./src/foo.ts",
            Code: 100,
            Lines: 120,
            Complexity: 10,
            Comment: 5,
          },
        ],
      },
    ]);

    mockExecSync.mockReturnValue(Buffer.from(sccOutput));

    const result = runScc();

    expect(result[0].file).toBe("src/foo.ts");
  });

  it("throws descriptive error when scc is not found", () => {
    const err = new Error("spawn scc ENOENT") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    mockExecSync.mockImplementation(() => {
      throw err;
    });

    expect(() => runScc()).toThrow("scc not found");
  });

  it("rethrows non-ENOENT errors", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("some other error");
    });

    expect(() => runScc()).toThrow("some other error");
  });
});

describe("getChurn", () => {
  it("counts commits per file from git log output", () => {
    const gitOutput =
      "src/foo.ts\nsrc/bar.ts\nsrc/foo.ts\nsrc/foo.ts\nsrc/bar.ts\n";

    mockExecSync.mockReturnValue(Buffer.from(gitOutput));

    const result = getChurn(3);

    expect(result.get("src/foo.ts")).toBe(3);
    expect(result.get("src/bar.ts")).toBe(2);
  });

  it("normalizes ./ prefix in git paths", () => {
    const gitOutput = "./src/foo.ts\n./src/foo.ts\n";

    mockExecSync.mockReturnValue(Buffer.from(gitOutput));

    const result = getChurn(3);

    expect(result.get("src/foo.ts")).toBe(2);
  });

  it("skips empty lines", () => {
    const gitOutput = "src/foo.ts\n\n\nsrc/bar.ts\n\n";

    mockExecSync.mockReturnValue(Buffer.from(gitOutput));

    const result = getChurn(3);

    expect(result.size).toBe(2);
  });

  it("throws error when not in a git repo", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("not a git repository");
    });

    expect(() => getChurn(3)).toThrow(
      "Not a git repository or git is not installed",
    );
  });
});

describe("getDefects", () => {
  it("counts fix commits per file", () => {
    const gitOutput = "src/foo.ts\nsrc/bar.ts\nsrc/foo.ts\n";
    mockExecSync.mockReturnValue(Buffer.from(gitOutput));

    const result = getDefects(3);

    expect(result.get("src/foo.ts")).toBe(2);
    expect(result.get("src/bar.ts")).toBe(1);
  });

  it("passes --grep flag to match fix commits", () => {
    mockExecSync.mockReturnValue(Buffer.from(""));

    getDefects(6);

    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('--grep="^fix"'),
      expect.any(Object),
    );
  });

  it("returns empty map when no fix commits exist", () => {
    mockExecSync.mockReturnValue(Buffer.from(""));

    const result = getDefects(3);

    expect(result.size).toBe(0);
  });

  it("throws error when not in a git repo", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("not a git repository");
    });

    expect(() => getDefects(3)).toThrow(
      "Not a git repository or git is not installed",
    );
  });
});

describe("getAuthorCommitCounts", () => {
  const sizeFor = (
    result: Map<string, Map<string, number>>,
    file: string,
  ): number | undefined => result.get(file)?.size;

  it("counts unique authors per file", () => {
    const gitOutput =
      "COMMIT_SEP\nAlice\nsrc/foo.ts\nsrc/bar.ts\nCOMMIT_SEP\nBob\nsrc/foo.ts\nCOMMIT_SEP\nAlice\nsrc/foo.ts\n";
    mockExecSync.mockReturnValue(Buffer.from(gitOutput));

    const result = getAuthorCommitCounts(3);

    expect(sizeFor(result, "src/foo.ts")).toBe(2);
    expect(sizeFor(result, "src/bar.ts")).toBe(1);
    expect(result.get("src/foo.ts")?.get("Alice")).toBe(2);
    expect(result.get("src/foo.ts")?.get("Bob")).toBe(1);
  });

  it("excludes bot authors from count", () => {
    const gitOutput =
      "COMMIT_SEP\nAlice\nsrc/foo.ts\nCOMMIT_SEP\nsemantic-release[bot]\nsrc/foo.ts\npackage.json\nCOMMIT_SEP\nBob\npackage.json\n";
    mockExecSync.mockReturnValue(Buffer.from(gitOutput));

    const result = getAuthorCommitCounts(3);

    expect(sizeFor(result, "src/foo.ts")).toBe(1);
    expect(sizeFor(result, "package.json")).toBe(1);
  });

  it("omits files only touched by bots", () => {
    const gitOutput =
      "COMMIT_SEP\ndependabot[bot]\npackage.json\nCOMMIT_SEP\nrenovate[bot]\npackage.json\n";
    mockExecSync.mockReturnValue(Buffer.from(gitOutput));

    const result = getAuthorCommitCounts(3);

    expect(result.has("package.json")).toBe(false);
  });

  it("returns 1 for single-author file", () => {
    const gitOutput =
      "COMMIT_SEP\nAlice\nsrc/solo.ts\nCOMMIT_SEP\nAlice\nsrc/solo.ts\n";
    mockExecSync.mockReturnValue(Buffer.from(gitOutput));

    const result = getAuthorCommitCounts(3);

    expect(sizeFor(result, "src/solo.ts")).toBe(1);
    expect(result.get("src/solo.ts")?.get("Alice")).toBe(2);
  });

  it("normalizes paths with ./ prefix", () => {
    const gitOutput = "COMMIT_SEP\nAlice\n./src/foo.ts\n";
    mockExecSync.mockReturnValue(Buffer.from(gitOutput));

    const result = getAuthorCommitCounts(3);

    expect(sizeFor(result, "src/foo.ts")).toBe(1);
  });

  it("skips blocks with empty author", () => {
    const gitOutput =
      "COMMIT_SEP\n\nsrc/foo.ts\nCOMMIT_SEP\nAlice\nsrc/bar.ts\n";
    mockExecSync.mockReturnValue(Buffer.from(gitOutput));

    const result = getAuthorCommitCounts(3);

    expect(result.has("src/foo.ts")).toBe(false);
    expect(sizeFor(result, "src/bar.ts")).toBe(1);
  });

  it("returns empty map when no commits exist", () => {
    mockExecSync.mockReturnValue(Buffer.from(""));

    const result = getAuthorCommitCounts(3);

    expect(result.size).toBe(0);
  });

  it("throws error when not in a git repo", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("not a git repository");
    });

    expect(() => getAuthorCommitCounts(3)).toThrow(
      "Not a git repository or git is not installed",
    );
  });

  it("folds Co-authored-by trailers into the author set", () => {
    // git log format we emit: "<primary>\t<coauthor1>\t<coauthor2>..."
    const gitOutput =
      "COMMIT_SEP\nAlice\tBob <bob@example.com>\tCarol <carol@example.com>\nsrc/foo.ts\nCOMMIT_SEP\nAlice\nsrc/foo.ts\n";
    mockExecSync.mockReturnValue(Buffer.from(gitOutput));

    const result = getAuthorCommitCounts(3);

    const perAuthor = result.get("src/foo.ts");
    expect(perAuthor?.size).toBe(3);
    expect(perAuthor?.get("Alice")).toBe(2);
    expect(perAuthor?.get("Bob")).toBe(1);
    expect(perAuthor?.get("Carol")).toBe(1);
  });

  it("ignores bot coauthors but keeps the human primary", () => {
    const gitOutput =
      "COMMIT_SEP\nAlice\tdependabot[bot] <noreply@github.com>\nsrc/foo.ts\n";
    mockExecSync.mockReturnValue(Buffer.from(gitOutput));

    const result = getAuthorCommitCounts(3);

    const perAuthor = result.get("src/foo.ts");
    expect(perAuthor?.size).toBe(1);
    expect(perAuthor?.get("Alice")).toBe(1);
  });

  it("deduplicates the primary when also listed as a coauthor", () => {
    const gitOutput =
      "COMMIT_SEP\nAlice\tAlice <alice@example.com>\nsrc/foo.ts\n";
    mockExecSync.mockReturnValue(Buffer.from(gitOutput));

    const result = getAuthorCommitCounts(3);

    const perAuthor = result.get("src/foo.ts");
    expect(perAuthor?.size).toBe(1);
    expect(perAuthor?.get("Alice")).toBe(1);
  });
});

describe("getNestingDepths", () => {
  it("detects nesting depth with 2-space indentation", () => {
    const content = "function foo() {\n  if (x) {\n    return;\n  }\n}\n";
    mockReadFileSync.mockReturnValue(content);

    const result = getNestingDepths(["src/foo.ts"]);

    expect(result.get("src/foo.ts")).toBe(2);
  });

  it("detects nesting depth with 4-space indentation", () => {
    const content =
      "function foo() {\n    if (x) {\n        return;\n    }\n}\n";
    mockReadFileSync.mockReturnValue(content);

    const result = getNestingDepths(["src/foo.ts"]);

    expect(result.get("src/foo.ts")).toBe(2);
  });

  it("detects nesting depth with tabs", () => {
    const content = "function foo() {\n\tif (x) {\n\t\treturn;\n\t}\n}\n";
    mockReadFileSync.mockReturnValue(content);

    const result = getNestingDepths(["src/foo.ts"]);

    expect(result.get("src/foo.ts")).toBe(2);
  });

  it("returns 0 for flat file with no indentation", () => {
    const content = "const a = 1;\nconst b = 2;\n";
    mockReadFileSync.mockReturnValue(content);

    const result = getNestingDepths(["src/flat.ts"]);

    expect(result.get("src/flat.ts")).toBe(0);
  });

  it("returns 0 for empty file", () => {
    mockReadFileSync.mockReturnValue("");

    const result = getNestingDepths(["src/empty.ts"]);

    expect(result.get("src/empty.ts")).toBe(0);
  });

  it("returns 0 for unreadable file", () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    const result = getNestingDepths(["src/missing.ts"]);

    expect(result.get("src/missing.ts")).toBe(0);
  });

  it("reads from the given cwd when one is provided", () => {
    mockReadFileSync.mockReturnValue("function foo() {\n  return;\n}\n");

    getNestingDepths(["src/foo.ts"], "/tmp/worktree");

    expect(mockReadFileSync).toHaveBeenCalledWith(
      "/tmp/worktree/src/foo.ts",
      "utf-8",
    );
  });

  it("skips blank lines when measuring depth", () => {
    const content = "function foo() {\n\n  return;\n}\n";
    mockReadFileSync.mockReturnValue(content);

    const result = getNestingDepths(["src/blanks.ts"]);

    expect(result.get("src/blanks.ts")).toBe(1);
  });

  it("breaks ties between equally-frequent indent deltas by picking the smaller", () => {
    // Designed so deltaCounts == {4: 2, 2: 2} with the larger key inserted
    // first — exercises the tiebreaker (count == bestCount && delta < indentUnit).
    // Result: indent unit resolves to 2.
    const content = ["x", "    a", "        b", "c", "  d", "    e"].join("\n");
    mockReadFileSync.mockReturnValue(content);

    const result = getNestingDepths(["src/tie.ts"]);

    // Max leading is 8 spaces; with unit=2 that's depth 4.
    expect(result.get("src/tie.ts")).toBe(4);
  });

  it("ignores outlier single-space-leading lines from multiline strings", () => {
    // A Python file with normal 4-space indented control flow (max depth 3)
    // plus a multiline string whose continuation lines have a single leading
    // space. Pre-fix, the min-width detector picked unit=1 and inflated depth
    // to 12+. Post-fix, the most-common positive delta is 4 → unit=4 → depth=3.
    const content = [
      "def handler():",
      "    if a:",
      "        if b:",
      '            return "ok"',
      "",
      '"""',
      " continuation line one",
      " continuation line two",
      '"""',
    ].join("\n");
    mockReadFileSync.mockReturnValue(content);

    const result = getNestingDepths(["src/handler.py"]);

    expect(result.get("src/handler.py")).toBe(3);
  });
});

describe("assignTiers", () => {
  it("assigns hot to items in top 50%, warm to next 30%, cool to rest", () => {
    const items = [
      { score: 100, percentOfTotal: 0, tier: "cool" as Tier },
      { score: 100, percentOfTotal: 0, tier: "cool" as Tier },
      { score: 100, percentOfTotal: 0, tier: "cool" as Tier },
      { score: 100, percentOfTotal: 0, tier: "cool" as Tier },
    ];

    assignTiers(items, 400);

    expect(items[0].tier).toBe("hot");
    expect(items[1].tier).toBe("hot");
    expect(items[2].tier).toBe("warm");
    expect(items[3].tier).toBe("cool");
  });

  it("calculates percentOfTotal correctly", () => {
    const items = [
      { score: 75, percentOfTotal: 0, tier: "cool" as Tier },
      { score: 25, percentOfTotal: 0, tier: "cool" as Tier },
    ];

    assignTiers(items, 100);

    expect(items[0].percentOfTotal).toBe(75);
    expect(items[1].percentOfTotal).toBe(25);
  });
});

describe("computeAllRankings", () => {
  const files: FileMetrics[] = [
    {
      file: "a.ts",
      code: 100,
      lines: 120,
      complexity: 50,
      comments: 10,
      complexityDensity: 0.5,
    },
    {
      file: "b.ts",
      code: 200,
      lines: 250,
      complexity: 20,
      comments: 5,
      complexityDensity: 0.1,
    },
    {
      file: "c.ts",
      code: 50,
      lines: 60,
      complexity: 5,
      comments: 2,
      complexityDensity: 0.1,
    },
    {
      file: "d.ts",
      code: 30,
      lines: 40,
      complexity: 3,
      comments: 1,
      complexityDensity: 0.1,
    },
  ];

  it("produces complexity ranking scored by complexity × churn", () => {
    const churn = new Map([
      ["a.ts", 10],
      ["b.ts", 5],
      ["c.ts", 20],
    ]);

    const result = computeAllRankings(
      files,
      churn,
      new Map(),
      new Map(),
      new Map(),
      0,
    );

    expect(result.rankings.complexity).toBeDefined();
    expect(result.rankings.complexity.entries[0].file).toBe("a.ts");
    expect(result.rankings.complexity.entries[0].score).toBe(500);
    expect(result.rankings.complexity.entries[1].score).toBe(100);
    expect(result.rankings.complexity.label).toBe("Complexity \u00D7 Churn");
  });

  it("includes complexity density in complexity ranking entries", () => {
    const churn = new Map([["a.ts", 10]]);

    const result = computeAllRankings(
      files,
      churn,
      new Map(),
      new Map(),
      new Map(),
      0,
    );

    expect(result.rankings.complexity.entries[0].metricDensity).toBe(0.5);
  });

  it("produces nesting ranking from nestingDepths map", () => {
    const churn = new Map([
      ["a.ts", 10],
      ["b.ts", 5],
      ["c.ts", 4],
      ["d.ts", 2],
    ]);
    const nesting = new Map([
      ["a.ts", 5],
      ["b.ts", 3],
      ["c.ts", 4],
    ]);

    const result = computeAllRankings(
      files,
      churn,
      new Map(),
      nesting,
      new Map(),
      0,
    );

    expect(result.rankings.nesting).toBeDefined();
    expect(result.rankings.nesting.entries[0].file).toBe("a.ts");
    expect(result.rankings.nesting.entries[0].score).toBe(50); // 5 × 10
    expect(result.rankings.nesting.entries[0].metricValue).toBe(5);
  });

  it("excludes zero-complexity files from the nesting ranking", () => {
    // YAML/structural files have deep indentation but scc reports complexity
    // 0 — they shouldn't score on Nesting × Churn alongside real code files.
    const mixedFiles: FileMetrics[] = [
      {
        file: "playbook.yml",
        code: 200,
        lines: 220,
        complexity: 0,
        comments: 5,
        complexityDensity: 0,
      },
      {
        file: "deploy.yml",
        code: 150,
        lines: 170,
        complexity: 0,
        comments: 2,
        complexityDensity: 0,
      },
      ...files,
    ];
    const churn = new Map([
      ["playbook.yml", 20],
      ["deploy.yml", 15],
      ["a.ts", 10],
      ["b.ts", 5],
      ["c.ts", 4],
    ]);
    const nesting = new Map([
      ["playbook.yml", 8],
      ["deploy.yml", 7],
      ["a.ts", 4],
      ["b.ts", 3],
      ["c.ts", 5],
    ]);

    const result = computeAllRankings(
      mixedFiles,
      churn,
      new Map(),
      nesting,
      new Map(),
      0,
    );

    expect(result.rankings.nesting).toBeDefined();
    const entryFiles = result.rankings.nesting.entries.map((e) => e.file);
    expect(entryFiles).not.toContain("playbook.yml");
    expect(entryFiles).not.toContain("deploy.yml");
    expect(entryFiles).toContain("a.ts");
  });

  it("produces defects ranking with defect density", () => {
    const churn = new Map([
      ["a.ts", 10],
      ["b.ts", 5],
      ["c.ts", 3],
    ]);
    const defectMap = new Map([
      ["a.ts", 3],
      ["b.ts", 1],
      ["c.ts", 1],
    ]);

    const result = computeAllRankings(
      files,
      churn,
      defectMap,
      new Map(),
      new Map(),
      0,
    );

    expect(result.rankings.defects).toBeDefined();
    expect(result.rankings.defects.entries[0].score).toBe(30); // 3 × 10
    expect(result.rankings.defects.entries[0].metricDensity).toBe(0.03); // 3/100
  });

  it("sets defect density to 0 when code is 0", () => {
    const zeroCodeFiles: FileMetrics[] = [
      {
        file: "empty.ts",
        code: 0,
        lines: 5,
        complexity: 1,
        comments: 0,
        complexityDensity: 0,
      },
      {
        file: "x.ts",
        code: 10,
        lines: 12,
        complexity: 1,
        comments: 0,
        complexityDensity: 0.1,
      },
      {
        file: "y.ts",
        code: 20,
        lines: 25,
        complexity: 2,
        comments: 0,
        complexityDensity: 0.1,
      },
    ];
    const churn = new Map([
      ["empty.ts", 2],
      ["x.ts", 1],
      ["y.ts", 1],
    ]);
    const defectMap = new Map([
      ["empty.ts", 2],
      ["x.ts", 2],
      ["y.ts", 1],
    ]);

    const result = computeAllRankings(
      zeroCodeFiles,
      churn,
      defectMap,
      new Map(),
      new Map(),
      0,
    );

    expect(result.rankings.defects.entries[0].metricDensity).toBe(0);
  });

  it("attaches MinAuth (minorAuthors) to authors-ranking entries when commit counts are provided", () => {
    const churn = new Map([
      ["a.ts", 10],
      ["b.ts", 5],
    ]);
    const authorMap = new Map([
      ["a.ts", 4],
      ["b.ts", 2],
    ]);
    // a.ts: 22 commits total. 5% cutoff = 1.1. Two contributors with 1 commit
    // each (< 1.1) → both are *minor*. Two contributors with 10 commits each →
    // major. Expected minorAuthors = 2.
    const authorCommitCounts = new Map<string, Map<string, number>>([
      [
        "a.ts",
        new Map([
          ["Alice", 10],
          ["Bob", 10],
          ["Carol", 1],
          ["Dave", 1],
        ]),
      ],
      [
        "b.ts",
        new Map([
          ["Alice", 4],
          ["Bob", 1],
        ]),
      ],
    ]);

    const result = computeAllRankings(
      files,
      churn,
      new Map(),
      new Map(),
      authorMap,
      0,
      authorCommitCounts,
    );

    const aEntry = result.rankings.authors.entries.find(
      (e) => e.file === "a.ts",
    );
    const bEntry = result.rankings.authors.entries.find(
      (e) => e.file === "b.ts",
    );
    expect(aEntry?.minorAuthors).toBe(2);
    // b.ts: 5 commits total. 5% cutoff = 0.25. Bob has 1 commit (>= 0.25) so
    // not minor; both contributors are above the cutoff → minorAuthors = 0.
    expect(bEntry?.minorAuthors).toBe(0);
  });

  it("returns minorAuthors=null when a file has fewer than 2 commits", () => {
    const churn = new Map([
      ["a.ts", 10],
      ["b.ts", 5],
    ]);
    const authorMap = new Map([
      ["a.ts", 2],
      ["b.ts", 1],
    ]);
    const authorCommitCounts = new Map<string, Map<string, number>>([
      [
        "a.ts",
        new Map([
          ["Alice", 5],
          ["Bob", 5],
        ]),
      ],
      // b.ts has only 1 total commit — below the Greiler 2015 floor of 2.
      ["b.ts", new Map([["Alice", 1]])],
    ]);

    const result = computeAllRankings(
      files,
      churn,
      new Map(),
      new Map(),
      authorMap,
      0,
      authorCommitCounts,
    );

    const bEntry = result.rankings.authors.entries.find(
      (e) => e.file === "b.ts",
    );
    expect(bEntry?.minorAuthors).toBeNull();
  });

  it("leaves minorAuthors undefined when authorCommitCounts is not supplied", () => {
    const churn = new Map([
      ["a.ts", 10],
      ["b.ts", 5],
    ]);
    const authorMap = new Map([
      ["a.ts", 2],
      ["b.ts", 4],
    ]);

    const result = computeAllRankings(
      files,
      churn,
      new Map(),
      new Map(),
      authorMap,
      0,
    );

    for (const entry of result.rankings.authors.entries) {
      expect(entry.minorAuthors).toBeUndefined();
    }
  });

  it("returns minorAuthors=null for a file missing from authorCommitCounts", () => {
    const churn = new Map([
      ["a.ts", 10],
      ["b.ts", 5],
    ]);
    const authorMap = new Map([
      ["a.ts", 2],
      ["b.ts", 4],
    ]);
    // authorCommitCounts is non-empty (so the side-column is enabled) but
    // b.ts is absent — that's the perAuthor === undefined branch.
    const authorCommitCounts = new Map<string, Map<string, number>>([
      [
        "a.ts",
        new Map([
          ["Alice", 5],
          ["Bob", 5],
        ]),
      ],
    ]);

    const result = computeAllRankings(
      files,
      churn,
      new Map(),
      new Map(),
      authorMap,
      0,
      authorCommitCounts,
    );

    const bEntry = result.rankings.authors.entries.find(
      (e) => e.file === "b.ts",
    );
    expect(bEntry?.minorAuthors).toBeNull();
  });

  it("produces authors ranking", () => {
    const churn = new Map([
      ["a.ts", 10],
      ["b.ts", 5],
    ]);
    const authorMap = new Map([
      ["a.ts", 2],
      ["b.ts", 4],
    ]);

    const result = computeAllRankings(
      files,
      churn,
      new Map(),
      new Map(),
      authorMap,
      0,
    );

    expect(result.rankings.authors).toBeDefined();
    expect(result.rankings.authors.entries[0].file).toBe("a.ts");
    expect(result.rankings.authors.entries[0].score).toBe(20); // 2 × 10
    expect(result.rankings.authors.entries[1].score).toBe(20); // 4 × 5
  });

  it("omits rankings with no scored entries", () => {
    const churn = new Map([["a.ts", 10]]);

    const result = computeAllRankings(
      files,
      churn,
      new Map(),
      new Map(),
      new Map(),
      0,
    );

    // Only complexity should exist since nesting/defects/authors maps are empty
    expect(result.rankings.complexity).toBeDefined();
    expect(result.rankings.nesting).toBeUndefined();
    expect(result.rankings.defects).toBeUndefined();
    expect(result.rankings.authors).toBeUndefined();
  });

  it("returns empty object when no files have churn", () => {
    const churn = new Map<string, number>();

    const result = computeAllRankings(
      files,
      churn,
      new Map(),
      new Map(),
      new Map(),
      0,
    );

    expect(Object.keys(result.rankings)).toHaveLength(0);
  });

  it("limits entries by top parameter", () => {
    const churn = new Map([
      ["a.ts", 10],
      ["b.ts", 5],
      ["c.ts", 20],
      ["d.ts", 3],
    ]);

    const result = computeAllRankings(
      files,
      churn,
      new Map(),
      new Map(),
      new Map(),
      2,
    );

    expect(result.rankings.complexity.showing).toBe(2);
    expect(result.rankings.complexity.entries).toHaveLength(2);
    expect(result.rankings.complexity.totalEntries).toBe(4);
  });

  it("assigns tiers by cumulative distribution", () => {
    const evenFiles: FileMetrics[] = [
      {
        file: "x.ts",
        code: 100,
        lines: 120,
        complexity: 10,
        comments: 5,
        complexityDensity: 0.1,
      },
      {
        file: "y.ts",
        code: 100,
        lines: 120,
        complexity: 10,
        comments: 5,
        complexityDensity: 0.1,
      },
      {
        file: "z.ts",
        code: 100,
        lines: 120,
        complexity: 10,
        comments: 5,
        complexityDensity: 0.1,
      },
      {
        file: "w.ts",
        code: 100,
        lines: 120,
        complexity: 10,
        comments: 5,
        complexityDensity: 0.1,
      },
    ];

    const churn = new Map([
      ["x.ts", 10],
      ["y.ts", 10],
      ["z.ts", 10],
      ["w.ts", 10],
    ]);

    const result = computeAllRankings(
      evenFiles,
      churn,
      new Map(),
      new Map(),
      new Map(),
      0,
    );

    const entries = result.rankings.complexity.entries;
    expect(entries).toHaveLength(4);
    expect(entries[0].tier).toBe("hot");
    expect(entries[1].tier).toBe("hot");
    expect(entries[2].tier).toBe("warm");
    expect(entries[3].tier).toBe("cool");
  });

  it("calculates percentOfTotal correctly", () => {
    const churn = new Map([
      ["a.ts", 10],
      ["b.ts", 10],
    ]);

    const result = computeAllRankings(
      files,
      churn,
      new Map(),
      new Map(),
      new Map(),
      0,
    );

    const totalPercent = result.rankings.complexity.entries.reduce(
      (s, e) => s + e.percentOfTotal,
      0,
    );
    expect(totalPercent).toBeCloseTo(100, 0);
  });

  it("populates tierCounts across all entries, not just shown", () => {
    const churn = new Map([
      ["a.ts", 10],
      ["b.ts", 5],
      ["c.ts", 20],
      ["d.ts", 3],
    ]);

    const result = computeAllRankings(
      files,
      churn,
      new Map(),
      new Map(),
      new Map(),
      2,
    );

    const counts = result.rankings.complexity.tierCounts;
    const total = counts.hot + counts.warm + counts.cool;
    expect(total).toBe(result.rankings.complexity.totalEntries);
  });

  it("skips defects ranking when fewer than 5 fix commits exist", () => {
    const churn = new Map([
      ["a.ts", 10],
      ["b.ts", 5],
      ["c.ts", 8],
    ]);
    // Only 4 total fix commits across 3 files — below threshold of 5
    const defects = new Map([
      ["a.ts", 2],
      ["b.ts", 1],
      ["c.ts", 1],
    ]);

    const result = computeAllRankings(
      files,
      churn,
      defects,
      new Map(),
      new Map(),
      0,
    );

    expect(result.rankings.defects).toBeUndefined();
    expect(result.rankings.complexity).toBeDefined();
    expect(result.skipped.defects).toBeDefined();
    expect(result.skipped.defects.reason).toContain("fix:");
    expect(result.skipped.defects.suggestion).toContain("conventionalcommits");
  });

  it("skips defects ranking when fewer than 3 files have fix commits", () => {
    const churn = new Map([
      ["a.ts", 10],
      ["b.ts", 5],
      ["c.ts", 8],
    ]);
    // 6 total fix commits but only 2 files — below threshold of 3 files
    const defects = new Map([
      ["a.ts", 4],
      ["b.ts", 2],
    ]);

    const result = computeAllRankings(
      files,
      churn,
      defects,
      new Map(),
      new Map(),
      0,
    );

    expect(result.rankings.defects).toBeUndefined();
  });

  it("includes defects ranking when thresholds are met", () => {
    const churn = new Map([
      ["a.ts", 10],
      ["b.ts", 5],
      ["c.ts", 8],
    ]);
    // 6 total fix commits across 3 files — meets both thresholds
    const defects = new Map([
      ["a.ts", 2],
      ["b.ts", 2],
      ["c.ts", 2],
    ]);

    const result = computeAllRankings(
      files,
      churn,
      defects,
      new Map(),
      new Map(),
      0,
    );

    expect(result.rankings.defects).toBeDefined();
  });

  it("skips authors ranking when max author count is 1", () => {
    const churn = new Map([
      ["a.ts", 10],
      ["b.ts", 5],
    ]);
    // Every file has exactly 1 author — no variance
    const authors = new Map([
      ["a.ts", 1],
      ["b.ts", 1],
    ]);

    const result = computeAllRankings(
      files,
      churn,
      new Map(),
      new Map(),
      authors,
      0,
    );

    expect(result.rankings.authors).toBeUndefined();
    expect(result.skipped.authors).toBeDefined();
    expect(result.skipped.authors.reason).toContain("author count");
  });
});

describe("getCoChanges", () => {
  it("counts co-occurrences across commits", () => {
    const gitOutput =
      "COMMIT_SEP\nsrc/foo.ts\nlib/bar.ts\nCOMMIT_SEP\nsrc/foo.ts\nlib/bar.ts\n";
    mockExecSync.mockReturnValue(Buffer.from(gitOutput));

    const result = getCoChanges(3);

    expect(result.get("lib/bar.ts\0src/foo.ts")).toBe(2);
  });

  it("skips commits with more than 20 files", () => {
    const files = Array.from({ length: 21 }, (_, i) => `dir${i}/f${i}.ts`).join(
      "\n",
    );
    const gitOutput = `COMMIT_SEP\n${files}\n`;
    mockExecSync.mockReturnValue(Buffer.from(gitOutput));

    const result = getCoChanges(3);

    expect(result.size).toBe(0);
  });

  it("excludes same-directory pairs", () => {
    const gitOutput = "COMMIT_SEP\nsrc/a.ts\nsrc/b.ts\nlib/c.ts\n";
    mockExecSync.mockReturnValue(Buffer.from(gitOutput));

    const result = getCoChanges(3);

    // src/a.ts + src/b.ts are same dir → excluded
    // src/a.ts + lib/c.ts and src/b.ts + lib/c.ts are cross-dir → included
    expect(result.has("src/a.ts\0src/b.ts")).toBe(false);
    expect(result.get("lib/c.ts\0src/a.ts")).toBe(1);
    expect(result.get("lib/c.ts\0src/b.ts")).toBe(1);
  });

  it("does not exclude test files by default (opt-in via .obsignore)", () => {
    const gitOutput = "COMMIT_SEP\nsrc/foo.test.ts\nlib/bar.ts\nsrc/real.ts\n";
    mockExecSync.mockReturnValue(Buffer.from(gitOutput));

    const result = getCoChanges(3);

    // foo.test.ts should now be included in co-change pairs
    expect(result.get("lib/bar.ts\0src/foo.test.ts")).toBe(1);
    expect(result.get("lib/bar.ts\0src/real.ts")).toBe(1);
  });

  it("does not exclude lock files and package manifests by default (opt-in via .obsignore)", () => {
    const gitOutput =
      "COMMIT_SEP\npackage.json\npnpm-lock.yaml\nsrc/real.ts\nlib/bar.ts\nCOMMIT_SEP\npackage-lock.json\nyarn.lock\nbun.lock\nlibs/ui/package.json\nsrc/real.ts\nlib/bar.ts\n";
    mockExecSync.mockReturnValue(Buffer.from(gitOutput));

    const result = getCoChanges(3);

    // Lock files and package manifests should now be in co-change pairs
    expect(result.get("lib/bar.ts\0package.json")).toBe(1);
    expect(result.get("lib/bar.ts\0pnpm-lock.yaml")).toBe(1);
    // src/real.ts ↔ lib/bar.ts should still be present
    expect(result.get("lib/bar.ts\0src/real.ts")).toBe(2);
  });

  it("applies custom exclude patterns", () => {
    const gitOutput = "COMMIT_SEP\nsrc/gen.ts\nlib/bar.ts\nsrc/real.ts\n";
    mockExecSync.mockReturnValue(Buffer.from(gitOutput));

    const result = getCoChanges(3, ["**/gen.ts"]);

    for (const key of result.keys()) {
      expect(key).not.toContain("gen.ts");
    }
  });

  it("normalizes ./ paths", () => {
    const gitOutput = "COMMIT_SEP\n./src/foo.ts\n./lib/bar.ts\n";
    mockExecSync.mockReturnValue(Buffer.from(gitOutput));

    const result = getCoChanges(3);

    expect(result.get("lib/bar.ts\0src/foo.ts")).toBe(1);
  });

  it("deduplicates files within a commit", () => {
    const gitOutput = "COMMIT_SEP\nsrc/foo.ts\nlib/bar.ts\nsrc/foo.ts\n";
    mockExecSync.mockReturnValue(Buffer.from(gitOutput));

    const result = getCoChanges(3);

    expect(result.get("lib/bar.ts\0src/foo.ts")).toBe(1);
  });

  it("returns empty map for no commits", () => {
    mockExecSync.mockReturnValue(Buffer.from(""));

    const result = getCoChanges(3);

    expect(result.size).toBe(0);
  });

  it("treats root-level files as same directory", () => {
    const gitOutput = "COMMIT_SEP\na.ts\nb.ts\nsrc/c.ts\n";
    mockExecSync.mockReturnValue(Buffer.from(gitOutput));

    const result = getCoChanges(3);

    // a.ts and b.ts both have dir="" → same dir → excluded
    expect(result.has("a.ts\0b.ts")).toBe(false);
    // a.ts + src/c.ts and b.ts + src/c.ts are cross-dir
    expect(result.get("a.ts\0src/c.ts")).toBe(1);
    expect(result.get("b.ts\0src/c.ts")).toBe(1);
  });

  it("throws on non-git repo", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("not a git repository");
    });

    expect(() => getCoChanges(3)).toThrow(
      "Not a git repository or git is not installed",
    );
  });
});

describe("computeCoupling", () => {
  it("scores and sorts by cochanges", () => {
    const cochanges = new Map([
      ["a.ts\0lib/b.ts", 5],
      ["c.ts\0lib/d.ts", 10],
    ]);
    const churn = new Map([
      ["a.ts", 10],
      ["lib/b.ts", 8],
      ["c.ts", 15],
      ["lib/d.ts", 12],
    ]);
    const complexity = new Map([
      ["a.ts", 20],
      ["lib/b.ts", 30],
      ["c.ts", 10],
      ["lib/d.ts", 40],
    ]);

    const result = computeCoupling(cochanges, churn, complexity, 1);

    expect(result[0].file1).toBe("c.ts");
    expect(result[0].file2).toBe("lib/d.ts");
    expect(result[0].couplingScore).toBe(10);
    expect(result[1].couplingScore).toBe(5);
  });

  it("calculates degree as cochanges/min(churn)×100", () => {
    const cochanges = new Map([["a.ts\0lib/b.ts", 4]]);
    const churn = new Map([
      ["a.ts", 10],
      ["lib/b.ts", 8],
    ]);

    const result = computeCoupling(cochanges, churn, new Map(), 1);

    // degree = 4/8 × 100 = 50.0
    expect(result[0].degree).toBe(50);
  });

  it("sets degree to 0 when min churn is 0", () => {
    const cochanges = new Map([["a.ts\0lib/b.ts", 3]]);
    const churn = new Map<string, number>();

    const result = computeCoupling(cochanges, churn, new Map(), 1);

    expect(result[0].degree).toBe(0);
  });

  it("filters below minCochanges", () => {
    const cochanges = new Map([
      ["a.ts\0lib/b.ts", 1],
      ["c.ts\0lib/d.ts", 3],
    ]);

    const result = computeCoupling(cochanges, new Map(), new Map(), 2);

    expect(result).toHaveLength(1);
    expect(result[0].file1).toBe("c.ts");
  });

  it("assigns tiers by cumulative distribution", () => {
    const cochanges = new Map([
      ["a.ts\0lib/b.ts", 10],
      ["c.ts\0lib/d.ts", 10],
      ["e.ts\0lib/f.ts", 10],
      ["g.ts\0lib/h.ts", 10],
    ]);

    const result = computeCoupling(cochanges, new Map(), new Map(), 1);

    // All equal: 10 each, total 40
    // 10/40 = 25% → hot, 50% → hot, 75% → warm, 100% → cool
    expect(result[0].tier).toBe("hot");
    expect(result[1].tier).toBe("hot");
    expect(result[2].tier).toBe("warm");
    expect(result[3].tier).toBe("cool");
  });

  it("returns empty array when all below threshold", () => {
    const cochanges = new Map([["a.ts\0lib/b.ts", 1]]);

    const result = computeCoupling(cochanges, new Map(), new Map(), 5);

    expect(result).toHaveLength(0);
  });

  it("defaults complexity to 0 for unknown files", () => {
    const cochanges = new Map([["a.ts\0lib/b.ts", 3]]);

    const result = computeCoupling(cochanges, new Map(), new Map(), 1);

    expect(result[0].totalComplexity).toBe(0);
  });

  it("percentOfTotal sums to ~100", () => {
    const cochanges = new Map([
      ["a.ts\0lib/b.ts", 5],
      ["c.ts\0lib/d.ts", 3],
      ["e.ts\0lib/f.ts", 2],
    ]);

    const result = computeCoupling(cochanges, new Map(), new Map(), 1);
    const totalPercent = result.reduce((s, e) => s + e.percentOfTotal, 0);

    expect(totalPercent).toBeCloseTo(100, 0);
  });

  it("flags entries whose files are absent from the tracked set", () => {
    const cochanges = new Map([
      ["a.ts\0lib/b.ts", 3],
      ["c.ts\0lib/d.ts", 2],
    ]);
    const tracked = new Set(["a.ts", "lib/b.ts"]);

    const result = computeCoupling(cochanges, new Map(), new Map(), 1, tracked);

    const ab = result.find((e) => e.file1 === "a.ts");
    const cd = result.find((e) => e.file1 === "c.ts");
    expect(ab?.file1Deleted).toBeUndefined();
    expect(ab?.file2Deleted).toBeUndefined();
    expect(cd?.file1Deleted).toBe(true);
    expect(cd?.file2Deleted).toBe(true);
  });

  it("does not set deletion flags when trackedFiles is omitted", () => {
    const cochanges = new Map([["a.ts\0lib/b.ts", 3]]);

    const result = computeCoupling(cochanges, new Map(), new Map(), 1);

    expect(result[0].file1Deleted).toBeUndefined();
    expect(result[0].file2Deleted).toBeUndefined();
  });

  it("flags lockstep pairs (both files only ever co-changed)", () => {
    const cochanges = new Map([["a.ts\0lib/b.ts", 4]]);
    const churn = new Map([
      ["a.ts", 4],
      ["lib/b.ts", 4],
    ]);

    const result = computeCoupling(cochanges, churn, new Map(), 1);

    expect(result[0].lockstep).toBe(true);
  });

  it("flags near-lockstep pairs at the 0.9 ratio threshold (generator drift)", () => {
    // README.md ↔ src/README.md: 9 shared / 10 max churn = 0.9 → lockstep
    const cochanges = new Map([["README.md\0src/README.md", 9]]);
    const churn = new Map([
      ["README.md", 10],
      ["src/README.md", 10],
    ]);

    const result = computeCoupling(cochanges, churn, new Map(), 1);

    expect(result[0].lockstep).toBe(true);
  });

  it("flags asymmetric near-lockstep when shared / max(churn) ≥ 0.9", () => {
    // 9 shared / max(9, 10) = 0.9 → lockstep
    const cochanges = new Map([["a.ts\0lib/b.ts", 9]]);
    const churn = new Map([
      ["a.ts", 9],
      ["lib/b.ts", 10],
    ]);

    const result = computeCoupling(cochanges, churn, new Map(), 1);

    expect(result[0].lockstep).toBe(true);
  });

  it("does not flag lockstep when ratio is below 0.9", () => {
    // 8 shared / max(10, 10) = 0.8 → not lockstep
    const cochanges = new Map([["a.ts\0lib/b.ts", 8]]);
    const churn = new Map([
      ["a.ts", 10],
      ["lib/b.ts", 10],
    ]);

    const result = computeCoupling(cochanges, churn, new Map(), 1);

    expect(result[0].lockstep).toBeUndefined();
  });

  it("does not flag lockstep when one file changed substantially outside the pair", () => {
    // 4 shared / max(4, 5) = 0.8 → not lockstep
    const cochanges = new Map([["a.ts\0lib/b.ts", 4]]);
    const churn = new Map([
      ["a.ts", 4],
      ["lib/b.ts", 5],
    ]);

    const result = computeCoupling(cochanges, churn, new Map(), 1);

    expect(result[0].lockstep).toBeUndefined();
  });

  it("does not flag lockstep when the other side changed substantially outside the pair", () => {
    // 4 shared / max(6, 4) = 0.67 → not lockstep
    const cochanges = new Map([["a.ts\0lib/b.ts", 4]]);
    const churn = new Map([
      ["a.ts", 6],
      ["lib/b.ts", 4],
    ]);

    const result = computeCoupling(cochanges, churn, new Map(), 1);

    expect(result[0].lockstep).toBeUndefined();
  });
});

describe("computeComposite", () => {
  const STUB_RANKING_CONFIDENCE: ConfidenceInfo = {
    level: "plausible",
    reason: "stub",
    inputs: {
      metric: "stub",
      value: 10,
      thresholds: { weak: 3, plausible: 10, acceptable: 30 },
    },
    source: "stub",
  };

  function makeRanking(files: string[]): RankingOutput {
    return {
      label: "Stub",
      scoreFormula: "stub",
      totalScore: files.length,
      tierCounts: { hot: 0, warm: 0, cool: files.length },
      totalEntries: files.length,
      showing: files.length,
      confidence: STUB_RANKING_CONFIDENCE,
      entries: files.map((f, i) => ({
        file: f,
        score: files.length - i,
        percentOfTotal: 0,
        tier: "cool" as const,
        churn: 0,
        metricValue: 0,
      })),
    };
  }

  it("ranks files by RRF score across multiple rankings", () => {
    const rankings: Record<string, RankingOutput> = {
      complexity: makeRanking(["a.ts", "b.ts", "c.ts"]),
      nesting: makeRanking(["a.ts", "c.ts", "b.ts"]),
      defects: makeRanking(["a.ts", "b.ts"]),
    };
    const churn = new Map([
      ["a.ts", 10],
      ["b.ts", 8],
      ["c.ts", 5],
    ]);

    const result = computeComposite(rankings, churn, 3);

    // a.ts: rank 1 in all three → highest RRF
    // b.ts: rank 2 in complexity, rank 3 in nesting, rank 2 in defects
    // c.ts: rank 3 in complexity, rank 2 in nesting, absent from defects
    expect(result.entries[0].file).toBe("a.ts");
    expect(result.entries[0].dimensionCount).toBe(3);
    expect(result.entries[0].churn).toBe(10);
    expect(result.entries.length).toBe(3);
  });

  it("returns empty output when no rankings provided", () => {
    const result = computeComposite({}, new Map(), 20);

    expect(result.entries).toHaveLength(0);
    expect(result.totalScore).toBe(0);
    expect(result.totalEntries).toBe(0);
  });

  it("assigns tiers by cumulative distribution", () => {
    const rankings: Record<string, RankingOutput> = {
      complexity: makeRanking(["a.ts", "b.ts", "c.ts", "d.ts"]),
    };

    const result = computeComposite(rankings, new Map(), 0);

    expect(result.entries[0].tier).toBe("hot");
    expect(result.entries[3].tier).toBe("cool");
    expect(
      result.tierCounts.hot + result.tierCounts.warm + result.tierCounts.cool,
    ).toBe(4);
  });

  it("limits output by top parameter", () => {
    const rankings: Record<string, RankingOutput> = {
      complexity: makeRanking(["a.ts", "b.ts", "c.ts"]),
    };

    const result = computeComposite(rankings, new Map(), 2);

    expect(result.entries).toHaveLength(2);
    expect(result.showing).toBe(2);
    expect(result.totalEntries).toBe(3);
  });

  it("counts dimensions a file appears in", () => {
    const rankings: Record<string, RankingOutput> = {
      complexity: makeRanking(["a.ts", "b.ts"]),
      nesting: makeRanking(["a.ts"]),
      defects: makeRanking(["a.ts"]),
      authors: makeRanking(["b.ts"]),
    };

    const result = computeComposite(rankings, new Map(), 0);

    const aEntry = result.entries.find((e) => e.file === "a.ts");
    const bEntry = result.entries.find((e) => e.file === "b.ts");
    expect(aEntry?.dimensionCount).toBe(3);
    expect(bEntry?.dimensionCount).toBe(2);
  });

  it("emits inconclusive composite confidence with fewer than 2 rankings", () => {
    const rankings: Record<string, RankingOutput> = {
      complexity: makeRanking(["a.ts"]),
    };

    const result = computeComposite(rankings, new Map(), 0);

    expect(result.confidence.level).toBe("inconclusive");
    expect(result.confidence.reason).toContain("RRF requires");
  });

  it("inherits the weakest input ranking confidence", () => {
    const weak: RankingOutput = {
      ...makeRanking(["a.ts"]),
      confidence: {
        ...STUB_RANKING_CONFIDENCE,
        level: "weak",
      },
    };
    const rankings: Record<string, RankingOutput> = {
      complexity: makeRanking(["a.ts", "b.ts"]),
      defects: weak,
    };

    const result = computeComposite(rankings, new Map(), 0);

    expect(result.confidence.level).toBe("weak");
    expect(result.confidence.reason).toContain("weakest: WEAK");
  });
});

describe("couplingConfidence", () => {
  it("returns inconclusive below the weak floor", () => {
    const c = couplingConfidence(2);
    expect(c.level).toBe("inconclusive");
    expect(c.reason).toContain("need ≥ 5");
  });

  it("returns weak between weak and plausible thresholds", () => {
    expect(couplingConfidence(10).level).toBe("weak");
  });

  it("returns plausible between plausible and acceptable thresholds", () => {
    expect(couplingConfidence(50).level).toBe("plausible");
  });

  it("returns acceptable at or above the acceptable threshold", () => {
    expect(couplingConfidence(150).level).toBe("acceptable");
  });
});

describe("getCommitsInWindow", () => {
  it("parses the rev-list count", () => {
    mockExecSync.mockReturnValue(Buffer.from("42\n"));
    expect(getCommitsInWindow(3)).toBe(42);
  });

  it("returns 0 when output is not a number", () => {
    mockExecSync.mockReturnValue(Buffer.from("not-a-number\n"));
    expect(getCommitsInWindow(3)).toBe(0);
  });

  it("throws when git is unavailable", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("git not found");
    });
    expect(() => getCommitsInWindow(3)).toThrow(
      /Not a git repository or git is not installed/,
    );
  });
});

describe("getHistoryCoverage", () => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const daysAgo = (n: number): number => nowSeconds - n * 86400;

  it("flags underCovered when history is shorter than the window", () => {
    mockExecSync.mockReturnValue(
      Buffer.from(`${daysAgo(20)}\n${daysAgo(1)}\n`),
    );
    const coverage = getHistoryCoverage(3); // 90-day window
    expect(coverage.underCovered).toBe(true);
    expect(coverage.windowDays).toBe(90);
    expect(coverage.spanDays).toBeGreaterThanOrEqual(19);
    expect(coverage.spanDays).toBeLessThanOrEqual(20);
  });

  it("clears underCovered when history exceeds the window", () => {
    mockExecSync.mockReturnValue(
      Buffer.from(`${daysAgo(180)}\n${daysAgo(1)}\n`),
    );
    const coverage = getHistoryCoverage(3); // 90-day window
    expect(coverage.underCovered).toBe(false);
    expect(coverage.spanDays).toBeGreaterThanOrEqual(179);
  });

  it("returns underCovered=true with spanDays=0 on a malformed first line", () => {
    mockExecSync.mockReturnValue(Buffer.from("not-a-timestamp\n"));
    const coverage = getHistoryCoverage(3);
    expect(coverage.spanDays).toBe(0);
    expect(coverage.underCovered).toBe(true);
  });

  it("returns underCovered=true with spanDays=0 on an empty log", () => {
    mockExecSync.mockReturnValue(Buffer.from(""));
    const coverage = getHistoryCoverage(3);
    expect(coverage.spanDays).toBe(0);
    expect(coverage.underCovered).toBe(true);
  });

  it("throws when git is unavailable", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("git not found");
    });
    expect(() => getHistoryCoverage(3)).toThrow(
      /Not a git repository or git is not installed/,
    );
  });
});

describe("spearmanRho", () => {
  it("returns rho = 1 for identical orderings", () => {
    const a = new Map([
      ["a", 100],
      ["b", 50],
      ["c", 25],
      ["d", 10],
      ["e", 5],
    ]);
    const b = new Map([
      ["a", 9],
      ["b", 7],
      ["c", 5],
      ["d", 3],
      ["e", 1],
    ]);
    const { rho, n } = spearmanRho(a, b);
    expect(n).toBe(5);
    expect(rho).toBe(1);
  });

  it("returns rho = -1 for opposite orderings", () => {
    const a = new Map([
      ["a", 100],
      ["b", 50],
      ["c", 25],
      ["d", 10],
      ["e", 5],
    ]);
    const b = new Map([
      ["a", 1],
      ["b", 3],
      ["c", 5],
      ["d", 7],
      ["e", 9],
    ]);
    const { rho } = spearmanRho(a, b);
    expect(rho).toBe(-1);
  });

  it("averages ranks for ties", () => {
    // a, b, c all tie at score 10 on map A (ranks 1,2,3 → avg 2 each).
    // On map B they have unique ranks 1,2,3. Pearson(ranks) with one side
    // having zero variance → denom = 0 → ρ = 0.
    const a = new Map([
      ["a", 10],
      ["b", 10],
      ["c", 10],
    ]);
    const b = new Map([
      ["a", 30],
      ["b", 20],
      ["c", 10],
    ]);
    const { rho, n } = spearmanRho(a, b);
    expect(n).toBe(3);
    expect(rho).toBe(0);
  });

  it("uses only files present in both maps", () => {
    const a = new Map([
      ["a", 10],
      ["b", 5],
      ["c", 1],
      ["only-in-a", 100],
    ]);
    const b = new Map([
      ["a", 10],
      ["b", 5],
      ["c", 1],
      ["only-in-b", 100],
    ]);
    const { rho, n } = spearmanRho(a, b);
    expect(n).toBe(3);
    expect(rho).toBe(1);
  });

  it("returns n=0, rho=0 when there is no overlap", () => {
    const a = new Map([["a", 1]]);
    const b = new Map([["b", 1]]);
    expect(spearmanRho(a, b)).toEqual({ rho: 0, n: 0 });
  });

  it("returns rho=0 for a single overlapping file", () => {
    const a = new Map([["a", 1]]);
    const b = new Map([["a", 99]]);
    expect(spearmanRho(a, b)).toEqual({ rho: 0, n: 1 });
  });
});

describe("computeCorrelations", () => {
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

  function makeEntries(scored: [string, number][]) {
    return scored.map(([file, score]) => ({
      file,
      score,
      percentOfTotal: 0,
      tier: "cool" as Tier,
      churn: 1,
      metricValue: score,
    }));
  }

  it("returns undefined when the defects ranking is absent", () => {
    const result = computeCorrelations({
      complexity: makeEntries([["a.ts", 10]]),
    });
    expect(result).toBeUndefined();
  });

  it("emits one ρ entry per non-reference ranking against defects", () => {
    const result = computeCorrelations({
      complexity: makeEntries([
        ["a.ts", 100],
        ["b.ts", 50],
        ["c.ts", 25],
        ["d.ts", 10],
        ["e.ts", 5],
      ]),
      nesting: makeEntries([
        ["a.ts", 5],
        ["b.ts", 4],
        ["c.ts", 3],
        ["d.ts", 2],
        ["e.ts", 1],
      ]),
      defects: makeEntries([
        ["a.ts", 9],
        ["b.ts", 7],
        ["c.ts", 5],
        ["d.ts", 3],
        ["e.ts", 1],
      ]),
    });

    expect(result).toBeDefined();
    expect(result?.reference).toBe("defects");
    expect(result?.referenceLabel).toBe("Fix Activity × Churn");
    const metrics = result?.entries.map((e) => e.metric).sort();
    expect(metrics).toEqual(["complexity", "nesting"]);
    for (const entry of result?.entries ?? []) {
      expect(entry.rho).toBe(1);
      expect(entry.n).toBe(5);
      expect(entry.confidence.level).toBe("weak");
    }
  });

  it("singularizes the inconclusive reason when only one file overlaps", () => {
    const result = computeCorrelations({
      complexity: makeEntries([["a.ts", 1]]),
      defects: makeEntries([["a.ts", 1]]),
    });
    expect(result?.entries[0].n).toBe(1);
    expect(result?.entries[0].confidence.reason).toContain(
      "1 file in both rankings",
    );
  });

  it("stamps inconclusive confidence below the weak sample-size floor", () => {
    const result = computeCorrelations({
      complexity: makeEntries([
        ["a.ts", 3],
        ["b.ts", 2],
      ]),
      defects: makeEntries([
        ["a.ts", 3],
        ["b.ts", 2],
      ]),
    });
    expect(result?.entries[0].confidence.level).toBe("inconclusive");
    expect(result?.entries[0].confidence.reason).toContain("need ≥ 5");
  });

  it("rounds rho to 4 decimal places", () => {
    const result = computeCorrelations({
      complexity: makeEntries([
        ["a.ts", 100],
        ["b.ts", 50],
        ["c.ts", 25],
        ["d.ts", 10],
        ["e.ts", 5],
      ]),
      defects: makeEntries([
        ["a.ts", 9],
        ["b.ts", 7],
        ["c.ts", 1],
        ["d.ts", 3],
        ["e.ts", 5],
      ]),
    });
    const rho = result?.entries[0].rho ?? 0;
    expect(Number.isInteger(rho * 10000)).toBe(true);
  });

  it("skips a non-defects ranking that has no entries", () => {
    const result = computeCorrelations({
      complexity: makeEntries([
        ["a.ts", 1],
        ["b.ts", 2],
      ]),
      nesting: [],
      defects: makeEntries([
        ["a.ts", 1],
        ["b.ts", 2],
      ]),
    });
    expect(result?.entries.map((e) => e.metric)).toEqual(["complexity"]);
  });

  // Wired-in path: computeAllRankings should hand the same correlations back.
  it("is produced by computeAllRankings when defects has signal", () => {
    const files: FileMetrics[] = [
      {
        file: "a.ts",
        code: 100,
        lines: 110,
        complexity: 50,
        comments: 0,
        complexityDensity: 0.5,
      },
      {
        file: "b.ts",
        code: 80,
        lines: 90,
        complexity: 20,
        comments: 0,
        complexityDensity: 0.25,
      },
      {
        file: "c.ts",
        code: 60,
        lines: 70,
        complexity: 5,
        comments: 0,
        complexityDensity: 0.08,
      },
    ];
    const churn = new Map([
      ["a.ts", 10],
      ["b.ts", 5],
      ["c.ts", 3],
    ]);
    const defects = new Map([
      ["a.ts", 4],
      ["b.ts", 2],
      ["c.ts", 1],
    ]);

    const result = computeAllRankings(
      files,
      churn,
      defects,
      new Map(),
      new Map(),
      0,
    );

    expect(result.correlations).toBeDefined();
    expect(result.correlations?.reference).toBe("defects");
    // Single STUB_CONFIDENCE unused, silence the linter.
    expect(STUB_CONFIDENCE.level).toBe("plausible");
  });

  it("skips correlations and surfaces it in skipped[] when defects is unavailable", () => {
    const files: FileMetrics[] = [
      {
        file: "a.ts",
        code: 100,
        lines: 110,
        complexity: 50,
        comments: 0,
        complexityDensity: 0.5,
      },
    ];
    const churn = new Map([["a.ts", 10]]);

    const result = computeAllRankings(
      files,
      churn,
      new Map(),
      new Map(),
      new Map(),
      0,
    );

    expect(result.correlations).toBeUndefined();
    expect(result.skipped.correlations).toBeDefined();
    expect(result.skipped.correlations.confidence.level).toBe("inconclusive");
    expect(result.skipped.correlations.reason).toContain(
      "no reference ranking",
    );
  });
});

describe("computeAllRankings confidence routing", () => {
  const files: FileMetrics[] = [
    {
      file: "a.ts",
      code: 10,
      lines: 10,
      complexity: 0,
      comments: 0,
      complexityDensity: 0,
    },
  ];

  it("routes to skipped with inconclusive confidence when complexity sample is too small", () => {
    const result = computeAllRankings(
      files,
      new Map([["a.ts", 1]]),
      new Map(),
      new Map(),
      new Map(),
      0,
    );

    expect(result.rankings.complexity).toBeUndefined();
    expect(result.skipped.complexity).toBeDefined();
    expect(result.skipped.complexity.confidence.level).toBe("inconclusive");
  });

  it("marks authors as inconclusive when no variance is present", () => {
    const result = computeAllRankings(
      files,
      new Map([["a.ts", 1]]),
      new Map(),
      new Map(),
      new Map([["a.ts", 1]]),
      0,
    );

    expect(result.skipped.authors).toBeDefined();
    expect(result.skipped.authors.confidence.level).toBe("inconclusive");
  });
});

describe("getTrackedFiles", () => {
  it("returns a normalized set from git ls-files output", () => {
    mockExecSync.mockReturnValue(
      Buffer.from("src/a.ts\n./src/b.ts\nlib\\nested\\c.ts\n"),
    );

    const result = getTrackedFiles();

    expect(result.has("src/a.ts")).toBe(true);
    expect(result.has("src/b.ts")).toBe(true);
    expect(result.has("lib/nested/c.ts")).toBe(true);
  });

  it("ignores blank lines", () => {
    mockExecSync.mockReturnValue(Buffer.from("\nsrc/a.ts\n\n"));

    const result = getTrackedFiles();

    expect(result.size).toBe(1);
    expect(result.has("src/a.ts")).toBe(true);
  });

  it("throws when git is not available", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("git not found");
    });

    expect(() => getTrackedFiles()).toThrow(
      "Not a git repository or git is not installed.",
    );
  });
});

describe("getChangedFiles", () => {
  it("returns the normalized set of files in the three-dot diff", () => {
    mockExecSync.mockReturnValue(
      Buffer.from("src/a.ts\n./src/b.ts\nlib\\nested\\c.ts\n"),
    );

    const result = getChangedFiles("main");

    expect(mockExecSync).toHaveBeenCalledWith(
      "git diff --name-only main...HEAD",
      expect.any(Object),
    );
    expect(result.has("src/a.ts")).toBe(true);
    expect(result.has("src/b.ts")).toBe(true);
    expect(result.has("lib/nested/c.ts")).toBe(true);
  });

  it("accepts a commit sha as base ref", () => {
    mockExecSync.mockReturnValue(Buffer.from("src/a.ts\n"));

    getChangedFiles("abc123");

    expect(mockExecSync).toHaveBeenCalledWith(
      "git diff --name-only abc123...HEAD",
      expect.any(Object),
    );
  });

  it("returns an empty set when nothing has changed", () => {
    mockExecSync.mockReturnValue(Buffer.from(""));

    const result = getChangedFiles("main");

    expect(result.size).toBe(0);
  });

  it("ignores blank lines in output", () => {
    mockExecSync.mockReturnValue(Buffer.from("\nsrc/a.ts\n\n\nsrc/b.ts\n"));

    const result = getChangedFiles("main");

    expect(result.size).toBe(2);
  });

  it("throws a descriptive error when the ref does not exist", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("fatal: bad revision");
    });

    expect(() => getChangedFiles("nope")).toThrow(
      /Failed to compute diff against base ref 'nope'/,
    );
  });
});

describe("detectDefaultBranch", () => {
  it("returns 'main' when it resolves", () => {
    mockExecSync.mockImplementation((cmd: unknown) => {
      if (typeof cmd === "string" && cmd.includes("rev-parse --verify main")) {
        return Buffer.from("abc123\n");
      }
      throw new Error("no");
    });

    expect(detectDefaultBranch()).toBe("main");
  });

  it("falls back to 'master' when 'main' is missing", () => {
    mockExecSync.mockImplementation((cmd: unknown) => {
      if (typeof cmd !== "string") throw new Error("no");
      if (cmd.includes("rev-parse --verify main")) {
        throw new Error("fatal: Needed a single revision");
      }
      if (cmd.includes("rev-parse --verify master")) {
        return Buffer.from("abc123\n");
      }
      throw new Error("no");
    });

    expect(detectDefaultBranch()).toBe("master");
  });

  it("returns undefined when neither branch exists", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("fatal: Needed a single revision");
    });

    expect(detectDefaultBranch()).toBeUndefined();
  });
});

describe("detectIgnorePatterns", () => {
  it("detects CI directories from tracked files", () => {
    mockExecSync.mockReturnValue(
      Buffer.from(".github/workflows/ci.yml\nsrc/app.ts\n"),
    );

    const result = detectIgnorePatterns();

    expect(result).toContainEqual({
      pattern: ".github/**",
      comment: "GitHub Actions and workflows",
    });
  });

  it("detects multiple directory patterns", () => {
    mockExecSync.mockReturnValue(
      Buffer.from(
        ".github/workflows/ci.yml\n.husky/pre-commit\nscripts/build.sh\nsrc/app.ts\n",
      ),
    );

    const result = detectIgnorePatterns();

    expect(result).toContainEqual({
      pattern: ".github/**",
      comment: "GitHub Actions and workflows",
    });
    expect(result).toContainEqual({
      pattern: ".husky/**",
      comment: "Git hooks",
    });
    expect(result).toContainEqual({
      pattern: "scripts/**",
      comment: "Build and utility scripts",
    });
  });

  it("detects generated file patterns", () => {
    mockExecSync.mockReturnValue(
      Buffer.from("src/api.generated.ts\nsrc/app.ts\n"),
    );

    const result = detectIgnorePatterns();

    expect(result).toContainEqual({
      pattern: "*.generated.*",
      comment: "Generated code",
    });
  });

  it("detects .gen file patterns", () => {
    mockExecSync.mockReturnValue(Buffer.from("src/types.gen.ts\nsrc/app.ts\n"));

    const result = detectIgnorePatterns();

    expect(result).toContainEqual({
      pattern: "*.gen.*",
      comment: "Generated code",
    });
  });

  it("detects config file patterns", () => {
    mockExecSync.mockReturnValue(Buffer.from("vite.config.ts\nsrc/app.ts\n"));

    const result = detectIgnorePatterns();

    expect(result).toContainEqual({
      pattern: "*.config.*",
      comment: "Configuration files",
    });
  });

  it("detects GitLab CI from tracked files", () => {
    mockExecSync.mockReturnValue(Buffer.from(".gitlab-ci.yml\nsrc/app.ts\n"));

    const result = detectIgnorePatterns();

    expect(result).toContainEqual({
      pattern: ".gitlab-ci*",
      comment: "GitLab CI configuration",
    });
  });

  it("detects Claude Code generated slash commands", () => {
    mockExecSync.mockReturnValue(
      Buffer.from(".claude/commands/review.md\nsrc/app.ts\n"),
    );

    const result = detectIgnorePatterns();

    expect(result).toContainEqual({
      pattern: ".claude/commands/**",
      comment: "Claude Code slash commands (often generated from sources)",
    });
  });

  it("detects OpenCode generated slash commands", () => {
    mockExecSync.mockReturnValue(
      Buffer.from(".opencode/commands/review.md\nsrc/app.ts\n"),
    );

    const result = detectIgnorePatterns();

    expect(result).toContainEqual({
      pattern: ".opencode/commands/**",
      comment: "OpenCode slash commands (often generated from sources)",
    });
  });

  it("detects Cursor generated rules", () => {
    mockExecSync.mockReturnValue(
      Buffer.from(".cursor/rules/typescript.mdc\nsrc/app.ts\n"),
    );

    const result = detectIgnorePatterns();

    expect(result).toContainEqual({
      pattern: ".cursor/rules/**",
      comment: "Cursor rules (often generated from sources)",
    });
  });

  it("returns empty array when no patterns match", () => {
    mockExecSync.mockReturnValue(Buffer.from("src/app.ts\nlib/utils.ts\n"));

    const result = detectIgnorePatterns();

    expect(result).toEqual([]);
  });

  it("throws when not in a git repo", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("not a git repository");
    });

    expect(() => detectIgnorePatterns()).toThrow(
      "Not a git repository or git is not installed.",
    );
  });

  it("normalizes paths from git ls-files", () => {
    mockExecSync.mockReturnValue(
      Buffer.from("./.github/workflows/ci.yml\n./src/app.ts\n"),
    );

    const result = detectIgnorePatterns();

    expect(result).toContainEqual({
      pattern: ".github/**",
      comment: "GitHub Actions and workflows",
    });
  });
});

describe("UNIVERSAL_IGNORE_GROUPS", () => {
  it("has two groups with non-empty pattern arrays", () => {
    expect(UNIVERSAL_IGNORE_GROUPS).toHaveLength(2);
    for (const group of UNIVERSAL_IGNORE_GROUPS) {
      expect(group.title).toBeTruthy();
      expect(group.patterns.length).toBeGreaterThan(0);
      for (const p of group.patterns) {
        expect(p.pattern).toBeTruthy();
        expect(p.comment).toBeTruthy();
      }
    }
  });

  it("covers test file and lock file patterns", () => {
    const allPatterns = UNIVERSAL_IGNORE_GROUPS.flatMap((g) =>
      g.patterns.map((p) => p.pattern),
    );
    expect(allPatterns).toContain("*.test.*");
    expect(allPatterns).toContain("*.spec.*");
    expect(allPatterns).toContain("package.json");
    expect(allPatterns).toContain("pnpm-lock.yaml");
  });
});

describe("formatIgnoreFile", () => {
  it("always includes universal groups in output", () => {
    const result = formatIgnoreFile([]);

    expect(result).toContain("# Generated by obscene init");
    expect(result).toContain("# Test files and test infrastructure");
    expect(result).toContain("*.test.*");
    expect(result).toContain("*.spec.*");
    expect(result).toContain("# Lock files and package manifests");
    expect(result).toContain("package.json");
  });

  it("includes detected patterns after universal groups", () => {
    const detected = [
      { pattern: ".github/**", comment: "GitHub Actions and workflows" },
      { pattern: "scripts/**", comment: "Build and utility scripts" },
    ];

    const result = formatIgnoreFile(detected);

    expect(result).toContain("# Generated by obscene init");
    expect(result).toContain("# Test files and test infrastructure");
    expect(result).toContain("# Project-specific patterns");
    expect(result).toContain("# GitHub Actions and workflows\n.github/**");
    expect(result).toContain("# Build and utility scripts\nscripts/**");
  });

  it("omits project-specific section when no detected patterns", () => {
    const result = formatIgnoreFile([]);

    expect(result).not.toContain("# Project-specific patterns");
  });

  it("includes documentation link in header", () => {
    const result = formatIgnoreFile([]);

    expect(result).toContain("https://github.com/wbern/obscene#ignore-files");
  });

  it("accepts custom universal groups", () => {
    const customGroups = [
      {
        title: "Custom group",
        patterns: [{ pattern: "custom.*", comment: "Custom pattern" }],
      },
    ];

    const result = formatIgnoreFile([], customGroups);

    expect(result).toContain("# Custom group");
    expect(result).toContain("custom.*");
    expect(result).not.toContain("# Test files and test infrastructure");
  });
});

describe("runSccOnFiles", () => {
  it("returns empty map when given no files", () => {
    const result = runSccOnFiles("/tmp/wt", []);
    expect(result.size).toBe(0);
  });

  it("returns empty map when no input file exists in cwd", () => {
    mockExistsSync.mockReturnValue(false);
    const result = runSccOnFiles("/tmp/wt", ["src/a.ts", "src/b.ts"]);
    expect(result.size).toBe(0);
    expect(mockSpawnSync).not.toHaveBeenCalled();
  });

  it("parses scc JSON into a FileMetrics map", () => {
    mockExistsSync.mockReturnValue(true);
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: Buffer.from(
        JSON.stringify([
          {
            Name: "TypeScript",
            Files: [
              {
                Location: "src/a.ts",
                Code: 10,
                Lines: 12,
                Complexity: 4,
                Comment: 1,
              },
              {
                Location: "src/b.ts",
                Code: 0,
                Lines: 1,
                Complexity: 0,
                Comment: 0,
              },
            ],
          },
        ]),
      ),
      stderr: Buffer.from(""),
      pid: 1,
      output: [],
      signal: null,
    } as unknown as ReturnType<typeof spawnSync>);

    const result = runSccOnFiles("/tmp/wt", ["src/a.ts", "src/b.ts"]);

    expect(result.get("src/a.ts")).toEqual({
      file: "src/a.ts",
      code: 10,
      lines: 12,
      complexity: 4,
      comments: 1,
      complexityDensity: 0.4,
    });
    // Zero-code files render density as 0 rather than NaN
    expect(result.get("src/b.ts")?.complexityDensity).toBe(0);
  });

  it("throws when scc is not installed", () => {
    mockExistsSync.mockReturnValue(true);
    mockSpawnSync.mockReturnValue({
      status: null,
      error: Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
      stdout: Buffer.from(""),
      stderr: Buffer.from(""),
      pid: 0,
      output: [],
      signal: null,
    } as unknown as ReturnType<typeof spawnSync>);

    expect(() => runSccOnFiles("/tmp/wt", ["src/a.ts"])).toThrow(
      /scc not found/,
    );
  });

  it("surfaces non-ENOENT spawn errors", () => {
    mockExistsSync.mockReturnValue(true);
    mockSpawnSync.mockReturnValue({
      status: null,
      stdout: Buffer.from(""),
      stderr: Buffer.from(""),
      error: Object.assign(new Error("EACCES: permission denied"), {
        code: "EACCES",
      }),
      pid: 0,
      output: [],
      signal: null,
    } as unknown as ReturnType<typeof spawnSync>);

    expect(() => runSccOnFiles("/tmp/wt", ["src/a.ts"])).toThrow(
      /scc spawn failed: EACCES: permission denied/,
    );
  });

  it("throws when scc exits non-zero", () => {
    mockExistsSync.mockReturnValue(true);
    mockSpawnSync.mockReturnValue({
      status: 1,
      stdout: Buffer.from(""),
      stderr: Buffer.from("bad input"),
      pid: 1,
      output: [],
      signal: null,
    } as unknown as ReturnType<typeof spawnSync>);

    expect(() => runSccOnFiles("/tmp/wt", ["src/a.ts"])).toThrow(/bad input/);
  });

  it("falls back to a generic message when stderr is empty", () => {
    mockExistsSync.mockReturnValue(true);
    mockSpawnSync.mockReturnValue({
      status: 1,
      stdout: Buffer.from(""),
      stderr: Buffer.from(""),
      pid: 1,
      output: [],
      signal: null,
    } as unknown as ReturnType<typeof spawnSync>);

    expect(() => runSccOnFiles("/tmp/wt", ["src/a.ts"])).toThrow(
      /unknown error/,
    );
  });
});

describe("withWorktreeAt", () => {
  const worktreeOk = {
    status: 0,
    stdout: Buffer.from(""),
    stderr: Buffer.from(""),
  } as unknown as ReturnType<typeof spawnSync>;

  it("creates a worktree, runs the callback, and removes the worktree", () => {
    mockMkdtempSync.mockReturnValue("/tmp/obscene-base-xyz");
    mockSpawnSync.mockReturnValue(worktreeOk);

    const result = withWorktreeAt("main", (path) => `ran-in:${path}`);

    expect(result).toBe("ran-in:/tmp/obscene-base-xyz");
    expect(mockSpawnSync).toHaveBeenCalledTimes(2);
    expect(mockSpawnSync.mock.calls[0][0]).toBe("git");
    expect(mockSpawnSync.mock.calls[0][1]).toEqual([
      "worktree",
      "add",
      "--detach",
      "/tmp/obscene-base-xyz",
      "main",
    ]);
    expect(mockSpawnSync.mock.calls[1][1]).toEqual([
      "worktree",
      "remove",
      "--force",
      "/tmp/obscene-base-xyz",
    ]);
  });

  it("scrubs GIT_* env vars before spawning git", () => {
    mockMkdtempSync.mockReturnValue("/tmp/obscene-base-xyz");
    mockSpawnSync.mockReturnValue(worktreeOk);
    const original = {
      GIT_DIR: process.env.GIT_DIR,
      GIT_INDEX_FILE: process.env.GIT_INDEX_FILE,
      GIT_PREFIX: process.env.GIT_PREFIX,
    };
    process.env.GIT_DIR = "/some/parent/.git";
    process.env.GIT_INDEX_FILE = "/some/parent/.git/index";
    process.env.GIT_PREFIX = "subdir/";
    try {
      withWorktreeAt("main", () => null);
    } finally {
      for (const [k, v] of Object.entries(original)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }

    for (const call of mockSpawnSync.mock.calls) {
      const env = (call[2] as { env?: NodeJS.ProcessEnv }).env;
      expect(env).toBeDefined();
      expect(env?.GIT_DIR).toBeUndefined();
      expect(env?.GIT_INDEX_FILE).toBeUndefined();
      expect(env?.GIT_PREFIX).toBeUndefined();
    }
  });

  it("removes the temp dir and throws when worktree creation fails", () => {
    mockMkdtempSync.mockReturnValue("/tmp/obscene-base-xyz");
    mockSpawnSync.mockReturnValue({
      status: 128,
      stdout: Buffer.from(""),
      stderr: Buffer.from("fatal: invalid reference: nope"),
    } as unknown as ReturnType<typeof spawnSync>);

    expect(() => withWorktreeAt("nope", () => 0)).toThrow(
      /Could not create worktree at 'nope': fatal: invalid reference: nope/,
    );
    expect(mockRmSync).toHaveBeenCalledWith("/tmp/obscene-base-xyz", {
      recursive: true,
      force: true,
    });
  });

  it("omits stderr detail when the worktree error has no stderr", () => {
    mockMkdtempSync.mockReturnValue("/tmp/obscene-base-xyz");
    mockSpawnSync.mockReturnValue({
      status: 128,
      stdout: Buffer.from(""),
      stderr: Buffer.from(""),
    } as unknown as ReturnType<typeof spawnSync>);

    expect(() => withWorktreeAt("nope", () => 0)).toThrow(
      /Could not create worktree at 'nope'\. Verify the ref exists/,
    );
  });

  it("cleans up via rmSync when the teardown worktree-remove fails", () => {
    mockMkdtempSync.mockReturnValue("/tmp/obscene-base-xyz");
    let call = 0;
    mockSpawnSync.mockImplementation(
      () =>
        (call++ === 0
          ? worktreeOk
          : {
              status: 1,
              stdout: Buffer.from(""),
              stderr: Buffer.from("remove failed"),
            }) as unknown as ReturnType<typeof spawnSync>,
    );

    const result = withWorktreeAt("main", () => "done");

    expect(result).toBe("done");
    expect(mockRmSync).toHaveBeenCalledWith("/tmp/obscene-base-xyz", {
      recursive: true,
      force: true,
    });
  });

  it("still tears the worktree down when the callback throws", () => {
    mockMkdtempSync.mockReturnValue("/tmp/obscene-base-xyz");
    mockSpawnSync.mockReturnValue(worktreeOk);

    expect(() =>
      withWorktreeAt("main", () => {
        throw new Error("callback failed");
      }),
    ).toThrow("callback failed");

    expect(mockSpawnSync.mock.calls.at(-1)?.[1]).toEqual([
      "worktree",
      "remove",
      "--force",
      "/tmp/obscene-base-xyz",
    ]);
  });
});

describe("getComplexityDeltas", () => {
  it("returns empty map when no files are given", () => {
    const result = getComplexityDeltas("main", [], new Map());
    expect(result.size).toBe(0);
  });

  it("computes change for files present at base and HEAD", () => {
    mockMkdtempSync.mockReturnValue("/tmp/wt");
    mockExecSync.mockReturnValue(Buffer.from(""));
    mockExistsSync.mockReturnValue(true);
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: Buffer.from(
        JSON.stringify([
          {
            Name: "TypeScript",
            Files: [
              {
                Location: "src/a.ts",
                Code: 10,
                Lines: 12,
                Complexity: 5,
                Comment: 1,
              },
            ],
          },
        ]),
      ),
      stderr: Buffer.from(""),
      pid: 1,
      output: [],
      signal: null,
    } as unknown as ReturnType<typeof spawnSync>);

    const newMetrics = new Map([["src/a.ts", 9]]);
    const result = getComplexityDeltas("main", ["src/a.ts"], newMetrics);

    expect(result.get("src/a.ts")).toEqual({
      oldComplexity: 5,
      newComplexity: 9,
      change: 4,
    });
  });

  it("labels files absent at base with oldComplexity=null", () => {
    mockMkdtempSync.mockReturnValue("/tmp/wt");
    mockExecSync.mockReturnValue(Buffer.from(""));
    mockExistsSync.mockReturnValue(false); // file isn't at base
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: Buffer.from("[]"),
      stderr: Buffer.from(""),
      pid: 1,
      output: [],
      signal: null,
    } as unknown as ReturnType<typeof spawnSync>);

    const newMetrics = new Map([["src/new.ts", 7]]);
    const result = getComplexityDeltas("main", ["src/new.ts"], newMetrics);

    expect(result.get("src/new.ts")).toEqual({
      oldComplexity: null,
      newComplexity: 7,
      change: null,
    });
  });

  it("skips files that have no entry in the HEAD metrics map", () => {
    mockMkdtempSync.mockReturnValue("/tmp/wt");
    mockExecSync.mockReturnValue(Buffer.from(""));
    mockExistsSync.mockReturnValue(true);
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: Buffer.from("[]"),
      stderr: Buffer.from(""),
      pid: 1,
      output: [],
      signal: null,
    } as unknown as ReturnType<typeof spawnSync>);

    const result = getComplexityDeltas("main", ["src/gone.ts"], new Map());
    expect(result.size).toBe(0);
  });
});

function snapshotFrom(opts: {
  files: { file: string; complexity: number }[];
  compositeEntries: { file: string; score: number; tier: Tier }[];
}): HotspotSnapshot {
  const fileMetrics: FileMetrics[] = opts.files.map((f) => ({
    file: f.file,
    code: 100,
    lines: 120,
    complexity: f.complexity,
    comments: 0,
    complexityDensity: f.complexity / 100,
  }));
  const totalComplexity = opts.files.reduce((s, f) => s + f.complexity, 0);
  const composite: CompositeOutput = {
    label: "Combined",
    scoreFormula: "reciprocal rank fusion across all dimensions",
    totalScore: opts.compositeEntries.reduce((s, e) => s + e.score, 0),
    tierCounts: { hot: 0, warm: 0, cool: 0 },
    totalDimensions: 4,
    totalEntries: opts.compositeEntries.length,
    showing: opts.compositeEntries.length,
    entries: opts.compositeEntries.map((e) => ({
      ...e,
      percentOfTotal: 0,
      churn: 0,
      dimensionCount: 4,
    })),
    confidence: {
      level: "plausible",
      reason: "test",
      inputs: {
        metric: "inputRankings",
        value: 4,
        thresholds: { weak: 2, plausible: 3, acceptable: 4 },
      },
      source: "test",
    },
  };
  return {
    files: fileMetrics,
    rankings: {},
    skipped: {},
    composite,
    corpus: { fileCount: opts.files.length, totalComplexity },
  };
}

describe("computeDelta", () => {
  it("returns empty transitions for identical snapshots", () => {
    const snap = snapshotFrom({
      files: [{ file: "a.ts", complexity: 10 }],
      compositeEntries: [{ file: "a.ts", score: 0.1, tier: "hot" }],
    });
    const result = computeDelta("base", "HEAD", snap, snap);
    expect(result.newFiles).toEqual([]);
    expect(result.deletedFiles).toEqual([]);
    expect(result.tierTransitions.enteredHot).toEqual([]);
    expect(result.tierTransitions.exitedHot).toEqual([]);
    expect(result.scoreChanges.every((c) => c.change === 0)).toBe(true);
    expect(result.perDimensionDeltas.complexity.change).toBe(0);
    expect(result.perDimensionDeltas.fileCount.change).toBe(0);
  });

  it("identifies new and deleted files", () => {
    const base = snapshotFrom({
      files: [{ file: "old.ts", complexity: 10 }],
      compositeEntries: [{ file: "old.ts", score: 0.1, tier: "hot" }],
    });
    const head = snapshotFrom({
      files: [{ file: "new.ts", complexity: 7 }],
      compositeEntries: [{ file: "new.ts", score: 0.05, tier: "hot" }],
    });
    const result = computeDelta("base", "HEAD", base, head);
    expect(result.newFiles).toEqual(["new.ts"]);
    expect(result.deletedFiles).toEqual(["old.ts"]);
    const newEntry = result.scoreChanges.find((c) => c.file === "new.ts");
    const oldEntry = result.scoreChanges.find((c) => c.file === "old.ts");
    expect(newEntry?.transition).toBe("new");
    expect(newEntry?.oldScore).toBeNull();
    expect(newEntry?.change).toBeNull();
    expect(oldEntry?.transition).toBe("deleted");
    expect(oldEntry?.newScore).toBeNull();
    expect(result.perDimensionDeltas.complexity.change).toBe(-3);
  });

  it("detects upward and downward tier transitions", () => {
    const base = snapshotFrom({
      files: [
        { file: "rising.ts", complexity: 5 },
        { file: "falling.ts", complexity: 50 },
        { file: "stable.ts", complexity: 20 },
        { file: "warming.ts", complexity: 5 },
        { file: "cooling.ts", complexity: 20 },
      ],
      compositeEntries: [
        { file: "rising.ts", score: 0.01, tier: "cool" },
        { file: "falling.ts", score: 0.2, tier: "hot" },
        { file: "stable.ts", score: 0.1, tier: "warm" },
        { file: "warming.ts", score: 0.02, tier: "cool" },
        { file: "cooling.ts", score: 0.08, tier: "warm" },
      ],
    });
    const head = snapshotFrom({
      files: [
        { file: "rising.ts", complexity: 60 },
        { file: "falling.ts", complexity: 5 },
        { file: "stable.ts", complexity: 20 },
        { file: "warming.ts", complexity: 20 },
        { file: "cooling.ts", complexity: 5 },
      ],
      compositeEntries: [
        { file: "rising.ts", score: 0.25, tier: "hot" },
        { file: "falling.ts", score: 0.01, tier: "cool" },
        { file: "stable.ts", score: 0.1, tier: "warm" },
        { file: "warming.ts", score: 0.09, tier: "warm" },
        { file: "cooling.ts", score: 0.02, tier: "cool" },
      ],
    });
    const result = computeDelta("base", "HEAD", base, head);
    expect(result.tierTransitions.enteredHot).toEqual(["rising.ts"]);
    expect(result.tierTransitions.exitedHot).toEqual(["falling.ts"]);
    expect(result.tierTransitions.enteredWarm).toEqual(["warming.ts"]);
    expect(result.tierTransitions.exitedWarm).toEqual(["cooling.ts"]);
    const stable = result.scoreChanges.find((c) => c.file === "stable.ts");
    expect(stable?.transition).toBe("stable");
  });

  it("computes percentChange and sorts by magnitude", () => {
    const base = snapshotFrom({
      files: [
        { file: "big.ts", complexity: 100 },
        { file: "small.ts", complexity: 10 },
      ],
      compositeEntries: [
        { file: "big.ts", score: 1.0, tier: "hot" },
        { file: "small.ts", score: 0.1, tier: "warm" },
      ],
    });
    const head = snapshotFrom({
      files: [
        { file: "big.ts", complexity: 50 },
        { file: "small.ts", complexity: 12 },
      ],
      compositeEntries: [
        { file: "big.ts", score: 0.5, tier: "hot" },
        { file: "small.ts", score: 0.12, tier: "warm" },
      ],
    });
    const result = computeDelta("base", "HEAD", base, head);
    // big.ts has larger |change|, so it sorts first.
    expect(result.scoreChanges[0].file).toBe("big.ts");
    expect(result.scoreChanges[0].percentChange).toBe(-50);
    const small = result.scoreChanges.find((c) => c.file === "small.ts");
    expect(small?.percentChange).toBe(20);
  });

  it("returns null percentChange when oldScore is zero", () => {
    const base = snapshotFrom({
      files: [{ file: "x.ts", complexity: 1 }],
      compositeEntries: [{ file: "x.ts", score: 0, tier: "cool" }],
    });
    const head = snapshotFrom({
      files: [{ file: "x.ts", complexity: 5 }],
      compositeEntries: [{ file: "x.ts", score: 0.5, tier: "hot" }],
    });
    const result = computeDelta("base", "HEAD", base, head);
    const entry = result.scoreChanges.find((c) => c.file === "x.ts");
    expect(entry?.percentChange).toBeNull();
    expect(entry?.transition).toBe("entered-hot");
  });
});

describe("computeHotspotsCore", () => {
  it("assembles rankings, composite, and corpus from file + git data", () => {
    const files: FileMetrics[] = [
      {
        file: "src/a.ts",
        code: 100,
        lines: 110,
        complexity: 30,
        comments: 0,
        complexityDensity: 0.3,
      },
      {
        file: "src/b.ts",
        code: 50,
        lines: 55,
        complexity: 10,
        comments: 0,
        complexityDensity: 0.2,
      },
      {
        file: "src/c.ts",
        code: 30,
        lines: 35,
        complexity: 5,
        comments: 0,
        complexityDensity: 0.16,
      },
    ];
    // git log calls in order: getChurn, getDefects, getAuthorCommitCounts.
    mockExecSync
      .mockReturnValueOnce(
        Buffer.from("src/a.ts\nsrc/a.ts\nsrc/b.ts\nsrc/c.ts\n"),
      )
      .mockReturnValueOnce(Buffer.from("src/a.ts\n"))
      .mockReturnValueOnce(
        Buffer.from(
          "COMMIT_SEP\nalice\nsrc/a.ts\nCOMMIT_SEP\nbob\nsrc/a.ts\nCOMMIT_SEP\nalice\nsrc/b.ts\nCOMMIT_SEP\ncarol\nsrc/c.ts\n",
        ),
      );
    // getNestingDepths reads each file.
    mockReadFileSync.mockImplementation(
      () =>
        "function f() {\n  if (x) {\n    if (y) {\n      doit();\n    }\n  }\n}\n",
    );
    const result = computeHotspotsCore(files, 3, 0);
    expect(result.corpus).toEqual({ fileCount: 3, totalComplexity: 45 });
    expect(result.churn.get("src/a.ts")).toBe(2);
    expect(result.rankings.complexity?.entries.length ?? 0).toBeGreaterThan(0);
    expect(result.composite.totalEntries).toBeGreaterThan(0);
  });
});

describe("sliceCoreForDisplay", () => {
  // Build a deterministic "fully-computed" core (as produced by
  // computeHotspotsCore(..., top=0)) we can slice without invoking the
  // real pipeline. The fields we exercise are entries[]/showing across
  // rankings and composite.
  function makeCore(fileCount: number): ReturnType<typeof computeHotspotsCore> {
    const entries = Array.from({ length: fileCount }, (_, i) => ({
      file: `src/${String.fromCharCode(97 + i)}.ts`,
      score: 1000 - i,
      percentOfTotal: 10,
      churn: 5,
      tier: "hot" as Tier,
      metricValue: 10,
    }));
    const compositeEntries = entries.map((e) => ({
      file: e.file,
      score: e.score,
      percentOfTotal: e.percentOfTotal,
      tier: e.tier,
      churn: e.churn,
      dimensionCount: 4,
    }));
    const confidence: ConfidenceInfo = {
      level: "acceptable",
      reason: "test",
      source: "test",
      inputs: {
        metric: "test",
        value: fileCount,
        thresholds: { weak: 1, plausible: 2, acceptable: 3 },
      },
    };
    const ranking: RankingOutput = {
      label: "Test",
      scoreFormula: "metric × churn",
      totalScore: entries.reduce((s, e) => s + e.score, 0),
      tierCounts: { hot: fileCount, warm: 0, cool: 0 },
      totalEntries: fileCount,
      showing: fileCount,
      entries,
      confidence,
    };
    const composite: CompositeOutput = {
      label: "Composite",
      scoreFormula: "RRF",
      totalScore: entries.reduce((s, e) => s + e.score, 0),
      tierCounts: { hot: fileCount, warm: 0, cool: 0 },
      totalDimensions: 4,
      totalEntries: fileCount,
      showing: fileCount,
      entries: compositeEntries,
      confidence,
    };
    return {
      rankings: { complexity: ranking, nesting: ranking },
      skipped: {},
      composite,
      corpus: { fileCount, totalComplexity: 100 },
      churn: new Map([["src/a.ts", 5]]),
    };
  }

  it("returns the input unchanged when top <= 0", () => {
    const core = makeCore(5);
    expect(sliceCoreForDisplay(core, 0)).toBe(core);
    expect(sliceCoreForDisplay(core, -1)).toBe(core);
  });

  it("trims rankings + composite entries to top N and updates `showing`", () => {
    const core = makeCore(10);
    const sliced = sliceCoreForDisplay(core, 3);
    for (const r of Object.values(sliced.rankings)) {
      expect(r.entries).toHaveLength(3);
      expect(r.showing).toBe(3);
      // totalEntries reflects the unsliced corpus — the slice is a display
      // window, not a filter on what was computed.
      expect(r.totalEntries).toBe(10);
    }
    expect(sliced.composite.entries).toHaveLength(3);
    expect(sliced.composite.showing).toBe(3);
    expect(sliced.composite.totalEntries).toBe(10);
  });

  it("passes corpus and churn through untouched", () => {
    const core = makeCore(10);
    const sliced = sliceCoreForDisplay(core, 3);
    expect(sliced.corpus).toBe(core.corpus);
    expect(sliced.churn).toBe(core.churn);
  });

  it("is a no-op when top exceeds the entry count", () => {
    const core = makeCore(3);
    const sliced = sliceCoreForDisplay(core, 50);
    for (const r of Object.values(sliced.rankings)) {
      expect(r.entries).toHaveLength(3);
      expect(r.showing).toBe(3);
    }
    expect(sliced.composite.entries).toHaveLength(3);
  });
});

describe("computeSnapshot", () => {
  it("runs scc + computeHotspotsCore and returns a HotspotSnapshot", () => {
    // First execSync call is runScc.
    mockExecSync
      .mockReturnValueOnce(
        Buffer.from(
          JSON.stringify([
            {
              Name: "TypeScript",
              Files: [
                {
                  Location: "src/a.ts",
                  Code: 80,
                  Lines: 90,
                  Complexity: 12,
                  Comment: 2,
                },
              ],
            },
          ]),
        ),
      )
      // Then computeHotspotsCore makes 3 git log calls.
      .mockReturnValueOnce(Buffer.from("src/a.ts\nsrc/a.ts\n"))
      .mockReturnValueOnce(Buffer.from(""))
      .mockReturnValueOnce(Buffer.from("COMMIT_SEP\nalice\nsrc/a.ts\n"));
    mockReadFileSync.mockImplementation(() => "if (x) {\n  do();\n}\n");
    const snap = computeSnapshot({ months: 3, excludes: [] });
    expect(snap.files.length).toBe(1);
    expect(snap.files[0].file).toBe("src/a.ts");
    expect(snap.corpus.fileCount).toBe(1);
    expect(snap.corpus.totalComplexity).toBe(12);
  });
});
