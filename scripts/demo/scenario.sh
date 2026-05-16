#!/usr/bin/env bash
# Drives the README demo for obscene. Pretends to be a developer
# poking at an unfamiliar repo. Run inside an asciinema recording —
# every command is "typed" char-by-char so the cast looks like a real
# session.
#
# Usage: scenario.sh <section>
#   init       - generate a starter .obsignore (focused setup demo)
#   hotspots   - run the hotspot table (the main feature)
#   coupling   - cross-directory temporal coupling
#   confidence - thin-signal repo, watch obscene refuse to rank
#   all        - the README hero gif: hotspots -> coupling (no setup; usage only)
#
# The recorder is responsible for bootstrapping the workspace silently
# before invoking this script — repo plumbing is not part of what the
# viewer needs to see.
#
# Note: -e is intentionally NOT set. We want the scenario to keep
# going even if a command exits non-zero.
set -uo pipefail

SECTION="${1:-all}"

# Typing speed (seconds per char). Lower = faster.
TYPE_SPEED="${TYPE_SPEED:-0.025}"
# Pause after each command's output before the next prompt. Tables are
# information-dense so the viewer needs a moment to actually read them.
BEAT="${BEAT:-2.5}"

GREEN=$'\033[1;32m'
DIM=$'\033[2m'
BOLD=$'\033[1m'
CYAN=$'\033[1;36m'
RESET=$'\033[0m'

prompt() { printf '%s$%s ' "$GREEN" "$RESET"; }

# Type a command char-by-char and then run it through eval.
do_cmd() {
    local cmd="$1"
    prompt
    local i ch
    for ((i=0; i<${#cmd}; i++)); do
        ch="${cmd:i:1}"
        printf '%s' "$ch"
        sleep "$TYPE_SPEED"
    done
    printf '\n'
    eval "$cmd"
    sleep "$BEAT"
}

# Inline narrator comment.
say() {
    printf '%s# %s%s\n' "$DIM" "$1" "$RESET"
    sleep 0.6
}

banner() {
    printf '\n%s━━ %s ━━%s\n\n' "$CYAN" "$1" "$RESET"
    sleep 0.6
}

section_init() {
    banner "Setup: tell obscene what to ignore"
    say "Fresh checkout. obscene reminds us to set up exclusions first."
    do_cmd "obscene init"
    say "It detected this project's layout and wrote a starter .obsignore."
    do_cmd "cat .obsignore | head -20"
}

section_hotspots() {
    banner "Find the hotspots"
    say "complexity × churn — files that are both gnarly AND frequently touched."
    do_cmd "obscene --format table --top 8"
}

section_coupling() {
    banner "Cross-directory coupling"
    say "Which files keep changing together? Often a sign of hidden coupling."
    do_cmd "obscene coupling --format table --top 8 --months 6"
}

section_confidence() {
    banner "Bonus: obscene refuses to fabricate signal"
    say "Pointed at a fresh repo with one trivial file..."
    do_cmd "ls"
    do_cmd "git --no-pager log --oneline"
    say "...obscene tells you the signal is too thin to rank, instead of guessing."
    do_cmd "obscene --format table"
}

case "$SECTION" in
    init)       section_init ;;
    hotspots)   section_hotspots ;;
    coupling)   section_coupling ;;
    confidence) section_confidence ;;
    all)
        # Hero: actual usage only (no setup). The hero focuses on
        # running obscene and seeing the hotspots + coupling output;
        # `obscene init` is shown in its own focused demo.
        section_hotspots
        section_coupling
        ;;
    *) echo "unknown section: $SECTION" >&2; exit 2 ;;
esac

# Final beat so the GIF doesn't end mid-prompt.
printf '\n%sDone.%s\n' "$BOLD" "$RESET"
sleep 1.5
