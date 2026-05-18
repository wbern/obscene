#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

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

const args = ["dist/cli.js", "hotspots", "--top", "10", "--format", "table"];
if (lastTag) {
  args.push("--base", lastTag, "--full-delta");
}

let table;
try {
  table = execFileSync("node", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    env: { ...process.env, NO_COLOR: "1" },
  });
} catch (err) {
  emitUnavailable(err.message);
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
  `\n---\n\n${heading}\n\n${intro.join("\n")}\n\`\`\`\n${table.trimEnd()}\n\`\`\`\n`,
);
