import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const PROJECT_ROOT = path.join(import.meta.dirname, "../..");
const BIN_PATH = path.join(PROJECT_ROOT, "dist", "cli.js");

const hasPwsh = spawnSync("pwsh", ["-Version"], { stdio: "pipe" }).status === 0;

/** Escape a path for use inside PowerShell single quotes (double any single quotes) */
function pwshQuote(p: string): string {
  return `'${p.replaceAll("'", "''")}'`;
}

describe.skipIf(!hasPwsh)("CLI PowerShell", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "obscene-pwsh-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should output version via pwsh", () => {
    const result = spawnSync(
      "pwsh",
      ["-NoProfile", "-Command", `node ${pwshQuote(BIN_PATH)} --version`],
      { timeout: 10000, stdio: "pipe" },
    );

    expect(result.status).toBe(0);
    expect(result.stdout.toString().trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("should output help via pwsh", () => {
    const result = spawnSync(
      "pwsh",
      ["-NoProfile", "-Command", `node ${pwshQuote(BIN_PATH)} --help`],
      { timeout: 10000, stdio: "pipe" },
    );

    expect(result.status).toBe(0);
    const stdout = result.stdout.toString();
    expect(stdout).toContain("obscene");
    expect(stdout).toContain("hotspots");
    expect(stdout).toContain("report");
  });

  it("should produce valid JSON output via pwsh", { timeout: 30000 }, () => {
    const result = spawnSync(
      "pwsh",
      ["-NoProfile", "-Command", `node ${pwshQuote(BIN_PATH)} --top 3`],
      { timeout: 30000, stdio: "pipe", cwd: PROJECT_ROOT },
    );

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout.toString());
    expect(parsed).toHaveProperty("hotspots");
    expect(Array.isArray(parsed.hotspots)).toBe(true);
  });

  it("should produce table output via pwsh", { timeout: 30000 }, () => {
    const result = spawnSync(
      "pwsh",
      [
        "-NoProfile",
        "-Command",
        `node ${pwshQuote(BIN_PATH)} --format table --top 3`,
      ],
      { timeout: 30000, stdio: "pipe", cwd: PROJECT_ROOT },
    );

    expect(result.status).toBe(0);
    const stdout = result.stdout.toString();
    expect(stdout).toContain("Hotspots");
    expect(stdout).toContain("Score");
  });

  it("should fail gracefully outside a git repo via pwsh", () => {
    const result = spawnSync(
      "pwsh",
      ["-NoProfile", "-Command", `node ${pwshQuote(BIN_PATH)}`],
      { timeout: 10000, stdio: "pipe", cwd: tempDir },
    );

    expect(result.status).not.toBe(0);
  });

  it("should handle paths with spaces via pwsh", () => {
    const dirWithSpaces = path.join(tempDir, "path with spaces");
    fs.mkdirSync(dirWithSpaces);

    const result = spawnSync(
      "pwsh",
      ["-NoProfile", "-Command", `node ${pwshQuote(BIN_PATH)} --version`],
      { timeout: 10000, stdio: "pipe", cwd: dirWithSpaces },
    );

    expect(result.status).toBe(0);
    expect(result.stdout.toString().trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
