import pc from "picocolors";
import type { Tier } from "./types.js";

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequences use control characters by definition
const ANSI_RE = /\x1b\[[0-9;]*m/g;

/**
 * Check if a Unicode codepoint occupies 2 terminal columns.
 * Covers CJK, fullwidth forms, Hangul, and common emoji ranges.
 */
function isWide(cp: number): boolean {
  return (
    // CJK Radicals through Katakana (U+2E80–U+30FF) + CJK Symbols (U+3000–U+303F)
    (cp >= 0x2e80 && cp <= 0x30ff) ||
    // Enclosed CJK Letters + CJK Compatibility (U+3200–U+33FF)
    (cp >= 0x3200 && cp <= 0x33ff) ||
    // CJK Extension A (U+3400–U+4DBF) + CJK Unified Ideographs (U+4E00–U+9FFF)
    (cp >= 0x3400 && cp <= 0x9fff) ||
    // Hangul Syllables (U+AC00–U+D7AF)
    (cp >= 0xac00 && cp <= 0xd7af) ||
    // CJK Compatibility Ideographs (U+F900–U+FAFF)
    (cp >= 0xf900 && cp <= 0xfaff) ||
    // Fullwidth Forms (U+FF01–U+FF60, U+FFE0–U+FFE6)
    (cp >= 0xff01 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    // Miscellaneous Symbols (U+2600–U+26FF) — includes ☀, ⚡, etc.
    (cp >= 0x2600 && cp <= 0x26ff) ||
    // Emoji and symbol blocks in supplementary planes (U+1F300–U+1FAFF)
    (cp >= 0x1f300 && cp <= 0x1faff) ||
    // CJK Extension B+ and supplementary ideographs (U+20000–U+2FA1F)
    (cp >= 0x20000 && cp <= 0x2fa1f)
  );
}

export function visualWidth(s: string): number {
  const stripped = s.replace(ANSI_RE, "");
  let width = 0;
  for (const ch of stripped) {
    const cp = ch.codePointAt(0)!;
    // Variation selectors are zero-width (U+FE0E text, U+FE0F emoji)
    if (cp === 0xfe0e || cp === 0xfe0f) continue;
    width += isWide(cp) ? 2 : 1;
  }
  return width;
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
  if (s.length <= max) return s;
  if (max <= 1) return "…";
  // Middle-truncate so both the leading prefix and the trailing basename remain
  // visible. Without this, paths sharing a common suffix (e.g. siblings under
  // .claude/commands/ and .opencode/commands/) collapse to indistinguishable
  // tails. Bias toward the tail (~60%) so the basename — the more identifying
  // segment — stays intact for typical path widths.
  const remaining = max - 1;
  const tail = Math.ceil(remaining * 0.6);
  const head = remaining - tail;
  return `${s.slice(0, head)}…${s.slice(s.length - tail)}`;
}

export function tierLabel(tier: Tier): string {
  if (tier === "hot") return pc.red("🔥 HOT ");
  if (tier === "warm") return pc.yellow("☀️ WARM");
  return pc.blue("🧊 COOL");
}

export function colorRow(tier: Tier, text: string): string {
  if (tier === "hot") return pc.red(text);
  if (tier === "warm") return pc.yellow(text);
  return pc.blue(text);
}

export function tierSummary(
  tierCounts: Record<Tier, number>,
  showing: number,
  total: number,
): string[] {
  const lines: string[] = [];
  lines.push(
    `Tiers: ${pc.red(`${tierCounts.hot} HOT`)}, ${pc.yellow(`${tierCounts.warm} WARM`)}, ${pc.blue(`${tierCounts.cool} COOL`)}`,
  );
  lines.push(`Showing: ${showing} of ${total}`);
  return lines;
}
