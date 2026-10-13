#!/usr/bin/env bash
# PostToolUse (Write|Edit): run the unit and poller-integration tests that depend on the edited file.
export NO_COLOR=1 FORCE_COLOR=0
command -v jq >/dev/null || { echo "Hook related-tests.sh needs jq: install it or port the hook to Node." >&2; exit 2; }

INPUT=$(cat)
FILE=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty' 2>/dev/null)
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)
[ -n "$FILE" ] || exit 0
case "$FILE" in /*) ;; *) FILE="${CWD:-$PWD}/$FILE" ;; esac

# Modules Vitest can import (no .astro).
case "$FILE" in
  *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs) ;;
  *) exit 0 ;;
esac
[ -f "$FILE" ] || exit 0

# Same checkout rules as lint-edited-file.sh.
ROOT=$(git -C "$(dirname "$FILE")" rev-parse --show-toplevel 2>/dev/null) || exit 0
REPO=$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
SESSION_REPO=$(git -C "${CWD:-$PWD}" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
[ -n "$REPO" ] && [ "$REPO" = "$SESSION_REPO" ] || exit 0
cd "$ROOT" || exit 0

# `vitest related` exits 0 when no test depends on the file. Both suites run in seconds.
REPORT=""
OUT=$(npx --no-install vitest related "$FILE" --run 2>&1 </dev/null) || REPORT="$REPORT
Unit tests (npm test) related to $FILE fail:
$OUT
"
OUT=$(npx --no-install vitest related "$FILE" --run --config vitest.integration.config.ts 2>&1 </dev/null) || REPORT="$REPORT
Poller integration tests (npm run test:integration) related to $FILE fail:
$OUT
"
if [ -n "$REPORT" ]; then
  echo "$REPORT" >&2
  exit 2
fi
exit 0
