import { createClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client for xero_tokens.
 * Prefer SUPABASE_SERVICE_ROLE_KEY so RLS does not block reads/writes (see docs/XERO_SUPABASE.md).
 */
export function createXeroSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}
