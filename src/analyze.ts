import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import type {
  CompositeEntry,
  CompositeOutput,
  ConfidenceInfo,
  ConfidenceLevel,
  CouplingEntry,
  FileMetrics,
  RankingEntry,
  RankingOutput,
  SccLanguage,
  SkippedRanking,
  Tier,
} from "./types.js";

const IGNORE_FILES = [".obsignore", ".obsceneignore"];

/**
 * Read exclusion patterns from .obsignore or .obsceneignore file.
 * First file found wins. Returns empty array if neither exists.
 */
export function readIgnoreFile(): string[] {
  for (const name of IGNORE_FILES) {
    try {
      const content = readFileSync(name, "utf-8");
      return content
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "" && !line.startsWith("#"));
    } catch (err: unknown) {
      if (
        err &&
        typeof err === "object" &&
        "code" in err &&
        err.code === "ENOENT"
      ) {
        continue;
      }
      throw err;
    }
  }
  return [];
}

interface IgnorePattern {
  pattern: string;
  comment: string;
}

interface IgnoreGroup {
  title: string;
  patterns: IgnorePattern[];
}

/**
 * Universal exclusion patterns that were historically applied implicitly.
 * Now only written to .obsignore by `obscene init` — no longer auto-applied.
 */
export const UNIVERSAL_IGNORE_GROUPS: IgnoreGroup[] = [
  {
    title: "Test files and test infrastructure",
    patterns: [
      { pattern: "*.test.*", comment: "Unit test files" },
      { pattern: "*.spec.*", comment: "Spec test files" },
      { pattern: "*.integration.test.*", comment: "Integration tests" },
      { pattern: "test-setup.*", comment: "Test setup files" },
      { pattern: "test-utils.*", comment: "Test utility files" },
      { pattern: "test-helpers.*", comment: "Test helper files" },
      { pattern: "__tests__/**", comment: "Test directories" },
      { pattern: "__mocks__/**", comment: "Mock directories" },
      { pattern: "*.stories.*", comment: "Storybook stories" },
      { pattern: "*.d.ts", comment: "TypeScript declaration files" },
    ],
  },
  {
    title: "Lock files and package manifests",
    patterns: [
      { pattern: "package.json", comment: "npm package manifest" },
      { pattern: "package-lock.json", comment: "npm lock file" },
      { pattern: "pnpm-lock.yaml", comment: "pnpm lock file" },
      { pattern: "yarn.lock", comment: "Yarn lock file" },
      { pattern: "bun.lock", comment: "Bun lock file" },
    ],
  },
];

// Cumulative score tiers — based on share of total hotspot burden.
// hot: files that together account for the top 50% of total score.
// warm: next 30% (cumulative 50–80%).
// cool: bottom 20%.
const HOT_CUMULATIVE = 0.5;
const WARM_CUMULATIVE = 0.8;

const MIN_FIX_COMMITS = 5;
const MIN_FILES_WITH_FIXES = 3;

// Confidence thresholds per dimension. These are engineering defaults — the
// floors come from established tooling where one exists (code-maat), and the
// upper tiers are scaled from there. They are NOT prescribed by any specific
// paper; the "acceptable" tier is a deliberate ceiling that says only that the
// sample supports the ranking, never that the code itself is good or bad.
const CONFIDENCE = {
  complexity: { weak: 3, plausible: 10, acceptable: 30 },
  nesting: { weak: 3, plausible: 10, acceptable: 30 },
  defects: { weak: 5, plausible: 15, acceptable: 50 },
  authors: { weak: 2, plausible: 4, acceptable: 8 },
  coupling: { weak: 5, plausible: 30, acceptable: 100 },
} as const;

