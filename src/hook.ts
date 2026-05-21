import type { HotspotDelta } from "./types.js";

export const SIGNIFICANT_PERCENT_CHANGE = 25;

interface HookContextOptions {
  significantPercentChange?: number;
}

interface ClaudeHookOutput {
  hookSpecificOutput: {
    hookEventName: string;
    additionalContext: string;
  };
}

function formatPercent(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(0)}%`;
}

/**
 * Render a HotspotDelta as Claude-facing context, or null if nothing in the
 * delta crosses the significance threshold. Tier transitions are always
 * surfaced; score-only changes are only surfaced when |percent| ≥ threshold.
 */
export function formatHotspotDeltaForAgent(
  delta: HotspotDelta,
  opts: HookContextOptions = {},
): string | null {
  const threshold = opts.significantPercentChange ?? SIGNIFICANT_PERCENT_CHANGE;

  const tierFiles = new Set<string>([
    ...delta.tierTransitions.enteredHot,
    ...delta.tierTransitions.enteredWarm,
    ...delta.tierTransitions.exitedHot,
    ...delta.tierTransitions.exitedWarm,
  ]);

  const byFile = new Map(delta.scoreChanges.map((sc) => [sc.file, sc]));

  const lines: string[] = [];

  for (const file of [...tierFiles].sort()) {
    const sc = byFile.get(file);
    if (!sc) continue;
    const oldTier = sc.oldTier ?? "—";
    const newTier = sc.newTier ?? "—";
    const pct =
      sc.percentChange !== null ? formatPercent(sc.percentChange) : "—";
    lines.push(`- ${file}: ${oldTier} → ${newTier} (score ${pct})`);
  }

  const stableSignificant = delta.scoreChanges
    .filter((sc) => !tierFiles.has(sc.file))
    .filter(
      (sc) =>
        sc.percentChange !== null && Math.abs(sc.percentChange) >= threshold,
    )
    .sort(
      (a, b) =>
        Math.abs(b.percentChange as number) -
        Math.abs(a.percentChange as number),
    );

  for (const sc of stableSignificant) {
    const tier = sc.newTier ?? sc.oldTier ?? "—";
    lines.push(
      `- ${sc.file}: score ${formatPercent(sc.percentChange as number)} (stayed ${tier})`,
    );
  }

  if (lines.length === 0) return null;

  const hotIn = delta.tierTransitions.enteredHot.length;
  const hotOut = delta.tierTransitions.exitedHot.length;
  const warmIn = delta.tierTransitions.enteredWarm.length;
  const warmOut = delta.tierTransitions.exitedWarm.length;
  const hasTierMovement = hotIn + hotOut + warmIn + warmOut > 0;

  const header = `obscene drift (vs ${delta.base}):`;
  const summaryLine = hasTierMovement
    ? `tiers: HOT +${hotIn}/-${hotOut} · WARM +${warmIn}/-${warmOut}`
    : null;

  const body = summaryLine ? [summaryLine, ...lines] : lines;
  return `${header}\n${body.join("\n")}`;
}

export function buildClaudeHookOutput(
  context: string,
  eventName: string,
): ClaudeHookOutput {
  return {
    hookSpecificOutput: {
      hookEventName: eventName,
      additionalContext: context,
    },
  };
}
