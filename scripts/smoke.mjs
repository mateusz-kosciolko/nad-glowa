// Smoke test: proves the built app, the Cloudflare adapter and the Supabase auth flow still work together.
// Zero dependencies on purpose. Run against a live server: `npm run smoke` (reads `.dev.vars`; BASE_URL defaults
// to http://localhost:4321).
// Runs ONLY against a local Supabase: sign-up is closed, so the test account is created through the GoTrue Admin
// API with the service_role key and deleted after the run, even when a step fails or the run is interrupted. The
// script refuses to send any request when SUPABASE_URL does not point at 127.0.0.1, localhost or ::1, or when the
// key is not the local Supabase CLI demo key.

const BASE_URL = process.env.BASE_URL ?? "http://localhost:4321";
const { SUPABASE_URL, SUPABASE_KEY, SUPABASE_SERVICE_KEY } = process.env;
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

const missingVars = Object.entries({ SUPABASE_URL, SUPABASE_KEY, SUPABASE_SERVICE_KEY })
  .filter(([, value]) => !value)
  .map(([name]) => name);
if (missingVars.length) {
  console.error(`Missing environment variable(s): ${missingVars.join(", ")} (set them in .dev.vars).`);
  process.exit(1);
}

let supabaseHost;
try {
  supabaseHost = new URL(SUPABASE_URL).hostname;
} catch {
  console.error("SUPABASE_URL is not a valid URL.");
  process.exit(1);
}
if (!LOCAL_HOSTS.has(supabaseHost)) {
  console.error(
    `Refusing to run: SUPABASE_URL host "${supabaseHost}" is not a local Supabase (127.0.0.1, localhost, ::1).`,
  );
  process.exit(1);
}

// A local host could still be a tunnel to a remote project, so also require the CLI's demo key (iss "supabase-demo").
function isLocalDemoKey(key) {
  try {
    const payload = JSON.parse(Buffer.from(key.split(".")[1] ?? "", "base64url").toString("utf8"));
    return payload.iss === "supabase-demo";
  } catch {
    return false;
  }
}
if (!isLocalDemoKey(SUPABASE_SERVICE_KEY)) {
  console.error("Refusing to run: SUPABASE_SERVICE_KEY is not the local Supabase CLI demo key (npx supabase status).");
  process.exit(1);
}

const email = `smoke-${Date.now()}@example.com`;
const password = "Smoke-Test-Passw0rd!";
const jar = new Map();

function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function storeCookies(response) {
  for (const raw of response.headers.getSetCookie()) {
    const [pair, ...attrs] = raw.split(";");
    const [name, ...rest] = pair.split("=");
    const expired = attrs.some((a) => /max-age=0/i.test(a.trim()));
    if (expired) jar.delete(name.trim());
    else jar.set(name.trim(), rest.join("="));
  }
}

async function request(path, { method = "GET", form } = {}) {
  const response = await fetch(BASE_URL + path, {
    method,
    redirect: "manual",
    headers: {
      Cookie: cookieHeader(),
      Origin: BASE_URL,
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  storeCookies(response);
  return { status: response.status, location: response.headers.get("location") ?? "", body: await response.text() };
}

const adminHeaders = {
  apikey: SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  "Content-Type": "application/json",
};

async function createTestUser() {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`admin create user -> ${response.status} ${body}`);
  return JSON.parse(body).id;
}

async function deleteUser(id) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
    method: "DELETE",
    headers: adminHeaders,
  });
  if (!response.ok) throw new Error(`admin delete user ${id} -> ${response.status} ${await response.text()}`);
}

// Accounts to remove after the run; the direct sign-up step adds one only if Supabase wrongly accepts it.
const createdUserIds = [];

async function supabaseSignup() {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: `smoke-signup-${Date.now()}@example.com`, password }),
  });
  const body = await response.text();
  if (response.ok) {
    try {
      const parsed = JSON.parse(body);
      const id = parsed.user?.id ?? parsed.id;
      if (id) createdUserIds.push(id);
    } catch {
      // Not JSON: nothing to clean up.
    }
  }
  return { status: response.status, location: "", body };
}

