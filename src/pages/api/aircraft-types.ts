import type { APIRoute } from "astro";
import { normalizeTypeQuery, rankAircraftTypes } from "@/lib/aircraft-types";
import { createClient } from "@/lib/supabase";

// Searches the aircraft types dictionary for the type picker, with the anon key under RLS.

// More rows than the response limit, so that exact and prefix code matches survive ranking.
const FETCH_LIMIT = 50;

function json(status: number, body: object): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const GET: APIRoute = async (context) => {
  if (!context.locals.user) {
    return context.redirect("/auth/signin");
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return json(503, { error: "Supabase is not configured" });
  }

  // Typing the first letter is not an error: an invalid or too short query simply has no results.
  // Only the normalized query (whitelisted characters, so no `%` or `_` wildcards) may reach the filters below.
  const query = normalizeTypeQuery(context.url.searchParams.get("q") ?? "");
  if (query === null) {
    return json(200, { types: [] });
  }

  // Two queries instead of one `or`: a broad name match (e.g. "ai" → every AIRBUS) must not crowd code matches out
  // of the row limit before ranking.
  const [byCode, byName] = await Promise.all([
    supabase.from("aircraft_types").select("code, name").ilike("code", `${query}%`).order("code").limit(FETCH_LIMIT),
    supabase.from("aircraft_types").select("code, name").ilike("name", `%${query}%`).order("code").limit(FETCH_LIMIT),
  ]);

  const error = byCode.error ?? byName.error;
  if (error) {
    // eslint-disable-next-line no-console -- server-side detail; the response carries only an error code
    console.error(`Aircraft types search failed: ${error.message}`);
    return json(500, { error: "search_failed" });
  }

  const merged = new Map([...(byCode.data ?? []), ...(byName.data ?? [])].map((type) => [type.code, type]));
  return json(200, { types: rankAircraftTypes(query, [...merged.values()]) });
};
