import { createClient } from '@supabase/supabase-js';

/**
 * Server-only Supabase client using the service_role key.
 *
 * The browser never talks to Supabase directly — every query goes through an
 * API route that checks the session cookie first. Never import this into a
 * client component.
 */
export function createAdminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
}
