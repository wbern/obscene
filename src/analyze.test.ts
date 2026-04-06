import { beforeEach, describe, expect, it, vi } from "vitest";
import { computeHotspots, getChurn, runScc } from "./analyze.js";
import type { FileMetrics } from "./types.js";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

import { execSync } from "node:child_process";

const mockExecSync = vi.mocked(execSync);

beforeEach(() => {
  vi.clearAllMocks();
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

describe("computeHotspots", () => {
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

  it("scores files by complexity × churn", () => {
    const churn = new Map([
      ["a.ts", 10],
      ["b.ts", 5],
      ["c.ts", 20],
    ]);

    const result = computeHotspots(files, churn);

    expect(result[0].file).toBe("a.ts");
    expect(result[0].hotspotScore).toBe(500);
    expect(result[1].file).toBe("b.ts");
    expect(result[1].hotspotScore).toBe(100);
    expect(result[2].file).toBe("c.ts");
    expect(result[2].hotspotScore).toBe(100);
  });

  it("filters out files with zero churn", () => {
    const churn = new Map([["a.ts", 5]]);

    const result = computeHotspots(files, churn);

    expect(result).toHaveLength(1);
    expect(result[0].file).toBe("a.ts");
  });

  it("assigns danger tier to files within top 50% of cumulative score", () => {
    // Use evenly distributed files so multiple fit within 50%
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

    // All equal scores: 10 * 10 = 100 each. Total = 400.
    // x: cumulative 100/400 = 25% → danger
    // y: cumulative 200/400 = 50% → danger
    // z: cumulative 300/400 = 75% → watch
    // w: cumulative 400/400 = 100% → stable
    const churn = new Map([
      ["x.ts", 10],
      ["y.ts", 10],
      ["z.ts", 10],
      ["w.ts", 10],
    ]);

    const result = computeHotspots(evenFiles, churn);

    expect(result).toHaveLength(4);
    expect(result[0].tier).toBe("danger");
    expect(result[1].tier).toBe("danger");
    expect(result[2].tier).toBe("watch");
    expect(result[3].tier).toBe("stable");
  });

  it("returns empty array when no files have churn", () => {
    const churn = new Map<string, number>();

    const result = computeHotspots(files, churn);

    expect(result).toHaveLength(0);
  });

  it("calculates percentOfTotal correctly", () => {
    const churn = new Map([
      ["a.ts", 10],
      ["b.ts", 10],
    ]);

    const result = computeHotspots(files, churn);
    const totalPercent = result.reduce((s, h) => s + h.percentOfTotal, 0);

    // Should sum to ~100%
    expect(totalPercent).toBeCloseTo(100, 0);
  });
});
