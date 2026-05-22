import { describe, expect, it } from "vitest";
import {
  buildClaudeHookOutput,
  formatHotspotDeltaForAgent,
  SIGNIFICANT_PERCENT_CHANGE,
} from "./hook.js";
import type { CouplingReminder, HotspotDelta, ScoreChange } from "./types.js";

function makeDelta(overrides: Partial<HotspotDelta> = {}): HotspotDelta {
  return {
    base: "HEAD",
    head: "WORKING",
    newFiles: [],
    deletedFiles: [],
    tierTransitions: {
      enteredHot: [],
      enteredWarm: [],
      exitedHot: [],
      exitedWarm: [],
    },
    scoreChanges: [],
    perDimensionDeltas: {
      complexity: { oldTotal: 0, newTotal: 0, change: 0 },
      fileCount: { oldTotal: 0, newTotal: 0, change: 0 },
    },
    ...overrides,
  };
}

function makeScoreChange(overrides: Partial<ScoreChange>): ScoreChange {
  return {
    file: "src/x.ts",
    oldScore: 0.1,
    newScore: 0.15,
    change: 0.05,
    percentChange: 50,
    oldTier: "warm",
    newTier: "warm",
    transition: "stable",
    ...overrides,
  };
}

describe("formatHotspotDeltaForAgent", () => {
  it("returns null when nothing notable changed", () => {
    expect(formatHotspotDeltaForAgent(makeDelta())).toBeNull();
  });

  it("returns null when only sub-threshold score changes exist", () => {
    const delta = makeDelta({
      scoreChanges: [
        makeScoreChange({ file: "src/a.ts", percentChange: 5 }),
        makeScoreChange({ file: "src/b.ts", percentChange: -10 }),
      ],
    });
    expect(formatHotspotDeltaForAgent(delta)).toBeNull();
  });

  it("emits tier-entry transitions joined to score changes", () => {
    const delta = makeDelta({
      tierTransitions: {
        enteredHot: ["src/cli.ts"],
        enteredWarm: ["src/format.ts"],
        exitedHot: [],
        exitedWarm: [],
      },
      scoreChanges: [
        makeScoreChange({
          file: "src/cli.ts",
          oldTier: "warm",
          newTier: "hot",
          percentChange: 42,
        }),
        makeScoreChange({
          file: "src/format.ts",
          oldTier: "cool",
          newTier: "warm",
          percentChange: 31,
        }),
      ],
    });
    const out = formatHotspotDeltaForAgent(delta);
    expect(out).toContain("obscene drift (vs HEAD):");
    expect(out).toContain("src/cli.ts: warm → hot (score +42%)");
    expect(out).toContain("src/format.ts: cool → warm (score +31%)");
  });

  it("emits tier-exit transitions", () => {
    const delta = makeDelta({
      tierTransitions: {
        enteredHot: [],
        enteredWarm: [],
        exitedHot: ["src/legacy.ts"],
        exitedWarm: ["src/util.ts"],
      },
      scoreChanges: [
        makeScoreChange({
          file: "src/legacy.ts",
          oldTier: "hot",
          newTier: "warm",
          percentChange: -38,
        }),
        makeScoreChange({
          file: "src/util.ts",
          oldTier: "warm",
          newTier: "cool",
          percentChange: -22,
        }),
      ],
    });
    const out = formatHotspotDeltaForAgent(delta) ?? "";
    expect(out).toContain("src/legacy.ts: hot → warm (score -38%)");
    expect(out).toContain("src/util.ts: warm → cool (score -22%)");
  });

  it("falls back to em dash when tier or percent is null", () => {
    const delta = makeDelta({
      tierTransitions: {
        enteredHot: ["src/new.ts"],
        enteredWarm: [],
        exitedHot: ["src/gone.ts"],
        exitedWarm: [],
      },
      scoreChanges: [
        makeScoreChange({
          file: "src/new.ts",
          oldScore: null,
          oldTier: null,
          percentChange: null,
          change: null,
          transition: "new",
        }),
        makeScoreChange({
          file: "src/gone.ts",
          oldTier: "hot",
          newScore: null,
          newTier: null,
          percentChange: null,
          change: null,
          transition: "deleted",
        }),
      ],
    });
    const out = formatHotspotDeltaForAgent(delta) ?? "";
    expect(out).toContain("src/new.ts: — → warm (score —)");
    expect(out).toContain("src/gone.ts: hot → — (score —)");
  });

  it("skips tier-listed files whose scoreChange entry is missing", () => {
    const delta = makeDelta({
      tierTransitions: {
        enteredHot: ["src/orphan.ts"],
        enteredWarm: [],
        exitedHot: [],
        exitedWarm: [],
      },
      scoreChanges: [],
    });
    expect(formatHotspotDeltaForAgent(delta)).toBeNull();
  });

  it("emits significant stable-tier changes sorted by magnitude", () => {
    const delta = makeDelta({
      scoreChanges: [
        makeScoreChange({ file: "src/a.ts", percentChange: 30 }),
        makeScoreChange({ file: "src/b.ts", percentChange: -55 }),
        makeScoreChange({ file: "src/c.ts", percentChange: 5 }),
      ],
    });
    const out = formatHotspotDeltaForAgent(delta) ?? "";
    const lines = out.split("\n");
    expect(lines[1]).toContain("src/b.ts: score -55%");
    expect(lines[2]).toContain("src/a.ts: score +30%");
    expect(out).not.toContain("src/c.ts");
  });

  it("respects a custom threshold", () => {
    const delta = makeDelta({
      scoreChanges: [makeScoreChange({ file: "src/a.ts", percentChange: 12 })],
    });
    expect(formatHotspotDeltaForAgent(delta)).toBeNull();
    const out = formatHotspotDeltaForAgent(delta, {
      significantPercentChange: 10,
    });
    expect(out).toContain("src/a.ts: score +12%");
  });

  it("uses old tier label for deleted files in stable section", () => {
    const delta = makeDelta({
      scoreChanges: [
        makeScoreChange({
          file: "src/gone.ts",
          newTier: null,
          newScore: null,
          percentChange: -100,
          transition: "deleted",
        }),
      ],
    });
    const out = formatHotspotDeltaForAgent(delta) ?? "";
    expect(out).toContain("src/gone.ts: score -100% (stayed warm)");
  });

  it("renders em dash when both tiers are null in stable section", () => {
    const delta = makeDelta({
      scoreChanges: [
        makeScoreChange({
          file: "src/ghost.ts",
          oldTier: null,
          newTier: null,
          percentChange: 99,
        }),
      ],
    });
    const out = formatHotspotDeltaForAgent(delta) ?? "";
    expect(out).toContain("src/ghost.ts: score +99% (stayed —)");
  });

  it("emits a base ref in the header", () => {
    const delta = makeDelta({
      base: "main",
      scoreChanges: [makeScoreChange({ file: "src/a.ts", percentChange: 40 })],
    });
    const out = formatHotspotDeltaForAgent(delta) ?? "";
    expect(out.startsWith("obscene drift (vs main):")).toBe(true);
  });

  it("omits the tier-count rollup when only stable-significant changes exist", () => {
    const delta = makeDelta({
      scoreChanges: [makeScoreChange({ file: "src/a.ts", percentChange: 40 })],
    });
    const out = formatHotspotDeltaForAgent(delta) ?? "";
    expect(out).not.toContain("tiers:");
  });

  it("emits a tier-count rollup line when tier transitions exist", () => {
    const delta = makeDelta({
      tierTransitions: {
        enteredHot: ["src/a.ts", "src/b.ts"],
        enteredWarm: ["src/c.ts"],
        exitedHot: ["src/d.ts"],
        exitedWarm: ["src/e.ts", "src/f.ts"],
      },
      scoreChanges: [
        makeScoreChange({
          file: "src/a.ts",
          oldTier: "warm",
          newTier: "hot",
          percentChange: 40,
        }),
        makeScoreChange({
          file: "src/b.ts",
          oldTier: "warm",
          newTier: "hot",
          percentChange: 50,
        }),
        makeScoreChange({
          file: "src/c.ts",
          oldTier: "cool",
          newTier: "warm",
          percentChange: 30,
        }),
        makeScoreChange({
          file: "src/d.ts",
          oldTier: "hot",
          newTier: "warm",
          percentChange: -25,
        }),
        makeScoreChange({
          file: "src/e.ts",
          oldTier: "warm",
          newTier: "cool",
          percentChange: -30,
        }),
        makeScoreChange({
          file: "src/f.ts",
          oldTier: "warm",
          newTier: "cool",
          percentChange: -35,
        }),
      ],
    });
    const out = formatHotspotDeltaForAgent(delta) ?? "";
    expect(out).toContain("tiers: HOT +2/-1 · WARM +1/-2");
  });
});

