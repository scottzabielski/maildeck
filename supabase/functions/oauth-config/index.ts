import { corsHeaders } from '../_shared/cors.ts';

/**
 * Returns the OAuth client IDs so the frontend can construct authorization URLs.
 * No secrets are exposed — only the public client IDs.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  return new Response(
    JSON.stringify({
      gmail_client_id: Deno.env.get('GOOGLE_CLIENT_ID') ?? '',
      outlook_client_id: Deno.env.get('MICROSOFT_CLIENT_ID') ?? '',
    }),
    {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    },
  );
});
