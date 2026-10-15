/**
 * Message content from the providers, shared by fetch-email-body (the
 * reading pane), sync-emails (the bulk flag) and sweep checks (what Claude
 * reads): fetching a body, turning HTML into text, and spotting bulk mail.
 */

export interface Header {
  name: string;
  value: string;
}

/**
 * Mailing-list mail: a List-Unsubscribe or List-Id header, or
 * "Precedence: bulk" / "Precedence: list".
 */
export function isBulkMail(headers: Header[]): boolean {
  return headers.some((h) => {
    const name = h.name.toLowerCase();
    return name === 'list-unsubscribe' || name === 'list-id' ||
      (name === 'precedence' && /^\s*(bulk|list)\b/i.test(h.value ?? ''));
  });
}

export interface ProviderContent {
  html: string | null;
  text: string | null;
  /** Present when requested (withHeaders). */
  headers?: Header[];
}

// ---- Gmail ----------------------------------------------------------------------

export async function fetchGmailContent(accessToken: string, messageId: string): Promise<ProviderContent> {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=FULL`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) {
    throw new Error(`Gmail API error (${res.status}): ${await res.text()}`);
  }
  const msg = await res.json();
  const payload = (msg.payload ?? {}) as Record<string, unknown>;
  return { ...extractGmailBody(payload), headers: (payload.headers as Header[] | undefined) ?? [] };
}

export function extractGmailBody(
  payload: Record<string, unknown>,
): { html: string | null; text: string | null } {
  let html: string | null = null;
  let text: string | null = null;

  const mimeType = payload.mimeType as string;
  const body = payload.body as { data?: string; size?: number } | undefined;
  const parts = payload.parts as Array<Record<string, unknown>> | undefined;

  // Single-part message
  if (body?.data) {
    const decoded = base64UrlDecode(body.data);
    if (mimeType === 'text/html') html = decoded;
    else if (mimeType === 'text/plain') text = decoded;
  }

  // Multipart — recurse into parts
  if (parts) {
    for (const part of parts) {
      const partMime = part.mimeType as string;
      const partBody = part.body as { data?: string } | undefined;
      const subParts = part.parts as Array<Record<string, unknown>> | undefined;

      if (partBody?.data) {
        const decoded = base64UrlDecode(partBody.data);
        if (partMime === 'text/html' && !html) html = decoded;
        else if (partMime === 'text/plain' && !text) text = decoded;
      }

      // Recurse for nested multipart (e.g. multipart/alternative inside multipart/mixed)
      if (subParts) {
        const nested = extractGmailBody(part);
        if (nested.html && !html) html = nested.html;
        if (nested.text && !text) text = nested.text;
      }
    }
  }

  return { html, text };
}

function base64UrlDecode(data: string): string {
  // Gmail returns base64url-encoded data
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  // Handle UTF-8 properly
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder('utf-8').decode(bytes);
}

// ---- Outlook --------------------------------------------------------------------

/**
 * A message's body from Microsoft Graph. preferText asks Graph to convert an
 * HTML body to text; withHeaders adds the internet message headers.
 */
export async function fetchOutlookContent(
  accessToken: string,
  messageId: string,
  opts: { preferText?: boolean; withHeaders?: boolean } = {},
): Promise<ProviderContent> {
  const select = opts.withHeaders ? 'body,internetMessageHeaders' : 'body,uniqueBody';
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(messageId)}?$select=${select}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(opts.preferText ? { Prefer: 'outlook.body-content-type="text"' } : {}),
      },
    },
  );
  if (!res.ok) {
    throw new Error(`Graph API error (${res.status}): ${await res.text()}`);
  }

  const msg = await res.json();
  const body = msg.body as { contentType: string; content: string } | undefined;
  const headers = opts.withHeaders ? (msg.internetMessageHeaders as Header[] | undefined) ?? [] : undefined;
  if (!body) return { html: null, text: null, headers };
  return body.contentType === 'html'
    ? { html: body.content, text: null, headers }
    : { html: null, text: body.content, headers };
}

// ---- Text -----------------------------------------------------------------------

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Readable text from an HTML body: no scripts, styles or tags, entities decoded, whitespace tidied. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head|title|template)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/td|\/table)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
      if (code[0] === '#') {
        const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ' ';
      }
      return ENTITIES[code.toLowerCase()] ?? m;
    })
    .replace(/[​-‍⁠﻿­͏]/g, '')
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/ *\n[\s]*/g, '\n')
    .trim();
}

/** Plain text of a fetched or cached body, preferring the text part. */
export function plainText(content: { text: string | null; html: string | null }): string {
  if (content.text && content.text.trim()) return content.text.replace(/\r\n?/g, '\n').trim();
  if (content.html) return htmlToText(content.html);
  return '';
}
