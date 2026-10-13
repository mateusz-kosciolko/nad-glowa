#!/usr/bin/env bash
# PostToolUse (Write|Edit): lint the file the agent just edited, without --fix.
# Exit 2 + stderr is the only combination Claude sees.
export NO_COLOR=1 FORCE_COLOR=0
command -v jq >/dev/null || { echo "Hook lint-edited-file.sh needs jq: install it or port the hook to Node." >&2; exit 2; }

INPUT=$(cat)
FILE=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty' 2>/dev/null)
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)
[ -n "$FILE" ] || exit 0
case "$FILE" in /*) ;; *) FILE="${CWD:-$PWD}/$FILE" ;; esac

# Extensions eslint.config.js covers (typescript-eslint + eslint-plugin-astro).
case "$FILE" in
  *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.astro) ;;
  *) exit 0 ;;
esac
[ -f "$FILE" ] || exit 0

# Checkout of the edited file, not $CLAUDE_PROJECT_DIR (stale after EnterWorktree, wrong for a
# sibling worktree). Files of other repositories (~/.claude, other projects) are skipped.
ROOT=$(git -C "$(dirname "$FILE")" rev-parse --show-toplevel 2>/dev/null) || exit 0
REPO=$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
SESSION_REPO=$(git -C "${CWD:-$PWD}" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
[ -n "$REPO" ] && [ "$REPO" = "$SESSION_REPO" ] || exit 0
cd "$ROOT" || exit 0

# Register the checkout so end-of-turn.sh sweeps it too, even when it is not the session cwd.
SID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null | tr -cd 'A-Za-z0-9_-')
if [ -n "$SID" ] && mkdir -p "${TMPDIR:-/tmp}/claude-hooks"; then
  printf '%s\n' "$ROOT" >>"${TMPDIR:-/tmp}/claude-hooks/$SID.roots"
fi

# --no-install: a linter that is not installed fails here (exit 2) instead of passing.
# Files ignored by eslint.config.js (.claude/, generated types) only warn, which --quiet drops.
if ! OUTPUT=$(npx --no-install eslint --quiet "$FILE" 2>&1 </dev/null); then
  echo "ESLint reported errors in $FILE:" >&2
  echo "$OUTPUT" >&2
  exit 2
fi
exit 0