describe("formatHotspotDeltaForAgent — coupling reminders", () => {
  function reminder(
    overrides: Partial<CouplingReminder> = {},
  ): CouplingReminder {
    return {
      file: "src/cli.ts",
      partner: "src/format.ts",
      cochanges: 8,
      degree: 80,
      ...overrides,
    };
  }

  it("emits a reminders section even when nothing else changed", () => {
    const out = formatHotspotDeltaForAgent(makeDelta(), {
      reminders: [reminder()],
    });
    expect(out).not.toBeNull();
    expect(out).toContain("co-change reminders (≥5 commits, ≥70% degree):");
    expect(out).toContain(
      "- src/cli.ts ↔ src/format.ts: 8 shared commits (degree 80%)",
    );
    expect(out).toContain("ignore if unrelated to this change.");
  });

  it("returns null when reminders is empty and nothing else notable", () => {
    expect(
      formatHotspotDeltaForAgent(makeDelta(), { reminders: [] }),
    ).toBeNull();
  });

  it("renders multiple reminders one per line", () => {
    const out =
      formatHotspotDeltaForAgent(makeDelta(), {
        reminders: [
          reminder({
            file: "src/a.ts",
            partner: "src/x.ts",
            cochanges: 9,
            degree: 90,
          }),
          reminder({
            file: "src/b.ts",
            partner: "src/y.ts",
            cochanges: 7,
            degree: 70,
          }),
        ],
      }) ?? "";
    expect(out).toContain(
      "- src/a.ts ↔ src/x.ts: 9 shared commits (degree 90%)",
    );
    expect(out).toContain(
      "- src/b.ts ↔ src/y.ts: 7 shared commits (degree 70%)",
    );
  });

  it("appends reminders below tier/score lines when both exist", () => {
    const delta = makeDelta({
      scoreChanges: [makeScoreChange({ file: "src/a.ts", percentChange: 40 })],
    });
    const out =
      formatHotspotDeltaForAgent(delta, { reminders: [reminder()] }) ?? "";
    const reminderIdx = out.indexOf("co-change reminders");
    const scoreIdx = out.indexOf("src/a.ts: score +40%");
    expect(scoreIdx).toBeGreaterThan(-1);
    expect(reminderIdx).toBeGreaterThan(scoreIdx);
  });

  it("uses the configured base ref in the same header", () => {
    const out =
      formatHotspotDeltaForAgent(makeDelta({ base: "main" }), {
        reminders: [reminder()],
      }) ?? "";
    expect(out.startsWith("obscene drift (vs main):")).toBe(true);
  });
});

describe("buildClaudeHookOutput", () => {
  it("wraps context under hookSpecificOutput", () => {
    expect(buildClaudeHookOutput("hello", "Stop")).toEqual({
      hookSpecificOutput: {
        hookEventName: "Stop",
        additionalContext: "hello",
      },
    });
  });
});

describe("SIGNIFICANT_PERCENT_CHANGE", () => {
  it("is 25", () => {
    expect(SIGNIFICANT_PERCENT_CHANGE).toBe(25);
  });
});
