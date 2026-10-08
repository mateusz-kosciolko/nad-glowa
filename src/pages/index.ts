import type { APIRoute } from "astro";

// "/" has no content of its own. Anonymous visitors are redirected to sign-in by the middleware before this runs.
// An endpoint rather than index.astro: a top-level `return Astro.redirect()` in frontmatter crashes the
// @typescript-eslint/no-misused-promises rule.
export const GET: APIRoute = (context) => context.redirect("/dashboard");
