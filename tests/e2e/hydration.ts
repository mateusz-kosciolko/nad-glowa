import type { Page } from "@playwright/test";

// A React island drops input typed before it hydrates. Astro removes the `ssr` attribute from an <astro-island> once
// it has hydrated, so this resolves when every island on the page is interactive. Use it before a non-idempotent
// submit, or whenever the first input must not be lost; it is the one DOM query the specs share.
export async function waitForIslands(page: Page) {
  await page.waitForFunction(() => !document.querySelector("astro-island[ssr]"));
}
