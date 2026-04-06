# obscene

Hotspot analysis CLI — identifies files that are both complex and frequently changed.

## Package manager

**pnpm** — always use `pnpm` for install, run, exec commands. Never npm or yarn.

## Git identity

All commits must use author `wbern <wbern@users.noreply.github.com>`.
The pre-commit hook validates this. If Gas Town sets `GIT_AUTHOR_NAME` in the
environment (it does for crew agents), unset it before committing:

```bash
unset GIT_AUTHOR_NAME
```

## Commits

- Use **conventional commits**: `feat:`, `fix:`, `docs:`, `chore:`, etc.
- **No Co-Authored-By trailers** — commitlint blocks Claude Code promotional text.
  Set `"includeCoAuthoredBy": false` in `.claude/settings.local.json`.
- **Never use `--no-verify`** — always let the pre-commit hooks run.

## Key commands

```bash
pnpm build              # Build CLI (tsup → dist/)
pnpm test               # Run tests
pnpm test:coverage      # Run tests with 100% coverage enforcement
pnpm lint               # Biome lint + format check
pnpm lint:fix           # Biome auto-fix
pnpm knip               # Check for unused code/dependencies
pnpm duplication-check  # Check for code duplication (jscpd)
pnpm typecheck          # TypeScript type check (tsc --noEmit)
```

## Architecture

- `src/cli.ts` — CLI entry point (commander)
- `src/analyze.ts` — Core analysis: scc runner, git churn, hotspot scoring
- `src/format.ts` — Output formatting (JSON, table)
- `src/types.ts` — Shared TypeScript interfaces

## Pre-commit checks (husky)

All of these run on every commit via `.husky/pre-commit`:

1. **Author validation** — Rejects commits with wrong git identity
2. **Lockfile sync** — Validates pnpm-lock.yaml if package.json changed
3. **lint-staged** — Biome format/lint + tsc + secretlint on staged files
4. **knip** — Unused code/dependency detection
5. **jscpd** — Code duplication detection
6. **tsup build** — Ensures build succeeds
7. **vitest coverage** — Tests with 100% coverage thresholds

Additionally, `.husky/commit-msg` runs **commitlint** when `CLAUDECODE=1` to
enforce conventional commit format and block promotional text.

## External dependency

Requires [scc](https://github.com/boyter/scc) installed on the system for complexity analysis.
