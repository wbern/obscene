import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assignTiers,
  computeAllRankings,
  computeComposite,
  computeCoupling,
  getAuthors,
  getChurn,
  getCoChanges,
  getDefects,
  getNestingDepths,
  readIgnoreFile,
  runScc,
} from "./analyze.js";
import type { FileMetrics, Tier } from "./types.js";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
}));

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const mockExecSync = vi.mocked(execSync);
const mockReadFileSync = vi.mocked(readFileSync);

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

  it("excludes test files by default", () => {
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

    expect(result).toHaveLength(1);
    expect(result[0].file).toBe("src/real.ts");
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

describe("getAuthors", () => {
  it("counts unique authors per file", () => {
    const gitOutput =
      "COMMIT_SEP\nAlice\nsrc/foo.ts\nsrc/bar.ts\nCOMMIT_SEP\nBob\nsrc/foo.ts\nCOMMIT_SEP\nAlice\nsrc/foo.ts\n";
    mockExecSync.mockReturnValue(Buffer.from(gitOutput));

    const result = getAuthors(3);

    expect(result.get("src/foo.ts")).toBe(2);
    expect(result.get("src/bar.ts")).toBe(1);
  });

  it("excludes bot authors from count", () => {
    const gitOutput =
      "COMMIT_SEP\nAlice\nsrc/foo.ts\nCOMMIT_SEP\nsemantic-release[bot]\nsrc/foo.ts\npackage.json\nCOMMIT_SEP\nBob\npackage.json\n";
    mockExecSync.mockReturnValue(Buffer.from(gitOutput));

    const result = getAuthors(3);

    // semantic-release[bot] excluded: foo has 1 author, package.json has 1
    expect(result.get("src/foo.ts")).toBe(1);
    expect(result.get("package.json")).toBe(1);
  });

  it("omits files only touched by bots", () => {
    const gitOutput =
      "COMMIT_SEP\ndependabot[bot]\npackage.json\nCOMMIT_SEP\nrenovate[bot]\npackage.json\n";
    mockExecSync.mockReturnValue(Buffer.from(gitOutput));

    const result = getAuthors(3);

    expect(result.has("package.json")).toBe(false);
  });

  it("returns 1 for single-author file", () => {
    const gitOutput =
      "COMMIT_SEP\nAlice\nsrc/solo.ts\nCOMMIT_SEP\nAlice\nsrc/solo.ts\n";
    mockExecSync.mockReturnValue(Buffer.from(gitOutput));

    const result = getAuthors(3);

    expect(result.get("src/solo.ts")).toBe(1);
  });

  it("normalizes paths with ./ prefix", () => {
    const gitOutput = "COMMIT_SEP\nAlice\n./src/foo.ts\n";
    mockExecSync.mockReturnValue(Buffer.from(gitOutput));

    const result = getAuthors(3);

    expect(result.get("src/foo.ts")).toBe(1);
  });

  it("skips blocks with empty author", () => {
    const gitOutput =
      "COMMIT_SEP\n\nsrc/foo.ts\nCOMMIT_SEP\nAlice\nsrc/bar.ts\n";
    mockExecSync.mockReturnValue(Buffer.from(gitOutput));

    const result = getAuthors(3);

    expect(result.has("src/foo.ts")).toBe(false);
    expect(result.get("src/bar.ts")).toBe(1);
  });

  it("returns empty map when no commits exist", () => {
    mockExecSync.mockReturnValue(Buffer.from(""));

    const result = getAuthors(3);

    expect(result.size).toBe(0);
  });

  it("throws error when not in a git repo", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("not a git repository");
    });

    expect(() => getAuthors(3)).toThrow(
      "Not a git repository or git is not installed",
    );
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

  it("skips blank lines when measuring depth", () => {
    const content = "function foo() {\n\n  return;\n}\n";
    mockReadFileSync.mockReturnValue(content);

    const result = getNestingDepths(["src/blanks.ts"]);

    expect(result.get("src/blanks.ts")).toBe(1);
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
    ]);
    const nesting = new Map([
      ["a.ts", 5],
      ["b.ts", 3],
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

  it("excludes test files by default", () => {
    const gitOutput = "COMMIT_SEP\nsrc/foo.test.ts\nlib/bar.ts\nsrc/real.ts\n";
    mockExecSync.mockReturnValue(Buffer.from(gitOutput));

    const result = getCoChanges(3);

    // foo.test.ts should be excluded
    for (const key of result.keys()) {
      expect(key).not.toContain("foo.test.ts");
    }
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
});

describe("computeComposite", () => {
  it("ranks files by RRF score across multiple rankings", () => {
    const rankings: Record<string, { entries: { file: string }[] }> = {
      complexity: {
        entries: [{ file: "a.ts" }, { file: "b.ts" }, { file: "c.ts" }],
      },
      nesting: {
        entries: [{ file: "a.ts" }, { file: "c.ts" }, { file: "b.ts" }],
      },
      defects: {
        entries: [{ file: "a.ts" }, { file: "b.ts" }],
      },
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
    const rankings: Record<string, { entries: { file: string }[] }> = {
      complexity: {
        entries: [
          { file: "a.ts" },
          { file: "b.ts" },
          { file: "c.ts" },
          { file: "d.ts" },
        ],
      },
    };

    const result = computeComposite(rankings, new Map(), 0);

    expect(result.entries[0].tier).toBe("hot");
    expect(result.entries[3].tier).toBe("cool");
    expect(
      result.tierCounts.hot + result.tierCounts.warm + result.tierCounts.cool,
    ).toBe(4);
  });

  it("limits output by top parameter", () => {
    const rankings: Record<string, { entries: { file: string }[] }> = {
      complexity: {
        entries: [{ file: "a.ts" }, { file: "b.ts" }, { file: "c.ts" }],
      },
    };

    const result = computeComposite(rankings, new Map(), 2);

    expect(result.entries).toHaveLength(2);
    expect(result.showing).toBe(2);
    expect(result.totalEntries).toBe(3);
  });

  it("counts dimensions a file appears in", () => {
    const rankings: Record<string, { entries: { file: string }[] }> = {
      complexity: { entries: [{ file: "a.ts" }, { file: "b.ts" }] },
      nesting: { entries: [{ file: "a.ts" }] },
      defects: { entries: [{ file: "a.ts" }] },
      authors: { entries: [{ file: "b.ts" }] },
    };

    const result = computeComposite(rankings, new Map(), 0);

    const aEntry = result.entries.find((e) => e.file === "a.ts");
    const bEntry = result.entries.find((e) => e.file === "b.ts");
    expect(aEntry?.dimensionCount).toBe(3);
    expect(bEntry?.dimensionCount).toBe(2);
  });
});
