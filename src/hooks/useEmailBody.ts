import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase.ts';

interface EmailBody {
  body_html: string | null;
  body_text: string | null;
}

/**
 * Lazy-load the full HTML/text body of an email.
 * First checks the DB cache, then fetches from the provider API via Edge Function.
 */
export function useEmailBody(emailId: string | undefined) {
  return useQuery({
    queryKey: ['email_body', emailId],
    queryFn: async (): Promise<EmailBody> => {
      if (!supabase || !emailId) return { body_html: null, body_text: null };

      // First check if body is already cached in DB
      const { data: cached } = await supabase
        .from('emails')
        .select('body_html, body_text')
        .eq('id', emailId)
        .single();

      if (cached?.body_html || cached?.body_text) {
        return { body_html: cached.body_html, body_text: cached.body_text };
      }

      // Fetch from provider via Edge Function
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fetch-email-body`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ email_id: emailId }),
        },
      );

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Failed to fetch body: ${err}`);
      }

      return await res.json() as EmailBody;
    },
    enabled: !!supabase && !!emailId,
    staleTime: Infinity, // Body doesn't change, cache forever
    gcTime: 30 * 60 * 1000, // Keep in cache for 30 minutes
  });
}
