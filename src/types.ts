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
  rankings: Record<string, RankingOutput>;
  skipped?: Record<string, SkippedRanking>;
  composite?: CompositeOutput;
  corpus?: {
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
