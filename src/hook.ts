import { REMINDER_MIN_COCHANGES, REMINDER_MIN_DEGREE } from "./analyze.js";
import type { CouplingReminder, HotspotDelta } from "./types.js";

export const SIGNIFICANT_PERCENT_CHANGE = 25;

interface HookContextOptions {
  significantPercentChange?: number;
  reminders?: CouplingReminder[];
}

interface ClaudeAdditionalContextOutput {
  hookSpecificOutput: {
    hookEventName: string;
    additionalContext: string;
  };
}

interface ClaudeSystemMessageOutput {
  systemMessage: string;
}

type ClaudeHookOutput =
  | ClaudeAdditionalContextOutput
  | ClaudeSystemMessageOutput;

// Events that accept hookSpecificOutput.additionalContext per
// https://code.claude.com/docs/en/hooks. Everything else (Stop, SubagentStop,
// ConfigChange, PreCompact) emits top-level systemMessage, which is the only
// schema-valid context channel for those events.
const ADDITIONAL_CONTEXT_EVENTS = new Set([
  "SessionStart",
  "Setup",
  "SubagentStart",
  "UserPromptSubmit",
  "UserPromptExpansion",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PostToolBatch",
]);

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

  const reminderLines = formatReminderLines(opts.reminders);

  if (lines.length === 0 && reminderLines.length === 0) return null;

  const hotIn = delta.tierTransitions.enteredHot.length;
  const hotOut = delta.tierTransitions.exitedHot.length;
  const warmIn = delta.tierTransitions.enteredWarm.length;
  const warmOut = delta.tierTransitions.exitedWarm.length;
  const hasTierMovement = hotIn + hotOut + warmIn + warmOut > 0;

  const header = `obscene drift (vs ${delta.base}):`;
  const summaryLine = hasTierMovement
    ? `tiers: HOT +${hotIn}/-${hotOut} · WARM +${warmIn}/-${warmOut}`
    : null;

  const body: string[] = [];
  if (summaryLine) body.push(summaryLine);
  body.push(...lines);
  if (reminderLines.length > 0) {
    if (body.length > 0) body.push("");
    body.push(...reminderLines);
  }
  return `${header}\n${body.join("\n")}`;
}

function formatReminderLines(reminders?: CouplingReminder[]): string[] {
  if (!reminders || reminders.length === 0) return [];
  const out: string[] = [
    `co-change reminders (≥${REMINDER_MIN_COCHANGES} commits, ≥${REMINDER_MIN_DEGREE}% degree):`,
  ];
  for (const r of reminders) {
    out.push(
      `- ${r.file} ↔ ${r.partner}: ${r.cochanges} shared commits (degree ${r.degree.toFixed(0)}%)`,
    );
  }
  out.push("ignore if unrelated to this change.");
  return out;
}

export function buildClaudeHookOutput(
  context: string,
  eventName: string,
): ClaudeHookOutput {
  if (ADDITIONAL_CONTEXT_EVENTS.has(eventName)) {
    return {
      hookSpecificOutput: {
        hookEventName: eventName,
        additionalContext: context,
      },
    };
  }
  return { systemMessage: context };
}
