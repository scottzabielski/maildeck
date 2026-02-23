/**
 * OAuth helpers for connecting email provider accounts (Gmail, Outlook).
 * These are separate from MailDeck auth — this is for connecting email accounts
 * to sync via the Gmail API / Microsoft Graph API.
 */

import { supabase } from './supabase.ts';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';

/**
 * Fetch OAuth client IDs from the Edge Function.
 * Returns { gmail_client_id, outlook_client_id }.
 */
export async function fetchOAuthConfig(): Promise<{
  gmail_client_id: string;
  outlook_client_id: string;
}> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/oauth-config`);
  if (!res.ok) throw new Error('Failed to fetch OAuth config');
  return res.json();
}

/**
 * Create a signed JWT state parameter containing the user_id.
 * The Edge Function verifies this to associate the OAuth tokens with the user.
 */
async function createStateToken(): Promise<string> {
  if (!supabase) throw new Error('Supabase not configured');

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  // Use the user's access token as the state parameter.
  // The Edge Function will verify this against SUPABASE_JWT_SECRET.
  return session.access_token;
}

/**
 * Initiate Gmail OAuth flow.
 * Redirects the browser to Google's consent screen.
 */
export async function connectGmailAccount(): Promise<void> {
  const [config, state] = await Promise.all([
    fetchOAuthConfig(),
    createStateToken(),
  ]);

  const params = new URLSearchParams({
    client_id: config.gmail_client_id,
    redirect_uri: `${SUPABASE_URL}/functions/v1/oauth-gmail-callback`,
    response_type: 'code',
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/gmail.labels',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
    ].join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
  });

  window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

/**
 * Initiate Outlook OAuth flow.
 * Redirects the browser to Microsoft's consent screen.
 */
export async function connectOutlookAccount(): Promise<void> {
  const [config, state] = await Promise.all([
    fetchOAuthConfig(),
    createStateToken(),
  ]);

  const params = new URLSearchParams({
    client_id: config.outlook_client_id,
    redirect_uri: `${SUPABASE_URL}/functions/v1/oauth-outlook-callback`,
    response_type: 'code',
    scope: [
      'https://graph.microsoft.com/Mail.Read',
      'https://graph.microsoft.com/Mail.ReadWrite',
      'https://graph.microsoft.com/User.Read',
      'offline_access',
    ].join(' '),
    state,
  });

  window.location.href = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}`;
}