const settingsForm = {
  home_lat: "52.23456",
  home_lon: "21.01178",
  radius_km: "25",
  aircraft_types: "b744, a400 B744",
  telegram_chat_id: "123456789",
};

const steps = [
  ["home redirects anonymous user", () => request("/"), { status: 302, location: "/auth/signin" }],
  ["dashboard redirects anonymous user", () => request("/dashboard"), { status: 302, location: "/auth/signin" }],
  ["settings redirects anonymous user", () => request("/settings"), { status: 302, location: "/auth/signin" }],
  // No signed-in probe step: in CI it would depend on adsb.fi being up.
  ["adsb probe redirects anonymous user", () => request("/api/adsb/probe"), { status: 302, location: "/auth/signin" }],
  [
    "aircraft types search redirects anonymous user",
    () => request("/api/aircraft-types?q=a400"),
    { status: 302, location: "/auth/signin" },
  ],
  ["signup page redirects anonymous user", () => request("/auth/signup"), { status: 302, location: "/auth/signin" }],
  [
    "signup endpoint redirects anonymous user",
    () => request("/api/auth/signup", { method: "POST", form: { email, password } }),
    { status: 302, location: "/auth/signin" },
  ],
  [
    "signin page renders without sign-up link",
    () => request("/auth/signin"),
    { status: 200, bodyIncludes: ["Sign in"], bodyExcludes: ["Sign up"] },
  ],
  ["supabase rejects direct signup", () => supabaseSignup(), { status: "4xx" }],
  [
    "signin rejects wrong password",
    () => request("/api/auth/signin", { method: "POST", form: { email, password: "wrong" } }),
    { status: 302, location: "/auth/signin?error=" },
  ],
  [
    "signin accepts correct password",
    () => request("/api/auth/signin", { method: "POST", form: { email, password } }),
    { status: 302, location: "/dashboard" },
  ],
  ["home redirects signed-in user to dashboard", () => request("/"), { status: 302, location: "/dashboard" }],
  ["dashboard renders for signed-in user", () => request("/dashboard"), { status: 200 }],
  ["settings renders for signed-in user", () => request("/settings"), { status: 200 }],
  [
    "aircraft types search finds A400",
    () => request("/api/aircraft-types?q=a400"),
    { status: 200, bodyIncludes: ["A400", "AIRBUS A-400M"] },
  ],
  [
    "settings save succeeds",
    () => request("/api/settings", { method: "POST", form: settingsForm }),
    { status: 302, location: "/settings?saved=1" },
  ],
  [
    "settings page shows saved values",
    () => request("/settings"),
    { status: 200, bodyIncludes: ["52.23", "21.01", "B744, A400", "123456789"] },
  ],
  [
    "settings save rejects radius 0",
    () => request("/api/settings", { method: "POST", form: { ...settingsForm, radius_km: "0" } }),
    { status: 302, location: "/settings?error=radius_range" },
  ],
  [
    "settings save rejects non-numeric telegram chat id",
    () => request("/api/settings", { method: "POST", form: { ...settingsForm, telegram_chat_id: "abc" } }),
    { status: 302, location: "/settings?error=invalid_chat_id" },
  ],
  // No token in CI, and locally Telegram rejects the made-up chat ID, so this never depends on Telegram delivering.
  [
    "telegram test reports an error for signed-in user",
    () => request("/api/settings/telegram-test", { method: "POST" }),
    { status: 302, location: "/settings?telegram_error=" },
  ],
  // Pause round-trip; saving settings in between must not lift the pause.
  ["dashboard shows alerts active", () => request("/dashboard"), { status: 200, bodyIncludes: ["Alerts: active"] }],
  [
    "pause alerts succeeds",
    () => request("/api/settings/pause", { method: "POST", form: { paused: "true" } }),
    { status: 302, location: "/dashboard?alerts=paused" },
  ],
  ["dashboard shows alerts paused", () => request("/dashboard"), { status: 200, bodyIncludes: ["Alerts paused"] }],
  [
    "settings save during pause succeeds",
    () => request("/api/settings", { method: "POST", form: settingsForm }),
    { status: 302, location: "/settings?saved=1" },
  ],
  [
    "dashboard still shows alerts paused after settings save",
    () => request("/dashboard"),
    { status: 200, bodyIncludes: ["Alerts paused"] },
  ],
  [
    "pause rejects an invalid value",
    () => request("/api/settings/pause", { method: "POST", form: { paused: "maybe" } }),
    { status: 302, location: "/dashboard?alerts_error=invalid_pause" },
  ],
  [
    "resume alerts succeeds",
    () => request("/api/settings/pause", { method: "POST", form: { paused: "false" } }),
    { status: 302, location: "/dashboard?alerts=resumed" },
  ],
  [
    "dashboard shows alerts active after resume",
    () => request("/dashboard"),
    { status: 200, bodyIncludes: ["Alerts: active"] },
  ],
  // Error parameters carry codes; a crafted value must not reach the page.
  [
    "dashboard ignores free text in alerts_error",
    () => request(`/dashboard?alerts_error=${encodeURIComponent("<script>evil</script>")}`),
    { status: 200, bodyIncludes: ["Something went wrong. Please try again."], bodyExcludes: ["evil"] },
  ],
  [
    "signout clears session",
    () => request("/api/auth/signout", { method: "POST" }),
    { status: 302, location: "/auth/signin" },
  ],
  ["dashboard redirects after signout", () => request("/dashboard"), { status: 302, location: "/auth/signin" }],
  [
    "settings save redirects after signout",
    () => request("/api/settings", { method: "POST", form: settingsForm }),
    { status: 302, location: "/auth/signin" },
  ],
  [
    "telegram test redirects after signout",
    () => request("/api/settings/telegram-test", { method: "POST" }),
    { status: 302, location: "/auth/signin" },
  ],
  [
    "pause redirects after signout",
    () => request("/api/settings/pause", { method: "POST", form: { paused: "true" } }),
    { status: 302, location: "/auth/signin" },
  ],
];

