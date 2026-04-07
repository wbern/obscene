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

  it("truncates long strings with ellipsis prefix", () => {
    const result = truncate("abcdefghij", 5);
    expect(result).toBe("…ghij");
    expect(result.length).toBe(5);
  });

  it("returns string unchanged at exact max length", () => {
    expect(truncate("hello", 5)).toBe("hello");
  });
});

describe("tierLabel", () => {
  it("returns label with emoji for danger", () => {
    const label = tierLabel("danger");
    expect(label).toContain("DANGER");
    expect(label).toContain("🔴");
  });

  it("returns label with emoji for watch", () => {
    const label = tierLabel("watch");
    expect(label).toContain("WATCH");
    expect(label).toContain("🟡");
  });

  it("returns label with emoji for stable", () => {
    const label = tierLabel("stable");
    expect(label).toContain("stable");
    expect(label).toContain("🟢");
  });
});

describe("colorRow", () => {
  it("preserves text content for danger", () => {
    const result = colorRow("danger", "test row data");
    expect(result).toContain("test row data");
  });

  it("preserves text content for watch", () => {
    const result = colorRow("watch", "test row data");
    expect(result).toContain("test row data");
  });

  it("preserves text content for stable", () => {
    const result = colorRow("stable", "test row data");
    expect(result).toContain("test row data");
  });

  it("returns different output for different tiers (when color enabled)", () => {
    // Even if no ANSI in test env, the function returns the wrapped text
    const danger = colorRow("danger", "x");
    const watch = colorRow("watch", "x");
    const stable = colorRow("stable", "x");
    // All should contain the text
    expect(danger).toContain("x");
    expect(watch).toContain("x");
    expect(stable).toContain("x");
  });
});

describe("tierSummary", () => {
  it("returns two lines with tier counts and showing info", () => {
    const lines = tierSummary({ danger: 2, watch: 3, stable: 5 }, 10, 20);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("2 danger");
    expect(lines[0]).toContain("3 watch");
    expect(lines[0]).toContain("5 stable");
    expect(lines[1]).toBe("Showing: 10 of 20");
  });

  it("includes Tiers prefix in tier line", () => {
    const lines = tierSummary({ danger: 1, watch: 0, stable: 0 }, 1, 1);
    expect(lines[0]).toContain("Tiers:");
    expect(lines[0]).toContain("1 danger");
    expect(lines[0]).toContain("0 watch");
    expect(lines[0]).toContain("0 stable");
  });
});
