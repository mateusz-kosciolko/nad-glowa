#!/usr/bin/env bash
# Stop: sweep everything changed in the working tree before the agent finishes, one retry.
# Lint of changed files, both Vitest suites (seconds), whole-project `astro check`.
export NO_COLOR=1 FORCE_COLOR=0
command -v jq >/dev/null || { echo "Hook end-of-turn.sh needs jq: install it or port the hook to Node." >&2; exit 2; }

INPUT=$(cat)

# Already sent back once by this hook: let it finish. The commit gate and CI catch the rest.
# (loop_count covers Cursor, which imports hooks from .claude/settings.json.)
ACTIVE=$(printf '%s' "$INPUT" | jq -r '.stop_hook_active // false' 2>/dev/null)
LOOPS=$(printf '%s' "$INPUT" | jq -r '.loop_count // 0' 2>/dev/null)
if [ "$ACTIVE" = "true" ] || [ "${LOOPS:-0}" != "0" ]; then
  exit 0
fi

# Checkouts to sweep: the session's (payload cwd follows EnterWorktree, $CLAUDE_PROJECT_DIR
# does not) plus every checkout lint-edited-file.sh registered for this session.
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)
SID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null | tr -cd 'A-Za-z0-9_-')
STATE="${TMPDIR:-/tmp}/claude-hooks"
REGISTRY="$STATE/${SID:-none}.roots"
GREEN="$STATE/${SID:-none}.green"
ROOTS=()
while IFS= read -r r; do
  [ -n "$r" ] && [ -d "$r" ] && ROOTS+=("$r")
done <<EOF
$({ git -C "${CWD:-$PWD}" rev-parse --show-toplevel 2>/dev/null; [ -n "$SID" ] && cat "$REGISTRY" 2>/dev/null; } | sort -u)
EOF
if [ "${#ROOTS[@]}" -eq 0 ]; then
  # Not silent: the user sees why nothing was checked.
  jq -cn --arg m "end-of-turn.sh: no git checkout at ${CWD:-$PWD}, nothing checked." '{systemMessage: $m}'
  exit 0
fi

# Fingerprint of a checkout's uncommitted state: HEAD, the diff and untracked files' content.
fingerprint() {
  {
    git rev-parse HEAD
    git diff HEAD --binary
    git ls-files -o --exclude-standard
    git ls-files -o --exclude-standard | git hash-object --stdin-paths
  } 2>/dev/null | git hash-object --stdin
}

REPORT=""
NEW_GREEN=""
for ROOT in "${ROOTS[@]}"; do
  cd "$ROOT" || continue

  # Changed and new files. Nothing changed: nothing to check here.
  CHANGED=$({ git diff --name-only HEAD; git ls-files -o --exclude-standard; } 2>/dev/null | sort -u)
  [ -n "$CHANGED" ] || continue

  # Same tree as the last green sweep in this session (a Q&A turn on a dirty tree): skip.
  FP=$(fingerprint)
  if [ -n "$SID" ] && grep -qxF "$ROOT	$FP" "$GREEN" 2>/dev/null; then
    NEW_GREEN="$NEW_GREEN$ROOT	$FP
"
    continue
  fi
  ROOT_REPORT=""

  # Changed files ESLint covers that still exist. This also catches files rewritten through a
  # shell command, which never reach the per-edit hook.
  FILES=()
  while IFS= read -r f; do
    case "$f" in *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.astro) [ -f "$f" ] && FILES+=("$f") ;; esac
  done <<EOF
$CHANGED
EOF
  if [ "${#FILES[@]}" -gt 0 ]; then
    OUT=$(npx --no-install eslint --quiet "${FILES[@]}" 2>&1 </dev/null) || ROOT_REPORT="$ROOT_REPORT
ESLint errors in changed files ($ROOT):
$OUT
"
  fi

  # Both suites finish in a few seconds, so run them whole: this also catches a red test in a
  # module the turn only imported.
  OUT=$(npx --no-install vitest run 2>&1 </dev/null) || ROOT_REPORT="$ROOT_REPORT
Unit tests fail (npm test, $ROOT):
$OUT
"
  OUT=$(npx --no-install vitest run --config vitest.integration.config.ts 2>&1 </dev/null) || ROOT_REPORT="$ROOT_REPORT
Poller integration tests fail (npm run test:integration, $ROOT):
$OUT
"

  # The proof for these hooks spawns bash, git and npx (~45 s): only when the hooks or it changed.
  if printf '%s\n' "$CHANGED" | grep --color=never -qE '^(\.claude/hooks/|\.claude/settings\.json$|scripts/__tests__/agent-hooks|vitest\.hooks\.config\.ts$)'; then
    OUT=$(npx --no-install vitest run --config vitest.hooks.config.ts 2>&1 </dev/null) || ROOT_REPORT="$ROOT_REPORT
Agent hook tests fail (npm run test:hooks, $ROOT):
$OUT
"
  fi

  # astro check runs astro sync itself, so the gitignored .astro/ types are regenerated here.
  # Its TypeScript diagnostics stay colored despite NO_COLOR, so strip the escape codes.
  if ! OUT=$(npx --no-install astro check 2>&1 </dev/null); then
    ROOT_REPORT="$ROOT_REPORT
Typecheck fails (astro check, $ROOT):
$(printf '%s\n' "$OUT" | perl -pe 's/\e\[[0-9;]*m//g')
"
  fi

  if [ -n "$ROOT_REPORT" ]; then
    REPORT="$REPORT$ROOT_REPORT"
  else
    NEW_GREEN="$NEW_GREEN$ROOT	$FP
"
  fi
done

if [ -n "$REPORT" ]; then
  echo "Fix these before you finish:$REPORT" >&2
  exit 2
fi
# Green: remember the swept state and start the next turn with an empty registry.
if [ -n "$SID" ] && mkdir -p "$STATE" 2>/dev/null; then
  printf '%s' "$NEW_GREEN" >"$GREEN"
  : >"$REGISTRY"
fi
exit 0
