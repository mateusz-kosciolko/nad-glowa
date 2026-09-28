import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_KEY } from "astro:env/server";
import type { Database } from "@/db/database.types";

// service_role bypasses RLS: only code without a user session (the scheduled handler) may use it.
// ESLint no-restricted-imports enforces that boundary.
export function createAdminClient(): SupabaseClient<Database> | null {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return null;
  }
  // No user session to keep: a fresh client per run, nothing persisted or refreshed.
  return createSupabaseClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
