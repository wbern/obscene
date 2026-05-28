export interface SccFile {
  Location: string;
  Code: number;
  Lines: number;
  Complexity: number;
  Comment: number;
}

export interface SccLanguage {
  Name: string;
  Files: SccFile[];
}

export interface FileMetrics {
  file: string;
  code: number;
  lines: number;
  complexity: number;
  comments: number;
  complexityDensity: number;
}

export type Tier = "hot" | "warm" | "cool";

export type ConfidenceLevel =
  | "inconclusive"
  | "weak"
  | "plausible"
  | "acceptable";

export interface ConfidenceInfo {
  level: ConfidenceLevel;
  reason: string;
  inputs: {
    metric: string;
    value: number;
    thresholds: { weak: number; plausible: number; acceptable: number };
  };
  source: string;
}

/**
 * Activity inside a short recency window (e.g. last 14 days). Sits beside the
 * 90d composite to answer "what changed here lately, and who touched it?" —
 * recency is *in* the composite as a decay factor, but fused into a single
 * score; this surfaces it as its own dimension. Attached only when the user
 * passes `--recent-window`; default behavior is unchanged.
 */
export interface RecentActivity {
  windowDays: number;
  commits: number;
  /**
   * Distinct authors who touched this file in the window, sorted by commit
   * count desc then name asc. Capped at 3 by the producer so JSON consumers
   * see a stable, bounded set; the raw count is in `authorCount`.
   */
  authors: string[];
  authorCount: number;
  linesChanged: number;
}

/**
 * Per-file complexity change from a base ref to HEAD. Only attached when
 * `--base` is set on the hotspots command. `oldComplexity` is null for files
 * that didn't exist at the base ref; `change` is null in the same case.
 */
export interface ComplexityDelta {
  oldComplexity: number | null;
  newComplexity: number;
  change: number | null;
}

export interface RankingEntry {
  file: string;
  score: number;
  percentOfTotal: number;
  tier: Tier;
  churn: number;
  metricValue: number;
  metricDensity?: number;
  /**
   * Number of minor contributors on this file (< 5% of file commits;
   * Bird et al., FSE 2011). `null` means the file is below the
   * 2-commits/file Greiler-2015 floor — too few commits to call a
   * contributor "minor" with any confidence. Only set on the Authors
   * × Churn ranking.
   */
  minorAuthors?: number | null;
  complexityDelta?: ComplexityDelta;
  recent?: RecentActivity;
}

export interface RankingOutput {
  label: string;
  scoreFormula: string;
  totalScore: number;
  tierCounts: Record<Tier, number>;
  /** JSON alias of {@link tierCounts}, matching the table label "Tiers:" (GH#14). */
  tiers: Record<Tier, number>;
  totalEntries: number;
  showing: number;
  entries: RankingEntry[];
  confidence: ConfidenceInfo;
}

export interface ReportOutput {
  generated: string;
  guide: Record<string, string>;
  summary: {
    totalComplexity: number;
    totalCode: number;
    totalLines: number;
    fileCount: number;
    avgComplexityPerFile: number;
    showing: number;
  };
  files: FileMetrics[];
}

export interface SkippedRanking {
  reason: string;
  suggestion?: string;
  confidence: ConfidenceInfo;
}

export interface HistoryCoverageInfo {
  windowDays: number;
  spanDays: number;
  underCovered: boolean;
}

export interface DeltaInfo {
  base: string;
  head: string;
  changedFiles: string[];
  /**
   * Set when the user asked for a richer delta mode (e.g. `--full-delta`)
   * but the pipeline degraded to a smaller shape. The reason mirrors the
   * stderr warning so programmatic consumers can detect the downgrade
   * without scraping stderr.
   */
  fallback?: { from: "full-delta" | "working"; reason: string };
}

/**
 * Summary of a corpus-anchored path filter (GH#12). `--paths` / `--since`
 * keep tier labels anchored to the full-corpus distribution and filter
 * displayed entries to a touched set. `corpusHotRate` is the comparator
 * that makes `hotCount` actionable: 8/14 HOT files at a 14% corpus base
 * rate is a 4× elevation — that ratio is the signal.
 */
export interface PathFilterInfo {
  source: string;
  paths: string[];
  rankedCount: number;
  hotCount: number;
  warmCount: number;
  coolCount: number;
  notRanked: string[];
  corpusHotRate: number | null;
}

/**
 * "Reawakened" file: dormant for a clear margin before the churn window
 * (≥ MIN_DORMANCY_MULTIPLE × the window length), then touched again inside
 * the window. The forensic pattern Tornhill flags in *Your Code as a Crime
 * Scene* — code that was finished, then suddenly wasn't.
 *
 * `lastTouchedBeforeWindow` is the latest commit on the file BEFORE the
 * window opened; `firstTouchedInWindow` is the earliest commit on the file
 * INSIDE the window. The gap between them is the dormancy.
 */
export interface ReawakenedEntry {
  file: string;
  dormancyDays: number;
  dormancyMultiple: number;
  lastTouchedBeforeWindow: number;
  firstTouchedInWindow: number;
  complexity: number;
  churn: number;
}

export interface ReawakenedSection {
  windowDays: number;
  /**
   * The objective rule: a file is "reawakened" only when its dormancy gap is
   * at least this many times the churn window. Set to 3 so the gap can't be
   * confused with normal review/rework cadence. Surfaced in the JSON so
   * downstream consumers can verify the rule without re-deriving it.
   */
  minDormancyMultiple: number;
  minDormancyDays: number;
  entries: ReawakenedEntry[];
}

