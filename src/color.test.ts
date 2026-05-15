import { describe, expect, it } from "vitest";
import {
  colorRow,
  padLeft,
  padRight,
  tierLabel,
  tierSummary,
  truncate,
  visualWidth,
} from "./color.js";

describe("visualWidth", () => {
  it("returns length of plain text", () => {
    expect(visualWidth("hello")).toBe(5);
  });

  it("ignores ANSI escape codes", () => {
    expect(visualWidth("\x1b[31mhello\x1b[39m")).toBe(5);
  });

  it("handles multiple ANSI codes", () => {
    expect(visualWidth("\x1b[1m\x1b[31mhi\x1b[39m\x1b[22m")).toBe(2);
  });

  it("returns 0 for empty string", () => {
    expect(visualWidth("")).toBe(0);
  });

  it("counts emoji as 2 columns wide", () => {
    expect(visualWidth("🔴")).toBe(2);
    // All tier labels should have equal visual width (7) for alignment
    expect(visualWidth("🔥 HOT ")).toBe(7);
    expect(visualWidth("☀️ WARM")).toBe(7);
    expect(visualWidth("🧊 COOL")).toBe(7);
  });

  it("treats variation selectors as zero-width", () => {
    // U+FE0F (emoji presentation selector) should not add width
    expect(visualWidth("☀️")).toBe(2);
    expect(visualWidth("☀")).toBe(2);
  });

  it("counts CJK characters as 2 columns wide", () => {
    expect(visualWidth("中")).toBe(2);
    expect(visualWidth("中文")).toBe(4);
    expect(visualWidth("hello中")).toBe(7);
  });

  it("counts fullwidth characters as 2 columns wide", () => {
    expect(visualWidth("Ａ")).toBe(2); // Fullwidth A (U+FF21)
    expect(visualWidth("ＡＢ")).toBe(4);
  });

  it("counts Hangul syllables as 2 columns wide", () => {
    expect(visualWidth("한")).toBe(2); // U+D55C
  });

  it("counts CJK compatibility ideographs as 2 columns wide", () => {
    expect(visualWidth("\uF900")).toBe(2); // U+F900
  });

  it("counts fullwidth currency symbols as 2 columns wide", () => {
    expect(visualWidth("￥")).toBe(2); // U+FFE5 fullwidth yen
  });

  it("counts supplementary emoji as 2 columns wide", () => {
    expect(visualWidth("😀")).toBe(2); // U+1F600 Emoticon
    expect(visualWidth("🚀")).toBe(2); // U+1F680 Transport
    expect(visualWidth("🧩")).toBe(2); // U+1F9E9 Supplemental symbol
  });

  it("counts CJK Extension B characters as 2 columns wide", () => {
    expect(visualWidth("\u{20000}")).toBe(2); // U+20000
  });
});

describe("padRight", () => {
  it("pads plain text to target width", () => {
    expect(padRight("hi", 5)).toBe("hi   ");
  });

  it("pads ANSI-colored text correctly", () => {
    const colored = "\x1b[31mhi\x1b[39m";
    const result = padRight(colored, 5);
    expect(visualWidth(result)).toBe(5);
    expect(result).toContain("hi");
  });

  it("returns string unchanged when already at target width", () => {
    expect(padRight("hello", 5)).toBe("hello");
  });

  it("returns string unchanged when wider than target", () => {
    expect(padRight("hello world", 5)).toBe("hello world");
  });
});

describe("padLeft", () => {
  it("pads plain text to target width", () => {
    expect(padLeft("42", 5)).toBe("   42");
  });

  it("pads ANSI-colored text correctly", () => {
    const colored = "\x1b[31m42\x1b[39m";
    const result = padLeft(colored, 5);
    expect(visualWidth(result)).toBe(5);
    expect(result).toContain("42");
  });

  it("returns string unchanged when already at target width", () => {
    expect(padLeft("hello", 5)).toBe("hello");
  });

  it("returns string unchanged when wider than target", () => {
    expect(padLeft("hello world", 5)).toBe("hello world");
  });
});

describe("truncate", () => {
  it("returns short strings unchanged", () => {
    expect(truncate("hi", 10)).toBe("hi");
  });

  it("middle-truncates long strings preserving head and tail", () => {
    // max=5 → remaining=4, tail=ceil(4*0.6)=3, head=1
    const result = truncate("abcdefghij", 5);
    expect(result).toBe("a…hij");
    expect(result.length).toBe(5);
  });

  it("returns string unchanged at exact max length", () => {
    expect(truncate("hello", 5)).toBe("hello");
  });

  it("returns just the ellipsis when max is 1", () => {
    expect(truncate("hello", 1)).toBe("…");
  });

  it("preserves distinguishing prefix for sibling paths", () => {
    // Paths sharing a common trailing basename must not collide.
    const a = truncate(".claude/commands/commitlint-checklist-nodejs.md", 33);
    const b = truncate(".opencode/commands/commitlint-checklist-nodejs.md", 33);
    const c = truncate("src/sources/commitlint-checklist-nodejs.md", 33);
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(b).not.toBe(c);
    // Head segment stays visible so the parent dir is recognizable.
    expect(a.startsWith(".claude")).toBe(true);
    expect(b.startsWith(".opencode")).toBe(true);
    expect(c.startsWith("src/sources")).toBe(true);
  });
});

describe("tierLabel", () => {
  it("returns label with emoji for hot", () => {
    const label = tierLabel("hot");
    expect(label).toContain("HOT");
    expect(label).toContain("🔥");
  });

  it("returns label with emoji for warm", () => {
    const label = tierLabel("warm");
    expect(label).toContain("WARM");
    expect(label).toContain("☀️");
  });

  it("returns label with emoji for cool", () => {
    const label = tierLabel("cool");
    expect(label).toContain("COOL");
    expect(label).toContain("🧊");
  });
});

describe("colorRow", () => {
  it("preserves text content for hot", () => {
    const result = colorRow("hot", "test row data");
    expect(result).toContain("test row data");
  });

  it("preserves text content for warm", () => {
    const result = colorRow("warm", "test row data");
    expect(result).toContain("test row data");
  });

  it("preserves text content for cool", () => {
    const result = colorRow("cool", "test row data");
    expect(result).toContain("test row data");
  });

  it("returns different output for different tiers (when color enabled)", () => {
    const hot = colorRow("hot", "x");
    const warm = colorRow("warm", "x");
    const cool = colorRow("cool", "x");
    expect(hot).toContain("x");
    expect(warm).toContain("x");
    expect(cool).toContain("x");
  });
});

describe("tierSummary", () => {
  it("returns two lines with tier counts and showing info", () => {
    const lines = tierSummary({ hot: 2, warm: 3, cool: 5 }, 10, 20);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("2 HOT");
    expect(lines[0]).toContain("3 WARM");
    expect(lines[0]).toContain("5 COOL");
    expect(lines[1]).toBe("Showing: 10 of 20");
  });

  it("includes Tiers prefix in tier line", () => {
    const lines = tierSummary({ hot: 1, warm: 0, cool: 0 }, 1, 1);
    expect(lines[0]).toContain("Tiers:");
    expect(lines[0]).toContain("1 HOT");
    expect(lines[0]).toContain("0 WARM");
    expect(lines[0]).toContain("0 COOL");
  });
});
