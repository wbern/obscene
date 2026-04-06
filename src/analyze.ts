import { execSync } from "node:child_process";
import type { FileMetrics, HotspotEntry, SccLanguage, Tier } from "./types.js";

const DEFAULT_EXCLUDES = [
  /\.test\./,
  /\.spec\./,
  /\.integration\.test\./,
  /test-setup\./,
  /test-utils\./,
  /test-helpers\./,
  /__tests__\//,
  /__mocks__\//,
  /\.stories\./,
  /\.d\.ts$/,
];

// Cumulative score tiers — based on share of total hotspot burden.
// danger: files that together account for the top 50% of total score.
// watch: next 30% (cumulative 50–80%).
// stable: bottom 20%.
const DANGER_CUMULATIVE = 0.5;
const WATCH_CUMULATIVE = 0.8;

function isExcluded(location: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(location));
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "⟨GLOBSTAR⟩")
    .replace(/\*/g, "[^/]*")
    .replace(/⟨GLOBSTAR⟩/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(escaped);
}

/** Normalize paths: strip leading "./" and convert backslashes to forward slashes */
function normalizePath(p: string): string {
  const forwardSlash = p.replaceAll("\\", "/");
  return forwardSlash.startsWith("./") ? forwardSlash.slice(2) : forwardSlash;
}

/**
 * Run scc and parse per-file complexity metrics.
 * Requires scc to be installed: https://github.com/boyter/scc#install
 */
export function runScc(excludes: string[] = []): FileMetrics[] {
  const patterns = [...DEFAULT_EXCLUDES, ...excludes.map(globToRegex)];

  let raw: Buffer;
  try {
    raw = execSync("scc --by-file --format json --no-cocomo --no-gen", {
      maxBuffer: 50 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err: unknown) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      err.code === "ENOENT"
    ) {
      throw new Error(
        "scc not found. Install it: https://github.com/boyter/scc#install",
      );
    }
    throw err;
  }

  const languages: SccLanguage[] = JSON.parse(raw.toString());
  const files: FileMetrics[] = [];

  for (const lang of languages) {
    for (const f of lang.Files) {
      const normalized = normalizePath(f.Location);
      if (isExcluded(normalized, patterns)) continue;
      files.push({
        file: normalized,
        code: f.Code,
        lines: f.Lines,
        complexity: f.Complexity,
        comments: f.Comment,
        complexityDensity:
          f.Code > 0 ? Math.round((f.Complexity / f.Code) * 100) / 100 : 0,
      });
    }
  }

  return files.sort((a, b) => b.complexity - a.complexity);
}

/**
 * Count commits per file over a given time window via git log.
 */
export function getChurn(months: number): Map<string, number> {
  let raw: Buffer;
  try {
    raw = execSync(
      `git log --since="${months} months ago" --format="" --name-only`,
      { maxBuffer: 50 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] },
    );
  } catch {
    throw new Error("Not a git repository or git is not installed.");
  }

  const counts = new Map<string, number>();
  for (const line of raw.toString().split("\n")) {
    const trimmed = normalizePath(line.trim());
    if (!trimmed) continue;
    counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1);
  }
  return counts;
}

/**
 * Score files by churn × complexity and assign cumulative-distribution tiers.
 */
export function computeHotspots(
  files: FileMetrics[],
  churn: Map<string, number>,
): HotspotEntry[] {
  const scored = files
    .map((f) => {
      const fileChurn = churn.get(f.file) ?? 0;
      return {
        ...f,
        churn: fileChurn,
        hotspotScore: f.complexity * fileChurn,
      };
    })
    .filter((h) => h.hotspotScore > 0)
    .sort((a, b) => b.hotspotScore - a.hotspotScore);

  const totalScore = scored.reduce((sum, h) => sum + h.hotspotScore, 0);
  if (totalScore === 0) return [];

  let cumulative = 0;
  return scored.map((h) => {
    const percentOfTotal =
      Math.round((h.hotspotScore / totalScore) * 1000) / 10;
    cumulative += h.hotspotScore;
    const cumulativeShare = cumulative / totalScore;

    let tier: Tier;
    if (cumulativeShare <= DANGER_CUMULATIVE) {
      tier = "danger";
    } else if (cumulativeShare <= WATCH_CUMULATIVE) {
      tier = "watch";
    } else {
      tier = "stable";
    }

    return { ...h, percentOfTotal, tier };
  });
}