const CONFIDENCE_SOURCES = {
  complexity:
    "Engineering judgment: any rank ordering needs ≥ 3 items to be meaningful; higher tiers scale from there. No paper prescribes these exact cutoffs.",
  nesting:
    "Engineering judgment, informed by Campbell (SonarSource 2018) Cognitive Complexity which assigns a compounding penalty per nesting level. The 3/10/30 sample-count tiers are not from the paper.",
  defects:
    "code-maat's --min-revs default of 5 (Adam Tornhill); higher tiers are engineering judgment. Gall et al. (IWPSE 2003) and Hassan (ICSE 2009) study co-change and change-entropy but do not prescribe a specific commit-count floor.",
  authors:
    "Engineering judgment. Bird et al. (FSE 2011) Don't Touch My Code! shows minor contributors (< 5% of commits) correlate with elevated defects, motivating attention to contributor count — but the 2/4/8 tiers here are not from the paper.",
  coupling:
    "code-maat defaults (--min-revs 5, --max-changeset-size 30, Adam Tornhill). CodeScene's documented temporal-coupling default filters files with fewer than 10 commits. The 30/100 upper tiers are engineering judgment.",
  composite:
    "Reciprocal Rank Fusion (Cormack et al., SIGIR 2009) fuses multiple independent rankings; min-of-inputs is a strict monotone aggregator — when every input ranking is at confidence level L, the composite cannot exceed L.",
} as const;

function classifyConfidence(
  metric: string,
  value: number,
  thresholds: { weak: number; plausible: number; acceptable: number },
  source: string,
  reasonTemplate: (level: ConfidenceLevel) => string,
): ConfidenceInfo {
  let level: ConfidenceLevel;
  if (value < thresholds.weak) level = "inconclusive";
  else if (value < thresholds.plausible) level = "weak";
  else if (value < thresholds.acceptable) level = "plausible";
  else level = "acceptable";

  return {
    level,
    reason: reasonTemplate(level),
    inputs: { metric, value, thresholds },
    source,
  };
}

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
  const patterns = excludes.map(globToRegex);

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
    if (!author || author.endsWith("[bot]")) continue;
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

const MAX_FILES_PER_COMMIT = 20;

/**
 * Extract file co-change pairs from git history.
 * Returns a map of "file1\0file2" → count (canonical alphabetical order).
 * Excludes same-directory pairs and commits touching >20 files.
 */
export function getCoChanges(
  months: number,
  excludes: string[] = [],
): Map<string, number> {
  const patterns = excludes.map(globToRegex);

  let raw: Buffer;
  try {
    raw = execSync(
      `git log --since="${months} months ago" --format="COMMIT_SEP%n" --name-only`,
      { maxBuffer: 50 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] },
    );
  } catch {
    throw new Error("Not a git repository or git is not installed.");
  }

  const cochanges = new Map<string, number>();
  const commits = raw.toString().split("COMMIT_SEP\n");

  for (const commit of commits) {
    if (!commit.trim()) continue;

    const seen = new Set<string>();
    for (const line of commit.split("\n")) {
      const trimmed = normalizePath(line.trim());
      if (!trimmed) continue;
      if (!isExcluded(trimmed, patterns)) {
        seen.add(trimmed);
      }
    }

    const files = [...seen];
    if (files.length < 2 || files.length > MAX_FILES_PER_COMMIT) continue;

    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        const [a, b] =
          files[i] < files[j] ? [files[i], files[j]] : [files[j], files[i]];
        const dirA = a.includes("/") ? a.slice(0, a.lastIndexOf("/")) : "";
        const dirB = b.includes("/") ? b.slice(0, b.lastIndexOf("/")) : "";
        if (dirA === dirB) continue;

        const key = `${a}\0${b}`;
        cochanges.set(key, (cochanges.get(key) ?? 0) + 1);
      }
    }
  }

  return cochanges;
}

/**
 * Assign cumulative-distribution tiers to a sorted array of scored items.
 * Mutates the items in-place. Items must be sorted descending by score.
 */
export function assignTiers<
  T extends { score: number; percentOfTotal: number; tier: Tier },
>(items: T[], totalScore: number): void {
  let cumulative = 0;
  for (const item of items) {
    item.percentOfTotal = Math.round((item.score / totalScore) * 1000) / 10;
    cumulative += item.score;
    const cumulativeShare = cumulative / totalScore;

    if (cumulativeShare <= HOT_CUMULATIVE) {
      item.tier = "hot";
    } else if (cumulativeShare <= WARM_CUMULATIVE) {
      item.tier = "warm";
    } else {
      item.tier = "cool";
    }
  }
}

interface RankingDef {
  key: string;
  label: string;
  scoreFormula: string;
}

