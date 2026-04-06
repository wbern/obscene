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

export type Tier = "danger" | "watch" | "stable";

export interface HotspotEntry extends FileMetrics {
  churn: number;
  hotspotScore: number;
  percentOfTotal: number;
  tier: Tier;
  defects: number;
  defectDensity: number;
  maxNesting: number;
  authors: number;
}

export interface ReportOutput {
  generated: string;
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

export interface HotspotsOutput {
  generated: string;
  churnWindow: string;
  totalScore: number;
  tierCounts: Record<Tier, number>;
  totalHotspots: number;
  showing: number;
  hotspots: HotspotEntry[];
}
