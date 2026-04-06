import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const PROJECT_ROOT = path.join(import.meta.dirname, "../..");
const BIN_PATH = path.join(PROJECT_ROOT, "dist", "cli.js");

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
  });

  it("should run CLI from packed tarball without crashing", {
    timeout: 60000,
  }, () => {
    // Pack the package to temp dir
    const packResult = spawnSync(
      "pnpm",
      ["pack", "--pack-gzip-level", "0", "--pack-destination", tempDir],
      { cwd: PROJECT_ROOT, stdio: "pipe" },
    );
    expect(packResult.status).toBe(0);

    // Find the tarball
    const files = fs.readdirSync(tempDir);
    const tarball = files.find((f) => f.endsWith(".tgz"));
    expect(tarball).toBeDefined();

    // Check tarball size — should be small (uncompressed ~20KB, allow up to 50KB)
    const stats = fs.statSync(path.join(tempDir, tarball!));
    const sizeKB = stats.size / 1024;
    expect(sizeKB).toBeLessThan(50);

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
      { cwd: packageDir, stdio: "pipe" },
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
  });

  it("should produce valid JSON output in a git repo", {
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
    expect(parsed).toHaveProperty("churnWindow", "3 months");
    expect(parsed).toHaveProperty("hotspots");
    expect(Array.isArray(parsed.hotspots)).toBe(true);
    expect(parsed.hotspots.length).toBeLessThanOrEqual(5);

    if (parsed.hotspots.length > 0) {
      const first = parsed.hotspots[0];
      expect(first).toHaveProperty("file");
      expect(first).toHaveProperty("complexity");
      expect(first).toHaveProperty("churn");
      expect(first).toHaveProperty("hotspotScore");
      expect(first).toHaveProperty("tier");
    }
  });

  it("should produce table output with --format table", {
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
  });

  it("should fail gracefully outside a git repo", () => {
    const result = spawnSync("node", [BIN_PATH], {
      timeout: 5000,
      stdio: "pipe",
      cwd: tempDir,
    });

    expect(result.status).not.toBe(0);
  });
});
