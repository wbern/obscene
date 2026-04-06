# @wbern/obscene

```
       _==/          i     i          \==_
     /XX/            |\___/|            \XX\
   /XXXX\            |XXXXX|            /XXXX\
  |XXXXXX\_         _XXXXXXX_         _/XXXXXX|
 XXXXXXXXXXXxxxxxxxXXXXXXXXXXXxxxxxxxXXXXXXXXXXX
|XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX|
XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
|XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX|
 XXXXXX/^^^^"\XXXXXXXXXXXXXXXXXXXXX/^^^^^\XXXXXX
  |XXX|       \XXX/^^\XXXXX/^^\XXX/       |XXX|
    \XX\       \X/    \XXX/    \X/       /XX/
       "\       "      \X/      "       /"
```

**Find hotspot files — complex code that changes frequently.**

Combines [scc](https://github.com/boyter/scc) cyclomatic complexity with git churn to surface files that are both complex AND actively modified. Based on Adam Tornhill's *Your Code as a Crime Scene*.

Works on any language scc supports. No configuration needed.

## Prerequisites

[scc](https://github.com/boyter/scc#install) must be installed and on your PATH.

```bash
brew install scc          # macOS
choco install scc         # Windows
scoop install scc         # Windows (alt)
```

See [scc install docs](https://github.com/boyter/scc#install) for Linux and other options.

## Quick run (no install)

```bash
pnpm dlx @wbern/obscene --format table
```

## Install

```bash
pnpm add -g @wbern/obscene
```

```bash
npm install -g @wbern/obscene   # also works
```

## Usage

```bash
obscene                          # top 20 hotspots as JSON
obscene --format table           # human-readable table
obscene --top 50 --months 6     # more results, longer window
obscene --top 0                  # all files
obscene report                   # raw complexity (no churn)
obscene --exclude "*.generated.*"
obscene | jq '.hotspots[0]'     # pipe-friendly
```

## Commands

### `obscene hotspots` (default)

Scores each file by `complexity × commits` over a time window, then assigns tiers by cumulative score distribution:

| Tier | Range | Meaning |
|------|-------|---------|
| **danger** | top 50% of total score | Refactor candidates |
| **watch** | next 30% (50–80%) | Keep an eye on these |
| **stable** | bottom 20% | Low risk |

### `obscene report`

Per-file complexity without churn. Useful for raw complexity distribution.

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--top <n>` | `20` | Limit results (0 = all) |
| `--months <n>` | `3` | Churn window in months |
| `--format <type>` | `json` | `json` or `table` |
| `--exclude <patterns...>` | — | Additional exclusion patterns |

## Metrics

Each hotspot row includes the following metrics:

### Hotspot score (`Score`)

`complexity × churn`. The core ranking metric — files that are both complex and frequently modified bubble to the top. See [Why churn × complexity?](#why-churn-x-complexity) for the research backing this approach.

### Churn (`Churn`)

Number of commits touching the file within the configured time window (default: 3 months). Measures how actively the file is being modified.

### Cyclomatic complexity (`Cmplx`)

Total cyclomatic complexity as reported by [scc](https://github.com/boyter/scc). Counts independent execution paths (branches, loops, conditions). Higher values mean more paths to test and more places for bugs to hide.

### Complexity density (`Dens`)

`complexity / lines of code`. Normalizes complexity by file size so a 50-line file with complexity 25 (density 0.50) stands out against a 500-line file with complexity 25 (density 0.05). Based on Harrison & Magel (1981), who found that complexity relative to code size is a stronger fault predictor than raw complexity alone.

### Defects (`Dfcts`)

Count of `fix:` conventional commits touching the file within the churn window. A proxy for historical defect rate — files that attract repeated fixes are more likely to contain latent bugs. Inspired by Moser, Pedrycz & Succi (2008), who showed that change-history metrics outperform static code metrics for defect prediction.

### Defect density (`defectDensity`, JSON only)

`defects / lines of code`. Not shown in table output due to column width, but available in JSON. Normalizes defect count by file size.

### Nesting depth (`Nest`)

Maximum indentation level (tab stops) in the file. Deep nesting correlates with high cognitive load and defect likelihood. Harrison & Magel (1981) identified nesting depth as a significant complexity contributor.

### Unique authors (`Auth`)

Number of distinct git authors who committed to the file within the churn window. Files touched by many authors may lack clear ownership and accumulate inconsistent patterns. Kamei et al. (2013) found developer count to be a significant predictor of defect-introducing changes.

### Tier

Cumulative score distribution bucket:

| Tier | Range | Meaning |
|------|-------|---------|
| **danger** | top 50% of total score | Refactor candidates |
| **watch** | next 30% (50–80%) | Keep an eye on these |
| **stable** | bottom 20% | Low risk |

## Example output

```
Hotspots — 3 months churn window | Total score: 35452
Tiers: 3 danger, 13 watch, 194 stable
Showing: 5 of 210

File                                       Score      %  Churn  Cmplx   Dens Dfcts  Nest  Auth    Tier
────────────────────────────────────────────────────────────────────────────────────────────────────────
src/utils/effect-generator.ts               8296   23.4     68    122   0.12     5     6     4  DANGER
src/services/game-engine.ts                 4284   12.1     51     84   0.09     3     4     3  DANGER
src/components/board-renderer.tsx           2940    8.3     42     70   0.11     2     5     3  DANGER
src/hooks/use-game-state.ts                 1320    3.7     33     40   0.08     1     3     2   WATCH
src/utils/move-validator.ts                  945    2.7     27     35   0.06     0     2     1   WATCH

Score=complexity×churn | Dens=complexity/code | Dfcts=fix commits | Nest=max indent depth | Auth=unique authors
Docs: https://github.com/wbern/obscene#metrics
```

## Supported languages

Any language [scc supports](https://github.com/boyter/scc#features) — 200+ languages including C, C++, Go, Java, JavaScript, TypeScript, Python, Rust, Ruby, PHP, Swift, Kotlin, and many more. No configuration needed; scc auto-detects languages from file extensions.

## Default exclusions

Test and generated files are excluded automatically: `*.test.*`, `*.spec.*`, `__tests__/`, `__mocks__/`, `*.stories.*`, `*.d.ts`, and similar patterns. scc also skips generated files by default (`--no-gen`).

## Why churn x complexity?

Files that are both complex and frequently modified are disproportionately likely to contain defects. This is backed by decades of empirical software engineering research:

- **Nagappan & Ball (2005)** studied Windows Server 2003 and found that relative code churn measures predict system defect density with 89% accuracy. — [ICSE 2005](https://doi.org/10.1109/ICSE.2005.1553571)
- **Moser, Pedrycz & Succi (2008)** compared change metrics against static code attributes on Eclipse and found that process metrics (churn, change frequency) outperform static code metrics for defect prediction. — [ICSE 2008](https://doi.org/10.1145/1368088.1368114)
- **Shin, Meneely, Williams & Osborne (2011)** combined complexity, churn, and developer activity metrics to predict vulnerabilities in Mozilla Firefox and the Linux kernel. By flagging only 10.9% of files, the model identified 70.8% of known vulnerabilities. — [IEEE TSE](https://doi.org/10.1109/TSE.2010.55)
- **Tornhill & Borg (2022)** analyzed 39 proprietary codebases and found that low-quality code (by their Code Health metric) contains 15x more defects and takes 124% longer to resolve. In their case studies, 4% of the codebase was responsible for 72% of all defects. — [ACM/IEEE TechDebt 2022](https://arxiv.org/abs/2203.04374)

The general approach was popularized by Adam Tornhill's *Your Code as a Crime Scene* (2015), which applies forensic analysis techniques to version control history.

## Limitations

- **Churn = commit count**, not lines changed. A one-line typo fix counts the same as a 500-line rewrite.
- **Per-file granularity only.** A 1000-line file with many small functions scores higher than it probably should. No function-level breakdown.
- **Must be run inside a git repo.** Churn data comes from `git log`.
- **Only analyzes files that currently exist.** Deleted files don't appear, even if they churned heavily before removal.
- **Tier thresholds are fixed** (50/80 cumulative %). Not configurable yet.

## License

MIT