export interface HotspotsOutput {
  generated: string;
  guide: Record<string, string>;
  churnWindow: string;
  /**
   * How "churn" was counted for this run. `commits` (default) counts the
   * number of commits that touched each file; `lines` sums added+deleted
   * lines via `git log --numstat`. See README "Churn modes" for tradeoffs.
   */
  churnMode: "commits" | "lines";
  historyCoverage?: HistoryCoverageInfo;
  delta?: DeltaInfo;
  fullDelta?: HotspotDelta;
  pathFilter?: PathFilterInfo;
  rankings: Record<string, RankingOutput>;
  skipped?: Record<string, SkippedRanking>;
  composite?: CompositeOutput;
  reawakened?: ReawakenedSection;
  corpus?: {
    fileCount: number;
    totalComplexity: number;
    /**
     * `true` when an `.obsignore` or `.obsceneignore` was found and applied,
     * `false` when the rankings include lockfiles, generated code, vendored
     * dependencies — anything `obscene init` would normally exclude. Omitted
     * by callers that don't know (test fixtures, older snapshots).
     *
     * Surfaces the gap structurally instead of forcing JSON consumers to
     * scrape stderr — same philosophy as SARIF 2.1.0
     * `invocation.toolConfigurationNotifications[]` (OASIS).
     */
    filtered?: boolean;
  };
}

/**
 * Per-file composite-score change between two snapshots. `oldScore`/`oldTier`
 * are null when the file didn't exist at the base ref; `newScore`/`newTier`
 * are null when the file was deleted at HEAD. `transition` rolls up the
 * common cases callers want without reimplementing the lookup.
 */
export interface ScoreChange {
  file: string;
  oldScore: number | null;
  newScore: number | null;
  change: number | null;
  percentChange: number | null;
  oldTier: Tier | null;
  newTier: Tier | null;
  transition:
    | "new"
    | "deleted"
    | "entered-hot"
    | "entered-warm"
    | "exited-hot"
    | "exited-warm"
    | "stable";
}

/**
 * Full before/after snapshot diff produced by Mode C (`--full-delta`).
 *
 * Tier transitions reflect the *relative* tiers in each snapshot (HOT/WARM/COOL
 * are percentile bands within that snapshot's corpus). A file can shift tiers
 * because its absolute score moved OR because the rest of the corpus moved
 * around it — `scoreChanges` carries the absolute delta so callers can
 * disambiguate. See README "Delta modes" for details.
 */
export interface HotspotDelta {
  base: string;
  head: string;
  newFiles: string[];
  deletedFiles: string[];
  tierTransitions: {
    enteredHot: string[];
    enteredWarm: string[];
    exitedHot: string[];
    exitedWarm: string[];
  };
  scoreChanges: ScoreChange[];
  perDimensionDeltas: {
    complexity: { oldTotal: number; newTotal: number; change: number };
    fileCount: { oldTotal: number; newTotal: number; change: number };
  };
}

/**
 * Result of running the hotspot pipeline once (against HEAD or a base
 * worktree). Mode C runs this twice and feeds the pair to `computeDelta`.
 */
export interface HotspotSnapshot {
  files: FileMetrics[];
  rankings: Record<string, RankingOutput>;
  skipped: Record<string, SkippedRanking>;
  composite: CompositeOutput;
  reawakened: ReawakenedSection;
  corpus: {
    fileCount: number;
    totalComplexity: number;
  };
}

export interface CompositeEntry {
  file: string;
  score: number;
  percentOfTotal: number;
  tier: Tier;
  churn: number;
  dimensionCount: number;
  complexityDelta?: ComplexityDelta;
  recent?: RecentActivity;
}

export interface CompositeOutput {
  label: string;
  scoreFormula: string;
  totalScore: number;
  tierCounts: Record<Tier, number>;
  /** JSON alias of {@link tierCounts}, matching the table label "Tiers:" (GH#14). */
  tiers: Record<Tier, number>;
  totalDimensions: number;
  totalEntries: number;
  showing: number;
  entries: CompositeEntry[];
  confidence: ConfidenceInfo;
}

export interface CouplingEntry {
  file1: string;
  file2: string;
  cochanges: number;
  degree: number;
  totalComplexity: number;
  couplingScore: number;
  percentOfTotal: number;
  tier: Tier;
  file1Deleted?: boolean;
  file2Deleted?: boolean;
  lockstep?: boolean;
}

export interface SumOfCouplingEntry {
  file: string;
  partners: number;
  strength: number;
  percentOfTotal: number;
  tier: Tier;
  fileDeleted?: boolean;
}

/**
 * Per-edited-file pointer to its strongest unedited co-change partner. Used
 * by the Stop-hook to nudge the agent toward files that historically move
 * with the ones it just edited. Thresholds are applied by the producer
 * (`computeCoChangeReminders`); consumers see only entries worth surfacing.
 */
export interface CouplingReminder {
  file: string;
  partner: string;
  cochanges: number;
  degree: number;
}

export interface CouplingOutput {
  generated: string;
  guide: Record<string, string>;
  churnWindow: string;
  historyCoverage?: HistoryCoverageInfo;
  minCochanges: number;
  totalScore: number;
  tierCounts: Record<Tier, number>;
  /** JSON alias of {@link tierCounts}, matching the table label "Tiers:" (GH#14). */
  tiers: Record<Tier, number>;
  totalCouplings: number;
  showing: number;
  couplings: CouplingEntry[];
  sumOfCoupling?: SumOfCouplingEntry[];
  confidence: ConfidenceInfo;
}
