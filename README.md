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
obscene coupling                 # temporal coupling analysis
obscene coupling --min-cochanges 1 --format table
obscene --exclude "*.generated.*"
obscene | jq '.rankings.complexity.entries[0]'  # pipe-friendly
```

## Commands

### `obscene hotspots` (default)

Produces **four independent ranking tables**, each scoring files by a different metric multiplied by churn:

| Ranking | Score formula | Metric columns |
|---------|---------------|----------------|
| Complexity × Churn | `complexity × churn` | Cmplx, Dens |
| Nesting × Churn | `maxNesting × churn` | Nest |
| Defects × Churn | `defects × churn` | Dfcts, DfDns |
| Authors × Churn | `authors × churn` | Auth |

Plus a **Combined** ranking using [Reciprocal Rank Fusion](https://doi.org/10.1145/1571941.1572114) (RRF) across all dimensions — files appearing near the top of multiple rankings score highest.

Each table has its own tier assignment by cumulative score distribution:

| Tier | Range | Meaning |
|------|-------|---------|
| 🔥 **hot** | top 50% of total score | Highest churn × metric load |
| ☀️ **warm** | next 30% (50–80%) | Moderate load |
| 🧊 **cool** | bottom 20% | Low load |

Tiers are relative to THIS codebase, not absolute quality grades. A "hot" file is under heavy load, not necessarily broken.

A file may rank high in one dimension (e.g. complexity) but low in another (e.g. authors). Rankings with insufficient data are skipped with an explanation (e.g. defects ranking requires 5+ `fix:` commits across 3+ files). Bot authors (`[bot]` suffix) are filtered automatically.

### `obscene coupling`

Detects files that frequently change together in the same commit but live in different directories — Tornhill's "temporal coupling" analysis from *Your Code as a Crime Scene* (2015). Surfaces hidden structural dependencies that aren't visible in imports or the module graph.

Same-directory pairs are excluded (co-location is expected coupling). Mass commits touching >20 files are skipped (formatting changes, large refactors). See [Why temporal coupling?](#why-temporal-coupling) for the research backing this approach.

```bash
obscene coupling                          # default: min 2 shared commits
obscene coupling --min-cochanges 1        # include single co-occurrences
obscene coupling --format table --top 10  # human-readable, top 10
```

### `obscene report`

Per-file complexity without churn. Useful for raw complexity distribution.

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--top <n>` | `20` | Limit results (0 = all) |
| `--months <n>` | `3` | Churn window in months |
| `--format <type>` | `json` | `json` or `table` |
| `--min-cochanges <n>` | `2` | Minimum shared commits (coupling only) |
| `--exclude <patterns...>` | — | Additional exclusion patterns (also reads `.obsignore` / `.obsceneignore`) |

## Metrics

### Hotspot metrics

#### Score