export const RANKING_DEFS: RankingDef[] = [
  {
    key: "complexity",
    label: "Complexity \u00D7 Churn",
    scoreFormula: "complexity \u00D7 churn",
  },
  {
    key: "nesting",
    label: "Nesting \u00D7 Churn",
    scoreFormula: "maxNesting \u00D7 churn",
  },
  {
    key: "defects",
    label: "Fix Activity \u00D7 Churn",
    scoreFormula: "fixes \u00D7 churn",
  },
  {
    key: "authors",
    label: "Authors \u00D7 Churn",
    scoreFormula: "authors \u00D7 churn",
  },
];

function computeRanking(
  files: FileMetrics[],
  churn: Map<string, number>,
  metricExtractor: (f: FileMetrics) => number,
  densityExtractor?: (f: FileMetrics) => number,
): RankingEntry[] {
  const scored = files
    .map((f) => {
      const fileChurn = churn.get(f.file) ?? 0;
      const metricValue = metricExtractor(f);
      return {
        file: f.file,
        score: metricValue * fileChurn,
        percentOfTotal: 0,
        tier: "cool" as Tier,
        churn: fileChurn,
        metricValue,
        metricDensity: densityExtractor ? densityExtractor(f) : undefined,
      };
    })
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score);

  const totalScore = scored.reduce((sum, e) => sum + e.score, 0);
  if (totalScore === 0) return [];

  assignTiers(scored, totalScore);
  return scored;
}

/**
 * Compute all four ranking tables from file metrics and git data.
 */
