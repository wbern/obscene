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

      // Check tarball size — should be small (uncompressed ~30KB code + README).
      // README growth (field reports, expanded docs) is fine; binary bloat is not.
      const stats = fs.statSync(path.join(tempDir, tarball!));
      const sizeKB = stats.size / 1024;
      expect(sizeKB).toBeLessThan(75);

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
});