`metric × churn`. Each ranking table uses a different metric (complexity, nesting, defects, or authors) multiplied by churn. See [Why churn × complexity?](#why-churn-x-complexity) for the research backing this approach.

#### Churn (`Churn`)

Number of commits touching the file within the configured time window (default: 3 months). Measures how actively the file is being modified.

#### Cyclomatic complexity (`Cmplx`)

Total cyclomatic complexity as reported by [scc](https://github.com/boyter/scc). Counts independent execution paths (branches, loops, conditions). Higher values mean more paths to test and more places for bugs to hide.

#### Complexity density (`Dens`)

`complexity / lines of code`. Normalizes complexity by file size so a 50-line file with complexity 25 (density 0.50) stands out against a 500-line file with complexity 25 (density 0.05). Based on Harrison & Magel (1981), who found that complexity relative to code size is a stronger fault predictor than raw complexity alone.

#### Defects (`Dfcts`)

Count of `fix:` conventional commits touching the file within the churn window. A proxy for historical defect rate — files that attract repeated fixes are more likely to contain latent bugs. Inspired by Moser, Pedrycz & Succi (2008), who showed that change-history metrics outperform static code metrics for defect prediction.

#### Defect density (`DfDns`)

`defects / lines of code`. Shown in the Defects × Churn table. Normalizes defect count by file size.

#### Nesting depth (`Nest`)

Maximum indentation level (tab stops) in the file. Deep nesting correlates with high cognitive load and defect likelihood. Harrison & Magel (1981) identified nesting depth as a significant complexity contributor.

#### Unique authors (`Auth`)

Number of distinct git authors who committed to the file within the churn window. Bot authors (names ending in `[bot]`, e.g. `dependabot[bot]`) are excluded automatically. Files touched by many authors may lack clear ownership and accumulate inconsistent patterns. Kamei et al. (2013) found developer count to be a significant predictor of defect-introducing changes.

### Coupling metrics

#### Shared commits (`Shared`)

Number of commits where both files in a pair were modified together. The core ranking metric for temporal coupling — higher values indicate stronger hidden dependencies between files in different directories. Ball, Kim, Porter & Siy (1997) demonstrated that co-change relationships reveal design dependencies that static analysis misses.

#### Coupling degree (`Degree`)

`shared commits / min(churn of file1, churn of file2) × 100`. What percentage of the less-active file's changes also involved the other file. A degree of 100% means every change to the less-active file also touched the other file. This normalization follows D'Ambros, Lanza & Lungu (2009), who showed that relative coupling measures provide more stable results than raw co-change counts across projects of different sizes.

#### Combined complexity (`Cmplx`)

Sum of cyclomatic complexity of both files in the pair. Highlights coupled pairs where the involved code is also complex — the combination of hidden dependency and high complexity compounds maintenance risk.

#### Tier

Cumulative score distribution bucket:

| Tier | Range | Meaning |
|------|-------|---------|
| 🔥 **hot** | top 50% of total score | Highest coupling load |
| ☀️ **warm** | next 30% (50–80%) | Moderate coupling |
| 🧊 **cool** | bottom 20% | Low coupling |

## Example output

```
Hotspots — 3 months churn window

🧬 COMPLEXITY × 🔄 CHURN — Total score: 35,452
complexity × churn. Complex code that changes often poses maintenance risk.
Tiers: 3 HOT, 13 WARM, 194 COOL
Showing: 5 of 210

File                                                Score       %  Churn  Cmplx   Dens        Tier
──────────────────────────────────────────────────────────────────────────────────────────────────
src/utils/effect-generator.ts                       8,296    23.4     68    122   0.12  🔥 HOT
src/services/game-engine.ts                         4,284    12.1     51     84   0.09  🔥 HOT
src/components/board-renderer.tsx                   2,940     8.3     42     70   0.11  🔥 HOT
src/hooks/use-game-state.ts                         1,320     3.7     33     40   0.08  ☀️ WARM
src/utils/move-validator.ts                           945     2.7     27     35   0.06  ☀️ WARM

· · ·

📏 NESTING × 🔄 CHURN — Total score: 1,284
maxNesting × churn. Deeply nested code that changes often is harder to reason about.
Tiers: 2 HOT, 5 WARM, 203 COOL
Showing: 5 of 210

File                                                Score       %  Churn  Nest        Tier
────────────────────────────────────────────────────────────────────────────────────────
src/utils/effect-generator.ts                         408    31.8     68     6  🔥 HOT
src/services/game-engine.ts                           255    19.8     51     5  🔥 HOT
src/components/board-renderer.tsx                     210    16.4     42     5  ☀️ WARM
src/hooks/use-game-state.ts                            99     7.7     33     3  ☀️ WARM
src/utils/move-validator.ts                            54     4.2     27     2  ☀️ WARM

════════════════════════════════════════════════════════════════════════════════════
★ COMBINED — Total score: 1.2345
Tiers: 3 HOT, 5 WARM, 202 COOL
Showing: 5 of 210

File                                                Score       %  Churn  Dims        Tier
────────────────────────────────────────────────────────────────────────────────────────
src/utils/effect-generator.ts                      0.2727    22.1     68     4  🔥 HOT
src/services/game-engine.ts                        0.1667    13.5     51     3  🔥 HOT
src/components/board-renderer.tsx                   0.127    10.3     42     3  🔥 HOT
src/hooks/use-game-state.ts                        0.0769     6.2     33     2  ☀️ WARM
src/utils/move-validator.ts                        0.0667     5.4     27     2  ☀️ WARM

Score=metric×churn | Tiers are relative to THIS codebase, not absolute quality grades.
High scores flag review candidates, not bad code — stable complex files (parsers, engines) score high naturally.
Docs: https://github.com/wbern/obscene#metrics
```

### Coupling example

```
Coupling — 6 months churn window | Min shared: 3 | Total score: 91
Tiers: 10 HOT, 7 WARM, 7 COOL
Showing: 5 of 24

File 1                             File 2                              Shared  Degree  Cmplx      Tier
──────────────────────────────────────────────────────────────────────────────────────────────────────
…ePlayer/hooks/useChessEffects.ts  src/utils/effect-generator.ts            6   46.2%    261  🔥 HOT
…ePlayer/hooks/useChessEffects.ts  src/utils/pgn-types.ts                   6   50.0%    121  🔥 HOT
src/test/pgn-fixtures.ts           src/utils/pgn-parser.server.ts           5   71.4%      3  🔥 HOT
src/test/pgn-fixtures.ts           src/utils/effect-generator.ts            4   57.1%    145  🔥 HOT
src/test/pgn-fixtures.ts           src/utils/pgn-types.ts                   4   57.1%      5  🔥 HOT

Shared=co-changed commits | Degree=shared/min(churn)×100 | Cmplx=sum of both files
Tiers are relative to THIS codebase, not absolute quality grades. High coupling may be intentional and fine.
Same-directory pairs excluded. Commits touching >20 files skipped. Only cross-directory dependencies shown.
Docs: https://github.com/wbern/obscene#metrics
```

## Supported languages

Any language [scc supports](https://github.com/boyter/scc#features) — 200+ languages including C, C++, Go, Java, JavaScript, TypeScript, Python, Rust, Ruby, PHP, Swift, Kotlin, and many more. No configuration needed; scc auto-detects languages from file extensions.

## Default exclusions

Test and generated files are excluded automatically: `*.test.*`, `*.spec.*`, `__tests__/`, `__mocks__/`, `*.stories.*`, `*.d.ts`, and similar patterns. scc also skips generated files by default (`--no-gen`).

## Ignore files

Create a `.obsignore` or `.obsceneignore` file in your project root to persist exclusion patterns:

```
# vendored code
vendor/**

# generated API clients
*.generated.*
src/api/generated/**
```

- One glob pattern per line (same syntax as `--exclude`)
- Lines starting with `#` are comments
- Empty lines are ignored
- `.obsignore` takes priority if both files exist (they are not merged)
- CLI `--exclude` patterns are additive on top of ignore file patterns

## Why churn x complexity?

Files that are both complex and frequently modified are disproportionately likely to contain defects. This is backed by decades of empirical software engineering research:

- **Nagappan & Ball (2005)** studied Windows Server 2003 and found that relative code churn measures predict system defect density with 89% accuracy. — [ICSE 2005](https://doi.org/10.1109/ICSE.2005.1553571)
- **Moser, Pedrycz & Succi (2008)** compared change metrics against static code attributes on Eclipse and found that process metrics (churn, change frequency) outperform static code metrics for defect prediction. — [ICSE 2008](https://doi.org/10.1145/1368088.1368114)
- **Shin, Meneely, Williams & Osborne (2011)** combined complexity, churn, and developer activity metrics to predict vulnerabilities in Mozilla Firefox and the Linux kernel. By flagging only 10.9% of files, the model identified 70.8% of known vulnerabilities. — [IEEE TSE](https://doi.org/10.1109/TSE.2010.55)
- **Tornhill & Borg (2022)** analyzed 39 proprietary codebases and found that low-quality code (by their Code Health metric) contains 15x more defects and takes 124% longer to resolve. In their case studies, 4% of the codebase was responsible for 72% of all defects. — [ACM/IEEE TechDebt 2022](https://arxiv.org/abs/2203.04374)

The general approach was popularized by Adam Tornhill's *Your Code as a Crime Scene* (2015), which applies forensic analysis techniques to version control history.

## Why temporal coupling?

Files that change together but live in different directories reveal implicit dependencies that the module graph doesn't capture. These hidden couplings are a maintenance hazard: a developer modifying one file doesn't know they also need to update the other, leading to bugs that only surface later.

- **Ball, Kim, Porter & Siy (1997)** pioneered co-change analysis and showed that version control history surfaces design relationships invisible to static analysis. — [ICSE 1997 Workshop](https://www.researchgate.net/publication/2791666_If_Your_Version_Control_System_Could_Talk)
- **D'Ambros, Lanza & Lungu (2009)** developed the Evolution Radar for visualizing logical coupling at both file and module level, showing how evolutionary coupling reveals architectural decay. The normalized approach (coupling relative to total changes) provides more stable measures across projects of different sizes. — [IEEE TSE](https://doi.org/10.1109/TSE.2009.17)
- **Tornhill (2015)** popularized temporal coupling analysis in *Your Code as a Crime Scene*, demonstrating how co-change patterns reveal "surprise dependencies" — files that should logically be independent but can't be changed separately in practice. His tooling (Code Maat) uses the same commit co-occurrence approach.
- **Cataldo, Mockus, Roberts & Herbsleb (2009)** analyzed both syntactic and logical dependencies across two large systems and found that logical (co-change) dependencies have a significant independent effect on failure proneness. When developers are unaware of these hidden couplings, defects increase. — [IEEE TSE](https://doi.org/10.1109/TSE.2009.42)

## Limitations

### General

- **Churn = commit count**, not lines changed. A one-line typo fix counts the same as a 500-line rewrite.
- **Per-file granularity only.** A 1000-line file with many small functions scores higher than it probably should. No function-level breakdown.
- **Must be run inside a git repo.** Churn data comes from `git log`.
- **Only analyzes files that currently exist.** Deleted files don't appear, even if they churned heavily before removal.
- **Tier thresholds are fixed** (50/80 cumulative %). Not configurable yet.

### Coupling-specific

- **Same-directory exclusion is a heuristic.** Files in the same directory that are unexpectedly coupled won't be surfaced. The assumption is that co-located files are *expected* to change together.
- **Mass commit threshold (>20 files) is hardcoded.** Commits touching many files are skipped to avoid noise from formatting changes and large refactors, but legitimate large features that touch many files across directories are also excluded.
- **Degree uses unfiltered churn.** The denominator (`min(churn)`) counts all commits to a file, including single-file commits. This means degree can understate coupling when a file has high solo churn.
- **Squash merges collapse coupling signal.** If a branch with 10 separate commits is squash-merged into one, all co-changes within that branch become a single co-occurrence.

## License

MIT
