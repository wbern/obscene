import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const PROJECT_ROOT = path.join(import.meta.dirname, "../..");
const BIN_PATH = path.join(PROJECT_ROOT, "dist", "cli.js");
// On Windows, .cmd wrappers (pnpm, npm) need shell: true to be found by spawnSync
const SHELL = process.platform === "win32";

describe("CLI Integration", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "obscene-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should have built CLI binary", () => {
    expect(fs.existsSync(BIN_PATH)).toBe(true);
  });

  it("should have shebang in CLI binary", () => {
    const content = fs.readFileSync(BIN_PATH, "utf-8");
    expect(content.startsWith("#!/usr/bin/env node")).toBe(true);
  });

  it("should have package.json with correct bin entry", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(PROJECT_ROOT, "package.json"), "utf-8"),
    );
    expect(pkg.bin).toEqual({ obscene: "dist/cli.js" });
  });

  it("should have package.json with files array including dist", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(PROJECT_ROOT, "package.json"), "utf-8"),
    );
    expect(pkg.files).toContain("dist");
  });

  it("should output version with --version flag", () => {
    const result = spawnSync("node", [BIN_PATH, "--version"], {
      encoding: "utf-8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("should output help with --help flag", () => {
    const result = spawnSync("node", [BIN_PATH, "--help"], {
      encoding: "utf-8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("obscene");
    expect(result.stdout).toContain("hotspots");
    expect(result.stdout).toContain("report");
    expect(result.stdout).toContain("coupling");
    expect(result.stdout).toContain("init");
  });

  // Packs the tarball and runs a full `pnpm install` in a temp dir to verify
  // the published artifact resolves end-to-end. The install dominates the
  // runtime (~90-120s), which exceeds vitest's internal worker RPC heartbeat,
  // so this test is gated to CI (where the budget is fine and the signal
  // is most valuable: catching tarball regressions before release). Skipped
  // locally to keep pre-commit fast; pre-commit still verifies tarball size
  // and build output via the other tests in this file. Also skipped on
  // Windows CI because lifecycle scripts (build, prepare) are too slow there.
  it.skipIf(!process.env.CI || process.platform === "win32")(
    "should run CLI from packed tarball without crashing",
    {
      timeout: 120000,
    },
    () => {
      // Pack the package to temp dir
      const packResult = spawnSync(
        "pnpm",
        ["pack", "--pack-gzip-level", "0", "--pack-destination", tempDir],
        { cwd: PROJECT_ROOT, stdio: "pipe", shell: SHELL },
      );
      expect(packResult.status).toBe(0);

      // Find the tarball
      const files = fs.readdirSync(tempDir);
      const tarball = files.find((f) => f.endsWith(".tgz"));
      expect(tarball).toBeDefined();

      // Extract it
      const extractDir = path.join(tempDir, "extracted");
      fs.mkdirSync(extractDir);
      const tarResult = spawnSync(
        "tar",
        ["-xzf", path.join(tempDir, tarball!), "-C", extractDir],
        { stdio: "pipe" },
      );
      expect(tarResult.status).toBe(0);

      const packageDir = path.join(extractDir, "package");

      // Binary bloat canary: dist/cli.js (the runtime payload) should stay
      // compact regardless of how much the README grows. README growth from
      // field reports and expanded docs is welcome; binary bloat is not.
      const cliStats = fs.statSync(path.join(packageDir, "dist", "cli.js"));
      const cliSizeKB = cliStats.size / 1024;
      expect(cliSizeKB).toBeLessThan(40);

      // Install dependencies in isolated dir
      const installResult = spawnSync(
        "pnpm",
        ["install", "--prefer-offline", "--ignore-scripts"],
        { cwd: packageDir, stdio: "pipe", shell: SHELL },
      );
      expect(installResult.status).toBe(0);

      // Run --help from the packed version — should not crash
      const cliPath = path.join(packageDir, "dist", "cli.js");
      const result = spawnSync("node", [cliPath, "--help"], {
        timeout: 5000,
        stdio: "pipe",
        cwd: packageDir,
      });

      expect(result.status).toBe(0);
      expect(result.stdout.toString()).toContain("obscene");
    },
  );

  it("should produce valid JSON output with rankings structure", {
    timeout: 30000,
  }, () => {
    // Run obscene on this repo (which is a git repo with scc-analyzable files)
    const result = spawnSync("node", [BIN_PATH, "--top", "5"], {
      cwd: PROJECT_ROOT,
      encoding: "utf-8",
    });

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toHaveProperty("generated");
    expect(parsed).toHaveProperty("guide");
    expect(Object.keys(parsed.guide).sort()).toEqual([
      "authors",
      "complexity",
      "composite",
      "confidence",
      "corpus",
      "defects",
      "nesting",
      "rankings",
      "tier",
    ]);
    expect(parsed).toHaveProperty("churnWindow", "3 months");
    expect(parsed).toHaveProperty("rankings");
    expect(typeof parsed.rankings).toBe("object");
    expect(parsed).toHaveProperty("composite");
    expect(parsed.composite).toHaveProperty("entries");
    expect(parsed.composite).toHaveProperty("totalScore");
    expect(parsed.composite).toHaveProperty("label", "Combined");

    // complexity ranking should always exist
    expect(parsed.rankings).toHaveProperty("complexity");
    const complexity = parsed.rankings.complexity;
    expect(complexity).toHaveProperty("label");
    expect(complexity).toHaveProperty("scoreFormula");
    expect(complexity).toHaveProperty("totalScore");
    expect(complexity).toHaveProperty("entries");
    expect(Array.isArray(complexity.entries)).toBe(true);
    expect(complexity.entries.length).toBeLessThanOrEqual(5);

    if (complexity.entries.length > 0) {
      const first = complexity.entries[0];
      expect(first).toHaveProperty("file");
      expect(first).toHaveProperty("score");
      expect(first).toHaveProperty("churn");
      expect(first).toHaveProperty("tier");
      expect(first).toHaveProperty("metricValue");
    }
  });

  it("should produce table output with multiple ranking tables", {
    timeout: 30000,
  }, () => {
    const result = spawnSync("node", [BIN_PATH, "--format", "table"], {
      cwd: PROJECT_ROOT,
      encoding: "utf-8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Hotspots");
    expect(result.stdout).toContain("churn window");
    expect(result.stdout).toContain("Score");
    expect(result.stdout).toContain("Churn");
    expect(result.stdout).toContain("Tier");
    // Emoji presence
    expect(result.stdout).toMatch(/🔥|☀️|🧊/u);
    expect(result.stdout).toContain("https://github.com/wbern/obscene#metrics");
    // Combined table with emphasis
    expect(result.stdout).toContain("★ COMBINED");
    expect(result.stdout).toContain("Dims");
  });

  it("should produce valid JSON output with coupling command", {
    timeout: 30000,
  }, () => {
    const result = spawnSync(
      "node",
      [BIN_PATH, "coupling", "--top", "5", "--min-cochanges", "1"],
      {
        cwd: PROJECT_ROOT,
        encoding: "utf-8",
      },
    );

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toHaveProperty("generated");
    expect(parsed).toHaveProperty("guide");
    expect(Object.keys(parsed.guide).sort()).toEqual([
      "cochanges",
      "confidence",
      "degree",
      "deleted",
      "lockstep",
      "tier",
      "totalComplexity",
    ]);
    expect(parsed).toHaveProperty("churnWindow", "3 months");
    expect(parsed).toHaveProperty("minCochanges", 1);
    expect(parsed).toHaveProperty("couplings");
    expect(Array.isArray(parsed.couplings)).toBe(true);
    expect(parsed.couplings.length).toBeLessThanOrEqual(5);

    if (parsed.couplings.length > 0) {
      const first = parsed.couplings[0];
      expect(first).toHaveProperty("file1");
      expect(first).toHaveProperty("file2");
      expect(first).toHaveProperty("cochanges");
      expect(first).toHaveProperty("degree");
      expect(first).toHaveProperty("tier");
    }
  });

  it("should produce table output with coupling --format table", {
    timeout: 30000,
  }, () => {
    const result = spawnSync(
      "node",
      [BIN_PATH, "coupling", "--format", "table", "--min-cochanges", "1"],
      {
        cwd: PROJECT_ROOT,
        encoding: "utf-8",
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Coupling");
    expect(result.stdout).toContain("churn window");
    expect(result.stdout).toContain("Shared");
    expect(result.stdout).toContain("Degree");
    expect(result.stdout).toContain("Tier");
    expect(result.stdout).toContain("https://github.com/wbern/obscene#metrics");
  });

  it("should produce valid JSON output with report command", {
    timeout: 30000,
  }, () => {
    const result = spawnSync("node", [BIN_PATH, "report", "--top", "5"], {
      cwd: PROJECT_ROOT,
      encoding: "utf-8",
    });

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toHaveProperty("generated");
    expect(parsed).toHaveProperty("guide");
    expect(Object.keys(parsed.guide).sort()).toEqual([
      "comments",
      "complexity",
      "complexityDensity",
    ]);
    expect(parsed).toHaveProperty("summary");
    expect(parsed.summary).toHaveProperty("fileCount");
    expect(parsed).toHaveProperty("files");
    expect(Array.isArray(parsed.files)).toBe(true);
    expect(parsed.files.length).toBeLessThanOrEqual(5);
  });

  it("should fail gracefully outside a git repo", () => {
    const result = spawnSync("node", [BIN_PATH], {
      timeout: 5000,
      stdio: "pipe",
      cwd: tempDir,
    });

    expect(result.status).not.toBe(0);
  });

  it("should generate .obsignore with universal and detected patterns", {
    timeout: 30000,
  }, () => {
    // Set up a git repo in temp dir
    spawnSync("git", ["init"], { cwd: tempDir, stdio: "pipe" });
    spawnSync("git", ["config", "user.email", "test@test.com"], {
      cwd: tempDir,
      stdio: "pipe",
    });
    spawnSync("git", ["config", "user.name", "Test"], {
      cwd: tempDir,
      stdio: "pipe",
    });

    // Create a file structure with detectable patterns
    fs.mkdirSync(path.join(tempDir, ".github", "workflows"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(tempDir, ".github", "workflows", "ci.yml"),
      "name: CI\n",
    );
    fs.writeFileSync(path.join(tempDir, "app.ts"), "console.log('hello');\n");

    spawnSync("git", ["add", "."], { cwd: tempDir, stdio: "pipe" });
    spawnSync("git", ["commit", "-m", "init"], {
      cwd: tempDir,
      stdio: "pipe",
    });

    const result = spawnSync("node", [BIN_PATH, "init"], {
      cwd: tempDir,
      encoding: "utf-8",
    });

    expect(result.status).toBe(0);
    const obsignore = fs.readFileSync(
      path.join(tempDir, ".obsignore"),
      "utf-8",
    );
    expect(obsignore).toContain("# Generated by obscene init");
    // Universal patterns
    expect(obsignore).toContain("*.test.*");
    expect(obsignore).toContain("package.json");
    // Detected patterns
    expect(obsignore).toContain(".github/**");
    expect(result.stderr).toContain("Created .obsignore");
    expect(result.stderr).toContain("universal exclusions");
  });

  it("should fail init when .obsignore already exists", () => {
    fs.writeFileSync(path.join(tempDir, ".obsignore"), "# existing\n");

    // Need a git repo for the command to not fail for other reasons
    spawnSync("git", ["init"], { cwd: tempDir, stdio: "pipe" });

    const result = spawnSync("node", [BIN_PATH, "init"], {
      cwd: tempDir,
      encoding: "utf-8",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("already exists");
  });

  it("should show stderr hint when no .obsignore exists", {
    timeout: 30000,
  }, () => {
    // Run hotspots on this repo (which has no .obsignore in PROJECT_ROOT unless created)
    // We use tempDir to guarantee no .obsignore
    spawnSync("git", ["init"], { cwd: tempDir, stdio: "pipe" });
    spawnSync("git", ["config", "user.email", "test@test.com"], {
      cwd: tempDir,
      stdio: "pipe",
    });
    spawnSync("git", ["config", "user.name", "Test"], {
      cwd: tempDir,
      stdio: "pipe",
    });
    fs.writeFileSync(path.join(tempDir, "app.ts"), "console.log('hello');\n");
    spawnSync("git", ["add", "."], { cwd: tempDir, stdio: "pipe" });
    spawnSync("git", ["commit", "-m", "init"], {
      cwd: tempDir,
      stdio: "pipe",
    });

    const result = spawnSync("node", [BIN_PATH, "report"], {
      cwd: tempDir,
      encoding: "utf-8",
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("hint: no .obsignore found");
    expect(result.stderr).toContain("obscene init");
  });

  // Delta mode A: --base filters rankings to files changed since the base ref.
  // Builds a tiny two-commit repo so the diff is deterministic and unaffected
  // by the parent project's history.
  function setupDeltaRepo(): { headSha: string; baseSha: string } {
    spawnSync("git", ["init", "-b", "main"], { cwd: tempDir, stdio: "pipe" });
    spawnSync("git", ["config", "user.email", "test@test.com"], {
      cwd: tempDir,
      stdio: "pipe",
    });
    spawnSync("git", ["config", "user.name", "Test"], {
      cwd: tempDir,
      stdio: "pipe",
    });
    // Base commit: two files
    fs.writeFileSync(
      path.join(tempDir, "kept.ts"),
      "export function a() { if (1) return 1; }\n",
    );
    fs.writeFileSync(
      path.join(tempDir, "unchanged.ts"),
      "export function b() { if (1) return 2; }\n",
    );
    spawnSync("git", ["add", "."], { cwd: tempDir, stdio: "pipe" });
    spawnSync("git", ["commit", "-m", "base"], { cwd: tempDir, stdio: "pipe" });
    const baseSha = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: tempDir,
      encoding: "utf-8",
    }).stdout.trim();

    // Create a branch off main so HEAD diverges (matches PR shape)
    spawnSync("git", ["checkout", "-b", "feature"], {
      cwd: tempDir,
      stdio: "pipe",
    });
    // PR commit: modify kept.ts, add new.ts; leave unchanged.ts alone
    fs.writeFileSync(
      path.join(tempDir, "kept.ts"),
      "export function a() { if (1) { if (2) return 1; } }\n",
    );
    fs.writeFileSync(
      path.join(tempDir, "new.ts"),
      "export function c() { if (1) if (2) if (3) return 3; }\n",
    );
    spawnSync("git", ["add", "."], { cwd: tempDir, stdio: "pipe" });
    spawnSync("git", ["commit", "-m", "pr work"], {
      cwd: tempDir,
      stdio: "pipe",
    });
    const headSha = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: tempDir,
      encoding: "utf-8",
    }).stdout.trim();

    return { baseSha, headSha };
  }

  it("should filter rankings to changed files when --base is given", {
    timeout: 30000,
  }, () => {
    setupDeltaRepo();

    const result = spawnSync(
      "node",
      [BIN_PATH, "--base", "main", "--top", "0"],
      { cwd: tempDir, encoding: "utf-8" },
    );

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toHaveProperty("delta");
    expect(parsed.delta.base).toBe("main");
    expect(parsed.delta.head).toBe("HEAD");
    expect(parsed.delta.changedFiles.sort()).toEqual(["kept.ts", "new.ts"]);

    // Rankings should only contain changed files
    const seenFiles = new Set<string>();
    for (const ranking of Object.values(parsed.rankings) as Array<{
      entries: Array<{ file: string }>;
    }>) {
      for (const e of ranking.entries) seenFiles.add(e.file);
    }
    expect(seenFiles.has("unchanged.ts")).toBe(false);
  });

  it("should auto-detect default branch with bare --base", {
    timeout: 30000,
  }, () => {
    setupDeltaRepo();

    const result = spawnSync("node", [BIN_PATH, "--base"], {
      cwd: tempDir,
      encoding: "utf-8",
    });

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.delta.base).toBe("main");
  });

  it("should accept a commit sha as --base", {
    timeout: 30000,
  }, () => {
    const { baseSha } = setupDeltaRepo();

    const result = spawnSync("node", [BIN_PATH, "--base", baseSha], {
      cwd: tempDir,
      encoding: "utf-8",
    });

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.delta.base).toBe(baseSha);
    expect(parsed.delta.changedFiles.sort()).toEqual(["kept.ts", "new.ts"]);
  });

  it("should report empty delta when nothing changed", {
    timeout: 30000,
  }, () => {
    setupDeltaRepo();
    // Switch back to main where HEAD == base
    spawnSync("git", ["checkout", "main"], { cwd: tempDir, stdio: "pipe" });

    const result = spawnSync("node", [BIN_PATH, "--base", "main"], {
      cwd: tempDir,
      encoding: "utf-8",
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("No files changed since main");
    const parsed = JSON.parse(result.stdout);
    expect(parsed.delta.changedFiles).toEqual([]);
    expect(parsed.rankings).toEqual({});
  });

  it("should render a delta header in table format", {
    timeout: 30000,
  }, () => {
    setupDeltaRepo();

    const result = spawnSync(
      "node",
      [BIN_PATH, "--base", "main", "--format", "table"],
      { cwd: tempDir, encoding: "utf-8" },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Delta —");
    expect(result.stdout).toContain("changed since main");
  });

  it("should fail when --base references a missing ref", {
    timeout: 30000,
  }, () => {
    setupDeltaRepo();

    const result = spawnSync("node", [BIN_PATH, "--base", "does-not-exist"], {
      cwd: tempDir,
      encoding: "utf-8",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Failed to compute diff against base ref");
  });

  // Mode B fixture: needs ≥3 complex files at HEAD so the complexity ranking
  // surfaces entries (confidence floor is 3). scc requires whitespace after
  // `if` to recognize the branch, so each file is multi-line.
  function setupDeltaRepoB(): void {
    spawnSync("git", ["init", "-b", "main"], { cwd: tempDir, stdio: "pipe" });
    spawnSync("git", ["config", "user.email", "test@test.com"], {
      cwd: tempDir,
      stdio: "pipe",
    });
    spawnSync("git", ["config", "user.name", "Test"], {
      cwd: tempDir,
      stdio: "pipe",
    });
    const writeFile = (name: string, body: string) =>
      fs.writeFileSync(path.join(tempDir, name), body);

    // Base: three complex files, one trivial file we won't touch.
    writeFile(
      "a.ts",
      "export function a(x: number) {\n  if (x > 0) {\n    if (x > 10) return 1;\n  }\n  return 0;\n}\n",
    );
    writeFile(
      "b.ts",
      "export function b(x: number) {\n  if (x > 0) {\n    if (x > 10) return 2;\n  }\n  return 0;\n}\n",
    );
    writeFile(
      "c.ts",
      "export function c(x: number) {\n  if (x > 0) {\n    if (x > 10) return 3;\n  }\n  return 0;\n}\n",
    );
    writeFile("stable.ts", "export const x = 1;\n");
    spawnSync("git", ["add", "."], { cwd: tempDir, stdio: "pipe" });
    spawnSync("git", ["commit", "-m", "base"], { cwd: tempDir, stdio: "pipe" });

    spawnSync("git", ["checkout", "-b", "feature"], {
      cwd: tempDir,
      stdio: "pipe",
    });
    // PR: modify a.ts (deepen nesting), modify b.ts (touch comment only),
    // add new.ts. Leave c.ts and stable.ts untouched.
    writeFile(
      "a.ts",
      "export function a(x: number) {\n  if (x > 0) {\n    if (x > 10) {\n      if (x > 100) {\n        if (x > 1000) return 1;\n      }\n    }\n  }\n  return 0;\n}\n",
    );
    writeFile(
      "b.ts",
      "// touched\nexport function b(x: number) {\n  if (x > 0) {\n    if (x > 10) return 2;\n  }\n  return 0;\n}\n",
    );
    writeFile(
      "new.ts",
      "export function n(x: number) {\n  if (x > 0) {\n    if (x > 10) {\n      if (x > 100) return 4;\n    }\n  }\n  return 0;\n}\n",
    );
    spawnSync("git", ["add", "."], { cwd: tempDir, stdio: "pipe" });
    spawnSync("git", ["commit", "-m", "pr"], { cwd: tempDir, stdio: "pipe" });
  }

  // Mode B: complexity delta. The base worktree gives us oldComplexity for
  // changed files; files new in HEAD get oldComplexity=null.
  it("should attach complexity deltas to ranking entries under --base", {
    timeout: 30000,
  }, () => {
    setupDeltaRepoB();

    const result = spawnSync(
      "node",
      [BIN_PATH, "--base", "main", "--top", "0"],
      { cwd: tempDir, encoding: "utf-8" },
    );

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);

    const entriesByFile = new Map<
      string,
      {
        complexityDelta?: {
          oldComplexity: number | null;
          newComplexity: number;
          change: number | null;
        };
      }
    >();
    for (const ranking of Object.values(parsed.rankings) as Array<{
      entries: Array<{
        file: string;
        complexityDelta?: {
          oldComplexity: number | null;
          newComplexity: number;
          change: number | null;
        };
      }>;
    }>) {
      for (const e of ranking.entries) entriesByFile.set(e.file, e);
    }

    // a.ts existed at base — should have numeric old + change > 0 (got deeper)
    const a = entriesByFile.get("a.ts");
    expect(a?.complexityDelta).toBeDefined();
    expect(typeof a?.complexityDelta?.oldComplexity).toBe("number");
    expect(a?.complexityDelta?.change).toBeGreaterThan(0);

    // new.ts didn't exist at base — old should be null, change should be null
    const fresh = entriesByFile.get("new.ts");
    expect(fresh?.complexityDelta).toBeDefined();
    expect(fresh?.complexityDelta?.oldComplexity).toBeNull();
    expect(fresh?.complexityDelta?.change).toBeNull();
    expect(fresh?.complexityDelta?.newComplexity).toBeGreaterThan(0);

    // stable.ts was never touched — must not be in any ranking
    expect(entriesByFile.has("stable.ts")).toBe(false);
  });

  it("should render the Δ column in the delta table view", {
    timeout: 30000,
  }, () => {
    setupDeltaRepoB();

    const result = spawnSync(
      "node",
      [BIN_PATH, "--base", "main", "--format", "table"],
      { cwd: tempDir, encoding: "utf-8" },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Δ");
    // New file row labelled "new" in the Δ column (before the Tier column).
    expect(result.stdout).toMatch(/new\.ts\s+.*?\s+new\s+.*?(HOT|WARM|COOL)/);
  });

  it("should fail bare --base when no default branch exists", {
    timeout: 30000,
  }, () => {
    // Init a repo whose only branch is neither main nor master
    spawnSync("git", ["init", "-b", "trunk"], { cwd: tempDir, stdio: "pipe" });
    spawnSync("git", ["config", "user.email", "test@test.com"], {
      cwd: tempDir,
      stdio: "pipe",
    });
    spawnSync("git", ["config", "user.name", "Test"], {
      cwd: tempDir,
      stdio: "pipe",
    });
    fs.writeFileSync(path.join(tempDir, "app.ts"), "console.log(1);\n");
    spawnSync("git", ["add", "."], { cwd: tempDir, stdio: "pipe" });
    spawnSync("git", ["commit", "-m", "init"], {
      cwd: tempDir,
      stdio: "pipe",
    });

    const result = spawnSync("node", [BIN_PATH, "--base"], {
      cwd: tempDir,
      encoding: "utf-8",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("no default branch found");
  });
});
