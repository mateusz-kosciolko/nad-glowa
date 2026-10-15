// Seed test — the pattern every generated E2E test copies.
// Risk: auth-gate-redirect — a private page is served to an anonymous visitor, or a signed-in user is bounced to
// sign-in (cf. test-plan.md risk #6, whose cheapest layer stays the HTTP smoke; this seed proves it in a browser).
// Creates no data, so there is nothing to clean up.
import { test, expect } from "@playwright/test";

test.describe("signed out", () => {
  // The risk is the signed-out path, so this test opts out of the saved session.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("anonymous visitor to the dashboard is redirected to sign-in", async ({ page }) => {
    await page.goto("/dashboard");

    await page.waitForURL("**/auth/signin");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeHidden();
  });
});

test("signed-in user reaches the dashboard without being redirected", async ({ page }) => {
  await page.goto("/dashboard");

  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/dashboard");
});
