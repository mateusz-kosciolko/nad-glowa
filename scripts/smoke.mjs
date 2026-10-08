// Smoke test: proves the built app, the Cloudflare adapter and the Supabase auth flow still work together.
// Zero dependencies on purpose. Run against a live server: BASE_URL=http://localhost:4321 node scripts/smoke.mjs

const BASE_URL = process.env.BASE_URL ?? "http://localhost:4321";
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

const settingsForm = {
  home_lat: "52.23456",
  home_lon: "21.01178",
  radius_km: "25",
  aircraft_types: "b744, a400 B744",
  telegram_chat_id: "123456789",
};

const steps = [
  ["home renders", () => request("/"), { status: 200 }],
  ["dashboard redirects anonymous user", () => request("/dashboard"), { status: 302, location: "/auth/signin" }],
  ["settings redirects anonymous user", () => request("/settings"), { status: 302, location: "/auth/signin" }],
  // No signed-in probe step: in CI it would depend on adsb.fi being up.
  ["adsb probe redirects anonymous user", () => request("/api/adsb/probe"), { status: 302, location: "/auth/signin" }],
  [
    "signup creates account",
    () => request("/api/auth/signup", { method: "POST", form: { email, password } }),
    { status: 302, location: "/auth/confirm-email" },
  ],
  [
    "signin rejects wrong password",
    () => request("/api/auth/signin", { method: "POST", form: { email, password: "wrong" } }),
    { status: 302, location: "/auth/signin?error=" },
  ],
  [
    "signin accepts correct password",
    () => request("/api/auth/signin", { method: "POST", form: { email, password } }),
    { status: 302, location: "/" },
  ],
  ["dashboard renders for signed-in user", () => request("/dashboard"), { status: 200 }],
  ["settings renders for signed-in user", () => request("/settings"), { status: 200 }],
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
    { status: 302, location: "/settings?error=" },
  ],
  [
    "settings save rejects non-numeric telegram chat id",
    () => request("/api/settings", { method: "POST", form: { ...settingsForm, telegram_chat_id: "abc" } }),
    { status: 302, location: "/settings?error=" },
  ],
  // No token in CI, and locally Telegram rejects the made-up chat ID, so this never depends on Telegram delivering.
  [
    "telegram test reports an error for signed-in user",
    () => request("/api/settings/telegram-test", { method: "POST" }),
    { status: 302, location: "/settings?telegram_error=" },
  ],
  ["signout clears session", () => request("/api/auth/signout", { method: "POST" }), { status: 302, location: "/" }],
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
];

let failed = 0;
for (const [name, run, expected] of steps) {
  const actual = await run();
  const missing = (expected.bodyIncludes ?? []).filter((text) => !actual.body.includes(text));
  const ok =
    actual.status === expected.status &&
    (expected.location === undefined || actual.location.startsWith(expected.location)) &&
    missing.length === 0;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  -> ${actual.status} ${actual.location}`);
  if (!ok) {
    failed++;
    console.log(`      expected ${expected.status} ${expected.location ?? ""}`);
    if (missing.length) console.log(`      body missing: ${missing.map((text) => JSON.stringify(text)).join(", ")}`);
  }
}

console.log(failed ? `\n${failed} step(s) failed` : "\nAll smoke steps passed");
process.exit(failed ? 1 : 0);