function statusMatches(expected, actual) {
  return expected === "4xx" ? actual >= 400 && actual < 500 : actual === expected;
}

async function cleanup() {
  // A cleanup failure is reported but does not change the result.
  for (const id of createdUserIds.splice(0)) {
    try {
      await deleteUser(id);
    } catch (error) {
      console.log(`WARN  cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

// Ctrl+C or a CI cancel skips `finally`; remove the test account before exiting.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    console.log(`\nInterrupted (${signal}); removing the test account.`);
    void cleanup().finally(() => process.exit(130));
  });
}

let failed = 0;
try {
  createdUserIds.push(await createTestUser());
  for (const [name, run, expected] of steps) {
    const actual = await run();
    const missing = (expected.bodyIncludes ?? []).filter((text) => !actual.body.includes(text));
    const unexpected = (expected.bodyExcludes ?? []).filter((text) => actual.body.includes(text));
    const ok =
      statusMatches(expected.status, actual.status) &&
      (expected.location === undefined || actual.location.startsWith(expected.location)) &&
      missing.length === 0 &&
      unexpected.length === 0;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}  -> ${actual.status} ${actual.location}`);
    if (!ok) {
      failed++;
      console.log(`      expected ${expected.status} ${expected.location ?? ""}`);
      if (missing.length) console.log(`      body missing: ${missing.map((text) => JSON.stringify(text)).join(", ")}`);
      if (unexpected.length) {
        console.log(`      body should not contain: ${unexpected.map((text) => JSON.stringify(text)).join(", ")}`);
      }
    }
  }
} catch (error) {
  failed++;
  console.log(`FAIL  ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await cleanup();
}

console.log(failed ? `\n${failed} step(s) failed` : "\nAll smoke steps passed");
process.exit(failed ? 1 : 0);
