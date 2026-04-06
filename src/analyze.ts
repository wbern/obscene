import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
 * Run a git log command that produces one file path per line and return counts.
 */
function gitFileCount(
  gitArgs: string,
  errorMessage: string,
): Map<string, number> {
  let raw: Buffer;
  try {
    raw = execSync(gitArgs, {
      maxBuffer: 50 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    throw new Error(errorMessage);
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
 * Count commits per file over a given time window via git log.
 */
export function getChurn(months: number): Map<string, number> {
  return gitFileCount(
    `git log --since="${months} months ago" --format="" --name-only`,
    "Not a git repository or git is not installed.",
  );
}

/**
 * Count fix commits (conventional commit `fix:` prefix) per file.
 */
export function getDefects(months: number): Map<string, number> {
  return gitFileCount(
    `git log --since="${months} months ago" --grep="^fix" --format="" --name-only`,
    "Not a git repository or git is not installed.",
  );
}

/**
 * Count unique git authors per file over a given time window.
 */
export function getAuthors(months: number): Map<string, number> {
  let raw: Buffer;
  try {
    raw = execSync(
      `git log --since="${months} months ago" --format="COMMIT_SEP%n%aN" --name-only`,
      { maxBuffer: 50 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] },
    );
  } catch {
    throw new Error("Not a git repository or git is not installed.");
  }

  const authorSets = new Map<string, Set<string>>();
  const blocks = raw.toString().split("COMMIT_SEP\n");

  for (const block of blocks) {
    if (!block.trim()) continue;
    const lines = block.split("\n");
    const author = lines[0].trim();
    if (!author) continue;
    for (let i = 1; i < lines.length; i++) {
      const file = normalizePath(lines[i].trim());
      if (!file) continue;
      let set = authorSets.get(file);
      if (!set) {
        set = new Set();
        authorSets.set(file, set);
      }
      set.add(author);
    }
  }

  const counts = new Map<string, number>();
  for (const [file, set] of authorSets) {
    counts.set(file, set.size);
  }
  return counts;
}

/**
 * Measure deepest indentation level per file.
 * Language-agnostic: detects indent unit from smallest non-zero leading space count.
 */
export function getNestingDepths(filePaths: string[]): Map<string, number> {
  const depths = new Map<string, number>();

  for (const filePath of filePaths) {
    let content: string;
    try {
      content = readFileSync(filePath, "utf-8");
    } catch {
      depths.set(filePath, 0);
      continue;
    }

    let minSpaces = Number.POSITIVE_INFINITY;
    const leadings: string[] = [];
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      const match = line.match(/^(\s+)/);
      if (!match) continue;
      const leading = match[1];
      leadings.push(leading);
      const spaceCount = (leading.match(/ /g) ?? []).length;
      if (spaceCount > 0 && !leading.includes("\t") && spaceCount < minSpaces) {
        minSpaces = spaceCount;
      }
    }

    const indentUnit = minSpaces === Number.POSITIVE_INFINITY ? 4 : minSpaces;
    let maxDepth = 0;
    for (const leading of leadings) {
      let depth = 0;
      for (const ch of leading) {
        if (ch === "\t") {
          depth += 1;
        } else if (ch === " ") {
          depth += 1 / indentUnit;
        }
      }
      depth = Math.floor(depth);
      if (depth > maxDepth) maxDepth = depth;
    }

    depths.set(filePath, maxDepth);
  }

  return depths;
}

/**
 * Score files by churn × complexity and assign cumulative-distribution tiers.
 */
export function computeHotspots(
  files: FileMetrics[],
  churn: Map<string, number>,
  defects: Map<string, number> = new Map(),
  nestingDepths: Map<string, number> = new Map(),
  authors: Map<string, number> = new Map(),
): HotspotEntry[] {
  const scored = files
    .map((f) => {
      const fileChurn = churn.get(f.file) ?? 0;
      const fileDefects = defects.get(f.file) ?? 0;
      return {
        ...f,
        churn: fileChurn,
        hotspotScore: f.complexity * fileChurn,
        defects: fileDefects,
        defectDensity:
          f.code > 0 ? Math.round((fileDefects / f.code) * 10000) / 10000 : 0,
        maxNesting: nestingDepths.get(f.file) ?? 0,
        authors: authors.get(f.file) ?? 0,
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