export function computeAllRankings(
  files: FileMetrics[],
  churn: Map<string, number>,
  defects: Map<string, number>,
  nestingDepths: Map<string, number>,
  authors: Map<string, number>,
  top: number,
): {
  rankings: Record<string, RankingOutput>;
  skipped: Record<string, SkippedRanking>;
} {
  const extractors: Record<
    string,
    {
      extract: (f: FileMetrics) => number;
      density?: (f: FileMetrics) => number;
    }
  > = {
    complexity: {
      extract: (f) => f.complexity,
      density: (f) => f.complexityDensity,
    },
    nesting: {
      // Drop files with zero cyclomatic complexity: their indentation is
      // structural (YAML, JSON, templates) rather than control flow, so a
      // deep maxNesting reading isn't a signal of branching difficulty.
      extract: (f) =>
        f.complexity === 0 ? 0 : (nestingDepths.get(f.file) ?? 0),
    },
    defects: {
      extract: (f) => defects.get(f.file) ?? 0,
      density: (f) => {
        const d = defects.get(f.file) ?? 0;
        return f.code > 0 ? Math.round((d / f.code) * 10000) / 10000 : 0;
      },
    },
    authors: {
      extract: (f) => authors.get(f.file) ?? 0,
    },
  };

  const skipped: Record<string, SkippedRanking> = {};
  const confidences: Record<string, ConfidenceInfo> = {};

  // Per-dimension confidence — see CONFIDENCE_SOURCES for citations.
  let filesWithComplexity = 0;
  for (const f of files) {
    if (f.complexity > 0) filesWithComplexity++;
  }
  confidences.complexity = classifyConfidence(
    "filesWithComplexity",
    filesWithComplexity,
    CONFIDENCE.complexity,
    CONFIDENCE_SOURCES.complexity,
    (level) =>
      level === "inconclusive"
        ? `${filesWithComplexity} files with measurable complexity — not enough to rank.`
        : `${filesWithComplexity} files with measurable complexity (${level.toUpperCase()} sample size).`,
  );

  // Only count files that will actually contribute to the ranking — files
  // with complexity 0 are dropped above (structural indentation rather than
  // control flow), so they shouldn't inflate the confidence sample either.
  let filesWithNesting = 0;
  for (const f of files) {
    if (f.complexity > 0 && (nestingDepths.get(f.file) ?? 0) >= 3) {
      filesWithNesting++;
    }
  }
  confidences.nesting = classifyConfidence(
    "filesWithNesting>=3",
    filesWithNesting,
    CONFIDENCE.nesting,
    CONFIDENCE_SOURCES.nesting,
    (level) =>
      level === "inconclusive"
        ? `${filesWithNesting} files with nesting depth ≥ 3 — not enough to rank.`
        : `${filesWithNesting} files with nesting depth ≥ 3 (${level.toUpperCase()} sample size).`,
  );

  const totalFixCommits = [...defects.values()].reduce((s, v) => s + v, 0);
  const filesWithFixes = defects.size;
  const defectsBelowFloor =
    totalFixCommits < MIN_FIX_COMMITS || filesWithFixes < MIN_FILES_WITH_FIXES;
  confidences.defects = classifyConfidence(
    "fixCommits",
    totalFixCommits,
    CONFIDENCE.defects,
    CONFIDENCE_SOURCES.defects,
    (level) => {
      if (level === "inconclusive" || defectsBelowFloor) {
        return `${totalFixCommits} fix: commits across ${filesWithFixes} files — need ≥ ${MIN_FIX_COMMITS} commits across ≥ ${MIN_FILES_WITH_FIXES} files (matches code-maat's --min-revs default).`;
      }
      return `${totalFixCommits} fix: commits across ${filesWithFixes} files (${level.toUpperCase()} sample size).`;
    },
  );
  if (defectsBelowFloor) {
    confidences.defects = {
      ...confidences.defects,
      level: "inconclusive",
    };
    skipped.defects = {
      reason: `insufficient data (${totalFixCommits} fix: commits across ${filesWithFixes} files, need ${MIN_FIX_COMMITS}+ commits across ${MIN_FILES_WITH_FIXES}+ files)`,
      suggestion:
        "Adopt conventional commits with fix: prefix. See conventionalcommits.org",
      confidence: confidences.defects,
    };
  }

  let maxAuthors = 0;
  for (const count of authors.values()) {
    if (count > maxAuthors) maxAuthors = count;
  }
  confidences.authors = classifyConfidence(
    "maxAuthors",
    maxAuthors,
    CONFIDENCE.authors,
    CONFIDENCE_SOURCES.authors,
    (level) =>
      level === "inconclusive"
        ? `${maxAuthors} distinct authors on the most-touched file — not enough to rank ownership.`
        : `${maxAuthors} distinct authors on the most-touched file (${level.toUpperCase()} sample size).`,
  );
  if (maxAuthors <= 1) {
    confidences.authors = { ...confidences.authors, level: "inconclusive" };
    skipped.authors = {
      reason: "all files have the same author count — no variance to rank",
      confidence: confidences.authors,
    };
  }

  const rankings: Record<string, RankingOutput> = {};

  for (const def of RANKING_DEFS) {
    if (skipped[def.key]) continue;
    if (confidences[def.key].level === "inconclusive") {
      skipped[def.key] = {
        reason: confidences[def.key].reason,
        confidence: confidences[def.key],
      };
      continue;
    }
    const ext = extractors[def.key];
    const allEntries = computeRanking(files, churn, ext.extract, ext.density);
    if (allEntries.length === 0) continue;

    const limited = top > 0 ? allEntries.slice(0, top) : allEntries;
    const tierCounts: Record<Tier, number> = {
      hot: 0,
      warm: 0,
      cool: 0,
    };
    for (const e of allEntries) {
      tierCounts[e.tier]++;
    }

    rankings[def.key] = {
      label: def.label,
      scoreFormula: def.scoreFormula,
      totalScore: allEntries.reduce((sum, e) => sum + e.score, 0),
      tierCounts,
      totalEntries: allEntries.length,
      showing: limited.length,
      entries: limited,
      confidence: confidences[def.key],
    };
  }

  return { rankings, skipped };
}

/**
 * List files currently tracked at HEAD. Used to flag coupling pairs whose
 * members no longer exist (renamed away, deleted) so they aren't presented as
 * actionable hotspots.
 */
