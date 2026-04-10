#!/usr/bin/env bash
# apply-patches.sh — Apply OhMyFloyd customization patches onto upstream oh-my-pi
#
# Usage:
#   ./apply-patches.sh --upstream <path-to-upstream-monorepo> [--dry-run]
#
# Patches are sequential and must be applied in order (0001..0008).
# Generated against upstream/main at the time of rebase.

set -euo pipefail

DRY_RUN=""
UPSTREAM=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --dry-run) DRY_RUN=1; shift ;;
        --upstream) UPSTREAM="$2"; shift 2 ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

if [[ -z "$UPSTREAM" ]]; then
    echo "Usage: $0 --upstream <path-to-upstream-monorepo> [--dry-run]"
    echo ""
    echo "Patches require a monorepo checkout (not an npm tarball)."
    echo "Example: git clone https://github.com/can1357/oh-my-pi.git /tmp/upstream"
    echo "         $0 --upstream /tmp/upstream"
    exit 1
fi

if [[ ! -d "$UPSTREAM/.git" ]]; then
    echo "ERROR: $UPSTREAM is not a git repository."
    echo "Patches require a monorepo checkout with git history."
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATCH_DIR="$SCRIPT_DIR/rebased"

if [[ ! -d "$PATCH_DIR" ]]; then
    echo "ERROR: $PATCH_DIR not found. Expected rebased/ directory with .patch files."
    exit 1
fi

cd "$UPSTREAM"

APPLIED=0
FAILED=0

for patch in "$PATCH_DIR"/*.patch; do
    patch_name=$(basename "$patch")
    echo "==> $patch_name"

    if [[ -n "$DRY_RUN" ]]; then
        if git apply --check "$patch" 2>/dev/null; then
            echo "    [DRY-RUN] Would apply cleanly"
            APPLIED=$((APPLIED + 1))
        else
            echo "    [DRY-RUN] CONFLICT:"
            git apply --check "$patch" 2>&1 | sed 's/^/    | /'
            FAILED=$((FAILED + 1))
        fi
    else
        if git apply "$patch" 2>/dev/null; then
            echo "    [OK] Applied"
            APPLIED=$((APPLIED + 1))
        else
            echo "    [FAIL] Could not apply"
            git apply "$patch" 2>&1 | sed 's/^/    | /'
            FAILED=$((FAILED + 1))
            echo "    Stopping. Fix conflicts and re-run from patch $patch_name."
            break
        fi
    fi
done

echo ""
echo "=== Result: $APPLIED applied, $FAILED failed ==="
if [[ $FAILED -gt 0 ]]; then
    echo "Patches may need regeneration against the current upstream version."
    echo "See: git format-patch upstream/main..HEAD -o patches/rebased"
    exit 1
fi
