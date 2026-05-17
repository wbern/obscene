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
}

export interface RankingOutput {
  label: string;
  scoreFormula: string;
  totalScore: number;
  tierCounts: Record<Tier, number>;
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
}

export interface HotspotsOutput {
  generated: string;
  guide: Record<string, string>;
  churnWindow: string;
  historyCoverage?: HistoryCoverageInfo;
  delta?: DeltaInfo;
  fullDelta?: HotspotDelta;
  rankings: Record<string, RankingOutput>;
  skipped?: Record<string, SkippedRanking>;
  composite?: CompositeOutput;
  corpus?: {
    fileCount: number;
    totalComplexity: number;
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
}

export interface CompositeOutput {
  label: string;
  scoreFormula: string;
  totalScore: number;
  tierCounts: Record<Tier, number>;
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

export interface CouplingOutput {
  generated: string;
  guide: Record<string, string>;
  churnWindow: string;
  historyCoverage?: HistoryCoverageInfo;
  minCochanges: number;
  totalScore: number;
  tierCounts: Record<Tier, number>;
  totalCouplings: number;
  showing: number;
  couplings: CouplingEntry[];
  confidence: ConfidenceInfo;
}
