// risk: alert-history-reachable — a signed-in user cannot find the alert history from the dashboard.
// Removing entries needs seeded rows and therefore the service_role key, so that path is covered by scripts/smoke.mjs.
// Creates no data, so there is nothing to clean up.
// seed: tests/e2e/seed.spec.ts
import { test, expect } from "@playwright/test";

test("signed-in user opens the alert history from the dashboard", async ({ page }) => {
  await page.goto("/dashboard");

  await page.getByRole("link", { name: "Alert history" }).click();

  await page.waitForURL("**/alerts");
  await expect(page.getByRole("heading", { name: "Alert history" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to dashboard" })).toBeVisible();
});
