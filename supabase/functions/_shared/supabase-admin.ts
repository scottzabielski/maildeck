import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * Create a Supabase client with the service_role key.
 * This bypasses RLS and can access encrypted token columns.
 */
export function createAdminClient() {
  const url = Deno.env.get('SUPABASE_URL')!;
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  return createClient(url, key);
}
