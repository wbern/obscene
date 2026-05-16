#!/usr/bin/env bash
# Record an asciinema cast + agg-rendered GIF for one or more demo sections.
#
# Outputs:
#   docs/demo-<section>.cast
#   docs/demo-<section>.gif
#
# Usage:
#   ./scripts/demo/record_demo.sh                   # records hero (all) + focused
#   ./scripts/demo/record_demo.sh hotspots          # just one
#   ./scripts/demo/record_demo.sh --no-gif          # skip agg conversion
#
# Requires: asciinema, agg (brew install asciinema agg). Plus a built
# obscene at dist/cli.js — the script will run `pnpm build` if missing.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCENARIO="$REPO_ROOT/scripts/demo/scenario.sh"
DOCS_DIR="$REPO_ROOT/docs"
TMP_BIN="$(mktemp -d)/bin"
mkdir -p "$TMP_BIN" "$DOCS_DIR"

# Recording geometry. Matches a comfortable README display size.
COLS=100
ROWS=30
THEME="${AGG_THEME:-monokai}"
FONT_SIZE="${AGG_FONT_SIZE:-14}"

WANT_GIF=1
SECTIONS=()
for arg in "$@"; do
    case "$arg" in
        --no-gif) WANT_GIF=0 ;;
        init|hotspots|coupling|confidence|all) SECTIONS+=("$arg") ;;
        *) echo "unknown arg: $arg" >&2; exit 2 ;;
    esac
