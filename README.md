# code-hotspots

Identify hotspot files — complex code that changes frequently.

Combines [scc](https://github.com/boyter/scc) (cyclomatic complexity) with git churn data to find files that are both complex AND frequently modified. Based on the methodology from Adam Tornhill's *Your Code as a Crime Scene*.

Works on any language scc supports. No configuration needed.

## Install

```bash
npm install -g code-hotspots
```

Requires [scc](https://github.com/boyter/scc#install) to be installed separately.

## Usage

```bash
# Run from any git repo — shows top 20 hotspots (default)
hotspot

# More results
hotspot --top 50

# All files
hotspot --top 0

# 6-month churn window (default: 3)
hotspot --months 6

# Raw complexity data (no churn)
hotspot report

# Human-readable table output
hotspot --format table

# Custom exclusion patterns
hotspot --exclude "*.generated.*"

# Pipe-friendly JSON to stdout
hotspot | jq '.hotspots[0]'
```

## Commands

### `hotspot hotspots` (default)

Churn × complexity analysis. Scores each file by `complexity × commits` over a configurable time window, then assigns tiers based on cumulative score distribution:

- **danger** — files accounting for the top 50% of total hotspot score
- **watch** — next 30% (cumulative 50–80%)
- **stable** — bottom 20%

### `hotspot report`

Per-file complexity data without churn. Useful for understanding raw complexity distribution.

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--top <n>` | `20` | Limit to top N entries (0 = all) |
| `--months <n>` | `3` | Churn window in months (hotspots only) |
| `--format <type>` | `json` | Output format: `json` or `table` |
| `--exclude <patterns...>` | — | Additional file patterns to exclude |

## Output

JSON output to stdout. Example:

```json
{
  "generated": "2026-04-06T07:10:33.290Z",
  "churnWindow": "3 months",
  "totalScore": 35452,
  "tierCounts": { "danger": 3, "watch": 13, "stable": 194 },
  "totalHotspots": 210,
  "showing": 20,
  "hotspots": [
    {
      "file": "src/utils/effect-generator.ts",
      "code": 1055,
      "lines": 1404,
      "complexity": 122,
      "comments": 265,
      "complexityDensity": 0.12,
      "churn": 68,
      "hotspotScore": 8296,
      "percentOfTotal": 23.4,
      "tier": "danger"
    }
  ]
}
```

## Default exclusions

Test and generated files are excluded by default:

- `*.test.*`, `*.spec.*`, `*.integration.test.*`
- `test-setup.*`, `test-utils.*`, `test-helpers.*`
- `__tests__/`, `__mocks__/`
- `*.stories.*`, `*.d.ts`

Use `--exclude` to add additional patterns.

## Key metrics

- **complexity** — cyclomatic complexity (from scc)
- **churn** — number of commits touching the file in the time window
- **hotspotScore** — `complexity × churn`
- **complexityDensity** — `complexity / code_lines` — distinguishes "long but simple" from "genuinely branchy"

## Why

- MSR 2026 study (806 repos): +41% complexity after AI code adoption
- GitClear: refactoring dropped 60% industry-wide
- No existing open-source tool combines churn × complexity with tier classification and structured JSON output

## License

MIT
