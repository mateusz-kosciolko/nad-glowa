// Proof for the Claude Code hooks in .claude/hooks/ (configured in .claude/settings.json).
// Every case pipes a hook payload into the real script inside a throwaway git repo and asserts the exit
// code and the channel: Claude sees only exit 2 + stderr. Real git, jq, npx and bash; only the slow tools
// are stubbed in the throwaway repo's node_modules/.bin: eslint fails on files containing LINT_ERROR,
// vitest on TEST_FAIL, astro check on TYPE_ERROR.
import { spawn } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const PROJECT = path.resolve(import.meta.dirname, "../..");
// realpath: on macOS tmpdir() is a symlink, while git reports /private/var/... checkouts.
const SANDBOX = realpathSync(mkdtempSync(path.join(tmpdir(), "agent-hooks-")));
afterAll(() => {
  rmSync(SANDBOX, { recursive: true, force: true });
});

// Stubs log every call to $HOOK_TEST_LOG, so a case can assert that no check ran.
const STUBS = {
  eslint: `#!/usr/bin/env bash
echo "eslint $*" >>"$HOOK_TEST_LOG"
rc=0
for f in "$@"; do
  case "$f" in -*) continue ;; esac
  if grep -q LINT_ERROR "$f" 2>/dev/null; then
    echo "$f"; echo "  1:7  error  'unused' is assigned a value but never used  @typescript-eslint/no-unused-vars"; rc=1
  fi
done
exit $rc
`,
  vitest: `#!/usr/bin/env bash
echo "vitest $*" >>"$HOOK_TEST_LOG"
if [ "$1" = "related" ]; then targets=("$2")
elif [[ "$*" == *vitest.hooks.config.ts* ]]; then targets=(.claude)
else targets=(src); fi
if grep -rlq TEST_FAIL "\${targets[@]}" 2>/dev/null; then
  echo "AssertionError: expected 1 to be 2 // Object.is equality"; exit 1
fi
echo "Test Files  1 passed (1)"
`,
  astro: `#!/usr/bin/env bash
echo "astro $*" >>"$HOOK_TEST_LOG"
hit=$(grep -rl TYPE_ERROR src 2>/dev/null | head -n 1)
if [ -n "$hit" ]; then
  printf "\\033[96m%s\\033[0m:1:14 - error ts(2322): colored\\n" "$hit"
  echo "$hit:1:14 - error ts(2322): Type 'string' is not assignable to type 'number'."; exit 1
fi
echo "Result (1 file): - 0 errors"
`,
};