done
if [[ ${#SECTIONS[@]} -eq 0 ]]; then
    SECTIONS=(all hotspots coupling confidence)
fi

if [[ ! -f "$REPO_ROOT/dist/cli.js" ]]; then
    if ! command -v pnpm >/dev/null 2>&1; then
        echo "error: dist/cli.js missing and pnpm not installed." >&2
        echo "       Build first: pnpm install && pnpm build" >&2
        exit 1
    fi
    echo "==> dist/cli.js missing; running pnpm build"
    (cd "$REPO_ROOT" && pnpm build)
fi

# Wrap dist/cli.js as an `obscene` binary so the recorded prompt shows
# the published command name, not `node dist/cli.js`.
cat > "$TMP_BIN/obscene" <<EOF
#!/usr/bin/env bash
exec node "$REPO_ROOT/dist/cli.js" "\$@"
EOF
chmod +x "$TMP_BIN/obscene"

# Workspace each scenario boots into. Lives under \$HOME so the prompt
# shows a neutral relative path like `obscene-demo` rather than an
# absolute home or tmp path.
WORKSPACE_ROOT="${HOME:?HOME must be set}/.obscene-demo-workspace"
rm -rf "$WORKSPACE_ROOT"
mkdir -p "$WORKSPACE_ROOT"
trap 'rm -rf "$WORKSPACE_ROOT"' EXIT

bootstrap_repo_workspace() {
    local proj="$1"
    # Clone the repo locally so the demo has real history but no
    # absolute-path leakage in the prompt. --local keeps it fast and
    # avoids the network.
    git clone --quiet --local "$REPO_ROOT" "$proj"
    # Remove the .obsignore that ships in the repo, so `obscene init`
    # has something to do in the demo.
    rm -f "$proj/.obsignore"
    # Build the binary inside the cloned workspace so dist/cli.js exists
    # for any scenarios that need a local node_modules. We don't run
    # pnpm install — `obscene` is invoked through $TMP_BIN/obscene which
    # points at the source repo's dist/cli.js.
    :
}

bootstrap_thin_repo() {
    local proj="$1"
    mkdir -p "$proj"
    (
        cd "$proj"
        git init -q
        git config user.email "demo@example.com"
        git config user.name "demo"
        cat > hello.ts <<'TS'
export function hello(name: string): string {
    return `hello, ${name}`;
}
TS
        git add hello.ts
        git commit -q -m "feat: initial hello"
        cat >> hello.ts <<'TS'

export function shout(name: string): string {
    return hello(name).toUpperCase();
}
TS
        git add hello.ts
        git commit -q -m "feat: add shout"
    )
}

sanitize_cast_header() {
    local cast="$1"
    # Rewrite line 1: keep only version/term/timestamp/idle_time_limit.
    # Use python for robust JSON handling — every recording host has it
    # (macOS ships /usr/bin/python3, CI images all have python3).
    python3 - "$cast" <<'PY'
import json, sys, pathlib
path = pathlib.Path(sys.argv[1])
lines = path.read_text().splitlines()
header = json.loads(lines[0])
keep = {k: header[k] for k in ("version", "term", "timestamp", "idle_time_limit") if k in header}
lines[0] = json.dumps(keep, separators=(",", ":"))
path.write_text("\n".join(lines) + "\n")
PY
}

record_one() {
    local section="$1"
    local workdir="$WORKSPACE_ROOT/$section"
    mkdir -p "$workdir"

    local cast="$DOCS_DIR/demo-$section.cast"
    local gif="$DOCS_DIR/demo-$section.gif"

    local proj
    case "$section" in
        confidence)
            proj="$workdir/hello-world"
            echo "==> Bootstrapping thin-signal repo for: $section (silent)"
            bootstrap_thin_repo "$proj"
            ;;
        hotspots|coupling|all)
            proj="$workdir/obscene-demo"
            echo "==> Bootstrapping cloned workspace for: $section (silent)"
            bootstrap_repo_workspace "$proj"
            # These sections skip the init step in the scenario, so we
            # need an .obsignore already in place. Prefer the repo's
            # own; fall back to generating one silently so the scenario
            # doesn't show the "no .obsignore found" hint.
            if [[ -f "$REPO_ROOT/.obsignore" ]]; then
                cp "$REPO_ROOT/.obsignore" "$proj/.obsignore"
            else
                if ! (cd "$proj" && PATH="$TMP_BIN:$PATH" obscene init >/dev/null 2>&1); then
                    echo "    warning: obscene init failed; recording may show no-.obsignore hint" >&2
                fi
            fi
            ;;
        init)
            proj="$workdir/obscene-demo"
            echo "==> Bootstrapping cloned workspace for: $section (silent)"
            bootstrap_repo_workspace "$proj"
            ;;
    esac

    echo "==> Recording section: $section"
    # Use a one-shot launcher that cd's into the workspace and execs
    # scenario.sh. Two reasons we don't use `bash -c "cd … && bash …"`
    # here: (1) any nested `bash -c` layer block-buffers stdout, which
    # collapses scenario.sh's char-by-char typing animation into a
    # single cast event and ruins the perceived duration of the GIF;
    # (2) running scenario.sh as the *direct* child of asciinema lets
    # it run under asciinema's PTY, which is line-buffered.
    local launcher="$TMP_BIN/launch-$section.sh"
    # Heredoc terminator is intentionally unquoted: we want $proj, $TMP_BIN,
    # $TYPE_SPEED, $BEAT, $SCENARIO, $section expanded NOW (when the launcher
    # is written), not later when it runs. Do not change to <<'EOF'.
    cat > "$launcher" <<EOF
#!/usr/bin/env bash
cd "$proj"
export PATH="$TMP_BIN:\$PATH"
export TYPE_SPEED="${TYPE_SPEED:-0.025}"
export BEAT="${BEAT:-2.5}"
exec bash "$SCENARIO" "$section"
EOF
    chmod +x "$launcher"
    asciinema rec \
        --overwrite \
        --window-size "${COLS}x${ROWS}" \
        --idle-time-limit 3 \
        --command "$launcher" \
        "$cast"
    # Scrub the cast header. asciinema records the full `--command`
    # string and env vars (SHELL, etc.) into line 1 of the .cast file.
    # That string contains absolute home/tmp paths that we don't want
    # to commit. Players don't need `command` or `env` to replay the
    # cast, so we drop them and keep only the structural fields.
    sanitize_cast_header "$cast"
    echo "    wrote $cast"

    if [[ "$WANT_GIF" -eq 1 ]]; then
        if command -v agg >/dev/null 2>&1; then
            agg --theme "$THEME" --font-size "$FONT_SIZE" "$cast" "$gif"
            local sz
            sz=$(du -h "$gif" | cut -f1)
            echo "    wrote $gif ($sz)"
        else
            echo "    agg not installed - skipping gif (brew install agg)" >&2
        fi
    fi
}

for s in "${SECTIONS[@]}"; do
    record_one "$s"
done

echo "==> Done. Outputs in $DOCS_DIR/"