export function getTrackedFiles(): Set<string> {
  let raw: Buffer;
  try {
    raw = execSync("git ls-files", {
      maxBuffer: 50 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    throw new Error("Not a git repository or git is not installed.");
  }
  const set = new Set<string>();
  for (const line of raw.toString().split("\n")) {
    const trimmed = normalizePath(line.trim());
    if (trimmed) set.add(trimmed);
  }
  return set;
}

/**
 * Score file pairs by co-change frequency and assign tiers.
 */
export function computeCoupling(
  cochanges: Map<string, number>,
  churn: Map<string, number>,
  complexityMap: Map<string, number>,
  minCochanges: number,
  trackedFiles?: Set<string>,
): CouplingEntry[] {
  const entries: CouplingEntry[] = [];

  for (const [key, count] of cochanges) {
    if (count < minCochanges) continue;
    const [file1, file2] = key.split("\0");
    const churn1 = churn.get(file1) ?? 0;
    const churn2 = churn.get(file2) ?? 0;
    const minChurn = Math.min(churn1, churn2);
    const degree =
      minChurn > 0 ? Math.round((count / minChurn) * 1000) / 10 : 0;
    const totalComplexity =
      (complexityMap.get(file1) ?? 0) + (complexityMap.get(file2) ?? 0);

    const entry: CouplingEntry = {
      file1,
      file2,
      cochanges: count,
      degree,
      totalComplexity,
      couplingScore: count,
      percentOfTotal: 0,
      tier: "cool",
    };
    // Near-lockstep: shared / max(churn) ≥ 0.9 means both files almost always
    // change together — typical of generator/mirror pairs (README ↔ src/README,
    // *.pb.go ↔ *.proto). Symmetric ratio rejects asymmetric dependents where
    // only one side is saturated.
    const maxChurn = Math.max(churn1, churn2);
    if (count > 0 && maxChurn > 0 && count / maxChurn >= 0.9) {
      entry.lockstep = true;
    }
    if (trackedFiles) {
      if (!trackedFiles.has(file1)) entry.file1Deleted = true;
      if (!trackedFiles.has(file2)) entry.file2Deleted = true;
    }
    entries.push(entry);
  }

  entries.sort((a, b) => b.couplingScore - a.couplingScore);

  const totalScore = entries.reduce((sum, e) => sum + e.couplingScore, 0);
  if (totalScore === 0) return [];

  // Adapt CouplingEntry to use assignTiers by mapping score field
  const adapted = entries.map((e) => ({
    ...e,
    score: e.couplingScore,
  }));
  assignTiers(adapted, totalScore);
  for (let i = 0; i < entries.length; i++) {
    entries[i].percentOfTotal = adapted[i].percentOfTotal;
    entries[i].tier = adapted[i].tier;
  }

  return entries;
}

/**
 * Measure deepest indentation level per file.
 * Language-agnostic: detects indent unit from the most common positive delta
 * between consecutive non-blank line indent widths. Using the mode rather than
 * the minimum avoids single-space outlier lines (continuation alignment,
 * multiline strings, embedded SQL/JSON) inflating depths by an order of
 * magnitude.
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

    const leadings: string[] = [];
    const deltaCounts = new Map<number, number>();
    let prevSpaceWidth = 0;
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      const match = line.match(/^(\s+)/);
      if (!match) {
        prevSpaceWidth = 0;
        continue;
      }
      const leading = match[1];
      leadings.push(leading);
      if (leading.includes("\t")) {
        continue;
      }
      const width = leading.length;
      const delta = width - prevSpaceWidth;
      if (delta > 0) {
        deltaCounts.set(delta, (deltaCounts.get(delta) ?? 0) + 1);
      }
      prevSpaceWidth = width;
    }

    let indentUnit = 4;
    let bestCount = 0;
    for (const [delta, count] of deltaCounts) {
      if (count > bestCount || (count === bestCount && delta < indentUnit)) {
        bestCount = count;
        indentUnit = delta;
      }
    }

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

const INIT_DIR_RULES: { dir: string; pattern: string; comment: string }[] = [
  {
    dir: ".github",
    pattern: ".github/**",
    comment: "GitHub Actions and workflows",
  },
  {
    dir: ".circleci",
    pattern: ".circleci/**",
    comment: "CircleCI configuration",
  },
  { dir: ".husky", pattern: ".husky/**", comment: "Git hooks" },
  { dir: ".vscode", pattern: ".vscode/**", comment: "VS Code settings" },
  { dir: ".idea", pattern: ".idea/**", comment: "JetBrains settings" },
  {
    dir: "scripts",
    pattern: "scripts/**",
    comment: "Build and utility scripts",
  },
  { dir: "docs", pattern: "docs/**", comment: "Documentation" },
  { dir: "docker", pattern: "docker/**", comment: "Docker configuration" },
  {
    dir: "fixtures",
    pattern: "fixtures/**",
    comment: "Test fixtures",
  },
  {
    dir: "vendor",
    pattern: "vendor/**",
    comment: "Vendored dependencies",
  },
];

const INIT_FILE_RULES: { test: RegExp; pattern: string; comment: string }[] = [
  {
    test: /\.generated\./,
    pattern: "*.generated.*",
    comment: "Generated code",
  },
  { test: /\.gen\.[^.]+$/, pattern: "*.gen.*", comment: "Generated code" },
  {
    test: /\.config\.\w/,
    pattern: "*.config.*",
    comment: "Configuration files",
  },
  {
    test: /(?:^|\/)\.gitlab-ci/,
    pattern: ".gitlab-ci*",
    comment: "GitLab CI configuration",
  },
  {
    test: /^\.claude\/commands\//,
    pattern: ".claude/commands/**",
    comment: "Claude Code slash commands (often generated from sources)",
  },
  {
    test: /^\.opencode\/commands\//,
    pattern: ".opencode/commands/**",
    comment: "OpenCode slash commands (often generated from sources)",
  },
  {
    test: /^\.cursor\/rules\//,
    pattern: ".cursor/rules/**",
    comment: "Cursor rules (often generated from sources)",
  },
];

/**
 * Scan the project's tracked files and detect common noise patterns
 * that should be excluded from hotspot analysis.
 */
export function detectIgnorePatterns(): IgnorePattern[] {
  const trackedFiles = getTrackedFiles();
  const patterns: IgnorePattern[] = [];

  const topDirs = new Set<string>();
  for (const f of trackedFiles) {
    const slash = f.indexOf("/");
    if (slash > 0) topDirs.add(f.slice(0, slash));
  }

  for (const rule of INIT_DIR_RULES) {
    if (topDirs.has(rule.dir)) {
      patterns.push({ pattern: rule.pattern, comment: rule.comment });
    }
  }

  for (const rule of INIT_FILE_RULES) {
    for (const f of trackedFiles) {
      if (rule.test.test(f)) {
        patterns.push({ pattern: rule.pattern, comment: rule.comment });
        break;
      }
    }
  }

  return patterns;
}

/**
 * Format detected patterns into .obsignore file content with comments.
 * Always renders universal groups first, then project-specific detected patterns.
 */
export function formatIgnoreFile(
  detectedPatterns: IgnorePattern[],
  universalGroups: IgnoreGroup[] = UNIVERSAL_IGNORE_GROUPS,
): string {
  const lines: string[] = [
    "# Generated by obscene init",
    "# Edit this file to customize which files are excluded from analysis.",
    "# Patterns use glob syntax (same as .gitignore).",
    "# See: https://github.com/wbern/obscene#ignore-files",
    "",
  ];

  for (const group of universalGroups) {
    lines.push(`# ${group.title}`);
    for (const p of group.patterns) {
      lines.push(p.pattern);
    }
    lines.push("");
  }

  if (detectedPatterns.length > 0) {
    lines.push("# Project-specific patterns");
    for (const p of detectedPatterns) {
      lines.push(`# ${p.comment}`);
      lines.push(p.pattern);
    }
    lines.push("");
  }

  return lines.join("\n");
}

const RRF_K = 10;

/**
 * Combine multiple rankings into a single composite list using
 * Reciprocal Rank Fusion (RRF). Each file's composite score is
 * the sum of 1/(k + rank) across all dimensions it appears in.
 */
const CONFIDENCE_ORDER: Record<ConfidenceLevel, number> = {
  inconclusive: 0,
  weak: 1,
  plausible: 2,
  acceptable: 3,
};

function compositeConfidence(
  inputs: Record<string, { confidence: ConfidenceInfo }>,
): ConfidenceInfo {
  const levels = Object.values(inputs).map((r) => r.confidence);
  const inputCount = levels.length;

  if (inputCount < 2) {
    return {
      level: "inconclusive",
      reason: `${inputCount} input ranking — RRF requires ≥ 2 independent rankings.`,
      inputs: {
        metric: "inputRankings",
        value: inputCount,
        thresholds: { weak: 2, plausible: 3, acceptable: 4 },
      },
      source: CONFIDENCE_SOURCES.composite,
    };
  }

  let minLevel: ConfidenceLevel = "acceptable";
  for (const c of levels) {
    if (CONFIDENCE_ORDER[c.level] < CONFIDENCE_ORDER[minLevel]) {
      minLevel = c.level;
    }
  }
  return {
    level: minLevel,
    reason: `Composite inherits min-of-inputs across ${inputCount} rankings (weakest: ${minLevel.toUpperCase()}).`,
    inputs: {
      metric: "inputRankings",
      value: inputCount,
      thresholds: { weak: 2, plausible: 3, acceptable: 4 },
    },
    source: CONFIDENCE_SOURCES.composite,
  };
}

export function computeComposite(
  rankings: Record<string, RankingOutput>,
  churn: Map<string, number>,
  top: number,
): CompositeOutput {
  const totalDimensions = Object.keys(rankings).length;
  const confidence = compositeConfidence(rankings);
  const fileScores = new Map<string, { score: number; dims: number }>();

  for (const ranking of Object.values(rankings)) {
    for (let i = 0; i < ranking.entries.length; i++) {
      const file = ranking.entries[i].file;
      const rrf = 1 / (RRF_K + i + 1);
      const existing = fileScores.get(file);
      if (existing) {
        existing.score += rrf;
        existing.dims += 1;
      } else {
        fileScores.set(file, { score: rrf, dims: 1 });
      }
    }
  }

  const entries: CompositeEntry[] = [];
  for (const [file, data] of fileScores) {
    entries.push({
      file,
      score: Math.round(data.score * 10000) / 10000,
      percentOfTotal: 0,
      tier: "cool",
      churn: churn.get(file) ?? 0,
      dimensionCount: data.dims,
    });
  }

  entries.sort((a, b) => b.score - a.score);

  const totalScore = entries.reduce((sum, e) => sum + e.score, 0);
  if (totalScore === 0) {
    return {
      label: "Combined",
      scoreFormula: "reciprocal rank fusion across all dimensions",
      totalScore: 0,
      tierCounts: { hot: 0, warm: 0, cool: 0 },
      totalDimensions,
      totalEntries: 0,
      showing: 0,
      entries: [],
      confidence,
    };
  }

  assignTiers(entries, totalScore);

  const limited = top > 0 ? entries.slice(0, top) : entries;
  const tierCounts: Record<Tier, number> = { hot: 0, warm: 0, cool: 0 };
  for (const e of entries) {
    tierCounts[e.tier]++;
  }

  return {
    label: "Combined",
    scoreFormula: "reciprocal rank fusion across all dimensions",
    totalScore: Math.round(totalScore * 10000) / 10000,
    tierCounts,
    totalDimensions,
    totalEntries: entries.length,
    showing: limited.length,
    entries: limited,
    confidence,
  };
}

/**
 * Confidence for a coupling analysis given the number of commits in the churn
 * window. The weak floor of 5 matches code-maat's --min-revs default; higher
 * tiers are engineering judgment.
 */
export function couplingConfidence(commitsInWindow: number): ConfidenceInfo {
  return classifyConfidence(
    "commitsInWindow",
    commitsInWindow,
    CONFIDENCE.coupling,
    CONFIDENCE_SOURCES.coupling,
    (level) =>
      level === "inconclusive"
        ? `${commitsInWindow} commits in window — need ≥ ${CONFIDENCE.coupling.weak} (matches code-maat's --min-revs default).`
        : `${commitsInWindow} commits in window (${level.toUpperCase()} sample size).`,
  );
}

/**
 * Count distinct commits in the churn window. Used by coupling analysis to
 * compute its confidence level.
 */
export function getCommitsInWindow(months: number): number {
  try {
    const out = execSync(
      `git rev-list --count --since="${months} months ago" HEAD`,
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    return parseInt(out.toString().trim(), 10) || 0;
  } catch {
    throw new Error("Not a git repository or git is not installed.");
  }
}
