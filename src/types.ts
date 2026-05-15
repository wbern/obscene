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

export interface RankingEntry {
  file: string;
  score: number;
  percentOfTotal: number;
  tier: Tier;
  churn: number;
  metricValue: number;
  metricDensity?: number;
}

export interface RankingOutput {
  label: string;
  scoreFormula: string;
  totalScore: number;
  tierCounts: Record<Tier, number>;
  totalEntries: number;
  showing: number;
  entries: RankingEntry[];
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
}

export interface HotspotsOutput {
  generated: string;
  guide: Record<string, string>;
  churnWindow: string;
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
  minCochanges: number;
  totalScore: number;
  tierCounts: Record<Tier, number>;
  totalCouplings: number;
  showing: number;
  couplings: CouplingEntry[];
}
