#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  ageInDays,
  languageBreakdown,
  renderFunStatsSection,
} from "./dogfood-render.mjs";

const rawTag = process.argv[2]?.trim();
const lastTag = rawTag && rawTag !== "undefined" && rawTag !== "null" ? rawTag : "";

function emitUnavailable(reason) {
  const flat = String(reason).replace(/\s+/g, " ").trim();
  process.stdout.write(
    `\n---\n\n## Hotspots snapshot\n\n_Transparency snapshot unavailable for this release: ${flat}._\n`,
  );
  process.exit(0);
}

if (!existsSync("dist/cli.js")) {
  emitUnavailable("build artifact missing");
}

const obsceneEnv = { ...process.env, NO_COLOR: "1" };

function runObscene(extraArgs) {
  return execFileSync("node", ["dist/cli.js", ...extraArgs], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    env: obsceneEnv,
  });
}

function git(args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

const tableArgs = ["hotspots", "--top", "10", "--format", "table"];
if (lastTag) tableArgs.push("--base", lastTag, "--full-delta");

let table;
try {
  table = runObscene(tableArgs);
} catch (err) {
  emitUnavailable(err.message);
}

function gatherCodebase() {
  const report = JSON.parse(runObscene(["report", "--format", "json"]));
  const heaviest = report.files.reduce((a, b) => (b.lines > a.lines ? b : a));
  const totalComment = report.files.reduce((s, f) => s + (f.comments || 0), 0);
  const denom = report.summary.totalCode + totalComment;
  const commentRatio = denom === 0 ? 0 : totalComment / denom;

  const firstUnix = Number.parseInt(
    git(["log", "--reverse", "--format=%at"]).split("\n")[0],
    10,
  );
  const now = Math.floor(Date.now() / 1000);

  return {
    fileCount: report.summary.fileCount,
    totalCode: report.summary.totalCode,
    totalComplexity: report.summary.totalComplexity,
    avgComplexityPerFile: report.summary.avgComplexityPerFile,
    commentRatio,
    heaviest: {
      file: heaviest.file,
      lines: heaviest.lines,
      complexity: heaviest.complexity,
    },
    languages: languageBreakdown(report.files),
    ageDays: ageInDays(firstUnix, now),
  };
}

function gatherRelease(tag) {
  const log = git([
    "log",
    `${tag}..HEAD`,
    "--format=%H%x09%s%x09%aI",
  ]).trim();
  if (!log) return null;
  const commits = log.split("\n").map((line) => {
    const [sha, subject, iso] = line.split("\t");
    return { sha, subject, iso };
  });

  let added = 0;
  let removed = 0;
  const numstat = git([
    "log",
    `${tag}..HEAD`,
    "--numstat",
    "--format=",
  ]).trim();
  for (const line of numstat.split("\n")) {
    const parts = line.split("\t");
    if (parts.length < 2) continue;
    const a = Number.parseInt(parts[0], 10);
    const r = Number.parseInt(parts[1], 10);
    if (Number.isFinite(a)) added += a;
    if (Number.isFinite(r)) removed += r;
  }

  const shortstat = git([
    "log",
    `${tag}..HEAD`,
    "--shortstat",
    "--format=%H%x09%s",
  ]);
  let largest = { sha: "", subject: "", lines: 0 };
  for (const block of shortstat.split(/\n(?=[0-9a-f]{40}\t)/)) {
    const lines = block.split("\n");
    const head = lines[0];
    const stat = lines.find((l) => / files? changed/.test(l)) ?? "";
    if (!head) continue;
    const [sha, subject] = head.split("\t");
    const ins = /(\d+) insertion/.exec(stat);
    const del = /(\d+) deletion/.exec(stat);
    const changed =
      (ins ? Number.parseInt(ins[1], 10) : 0) +
      (del ? Number.parseInt(del[1], 10) : 0);
    if (changed > largest.lines) largest = { sha, subject, lines: changed };
  }

  let complexityDelta = { oldTotal: 0, newTotal: 0, change: 0 };
  try {
    const json = JSON.parse(
      runObscene(["hotspots", "--base", tag, "--full-delta", "--format", "json"]),
    );
    if (json.fullDelta?.perDimensionDeltas?.complexity) {
      complexityDelta = json.fullDelta.perDimensionDeltas.complexity;
    }
  } catch {
    // delta missing — release section will show 0→0; acceptable degradation
  }

  return {
    commitCount: commits.length,
    commitSubjects: commits.map((c) => c.subject),
    commitTimestamps: commits.map((c) => c.iso),
    largestCommit: largest,
    netLines: { added, removed },
    complexityDelta,
  };
}

let funStats = "";
try {
  const codebase = gatherCodebase();
  const release = lastTag ? gatherRelease(lastTag) : null;
  funStats = `${renderFunStatsSection({ lastTag, release, codebase })}\n\n`;
} catch (err) {
  process.stderr.write(`fun stats unavailable: ${err.message}\n`);
}

const heading = lastTag
  ? `## Hotspots snapshot (since \`${lastTag}\`)`
  : "## Hotspots snapshot";

const intro = [
  "_Transparency snapshot: obscene applied to its own source._",
  "",
  "The point of obscene is to surface where complexity meets churn — files worth a careful read, not files that are wrong. We publish this on every release so you can see how the tool reads its own code. Treat it the way you'd treat the output on your own repo: **as input for code review, not as a verdict.** High-tier files aren't broken; they're the places where a closer look is most likely to pay off.",
  "",
];

process.stdout.write(
  `\n---\n\n${heading}\n\n${intro.join("\n")}\n${funStats}\`\`\`\n${table.trimEnd()}\n\`\`\`\n`,
);
