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

## Example output

```
Hotspots — 3 months churn window | Total score: 35452
Tiers: 3 danger, 13 watch, 194 stable
Showing: 5 of 210

File                                       Score      %  Churn  Cmplx  Density    Tier
──────────────────────────────────────────────────────────────────────────────────────
src/utils/effect-generator.ts               8296   23.4     68    122     0.12  DANGER
src/services/game-engine.ts                 4284   12.1     51     84     0.09  DANGER
src/components/board-renderer.tsx           2940    8.3     42     70     0.11  DANGER
src/hooks/use-game-state.ts                 1320    3.7     33     40     0.08   WATCH
src/utils/move-validator.ts                  945    2.7     27     35     0.06   WATCH
```

## Default exclusions

Test and generated files are excluded automatically: `*.test.*`, `*.spec.*`, `__tests__/`, `__mocks__/`, `*.stories.*`, `*.d.ts`, and similar patterns.

## License

MIT
