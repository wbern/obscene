import pc from "picocolors";
import type { Tier } from "./types.js";

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequences use control characters by definition
const ANSI_RE = /\x1b\[[0-9;]*m/g;

export function visualWidth(s: string): number {
  return s.replace(ANSI_RE, "").length;
}

export function padRight(s: string, n: number): string {
  const w = visualWidth(s);
  return w >= n ? s : s + " ".repeat(n - w);
}

export function padLeft(s: string, n: number): string {
  const w = visualWidth(s);
  return w >= n ? s : " ".repeat(n - w) + s;
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : `…${s.slice(s.length - max + 1)}`;
}

export function tierLabel(tier: Tier): string {
  if (tier === "danger") return pc.red("🔴 DANGER");
  if (tier === "watch") return pc.yellow("🟡 WATCH");
  return pc.green("🟢 stable");
}

export function colorRow(tier: Tier, text: string): string {
  if (tier === "danger") return pc.red(text);
  if (tier === "watch") return pc.yellow(text);
  return pc.green(text);
}

export function tierSummary(
  tierCounts: Record<Tier, number>,
  showing: number,
  total: number,
): string[] {
  const lines: string[] = [];
  lines.push(
    `Tiers: ${pc.red(`${tierCounts.danger} danger`)}, ${pc.yellow(`${tierCounts.watch} watch`)}, ${pc.green(`${tierCounts.stable} stable`)}`,
  );
  lines.push(`Showing: ${showing} of ${total}`);
  return lines;
}