let counter = 0;
function freshDir(name) {
  counter += 1;
  const dir = path.join(SANDBOX, `${String(counter)}-${name}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeFile(file, content) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

// A committed checkout with the real hooks, the tool stubs and one clean module.
async function makeRepo({ stubs = STUBS } = {}) {
  const repo = freshDir("repo");
  writeFile(path.join(repo, "package.json"), '{ "name": "hooks-sandbox", "private": true }\n');
  for (const [name, body] of Object.entries(stubs)) {
    writeFile(path.join(repo, "node_modules/.bin", name), body);
    chmodSync(path.join(repo, "node_modules/.bin", name), 0o755);
  }
  cpSync(path.join(PROJECT, ".claude/hooks"), path.join(repo, ".claude/hooks"), { recursive: true });
  cpSync(path.join(PROJECT, ".claude/settings.json"), path.join(repo, ".claude/settings.json"));
  writeFile(path.join(repo, "src/lib/clean.ts"), "export const answer = 42;\n");
  await sh("git init -q && git add -A && git -c user.name=t -c user.email=t@t commit -qm init", repo);
  return repo;
}

function baseEnv(extra = {}) {
  // Nested git must not inherit a parent hook's GIT_DIR / GIT_INDEX_FILE (pre-commit runs this file).
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
  return {
    ...env,
    TMPDIR: freshDir("state"),
    HOOK_TEST_LOG: path.join(freshDir("log"), "calls.log"),
    // An empty global prefix, so `npx --no-install` cannot fall back to a globally installed tool.
    npm_config_prefix: freshDir("npm-prefix"),
    CLAUDE_PROJECT_DIR: "/nonexistent-project-dir",
    ...extra,
  };
}

function sh(command, cwd, { input = "", env = baseEnv() } = {}) {
  return new Promise((resolve) => {
    const child = spawn("bash", ["-c", command], { cwd, env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += String(d)));
    child.stderr.on("data", (d) => (stderr += String(d)));
    child.on("close", (status) => {
      resolve({ status, stdout, stderr });
    });
    child.stdin.end(input);
  });
}

function hook(repo, script, payload, { cwd = repo, env = baseEnv() } = {}) {
  const input = typeof payload === "string" ? payload : JSON.stringify(payload);
  return sh(`"${repo}/.claude/hooks/${script}"`, cwd, { input, env });
}

const edit = (repo, file, extra = {}) => ({
  session_id: "s1",
  hook_event_name: "PostToolUse",
  tool_name: "Edit",
  cwd: repo,
  tool_input: { file_path: file },
  ...extra,
});
const stop = (repo, extra = {}) => ({
  session_id: "s1",
  hook_event_name: "Stop",
  cwd: repo,
  stop_hook_active: false,
  ...extra,
});
const calls = (env) => {
  try {
    return readFileSync(env.HOOK_TEST_LOG, "utf8");
  } catch {
    return "";
  }
};

const PER_EDIT = ["lint-edited-file.sh", "related-tests.sh"];
const ALL = [...PER_EDIT, "end-of-turn.sh"];

describe.concurrent("per-edit hooks", () => {
  it("lint-edited-file.sh blocks a lint error in the edited file (exit 2, stderr)", async () => {
    const repo = await makeRepo();
    const file = path.join(repo, "src/lib/broken.ts");
    writeFile(file, "const unused = 1; // LINT_ERROR\n");
    const r = await hook(repo, "lint-edited-file.sh", edit(repo, file));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(`ESLint reported errors in ${file}`);
    expect(r.stderr).toContain("no-unused-vars");
    expect(r.stdout).toBe("");
  });

  it("lint-edited-file.sh lints .astro files", async () => {
    const repo = await makeRepo();
    const file = path.join(repo, "src/pages/broken.astro");
    writeFile(file, "---\nconst unused = 1; // LINT_ERROR\n---\n");
    const r = await hook(repo, "lint-edited-file.sh", edit(repo, file));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("broken.astro");
  });

  it("related-tests.sh blocks a failing assertion related to the edited file", async () => {
    const repo = await makeRepo();
    const file = path.join(repo, "src/lib/math.ts");
    writeFile(file, "export const add = (a: number, b: number) => a - b; // TEST_FAIL\n");
    const env = baseEnv();
    const r = await hook(repo, "related-tests.sh", edit(repo, file), { env });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(`Unit tests (npm test) related to ${file} fail`);
    expect(r.stderr).toContain(`Poller integration tests (npm run test:integration) related to ${file} fail`);
    expect(r.stderr).toContain("AssertionError");
    expect(calls(env)).toContain("--config vitest.integration.config.ts");
  });

  it.each(PER_EDIT)("%s passes a clean file silently", async (script) => {
    const repo = await makeRepo();
    const r = await hook(repo, script, edit(repo, path.join(repo, "src/lib/clean.ts")));
    expect(r).toMatchObject({ status: 0, stderr: "" });
  });

  it.each(PER_EDIT)("%s skips an uncovered file type without running a tool", async (script) => {
    const repo = await makeRepo();
    const file = path.join(repo, "README.md");
    writeFile(file, "LINT_ERROR TEST_FAIL\n");
    const env = baseEnv();
    const r = await hook(repo, script, edit(repo, file), { env });
    expect(r.status).toBe(0);
    expect(calls(env)).toBe("");
  });

  it.each(PER_EDIT)("%s skips a file that does not exist", async (script) => {
    const repo = await makeRepo();
    const r = await hook(repo, script, edit(repo, path.join(repo, "src/lib/gone.ts")));
    expect(r.status).toBe(0);
  });

  it.each(PER_EDIT)("%s resolves a relative path against the payload cwd", async (script) => {
    const repo = await makeRepo();
    writeFile(path.join(repo, "src/lib/broken.ts"), "const unused = 1; // LINT_ERROR TEST_FAIL\n");
    const r = await hook(repo, script, edit(repo, "src/lib/broken.ts"), { cwd: SANDBOX });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(path.join(repo, "src/lib/broken.ts"));
  });

  it.each(PER_EDIT)("%s skips a broken file of another repository", async (script) => {
    const repo = await makeRepo();
    const other = await makeRepo();
    const file = path.join(other, "src/lib/broken.ts");
    writeFile(file, "const unused = 1; // LINT_ERROR TEST_FAIL\n");
    const r = await hook(repo, script, edit(repo, file));
    expect(r.status).toBe(0);
  });

  it("lint-edited-file.sh fails visibly when ESLint is not installed", async () => {
    const { eslint: _eslint, ...rest } = STUBS;
    const repo = await makeRepo({ stubs: rest });
    const r = await hook(repo, "lint-edited-file.sh", edit(repo, path.join(repo, "src/lib/clean.ts")));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("ESLint reported errors");
  });

  it("related-tests.sh fails visibly when Vitest is not installed", async () => {
    const { vitest: _vitest, ...rest } = STUBS;
    const repo = await makeRepo({ stubs: rest });
    const r = await hook(repo, "related-tests.sh", edit(repo, path.join(repo, "src/lib/clean.ts")));
    expect(r.status).toBe(2);
  });
});

describe.concurrent("payload shapes", () => {
  const payloads = [
    ["empty stdin", ""],
    ["not json", "not json"],
    ["{}", "{}"],
    ["tool call without a path", { tool_name: "Bash", tool_input: { command: "ls" } }],
  ];
  it.each(ALL.flatMap((script) => payloads.map(([label, p]) => [script, label, p])))(
    "%s exits 0 on %s",
    async (script, _label, payload) => {
      const repo = await makeRepo();
      const r = await hook(repo, script, payload);
      expect(r.status).toBe(0);
    },
  );
});

describe.concurrent("end-of-turn.sh", () => {
  it("runs the hook proof (npm run test:hooks) only when a hook changed", async () => {
    const repo = await makeRepo();
    writeFile(path.join(repo, ".claude/hooks/end-of-turn.sh"), "#!/usr/bin/env bash\n# TEST_FAIL\n");
    const env = baseEnv();
    const r = await sh(`"${PROJECT}/.claude/hooks/end-of-turn.sh"`, repo, { input: JSON.stringify(stop(repo)), env });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("Agent hook tests fail (npm run test:hooks");
    expect(calls(env)).toContain("vitest run --config vitest.hooks.config.ts");
  });

  it("runs no check when nothing changed", async () => {
    const repo = await makeRepo();
    const env = baseEnv();
    const r = await hook(repo, "end-of-turn.sh", stop(repo), { env });
    expect(r).toMatchObject({ status: 0, stderr: "" });
    expect(calls(env)).toBe("");
  });

  it("passes a clean change after running lint, both suites and astro check", async () => {
    const repo = await makeRepo();
    writeFile(path.join(repo, "src/lib/clean.ts"), "export const answer = 43;\n");
    const env = baseEnv();
    const r = await hook(repo, "end-of-turn.sh", stop(repo), { env });
    expect(r).toMatchObject({ status: 0, stderr: "" });
    const log = calls(env);
    expect(log).toContain("eslint --quiet src/lib/clean.ts");
    expect(log).toContain("vitest run\n");
    expect(log).not.toContain("vitest.hooks.config.ts");
    expect(log).toContain("vitest run --config vitest.integration.config.ts");
    expect(log).toContain("astro check");
  });

  it("blocks a lint error written straight to disk, bypassing the per-edit hook", async () => {
    const repo = await makeRepo();
    writeFile(path.join(repo, "src/lib/shell-written.ts"), "const unused = 1; // LINT_ERROR\n");
    const r = await hook(repo, "end-of-turn.sh", stop(repo));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("Fix these before you finish:");
    expect(r.stderr).toContain("src/lib/shell-written.ts");
    expect(r.stderr).toContain("no-unused-vars");
  });

  it("blocks a failing test and a type error, reported in one message", async () => {
    const repo = await makeRepo();
    writeFile(path.join(repo, "src/lib/clean.ts"), "export const answer: number = '42'; // TEST_FAIL TYPE_ERROR\n");
    const r = await hook(repo, "end-of-turn.sh", stop(repo));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("Unit tests fail (npm test");
    expect(r.stderr).toContain("Poller integration tests fail");
    expect(r.stderr).toContain("Typecheck fails (astro check");
    expect(r.stderr).toContain("src/lib/clean.ts:1:14 - error ts(2322)");
    // Plain text for the model: no ANSI escape codes from the typechecker.
    expect(r.stderr).toContain("src/lib/clean.ts:1:14 - error ts(2322): colored");
    expect(r.stderr).not.toContain("\u001b[");
  });

  it.each([
    ["stop_hook_active", { stop_hook_active: true }],
    ["Cursor loop_count", { loop_count: 1 }],
  ])("lets the agent finish on the retry (%s) even when the error is still there", async (_label, extra) => {
    const repo = await makeRepo();
    writeFile(path.join(repo, "src/lib/broken.ts"), "const unused = 1; // LINT_ERROR\n");
    const env = baseEnv();
    const r = await hook(repo, "end-of-turn.sh", stop(repo, extra), { env });
    expect(r.status).toBe(0);
    expect(calls(env)).toBe("");
  });

  it("skips a tree it already passed in this session, and re-checks after a change", async () => {
    const repo = await makeRepo();
    writeFile(path.join(repo, "src/lib/clean.ts"), "export const answer = 43;\n");
    const env = baseEnv();
    expect((await hook(repo, "end-of-turn.sh", stop(repo), { env })).status).toBe(0);
    writeFileSync(env.HOOK_TEST_LOG, "");
    expect((await hook(repo, "end-of-turn.sh", stop(repo), { env })).status).toBe(0);
    expect(calls(env)).toBe("");
    writeFile(path.join(repo, "src/lib/clean.ts"), "const unused = 1; // LINT_ERROR\n");
    const r = await hook(repo, "end-of-turn.sh", stop(repo), { env });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("src/lib/clean.ts");
  });

  it("fails visibly when the typechecker is not installed", async () => {
    const { astro: _astro, ...rest } = STUBS;
    const repo = await makeRepo({ stubs: rest });
    writeFile(path.join(repo, "src/lib/clean.ts"), "export const answer = 43;\n");
    const r = await hook(repo, "end-of-turn.sh", stop(repo));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("Typecheck fails (astro check");
  });
});

describe.concurrent("checkout resolution", () => {
  it("checks the session checkout, not a broken checkout in CLAUDE_PROJECT_DIR", async () => {
    const repo = await makeRepo();
    const other = await makeRepo();
    writeFile(path.join(other, "src/lib/broken.ts"), "const unused = 1; // LINT_ERROR TEST_FAIL TYPE_ERROR\n");
    writeFile(path.join(repo, "src/lib/clean.ts"), "export const answer = 43;\n");
    const env = baseEnv({ CLAUDE_PROJECT_DIR: other });
    for (const script of PER_EDIT) {
      const r = await hook(repo, script, edit(repo, path.join(repo, "src/lib/clean.ts")), { env });
      expect(r.status, script).toBe(0);
    }
    const r = await hook(repo, "end-of-turn.sh", stop(repo), { env });
    expect(r).toMatchObject({ status: 0, stderr: "" });
  });

  it("sweeps a sibling worktree that a per-edit hook registered in this session", async () => {
    const repo = await makeRepo();
    const wt = path.join(freshDir("wt"), "sibling");
    await sh(`git worktree add -q "${wt}"`, repo);
    const file = path.join(wt, "src/lib/broken.ts");
    writeFile(file, "const unused = 1; // LINT_ERROR\n");
    const env = baseEnv();
    expect((await hook(repo, "lint-edited-file.sh", edit(repo, file), { env })).status).toBe(2);
    const r = await hook(repo, "end-of-turn.sh", stop(repo), { env });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(`ESLint errors in changed files (${wt}`);
  });

  it("every settings.json command reaches its script from a worktree with a stale CLAUDE_PROJECT_DIR", async () => {
    const repo = await makeRepo();
    const wt = path.join(freshDir("wt"), "moved");
    await sh(`git worktree add -q "${wt}"`, repo);
    const file = path.join(wt, "src/lib/broken.ts");
    writeFile(file, "const unused = 1; // LINT_ERROR TEST_FAIL\n");
    const settings = JSON.parse(readFileSync(path.join(repo, ".claude/settings.json"), "utf8"));
    const entries = [
      ...settings.hooks.PostToolUse.flatMap((m) => m.hooks.map((h) => [h, edit(wt, file)])),
      ...settings.hooks.Stop.flatMap((m) => m.hooks.map((h) => [h, stop(wt)])),
    ];
    expect(entries).toHaveLength(3);
    for (const [h, payload] of entries) {
      // Seconds, not milliseconds (10000 would be almost three hours).
      expect(h.timeout, h.command).toBeLessThanOrEqual(180);
      const r = await sh(h.command, wt, { input: JSON.stringify(payload) });
      expect(r.status, h.command).toBe(2);
      expect(r.stderr, h.command).toMatch(/ESLint|tests|Fix these/);
    }
  });
});
