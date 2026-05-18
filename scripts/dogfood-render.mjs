function row(label, value) {
  return `| **${label}** | ${value} |`;
}

function renderReleaseTable(release, lastTag) {
  const types = parseCommitTypes(release.commitSubjects);
  const day = busiestDay(release.commitTimestamps);
  const { largestCommit, netLines, complexityDelta } = release;
  const rows = [
    row("Commits", `${release.commitCount} since \`${lastTag}\``),
    row("Shape", formatTypeHistogram(types)),
    row(
      "Largest commit",
      `\`${largestCommit.sha.slice(0, 7)}\` — ${largestCommit.subject} _(+${commas(largestCommit.lines)} lines)_`,
    ),
    row("Net lines", `+${commas(netLines.added)} / −${commas(netLines.removed)}`),
  ];
  if (day) rows.push(row("Busiest day", `${day.day} _(${day.count} commits)_`));
  rows.push(
    row(
      "Δ complexity",
      `${commas(complexityDelta.oldTotal)} → ${commas(complexityDelta.newTotal)} _(${complexityDelta.change >= 0 ? "+" : "−"}${Math.abs(complexityDelta.change)})_`,
    ),
  );
  return ["**This release**", "", "| | |", "|---|---|", ...rows].join("\n");
}

function renderCodebaseTable(c) {
  const commentPct = `${Math.round(c.commentRatio * 100)}%`;
  return [
    "**The codebase**",
    "",
    "| | |",
    "|---|---|",
    row("Files", commas(c.fileCount)),
    row("Lines of code", commas(c.totalCode)),
    row(
      "Cyclomatic complexity",
      `${commas(c.totalComplexity)} _(avg ${c.avgComplexityPerFile}/file)_`,
    ),
    row(
      "Heaviest file",
      `\`${c.heaviest.file}\` — ${commas(c.heaviest.lines)} lines, complexity ${c.heaviest.complexity}`,
    ),
    row("Languages", c.languages),
    row("Comment ratio", commentPct),
    row("Project age", `${commas(c.ageDays)} days`),
  ].join("\n");
}

export function renderFunStatsSection({ lastTag, release, codebase }) {
  const parts = ["### 📊 By the numbers", ""];
  if (lastTag && release) {
    parts.push(renderReleaseTable(release, lastTag), "");
  }
  parts.push(renderCodebaseTable(codebase));
  return parts.join("\n");
}

const TYPE_RE = /^([a-z]+)(?:\([^)]+\))?!?:/;

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const EXT_TO_LANG = {
  ts: "TypeScript",
  tsx: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  mjs: "JavaScript",
  cjs: "JavaScript",
  py: "Python",
  go: "Go",
  rs: "Rust",
  rb: "Ruby",
  java: "Java",
  kt: "Kotlin",
  swift: "Swift",
  c: "C",
  h: "C",
  cpp: "C++",
  cc: "C++",
  hpp: "C++",
  cs: "C#",
  php: "PHP",
  sh: "Shell",
  md: "Markdown",
  json: "JSON",
  yaml: "YAML",
  yml: "YAML",
  toml: "TOML",
  html: "HTML",
  css: "CSS",
  scss: "Sass",
};

function languageOf(file) {
  const dot = file.lastIndexOf(".");
  if (dot === -1) return "other";
  const ext = file.slice(dot + 1).toLowerCase();
  return EXT_TO_LANG[ext] ?? "other";
}

export function languageBreakdown(files) {
  if (files.length === 0) return "no source files";
  const byLang = new Map();
  let total = 0;
  for (const f of files) {
    const lang = languageOf(f.file);
    const code = f.code ?? 0;
    byLang.set(lang, (byLang.get(lang) || 0) + code);
    total += code;
  }
  if (total === 0) return "no source files";
  const sorted = [...byLang.entries()].sort((a, b) => b[1] - a[1]);
  const [topLang, topCode] = sorted[0];
  const topPct = Math.round((topCode / total) * 100);
  const otherPct = 100 - topPct;
  if (otherPct === 0) return `${topLang} 100%`;
  return `${topLang} ${topPct}%, other ${otherPct}%`;
}

export function commas(n) {
  return n.toLocaleString("en-US");
}

export function ageInDays(fromUnixSec, nowUnixSec) {
  return Math.floor((nowUnixSec - fromUnixSec) / 86400);
}

export function heaviestFile(files) {
  if (files.length === 0) return null;
  return files.reduce((a, b) => (b.lines > a.lines ? b : a));
}

export function busiestDay(isoTimestamps) {
  if (isoTimestamps.length === 0) return null;
  const counts = new Array(7).fill(0);
  for (const ts of isoTimestamps) counts[new Date(ts).getUTCDay()]++;
  let max = 0;
  let idx = 0;
  for (let i = 0; i < 7; i++) {
    if (counts[i] > max) {
      max = counts[i];
      idx = i;
    }
  }
  return { day: DAY_NAMES[idx], count: max };
}

export function formatTypeHistogram(counts) {
  const entries = Object.entries(counts);
  if (entries.length === 0) return "no conventional commits";
  return entries
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `${n} \`${t}\``)
    .join(" · ");
}

export function parseCommitTypes(subjects) {
  const counts = {};
  for (const s of subjects) {
    const m = TYPE_RE.exec(s);
    if (!m) continue;
    counts[m[1]] = (counts[m[1]] || 0) + 1;
  }
  return counts;
}
