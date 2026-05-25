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
      // Threshold tracks feature growth — the original 40 KB ceiling was set
      // when the bundle was already 40.2 KB, so it never reflected reality.
      // 58 KB gives ~2 KB headroom over the current footprint (55.2 KB after
      // adding --format=compact in 2.10) so the canary fires on the next
      // meaningful payload addition.
      const cliStats = fs.statSync(path.join(packageDir, "dist", "cli.js"));
      const cliSizeKB = cliStats.size / 1024;
      expect(cliSizeKB).toBeLessThan(58);

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
      "reawakened",
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
      "sumOfCoupling",
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

  it("should produce compact output with hotspots --format compact", {
    timeout: 30000,
  }, () => {
    const result = spawnSync(
      "node",
      [BIN_PATH, "--format", "compact", "--top", "5"],
      { cwd: PROJECT_ROOT, encoding: "utf-8" },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Hotspot landscape");
    expect(result.stdout).toContain("Confidence:");
    expect(result.stdout).toMatch(/HOT |WARM|COOL/);
    expect(result.stdout).toMatch(/\d+\.\d+%/);
    expect(result.stdout).toMatch(/\d+ commits/);
    expect(result.stdout).toMatch(/\d+\/\d+ dims/);
    expect(result.stdout).not.toMatch(/🔥|☀️|🧊/u);
    expect(result.stdout).not.toContain("github.com/wbern/obscene#metrics");
    expect(result.stdout).not.toContain("═");
    // compact output is materially smaller than table output
    const tableResult = spawnSync(
      "node",
      [BIN_PATH, "--format", "table", "--top", "5"],
      { cwd: PROJECT_ROOT, encoding: "utf-8" },
    );
    expect(result.stdout.length).toBeLessThan(tableResult.stdout.length / 2);
  });

  it("should produce compact output with coupling --format compact", {
    timeout: 30000,
  }, () => {
    const result = spawnSync(
      "node",
      [
        BIN_PATH,
        "coupling",
        "--format",
        "compact",
        "--top",
        "5",
        "--min-cochanges",
        "1",
      ],
      { cwd: PROJECT_ROOT, encoding: "utf-8" },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Coupling");
    expect(result.stdout).toContain("min shared:");
    expect(result.stdout).toContain("↔");
    expect(result.stdout).toMatch(/\d+ shared/);
    expect(result.stdout).not.toContain("github.com/wbern/obscene#metrics");
    expect(result.stdout).not.toContain("─");
  });

  it("should produce compact output with report --format compact", {
    timeout: 30000,
  }, () => {
    const result = spawnSync(
      "node",
      [BIN_PATH, "report", "--format", "compact", "--top", "5"],
      { cwd: PROJECT_ROOT, encoding: "utf-8" },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Complexity report");
    expect(result.stdout).toMatch(/complexity=\s*\d+/);
    expect(result.stdout).toMatch(/density=\d+\.\d+/);
    expect(result.stdout).toMatch(/code=\d+/);
    expect(result.stdout).not.toContain("github.com/wbern/obscene#metrics");
    expect(result.stdout).not.toContain("─");
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

  it("warns when invoked from a subdirectory below the repo root (GH#13)", {
    timeout: 30000,
  }, () => {
    spawnSync("git", ["init"], { cwd: tempDir, stdio: "pipe" });
    spawnSync("git", ["config", "user.email", "test@test.com"], {
      cwd: tempDir,
      stdio: "pipe",
    });
    spawnSync("git", ["config", "user.name", "Test"], {
      cwd: tempDir,
      stdio: "pipe",
    });
    fs.mkdirSync(path.join(tempDir, "frontend"), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, "frontend", "app.ts"),
      "console.log('hi');\n",
    );
    spawnSync("git", ["add", "."], { cwd: tempDir, stdio: "pipe" });
    spawnSync("git", ["commit", "-m", "init"], {
      cwd: tempDir,
      stdio: "pipe",
    });

    const fromSubdir = spawnSync("node", [BIN_PATH, "report"], {
      cwd: path.join(tempDir, "frontend"),
      encoding: "utf-8",
    });

    expect(fromSubdir.status).toBe(0);
    expect(fromSubdir.stderr).toContain("scanning subtree 'frontend'");
    expect(fromSubdir.stderr).toContain("GH#13");

    const fromRoot = spawnSync("node", [BIN_PATH, "report"], {
      cwd: tempDir,
      encoding: "utf-8",
    });

    expect(fromRoot.status).toBe(0);
    expect(fromRoot.stderr).not.toContain("scanning subtree");
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

  // Mode C: --full-delta runs the snapshot pipeline against both refs and
  // attaches a structured fullDelta block alongside the HEAD rankings.
  it("should attach fullDelta with new files and corpus deltas under --full-delta", {
    timeout: 30000,
  }, () => {
    setupDeltaRepoB();

    const result = spawnSync(
      "node",
      [BIN_PATH, "--base", "main", "--full-delta", "--top", "0"],
      { cwd: tempDir, encoding: "utf-8" },
    );

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);

    expect(parsed.fullDelta).toBeDefined();
    expect(parsed.fullDelta.base).toBe("main");
    expect(parsed.fullDelta.head).toBe("HEAD");
    expect(parsed.fullDelta.newFiles).toContain("new.ts");
    expect(parsed.fullDelta.deletedFiles).toEqual([]);
    expect(parsed.fullDelta.perDimensionDeltas.fileCount.change).toBe(1);
    // a.ts got deeper — total complexity should have risen at HEAD.
    expect(
      parsed.fullDelta.perDimensionDeltas.complexity.change,
    ).toBeGreaterThan(0);
    // Full mode keeps the whole corpus visible, not just the changed files.
    const filesInRankings = new Set<string>();
    for (const ranking of Object.values(parsed.rankings) as Array<{
      entries: Array<{ file: string }>;
    }>) {
      for (const e of ranking.entries) filesInRankings.add(e.file);
    }
    expect(filesInRankings.has("c.ts")).toBe(true);
  });

  it("should render a Full Delta section in table format under --full-delta", {
    timeout: 30000,
  }, () => {
    setupDeltaRepoB();

    const result = spawnSync(
      "node",
      [BIN_PATH, "--base", "main", "--full-delta", "--format", "table"],
      { cwd: tempDir, encoding: "utf-8" },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Full Delta");
    expect(result.stdout).toContain("new.ts");
  });

  // When --full-delta is requested but the worktree pipeline can't run, the
  // CLI must degrade gracefully: filter rankings to changed files (Mode B
  // shape), surface the downgrade in stderr AND in `delta.fallback` so JSON
  // consumers can detect it without scraping stderr.
  it("should fall back to filtered rankings when --full-delta worktree fails", {
    timeout: 30000,
  }, () => {
    setupDeltaRepoB();

    // Point TMPDIR at a path that doesn't exist. withWorktreeAt's
    // `mkdtempSync(join(tmpdir(), "obscene-base-"))` will throw ENOENT,
    // while `git diff --name-only` (no temp space needed) still succeeds.
    const badTmp = path.join(tempDir, "no-such-tmp-dir");
    const result = spawnSync(
      "node",
      [BIN_PATH, "--base", "main", "--full-delta", "--top", "0"],
      {
        cwd: tempDir,
        encoding: "utf-8",
        env: { ...process.env, TMPDIR: badTmp, TMP: badTmp, TEMP: badTmp },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("full-delta unavailable");
    expect(result.stderr).toContain("Falling back to filtered rankings");

    const parsed = JSON.parse(result.stdout);
    // Mode C shape is gone; Mode B shape is in place.
    expect(parsed.fullDelta).toBeUndefined();
    expect(parsed.delta).toBeDefined();
    expect(parsed.delta.fallback).toBeDefined();
    expect(parsed.delta.fallback.from).toBe("full-delta");
    expect(typeof parsed.delta.fallback.reason).toBe("string");
    expect(parsed.delta.fallback.reason.length).toBeGreaterThan(0);

    // Rankings should be filtered — stable.ts was never touched and must
    // not appear; a.ts (modified) must.
    const filesInRankings = new Set<string>();
    for (const ranking of Object.values(parsed.rankings) as Array<{
      entries: Array<{ file: string }>;
    }>) {
      for (const e of ranking.entries) filesInRankings.add(e.file);
    }
    expect(filesInRankings.has("stable.ts")).toBe(false);
    expect(filesInRankings.has("a.ts")).toBe(true);
  });

  it("should reject --full-delta without --base", {
    timeout: 30000,
  }, () => {
    setupDeltaRepoB();

    const result = spawnSync("node", [BIN_PATH, "--full-delta"], {
      cwd: tempDir,
      encoding: "utf-8",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("--full-delta requires --base");
  });

  it("should describe the hook command in --help", {
    timeout: 10000,
  }, () => {
    const result = spawnSync("node", [BIN_PATH, "hook", "--help"], {
      encoding: "utf-8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Claude Code hook");
    expect(result.stdout).toContain("--base");
    expect(result.stdout).toContain("--event");
    expect(result.stdout).toContain("--significant-percent");
  });

  it("should accept --significant-percent without error", {
    timeout: 10000,
  }, () => {
    const result = spawnSync(
      "node",
      [BIN_PATH, "hook", "--base", "HEAD", "--significant-percent", "10"],
      { cwd: tempDir, encoding: "utf-8" },
    );
    // Outside a git repo the fast-path probe falls through and the full
    // pipeline errors out — but the hook swallows it and exits 0 silently.
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("should exit 0 silently when hook runs outside a git repo", {
    timeout: 10000,
  }, () => {
    const result = spawnSync("node", [BIN_PATH, "hook"], {
      cwd: tempDir,
      encoding: "utf-8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("should emit valid hook JSON or stay silent in a delta repo", {
    timeout: 30000,
  }, () => {
    setupDeltaRepoB();

    const result = spawnSync(
      "node",
      [BIN_PATH, "hook", "--base", "main", "--event", "Stop"],
      { cwd: tempDir, encoding: "utf-8" },
    );
    expect(result.status).toBe(0);

    if (result.stdout.length > 0) {
      const parsed = JSON.parse(result.stdout);
      expect(typeof parsed.systemMessage).toBe("string");
      expect(parsed.systemMessage).toContain("obscene drift");
    }
  });

  // Cross-directory pair with five shared commits and one solo commit on
  // src/a.ts — degree = 5/min(6,5)*100 = 100, lockstep ratio = 5/6 ≈ 0.83 so
  // the lockstep suppressor is *not* tripped. The feature branch edits
  // src/a.ts only so lib/b.ts qualifies as an unedited co-change partner.
  function setupCochangeRepo(): void {
    const run = (...args: string[]) =>
      spawnSync("git", args, { cwd: tempDir, stdio: "pipe" });
    run("init", "-b", "main");
    run("config", "user.email", "test@test.com");
    run("config", "user.name", "Test");

    const write = (name: string, body: string) => {
      const full = path.join(tempDir, name);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, body);
    };

    for (let i = 1; i <= 5; i++) {
      write("src/a.ts", `export const a = ${i};\n`);
      write("lib/b.ts", `export const b = ${i};\n`);
      run("add", ".");
      run("commit", "-m", `joint ${i}`);
    }
    // Sixth solo commit on a.ts so cochanges/max(churn) = 5/6 < 0.9.
    write("src/a.ts", "export const a = 6;\n");
    run("add", ".");
    run("commit", "-m", "solo a");

    run("checkout", "-b", "feature");
    write("src/a.ts", "export const a = 7;\n");
    run("add", ".");
    run("commit", "-m", "feature edit");
  }

  it("should surface unedited co-change partners in hook JSON", {
    timeout: 30000,
  }, () => {
    setupCochangeRepo();

    const result = spawnSync(
      "node",
      [BIN_PATH, "hook", "--base", "main", "--event", "Stop", "--months", "6"],
      { cwd: tempDir, encoding: "utf-8" },
    );

    expect(result.status).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(0);
    const parsed = JSON.parse(result.stdout);
    const context = parsed.systemMessage as string;
    expect(context).toContain("co-change reminders");
    expect(context).toContain("src/a.ts ↔ lib/b.ts");
    expect(context).toContain("ignore if unrelated to this change.");
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

  // Path scope (GH#12): corpus-anchored filter via --paths / --since.
  // Tier labels stay anchored to the full corpus — these flags only filter
  // displayed entries and add a stderr summary plus a `pathFilter` JSON block.
  function setupPathScopeRepo(): { baseSha: string } {
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

    // Base: four complex files so the corpus has a non-trivial tier
    // distribution. scc requires whitespace after `if` to count branches.
    writeFile(
      "alpha.ts",
      "export function a(x: number) {\n  if (x > 0) {\n    if (x > 10) {\n      if (x > 100) return 1;\n    }\n  }\n  return 0;\n}\n",
    );
    writeFile(
      "beta.ts",
      "export function b(x: number) {\n  if (x > 0) {\n    if (x > 10) return 2;\n  }\n  return 0;\n}\n",
    );
    writeFile(
      "gamma.ts",
      "export function c(x: number) {\n  if (x > 0) {\n    if (x > 10) return 3;\n  }\n  return 0;\n}\n",
    );
    writeFile(
      "delta.ts",
      "export function d(x: number) {\n  if (x > 0) {\n    if (x > 10) return 4;\n  }\n  return 0;\n}\n",
    );
    spawnSync("git", ["add", "."], { cwd: tempDir, stdio: "pipe" });
    spawnSync("git", ["commit", "-m", "base"], { cwd: tempDir, stdio: "pipe" });
    const baseSha = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: tempDir,
      encoding: "utf-8",
    }).stdout.trim();

    // Subsequent edit so --since main has something to report. Modifying
    // alpha.ts keeps it inside the corpus rather than introducing a new file.
    writeFile(
      "alpha.ts",
      "export function a(x: number) {\n  if (x > 0) {\n    if (x > 10) {\n      if (x > 100) {\n        if (x > 1000) return 1;\n      }\n    }\n  }\n  return 0;\n}\n",
    );
    spawnSync("git", ["checkout", "-b", "feature"], {
      cwd: tempDir,
      stdio: "pipe",
    });
    spawnSync("git", ["add", "."], { cwd: tempDir, stdio: "pipe" });
    spawnSync("git", ["commit", "-m", "edit alpha"], {
      cwd: tempDir,
      stdio: "pipe",
    });

    return { baseSha };
  }

  it("filters output and emits a pathFilter block under --paths (GH#12)", {
    timeout: 30000,
  }, () => {
    setupPathScopeRepo();

    const result = spawnSync(
      "node",
      [BIN_PATH, "--paths", "alpha.ts", "beta.ts", "--top", "0"],
      { cwd: tempDir, encoding: "utf-8" },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("path filter --paths (2 files)");
    expect(result.stderr).toContain("Corpus base rate:");

    const parsed = JSON.parse(result.stdout);
    expect(parsed.pathFilter).toBeDefined();
    expect(parsed.pathFilter.source).toBe("--paths (2 files)");
    expect(parsed.pathFilter.paths.sort()).toEqual(["alpha.ts", "beta.ts"]);
    expect(parsed.pathFilter.notRanked).toEqual([]);
    expect(parsed.pathFilter.corpusHotRate).not.toBeNull();

    // Rankings should only display the filtered files
    const seenFiles = new Set<string>();
    for (const ranking of Object.values(parsed.rankings) as Array<{
      entries: Array<{ file: string }>;
    }>) {
      for (const e of ranking.entries) seenFiles.add(e.file);
    }
    expect(seenFiles.has("gamma.ts")).toBe(false);
    expect(seenFiles.has("delta.ts")).toBe(false);
  });

  it("flags net-new files under --paths as notRanked (GH#12)", {
    timeout: 30000,
  }, () => {
    setupPathScopeRepo();

    const result = spawnSync(
      "node",
      [BIN_PATH, "--paths", "alpha.ts", "nonexistent.ts", "--top", "0"],
      { cwd: tempDir, encoding: "utf-8" },
    );

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.pathFilter.notRanked).toEqual(["nonexistent.ts"]);
    expect(result.stderr).toContain("1 not in any ranking");
  });

  it("resolves --since <ref> to changed files (GH#12)", {
    timeout: 30000,
  }, () => {
    setupPathScopeRepo();

    const result = spawnSync(
      "node",
      [BIN_PATH, "--since", "main", "--top", "0"],
      { cwd: tempDir, encoding: "utf-8" },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("path filter --since main");
    const parsed = JSON.parse(result.stdout);
    expect(parsed.pathFilter.source).toBe("--since main");
    expect(parsed.pathFilter.paths).toContain("alpha.ts");
  });

  it("rejects --paths and --base together (GH#12)", {
    timeout: 30000,
  }, () => {
    setupPathScopeRepo();

    const result = spawnSync(
      "node",
      [BIN_PATH, "--paths", "alpha.ts", "--base", "main"],
      { cwd: tempDir, encoding: "utf-8" },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("mutually exclusive");
  });

  it("rejects --paths and --since together (GH#12)", {
    timeout: 30000,
  }, () => {
    setupPathScopeRepo();

    const result = spawnSync(
      "node",
      [BIN_PATH, "--paths", "alpha.ts", "--since", "main"],
      { cwd: tempDir, encoding: "utf-8" },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("mutually exclusive");
  });

  // Churn mode (GH#17): commits is the default; lines sums numstat
  // added+deleted so big rewrites outweigh tiny typo fixes.
  function setupChurnModeRepo(): void {
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

    // Baseline: small.ts gets many tiny commits, big.ts gets one large
    // rewrite. Under --churn-mode commits, small.ts has the higher churn
    // count; under --churn-mode lines, big.ts dominates.
    writeFile(
      "small.ts",
      "export function s(x: number) {\n  if (x > 0) return 1;\n  return 0;\n}\n",
    );
    writeFile(
      "big.ts",
      "export function b(x: number) {\n  if (x > 0) {\n    if (x > 10) return 2;\n  }\n  return 0;\n}\n",
    );
    // Third file so the complexity ranking clears its 3-file confidence floor.
    writeFile(
      "third.ts",
      "export function t(x: number) {\n  if (x > 0) {\n    if (x > 10) return 3;\n  }\n  return 0;\n}\n",
    );
    spawnSync("git", ["add", "."], { cwd: tempDir, stdio: "pipe" });
    spawnSync("git", ["commit", "-m", "base"], { cwd: tempDir, stdio: "pipe" });

    // 3 tiny commits to small.ts (1 line each)
    for (let i = 0; i < 3; i++) {
      writeFile(
        "small.ts",
        `// tweak ${i}\nexport function s(x: number) {\n  if (x > 0) return 1;\n  return 0;\n}\n`,
      );
      spawnSync("git", ["add", "."], { cwd: tempDir, stdio: "pipe" });
      spawnSync("git", ["commit", "-m", `tweak ${i}`], {
        cwd: tempDir,
        stdio: "pipe",
      });
    }

    // 1 big commit to big.ts (many lines)
    const expanded = Array.from({ length: 40 }, (_, i) => `  // L${i}`).join(
      "\n",
    );
    writeFile(
      "big.ts",
      `export function b(x: number) {\n${expanded}\n  if (x > 0) {\n    if (x > 10) return 2;\n  }\n  return 0;\n}\n`,
    );
    spawnSync("git", ["add", "."], { cwd: tempDir, stdio: "pipe" });
    spawnSync("git", ["commit", "-m", "rewrite big"], {
      cwd: tempDir,
      stdio: "pipe",
    });
  }

  it("defaults to --churn-mode commits and surfaces commit counts (GH#17)", {
    timeout: 30000,
  }, () => {
    setupChurnModeRepo();

    const result = spawnSync("node", [BIN_PATH, "--top", "0"], {
      cwd: tempDir,
      encoding: "utf-8",
    });

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.churnMode).toBe("commits");

    const churns = new Map<string, number>();
    for (const e of parsed.rankings.complexity.entries as Array<{
      file: string;
      churn: number;
    }>) {
      churns.set(e.file, e.churn);
    }
    expect(churns.get("small.ts")).toBe(4); // base + 3 tweaks
    expect(churns.get("big.ts")).toBe(2); // base + rewrite
  });

  it("counts added+deleted lines under --churn-mode lines (GH#17)", {
    timeout: 30000,
  }, () => {
    setupChurnModeRepo();

    const result = spawnSync(
      "node",
      [BIN_PATH, "--top", "0", "--churn-mode", "lines"],
      { cwd: tempDir, encoding: "utf-8" },
    );

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.churnMode).toBe("lines");

    const churns = new Map<string, number>();
    for (const e of parsed.rankings.complexity.entries as Array<{
      file: string;
      churn: number;
    }>) {
      churns.set(e.file, e.churn);
    }
    // big.ts now dominates because its single commit was large
    expect(churns.get("big.ts")).toBeGreaterThan(churns.get("small.ts") ?? 0);
  });

  it("rejects unknown --churn-mode values (GH#17)", {
    timeout: 30000,
  }, () => {
    setupChurnModeRepo();

    const result = spawnSync("node", [BIN_PATH, "--churn-mode", "bogus"], {
      cwd: tempDir,
      encoding: "utf-8",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Unknown --churn-mode 'bogus'");
  });

  it("threads --churn-mode lines through --base delta mode (GH#17)", {
    timeout: 30000,
  }, () => {
    setupDeltaRepoB();

    const result = spawnSync(
      "node",
      [BIN_PATH, "--base", "main", "--churn-mode", "lines", "--top", "0"],
      { cwd: tempDir, encoding: "utf-8" },
    );

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.churnMode).toBe("lines");
    expect(parsed.delta.changedFiles.sort()).toEqual([
      "a.ts",
      "b.ts",
      "new.ts",
    ]);
    // Line-based churn must be non-zero for the changed files —
    // proves getChurnLines ran (not getChurn) in delta mode.
    const churns = new Map<string, number>();
    for (const e of parsed.rankings.complexity.entries as Array<{
      file: string;
      churn: number;
    }>) {
      churns.set(e.file, e.churn);
    }
    expect(churns.get("a.ts") ?? 0).toBeGreaterThan(0);
    expect(churns.get("new.ts") ?? 0).toBeGreaterThan(0);
  });

  it("threads --churn-mode lines through --full-delta mode (GH#17)", {
    timeout: 30000,
  }, () => {
    setupDeltaRepoB();

    const result = spawnSync(
      "node",
      [
        BIN_PATH,
        "--base",
        "main",
        "--full-delta",
        "--churn-mode",
        "lines",
        "--top",
        "0",
      ],
      { cwd: tempDir, encoding: "utf-8" },
    );

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.churnMode).toBe("lines");
    expect(parsed).toHaveProperty("fullDelta");
    // No silent fallback to a filtered view — the worktree-based BASE
    // snapshot succeeded and the head-side analysis also used lines.
    expect(parsed.delta.fallback).toBeUndefined();
  });

  function setupReawakeningRepo(): void {
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

    // Backdated git commit helper. We can't rely on `git commit --date`
    // alone — it only sets the author date, the committer date defaults to
    // wall clock. The reawakening detector reads `--format=%ct` (committer
    // time), so we set both via env.
    const commitWithDate = (message: string, iso: string) => {
      const env = {
        ...process.env,
        GIT_AUTHOR_DATE: iso,
        GIT_COMMITTER_DATE: iso,
      };
      spawnSync("git", ["add", "."], { cwd: tempDir, stdio: "pipe", env });
      spawnSync("git", ["commit", "-m", message], {
        cwd: tempDir,
        stdio: "pipe",
        env,
      });
    };

    const now = Date.now();
    const daysAgoIso = (n: number): string =>
      new Date(now - n * 86400_000).toISOString();

    // legacy.ts: complex, committed 400d ago, then again today → dormant
    // for ~400d which is ≥ 270d (3× the default 90d window) → reawakened.
    writeFile(
      "legacy.ts",
      "export function legacy(x: number) {\n  if (x > 0) {\n    if (x > 10) {\n      if (x > 100) return 1;\n    }\n  }\n  return 0;\n}\n",
    );
    commitWithDate("ancient legacy", daysAgoIso(400));
    writeFile(
      "legacy.ts",
      "export function legacy(x: number) {\n  if (x > 0) {\n    if (x > 10) {\n      if (x > 100) {\n        if (x > 1000) return 2;\n      }\n    }\n  }\n  return 0;\n}\n",
    );
    commitWithDate("revive legacy", daysAgoIso(1));

    // active.ts: complex, touched continuously — not reawakened.
    writeFile(
      "active.ts",
      "export function active(x: number) {\n  if (x > 0) {\n    if (x > 10) return 1;\n  }\n  return 0;\n}\n",
    );
    commitWithDate("active v1", daysAgoIso(100));
    writeFile(
      "active.ts",
      "export function active(x: number) {\n  if (x > 0) {\n    if (x > 10) return 2;\n  }\n  return 0;\n}\n",
    );
    commitWithDate("active v2", daysAgoIso(2));
  }

  it("flags reawakened files in JSON output (GH#19)", {
    timeout: 30000,
  }, () => {
    setupReawakeningRepo();

    const result = spawnSync("node", [BIN_PATH, "--top", "0"], {
      cwd: tempDir,
      encoding: "utf-8",
    });

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.reawakened).toBeDefined();
    expect(parsed.reawakened.windowDays).toBe(90);
    expect(parsed.reawakened.minDormancyMultiple).toBe(3);
    expect(parsed.reawakened.minDormancyDays).toBe(270);
    const files = parsed.reawakened.entries.map(
      (e: { file: string }) => e.file,
    );
    expect(files).toContain("legacy.ts");
    expect(files).not.toContain("active.ts");
    const legacy = parsed.reawakened.entries.find(
      (e: { file: string }) => e.file === "legacy.ts",
    );
    expect(legacy.dormancyDays).toBeGreaterThanOrEqual(390);
    expect(legacy.dormancyMultiple).toBeGreaterThanOrEqual(4.3);
  });

  it("renders a Reawakened section in table format (GH#19)", {
    timeout: 30000,
  }, () => {
    setupReawakeningRepo();

    const result = spawnSync(
      "node",
      [BIN_PATH, "--format", "table", "--top", "0"],
      { cwd: tempDir, encoding: "utf-8" },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Reawakened");
    expect(result.stdout).toContain("legacy.ts");
  });

  it("omits reawakened section when no files qualify (GH#19)", {
    timeout: 30000,
  }, () => {
    setupDeltaRepoB();

    const result = spawnSync("node", [BIN_PATH, "--top", "0"], {
      cwd: tempDir,
      encoding: "utf-8",
    });

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.reawakened).toBeUndefined();
  });

  it("filters reawakened entries by --paths and omits when filter excludes all (GH#19, GH#12)", {
    timeout: 30000,
  }, () => {
    setupReawakeningRepo();

    // Filter to a path that DOESN'T include the reawakened file → section
    // is dropped (not rendered as an empty stub).
    const excluded = spawnSync(
      "node",
      [BIN_PATH, "--paths", "active.ts", "--top", "0"],
      { cwd: tempDir, encoding: "utf-8" },
    );
    expect(excluded.status).toBe(0);
    expect(JSON.parse(excluded.stdout).reawakened).toBeUndefined();

    // Filter to a path that DOES include the reawakened file → section
    // survives with just that entry.
    const kept = spawnSync(
      "node",
      [BIN_PATH, "--paths", "legacy.ts", "--top", "0"],
      { cwd: tempDir, encoding: "utf-8" },
    );
    expect(kept.status).toBe(0);
    const parsed = JSON.parse(kept.stdout);
    expect(parsed.reawakened).toBeDefined();
    expect(parsed.reawakened.entries).toHaveLength(1);
    expect(parsed.reawakened.entries[0].file).toBe("legacy.ts");
  });
});
