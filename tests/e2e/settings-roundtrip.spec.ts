// risk: settings-roundtrip — a signed-in user saves alert settings in the settings island, and after a reload the
// page shows the saved location, radius and aircraft type (lost or not-persisted settings mean silent missing alerts).
// The parser's rules are unit-tested in src/lib/alert-settings.test.ts; this covers island → POST → RLS/DB → SSR.
// seed: tests/e2e/seed.spec.ts
import { test, expect, type Page } from "@playwright/test";
import { waitForIslands } from "./hydration";

const TYPE_CODE = "C17";
const TYPE_BUTTON = "BOEING C-17 Globemaster 3 · C17";

interface Snapshot {
  lat: string;
  lon: string;
  radius: string;
  hadType: boolean;
}

async function openSettings(page: Page) {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Alert settings" })).toBeVisible();
  await waitForIslands(page);
}

test.describe("settings-roundtrip", () => {
  // The test user's settings before this test changed them; afterEach restores them.
  let original: Snapshot | undefined;

  test.afterEach(async ({ page }) => {
    expect(original, "original settings were captured before any change").toBeDefined();
    if (!original) return;

    await openSettings(page);
    await page.getByLabel("Latitude").fill(original.lat);
    await page.getByLabel("Longitude").fill(original.lon);
    await page.getByLabel("Alert radius (km)").fill(original.radius);
    const remove = page.getByRole("button", { name: `Remove ${TYPE_CODE}` });
    if (!original.hadType && (await remove.isVisible())) {
      await remove.click();
    }
    await page.getByRole("button", { name: "Save settings" }).click();

    // Cleanup is asserted: a failed restore turns the run red instead of leaving the user changed.
    await expect(page.getByText("Settings saved.")).toBeVisible();
    await expect(page.getByLabel("Alert radius (km)")).toHaveValue(original.radius);
    await expect(page.getByLabel("Latitude")).toHaveValue(original.lat);
    await expect(page.getByRole("button", { name: `Remove ${TYPE_CODE}` })).toHaveCount(original.hadType ? 1 : 0);
  });

  test("saved alert settings persist after page reload", async ({ page }) => {
    // Open the settings page and record what the user had before.
    await openSettings(page);
    original = {
      lat: await page.getByLabel("Latitude").inputValue(),
      lon: await page.getByLabel("Longitude").inputValue(),
      radius: await page.getByLabel("Alert radius (km)").inputValue(),
      hadType: await page.getByRole("button", { name: `Remove ${TYPE_CODE}` }).isVisible(),
    };
    expect(original.hadType, `${TYPE_CODE} must start unselected so the test can prove it was saved`).toBe(false);

    // Unique values per run: a stale page or a leftover from an earlier run cannot match them by accident.
    // The last decimal is never 0: the page renders the stored numeric(5,2) as a number, so "49.50" comes back "49.5".
    const stamp = Date.now();
    const hundredths = (n: number) => `${String(Math.floor(n / 9) % 10)}${String((n % 9) + 1)}`;
    const lat = `49.${hundredths(stamp % 90)}`;
    const lon = `19.${hundredths(Math.floor(stamp / 90) % 90)}`;
    let radius = String(2 + (stamp % 98));
    if (radius === original.radius) radius = radius === "99" ? "2" : String(Number(radius) + 1);
    test.info().annotations.push({ type: "test-data", description: `lat=${lat} lon=${lon} radius=${radius}` });

    // Enter a new location, radius and aircraft type, then save.
    await page.getByLabel("Latitude").fill(lat);
    await page.getByLabel("Longitude").fill(lon);
    await page.getByLabel("Alert radius (km)").fill(radius);
    await page.getByRole("button", { name: TYPE_BUTTON }).click();
    await expect(page.getByRole("button", { name: `Remove ${TYPE_CODE}` })).toBeVisible();
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText("Settings saved.")).toBeVisible();

    // Reload the settings page from scratch: the values now come from the database, not the form state.
    await openSettings(page);
    await expect(page.getByLabel("Latitude")).toHaveValue(lat);
    await expect(page.getByLabel("Longitude")).toHaveValue(lon);
    await expect(page.getByLabel("Alert radius (km)")).toHaveValue(radius);
    await expect(page.getByRole("button", { name: `Remove ${TYPE_CODE}` })).toBeVisible();

    // An out-of-range radius is rejected and does not overwrite the saved value.
    await page.getByLabel("Alert radius (km)").fill("0");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText("Radius must be a whole number between 1 and 100 km")).toBeVisible();
    await openSettings(page);
    await expect(page.getByLabel("Alert radius (km)")).toHaveValue(radius);
  });
});
