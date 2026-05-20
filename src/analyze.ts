import { execSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ComplexityDelta,
  CompositeEntry,
  CompositeOutput,
  ConfidenceInfo,
  ConfidenceLevel,
  CorrelationEntry,
  CorrelationsOutput,
  CouplingEntry,
  FileMetrics,
  HistoryCoverageInfo,
  HotspotDelta,
  HotspotSnapshot,
  RankingEntry,
  RankingOutput,
  SccLanguage,
  ScoreChange,
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
  correlations: { weak: 5, plausible: 15, acceptable: 30 },
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
  correlations:
    "Spearman (1904) defines the rank correlation coefficient; no paper prescribes the sample-size tiers used here. Engineering judgment: below 5 paired observations the coefficient is too noisy to interpret; tiers scale from there.",
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
export function runScc(excludes: string[] = [], cwd?: string): FileMetrics[] {
  const patterns = excludes.map(globToRegex);

  let raw: Buffer;
  try {
    raw = execSync("scc --by-file --format json --no-cocomo --no-gen", {
      maxBuffer: 50 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
      cwd,
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
  cwd?: string,
): Map<string, number> {
  let raw: Buffer;
  try {
    raw = execSync(gitArgs, {
      maxBuffer: 50 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
      cwd,
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
 * Count commits per file over a given time window via git log. When `cwd`
 * is provided, runs git in that directory (used by Mode C to operate
 * against a base-ref worktree).
 */
export function getChurn(months: number, cwd?: string): Map<string, number> {
  return gitFileCount(
    `git log --since="${months} months ago" --format="" --name-only`,
    "Not a git repository or git is not installed.",
    cwd,
  );
}

/**
 * Count fix commits (conventional commit `fix:` prefix) per file.
 */
export function getDefects(months: number, cwd?: string): Map<string, number> {
  return gitFileCount(
    `git log --since="${months} months ago" --grep="^fix" --format="" --name-only`,
    "Not a git repository or git is not installed.",
    cwd,
  );
}

/**
 * Parse the first line of a git-log block into a list of distinct human
 * author names. The format produced by getAuthorCommitCounts is
 * `<primary>\t<coauthor1>\t<coauthor2>...` where each coauthor is the raw
 * "Name <email>" value from a Co-authored-by trailer. When no trailers
 * exist the line is just `<primary>` (no tab) — older callers and the
 * legacy git-log format still pass that shape, so the parser remains
 * backwards-compatible.
 */
function parseAuthorsLine(line: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of line.split("\t")) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    // Co-authored-by trailer values look like "Name <email>"; strip the
    // email so we match against names equivalently to %aN. Primary
    // authors have no angle-bracket suffix and pass through unchanged.
    const match = trimmed.match(/^(.+?)\s*<[^>]+>\s*$/);
    const name = (match ? match[1] : trimmed).trim();
    if (!name || name.endsWith("[bot]")) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/**
 * Per-file, per-author commit counts over a churn window.
 * Folds Co-authored-by trailers into the author set so squash-merge
 * workflows (which collapse the named PR authors into a single committer)
 * don't appear as solo-author files. Bot authors (`[bot]` suffix) are
 * filtered out.
 *
 * Used directly to compute MinAuth (count of <5% minor contributors per
 * file, Bird et al. FSE 2011). Set size of the inner map is the
 * underlying signal for the Authors × Churn ranking.
 */
export function getAuthorCommitCounts(
  months: number,
  cwd?: string,
): Map<string, Map<string, number>> {
  let raw: Buffer;
  try {
    raw = execSync(
      `git log --since="${months} months ago" --format="COMMIT_SEP%n%aN%x09%(trailers:key=Co-authored-by,valueonly,separator=%x09)" --name-only`,
      {
        maxBuffer: 50 * 1024 * 1024,
        stdio: ["pipe", "pipe", "pipe"],
        cwd,
      },
    );
  } catch {
    throw new Error("Not a git repository or git is not installed.");
  }

  const fileAuthors = new Map<string, Map<string, number>>();
  const blocks = raw.toString().split("COMMIT_SEP\n");

  for (const block of blocks) {
    if (!block.trim()) continue;
    const lines = block.split("\n");
    const authors = parseAuthorsLine(lines[0]);
    if (authors.length === 0) continue;
    for (let i = 1; i < lines.length; i++) {
      const file = normalizePath(lines[i].trim());
      if (!file) continue;
      let counts = fileAuthors.get(file);
      if (!counts) {
        counts = new Map();
        fileAuthors.set(file, counts);
      }
      for (const author of authors) {
        counts.set(author, (counts.get(author) ?? 0) + 1);
      }
    }
  }

  return fileAuthors;
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
  cwd?: string,
): Map<string, number> {
  const patterns = excludes.map(globToRegex);

  let raw: Buffer;
  try {
    raw = execSync(
      `git log --since="${months} months ago" --format="COMMIT_SEP%n" --name-only`,
      {
        maxBuffer: 50 * 1024 * 1024,
        stdio: ["pipe", "pipe", "pipe"],
        cwd,
      },
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
// Minor-contributor cutoff from Bird et al. (FSE 2011, "Don't Touch My Code!"):
// a contributor with fewer than 5% of a file's commits correlates with elevated
// post-release defects after controlling for size, churn, and complexity.
// Recent OSS replication (arXiv:2312.10861, 2023) found 10% more stable than
// 5% as a binary cutoff; we keep 5% as the canonical value and reserve a
// ladder of cutoffs for a future side-by-side comparison.
const MINOR_AUTHOR_CUTOFF = 0.05;
// Greiler et al. (MSR 2015) file-level replication: minor-contributor counts
// are skewed (p90 = 1-3 across 6 Microsoft products). Below 2 commits we have
// no way to say a contributor is *minor* vs *the only one* — emit null and
// render as "—" in the table so we don't fabricate signal on thin slices.
const MIN_COMMITS_FOR_MINOR_AUTHORS = 2;

function computeMinorAuthors(
  perAuthor: Map<string, number> | undefined,
): number | null {
  if (!perAuthor || perAuthor.size === 0) return null;
  let totalCommits = 0;
  for (const c of perAuthor.values()) totalCommits += c;
  if (totalCommits < MIN_COMMITS_FOR_MINOR_AUTHORS) return null;
  const cutoff = totalCommits * MINOR_AUTHOR_CUTOFF;
  let minor = 0;
  for (const c of perAuthor.values()) {
    if (c < cutoff) minor++;
  }
  return minor;
}

/**
 * Reference ranking that the correlation report compares every other ranking
 * against. Fix Activity × Churn is the closest obscene has to a ground-truth
 * defect signal — Spearman ρ against it tells the user, for this repo, how
 * well each metric ranking lines up with fix activity. See the README's
 * "Correlations" section for the framing.
 */
const CORRELATION_REFERENCE_KEY = "defects";

/**
 * Assign average ranks to a list of values. Ties share the average of the
 * positions they would occupy if broken arbitrarily — the standard
 * tie-handling rule for Spearman ρ. Returns ranks aligned to the input order.
 */
function rankValues(values: number[]): number[] {
  const indexed = values.map((value, index) => ({ value, index }));
  indexed.sort((a, b) => b.value - a.value);
  const ranks = new Array(values.length).fill(0);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j < indexed.length && indexed[j].value === indexed[i].value) j++;
    const avg = (i + j - 1) / 2 + 1;
    for (let k = i; k < j; k++) ranks[indexed[k].index] = avg;
    i = j;
  }
  return ranks;
}

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
  }
  const mx = sx / n;
  const my = sy / n;
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  // denom = 0 means every paired observation has the same score on at least
  // one side (no variance to correlate). Treat as ρ = 0 — the rank pairs
  // carry no directional information.
  return denom === 0 ? 0 : num / denom;
}

/**
 * Spearman rank correlation between two score maps. Only files present in
 * both maps contribute. Returns `n = 0` when there is no overlap and `rho = 0`
 * when N < 2 (no correlation is defined on a single point).
 */
export function spearmanRho(
  a: Map<string, number>,
  b: Map<string, number>,
): { rho: number; n: number } {
  const common: string[] = [];
  for (const f of a.keys()) {
    if (b.has(f)) common.push(f);
  }
  if (common.length < 2) return { rho: 0, n: common.length };
  const aValues = common.map((f) => a.get(f) as number);
  const bValues = common.map((f) => b.get(f) as number);
  const aRanks = rankValues(aValues);
  const bRanks = rankValues(bValues);
  return { rho: pearson(aRanks, bRanks), n: common.length };
}

/**
 * Compare each non-reference ranking against the Fix Activity × Churn
 * (`defects`) ranking via Spearman ρ. Operates on the unsliced ranking
 * entries so the result doesn't depend on the user's `--top`. Returns
 * `undefined` when the reference ranking is unavailable — the caller marks
 * the skip in the existing `skipped` map.
 */
export function computeCorrelations(
  allEntriesByKey: Record<string, RankingEntry[]>,
): CorrelationsOutput | undefined {
  const refEntries = allEntriesByKey[CORRELATION_REFERENCE_KEY];
  if (!refEntries || refEntries.length === 0) return undefined;
  // CORRELATION_REFERENCE_KEY is wired to a fixed RANKING_DEFS entry; the
  // lookup is total by construction. If RANKING_DEFS loses 'defects', the
  // whole defects pipeline above breaks long before this line.
  const referenceLabel = RANKING_DEFS.find(
    (d) => d.key === CORRELATION_REFERENCE_KEY,
  )!.label;
  const refScores = new Map<string, number>();
  for (const e of refEntries) refScores.set(e.file, e.score);

  const entries: CorrelationEntry[] = [];
  for (const def of RANKING_DEFS) {
    if (def.key === CORRELATION_REFERENCE_KEY) continue;
    const other = allEntriesByKey[def.key];
    if (!other || other.length === 0) continue;
    const otherScores = new Map<string, number>();
    for (const e of other) otherScores.set(e.file, e.score);
    const { rho, n } = spearmanRho(refScores, otherScores);
    const confidence = classifyConfidence(
      "commonFiles",
      n,
      CONFIDENCE.correlations,
      CONFIDENCE_SOURCES.correlations,
      (level) =>
        level === "inconclusive"
          ? `${n} file${n === 1 ? "" : "s"} in both rankings — need ≥ ${CONFIDENCE.correlations.weak} for a meaningful coefficient.`
          : `${n} files in both rankings (${level.toUpperCase()} sample size).`,
    );
    entries.push({
      metric: def.key,
      label: def.label,
      rho: Math.round(rho * 10000) / 10000,
      n,
      confidence,
    });
  }

  return {
    reference: CORRELATION_REFERENCE_KEY,
    referenceLabel,
    entries,
  };
}

export function computeAllRankings(
  files: FileMetrics[],
  churn: Map<string, number>,
  defects: Map<string, number>,
  nestingDepths: Map<string, number>,
  authors: Map<string, number>,
  top: number,
  authorCommitCounts?: Map<string, Map<string, number>>,
): {
  rankings: Record<string, RankingOutput>;
  skipped: Record<string, SkippedRanking>;
  correlations?: CorrelationsOutput;
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
  const allEntriesByKey: Record<string, RankingEntry[]> = {};

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

    if (def.key === "authors" && authorCommitCounts) {
      for (const entry of allEntries) {
        entry.minorAuthors = computeMinorAuthors(
          authorCommitCounts.get(entry.file),
        );
      }
    }

    allEntriesByKey[def.key] = allEntries;

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

  let correlations: CorrelationsOutput | undefined;
  if (skipped[CORRELATION_REFERENCE_KEY]) {
    // Same SkippedRanking shape as the existing skipped rankings, so format.ts
    // can render the entry through the same path. The confidence stamp is
    // INCONCLUSIVE because there is literally no reference ranking to
    // correlate against.
    const refLabel = RANKING_DEFS.find(
      (d) => d.key === CORRELATION_REFERENCE_KEY,
    )!.label;
    skipped.correlations = {
      reason: `${refLabel} unavailable — no reference ranking to correlate against`,
      confidence: {
        level: "inconclusive",
        reason: "no reference ranking",
        inputs: {
          metric: "commonFiles",
          value: 0,
          thresholds: CONFIDENCE.correlations,
        },
        source: CONFIDENCE_SOURCES.correlations,
      },
    };
  } else {
    correlations = computeCorrelations(allEntriesByKey);
  }

  return { rankings, skipped, correlations };
}

/**
 * Files changed between baseRef and HEAD using three-dot syntax —
 * `<base>...HEAD` resolves to the set of files modified on HEAD since the
 * merge-base with base. That matches PR semantics: a PR's diff is the work
 * done on the branch, not changes that happened on the base branch since
 * divergence.
 */
export function getChangedFiles(baseRef: string): Set<string> {
  let raw: Buffer;
  try {
    raw = execSync(`git diff --name-only ${baseRef}...HEAD`, {
      maxBuffer: 50 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    throw new Error(
      `Failed to compute diff against base ref '${baseRef}'. ` +
        "Verify the ref exists (e.g. 'git rev-parse --verify <ref>').",
    );
  }
  const set = new Set<string>();
  for (const line of raw.toString().split("\n")) {
    const trimmed = normalizePath(line.trim());
    if (trimmed) set.add(trimmed);
  }
  return set;
}

const DEFAULT_BRANCH_CANDIDATES = ["main", "master"];

/**
 * Locate the local default branch when the user invokes `--base` without
 * specifying a ref. Tries `main` then `master`. Returns undefined when
 * neither exists — the caller surfaces a usage error.
 */
export function detectDefaultBranch(): string | undefined {
  for (const candidate of DEFAULT_BRANCH_CANDIDATES) {
    try {
      execSync(`git rev-parse --verify ${candidate}`, {
        stdio: ["pipe", "pipe", "pipe"],
      });
      return candidate;
    } catch {}
  }
  return undefined;
}

/**
 * Run scc on a specific list of files inside `cwd`. Returns metrics keyed by
 * the file path relative to cwd. Files that don't exist at `cwd` are skipped
 * — useful when computing the base side of a delta, where files new in HEAD
 * are absent from the base worktree.
 */
export function runSccOnFiles(
  cwd: string,
  files: string[],
): Map<string, FileMetrics> {
  const result = new Map<string, FileMetrics>();
  if (files.length === 0) return result;

  const existing = files.filter((f) => existsSync(join(cwd, f)));
  if (existing.length === 0) return result;

  const proc = spawnSync(
    "scc",
    ["--by-file", "--format", "json", "--no-cocomo", "--no-gen", ...existing],
    { cwd, maxBuffer: 50 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] },
  );
  if (proc.error && "code" in proc.error && proc.error.code === "ENOENT") {
    throw new Error(
      "scc not found. Install it: https://github.com/boyter/scc#install",
    );
  }
  if (proc.error) {
    throw new Error(`scc spawn failed: ${proc.error.message}`);
  }
  if (proc.status !== 0) {
    throw new Error(
      `scc failed on base worktree: ${proc.stderr?.toString().trim() || "unknown error"}`,
    );
  }
  const languages: SccLanguage[] = JSON.parse(proc.stdout.toString());
  for (const lang of languages) {
    for (const f of lang.Files) {
      const normalized = normalizePath(f.Location);
      result.set(normalized, {
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
  return result;
}

/**
 * Allocate a detached git worktree at `ref` in a temp directory, run `fn`
 * against the worktree path, and always tear the worktree down on the way
 * out. Throws if the ref can't be checked out.
 */
export function withWorktreeAt<T>(ref: string, fn: (path: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "obscene-base-"));
  // Strip GIT_* env vars inherited from a parent git hook (pre-commit,
  // post-checkout, etc.) — they redirect git at the parent repo and break
  // worktree creation in the caller's cwd.
  const gitEnv = { ...process.env };
  for (const key of Object.keys(gitEnv)) {
    if (key.startsWith("GIT_")) delete gitEnv[key];
  }
  const add = spawnSync("git", ["worktree", "add", "--detach", dir, ref], {
    stdio: ["pipe", "pipe", "pipe"],
    env: gitEnv,
  });
  if (add.status !== 0) {
    rmSync(dir, { recursive: true, force: true });
    const detail = add.stderr?.toString().trim();
    throw new Error(
      `Could not create worktree at '${ref}'${detail ? `: ${detail}` : ""}. ` +
        "Verify the ref exists (e.g. 'git rev-parse --verify <ref>').",
    );
  }
  try {
    return fn(dir);
  } finally {
    const remove = spawnSync("git", ["worktree", "remove", "--force", dir], {
      stdio: ["pipe", "pipe", "pipe"],
      env: gitEnv,
    });
    if (remove.status !== 0) {
      // Worktree may already be gone or git failed; force-remove the dir to
      // avoid leaving a stale tree on disk. The next worktree-prune will
      // sweep the metadata.
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

/**
 * Compute per-file complexity deltas between `baseRef` and HEAD for the given
 * file set. Files absent at base are reported with `oldComplexity: null`.
 *
 * `newMetrics` maps file → current FileMetrics (already on hand from the HEAD
 * scc run). Mode B doesn't re-run scc on HEAD; the caller passes what they
 * already have.
 */
export function getComplexityDeltas(
  baseRef: string,
  files: string[],
  newMetrics: Map<string, number>,
): Map<string, ComplexityDelta> {
  const deltas = new Map<string, ComplexityDelta>();
  if (files.length === 0) return deltas;

  const baseMetrics = withWorktreeAt(baseRef, (path) =>
    runSccOnFiles(path, files),
  );

  for (const file of files) {
    const newComplexity = newMetrics.get(file);
    if (newComplexity === undefined) continue;
    const old = baseMetrics.get(file);
    if (old === undefined) {
      deltas.set(file, {
        oldComplexity: null,
        newComplexity,
        change: null,
      });
    } else {
      deltas.set(file, {
        oldComplexity: old.complexity,
        newComplexity,
        change: newComplexity - old.complexity,
      });
    }
  }

  return deltas;
}

/**
 * List files currently tracked at HEAD. Used to flag coupling pairs whose
 * members no longer exist (renamed away, deleted) so they aren't presented as
 * actionable hotspots.
 */
export function getTrackedFiles(cwd?: string): Set<string> {
  let raw: Buffer;
  try {
    raw = execSync("git ls-files", {
      maxBuffer: 50 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
      cwd,
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
export function getNestingDepths(
  filePaths: string[],
  cwd?: string,
): Map<string, number> {
  const depths = new Map<string, number>();

  for (const filePath of filePaths) {
    let content: string;
    try {
      content = readFileSync(cwd ? join(cwd, filePath) : filePath, "utf-8");
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
 * Build the rankings + composite + corpus for a given file set. Extracted
 * from runHotspots so Mode C can call it twice (HEAD and base worktree)
 * with the same logic.
 */
export function computeHotspotsCore(
  files: FileMetrics[],
  months: number,
  top: number,
  cwd?: string,
): {
  rankings: Record<string, RankingOutput>;
  skipped: Record<string, SkippedRanking>;
  composite: CompositeOutput;
  correlations?: CorrelationsOutput;
  corpus: { fileCount: number; totalComplexity: number };
  churn: Map<string, number>;
} {
  const churn = getChurn(months, cwd);
  const defects = getDefects(months, cwd);
  const authorCommitCounts = getAuthorCommitCounts(months, cwd);
  const authors = new Map<string, number>();
  for (const [file, perAuthor] of authorCommitCounts) {
    authors.set(file, perAuthor.size);
  }
  const nestingDepths = getNestingDepths(
    files.map((f) => f.file),
    cwd,
  );
  const { rankings, skipped, correlations } = computeAllRankings(
    files,
    churn,
    defects,
    nestingDepths,
    authors,
    top,
    authorCommitCounts,
  );
  const composite = computeComposite(rankings, churn, top);
  let totalComplexity = 0;
  for (const f of files) totalComplexity += f.complexity;
  return {
    rankings,
    skipped,
    composite,
    correlations,
    corpus: { fileCount: files.length, totalComplexity },
    churn,
  };
}

/**
 * Trim a `computeHotspotsCore(..., top=0)` result down to a top-N slice for
 * display. Mode C runs the head pipeline at top=0 (so the snapshot diff sees
 * the whole corpus), then reuses that result here instead of paying a second
 * git-log pass for display.
 *
 * Invariant: `sliceCoreForDisplay(computeHotspotsCore(files, months, 0), N)`
 * is observationally equivalent to `computeHotspotsCore(files, months, N)` —
 * if that diverges, mode C's display rankings will drift from modes A/B.
 */
export function sliceCoreForDisplay(
  core: ReturnType<typeof computeHotspotsCore>,
  top: number,
): ReturnType<typeof computeHotspotsCore> {
  if (top <= 0) return core;
  const rankings: typeof core.rankings = {};
  for (const [k, r] of Object.entries(core.rankings)) {
    const sliced = r.entries.slice(0, top);
    rankings[k] = { ...r, entries: sliced, showing: sliced.length };
  }
  const compositeSliced = core.composite.entries.slice(0, top);
  return {
    rankings,
    skipped: core.skipped,
    composite: {
      ...core.composite,
      entries: compositeSliced,
      showing: compositeSliced.length,
    },
    correlations: core.correlations,
    corpus: core.corpus,
    churn: core.churn,
  };
}

/**
 * Run the full snapshot pipeline (scc + git history + ranking) against a
 * single working tree. Mode C runs this twice — once at HEAD, once inside
 * a detached worktree at the base ref — and passes both to `computeDelta`.
 *
 * `top` is set to 0 here so the snapshot keeps every file; the diff is
 * computed against the full corpus and the CLI applies its own `top` cap
 * to the resulting score-change list.
 */
export function computeSnapshot(opts: {
  months: number;
  excludes: string[];
  cwd?: string;
}): HotspotSnapshot {
  const files = runScc(opts.excludes, opts.cwd);
  const core = computeHotspotsCore(files, opts.months, 0, opts.cwd);
  return {
    files,
    rankings: core.rankings,
    skipped: core.skipped,
    composite: core.composite,
    corpus: core.corpus,
  };
}

/**
 * Compare two HotspotSnapshot results and produce a structured diff. Tier
 * transitions are computed on the relative (percentile) tiers carried by
 * each snapshot — see the HotspotDelta doc and the README for the
 * relativity caveat. `scoreChanges` carries absolute deltas so callers can
 * disambiguate "file got worse" from "rest of corpus got better".
 */
export function computeDelta(
  base: string,
  head: string,
  baseSnapshot: HotspotSnapshot,
  headSnapshot: HotspotSnapshot,
): HotspotDelta {
  const baseEntries = new Map<string, { score: number; tier: Tier }>();
  for (const e of baseSnapshot.composite.entries) {
    baseEntries.set(e.file, { score: e.score, tier: e.tier });
  }
  const headEntries = new Map<string, { score: number; tier: Tier }>();
  for (const e of headSnapshot.composite.entries) {
    headEntries.set(e.file, { score: e.score, tier: e.tier });
  }

  const baseFiles = new Set(baseSnapshot.files.map((f) => f.file));
  const headFiles = new Set(headSnapshot.files.map((f) => f.file));

  const newFiles: string[] = [];
  const deletedFiles: string[] = [];
  for (const f of headFiles) {
    if (!baseFiles.has(f)) newFiles.push(f);
  }
  for (const f of baseFiles) {
    if (!headFiles.has(f)) deletedFiles.push(f);
  }
  newFiles.sort();
  deletedFiles.sort();

  const allFiles = new Set<string>([
    ...baseEntries.keys(),
    ...headEntries.keys(),
  ]);
  const scoreChanges: ScoreChange[] = [];
  const enteredHot: string[] = [];
  const enteredWarm: string[] = [];
  const exitedHot: string[] = [];
  const exitedWarm: string[] = [];

  for (const file of allFiles) {
    const before = baseEntries.get(file);
    const after = headEntries.get(file);
    const oldScore = before?.score ?? null;
    const newScore = after?.score ?? null;
    const oldTier = before?.tier ?? null;
    const newTier = after?.tier ?? null;
    const change =
      oldScore !== null && newScore !== null ? newScore - oldScore : null;
    const percentChange =
      change !== null && oldScore !== null && oldScore !== 0
        ? Math.round((change / oldScore) * 1000) / 10
        : null;

    let transition: ScoreChange["transition"];
    if (oldTier === null) transition = "new";
    else if (newTier === null) transition = "deleted";
    else if (oldTier !== "hot" && newTier === "hot") transition = "entered-hot";
    else if (oldTier === "cool" && newTier === "warm")
      transition = "entered-warm";
    else if (oldTier === "hot" && newTier !== "hot") transition = "exited-hot";
    else if (oldTier === "warm" && newTier === "cool")
      transition = "exited-warm";
    else transition = "stable";

    if (transition === "entered-hot") enteredHot.push(file);
    else if (transition === "entered-warm") enteredWarm.push(file);
    else if (transition === "exited-hot") exitedHot.push(file);
    else if (transition === "exited-warm") exitedWarm.push(file);

    scoreChanges.push({
      file,
      oldScore,
      newScore,
      change: change !== null ? Math.round(change * 10000) / 10000 : null,
      percentChange,
      oldTier,
      newTier,
      transition,
    });
  }

  scoreChanges.sort((a, b) => {
    const aMag = Math.abs(a.change ?? 0);
    const bMag = Math.abs(b.change ?? 0);
    if (aMag !== bMag) return bMag - aMag;
    return a.file.localeCompare(b.file);
  });
  enteredHot.sort();
  enteredWarm.sort();
  exitedHot.sort();
  exitedWarm.sort();

  return {
    base,
    head,
    newFiles,
    deletedFiles,
    tierTransitions: { enteredHot, enteredWarm, exitedHot, exitedWarm },
    scoreChanges,
    perDimensionDeltas: {
      complexity: {
        oldTotal: baseSnapshot.corpus.totalComplexity,
        newTotal: headSnapshot.corpus.totalComplexity,
        change:
          headSnapshot.corpus.totalComplexity -
          baseSnapshot.corpus.totalComplexity,
      },
      fileCount: {
        oldTotal: baseSnapshot.corpus.fileCount,
        newTotal: headSnapshot.corpus.fileCount,
        change: headSnapshot.corpus.fileCount - baseSnapshot.corpus.fileCount,
      },
    },
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
export function getCommitsInWindow(months: number, cwd?: string): number {
  try {
    const out = execSync(
      `git rev-list --count --since="${months} months ago" HEAD`,
      { stdio: ["pipe", "pipe", "pipe"], cwd },
    );
    return parseInt(out.toString().trim(), 10) || 0;
  } catch {
    throw new Error("Not a git repository or git is not installed.");
  }
}

const DAYS_PER_MONTH = 30;

/**
 * Compare the user's churn window against the actual git history length.
 * When history is shorter than the window, count-based confidence ladders
 * over-state how much *time* the ranking really observed: a 12-month window
 * on a 2-month repo still passes the commit-count floors but doesn't earn
 * time-based trust. Callers use `underCovered` to render a banner.
 */
export function getHistoryCoverage(
  months: number,
  cwd?: string,
): HistoryCoverageInfo {
  const windowDays = months * DAYS_PER_MONTH;
  let firstCommitSeconds: number;
  try {
    const out = execSync("git log --format=%ct --reverse HEAD", {
      maxBuffer: 50 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
      cwd,
    });
    const firstLine = out.toString().split("\n", 1)[0].trim();
    firstCommitSeconds = parseInt(firstLine, 10);
    if (!Number.isFinite(firstCommitSeconds) || firstCommitSeconds <= 0) {
      return { windowDays, spanDays: 0, underCovered: true };
    }
  } catch {
    throw new Error("Not a git repository or git is not installed.");
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  const spanDays = Math.max(
    0,
    Math.floor((nowSeconds - firstCommitSeconds) / 86400),
  );
  return { windowDays, spanDays, underCovered: spanDays < windowDays };
}
