import { readSession } from '@/lib/session';
import { createAdminSupabase } from '@/lib/supabase/server';

/**
 * The signed-in profile, or null.
 *
 * Sessions are cookie-based, so this works identically for fetches from the
 * client and for full-page navigations like the OAuth callback — which is
 * exactly what the old Bearer-token approach kept getting wrong.
 */
export async function currentUser() {
  const session = await readSession();
  if (!session?.uid) return null;

  const supabase = createAdminSupabase();
  const { data } = await supabase
    .from('profiles')
    .select('id, swiggy_user_id, phone, display_name')
    .eq('id', session.uid)
    .maybeSingle();

  return data || null;
}

/** Kept for the API routes; the request argument is no longer needed. */
export async function userFromRequest() {
  return currentUser();
}
