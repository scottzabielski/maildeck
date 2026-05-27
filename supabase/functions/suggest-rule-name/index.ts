import { createAdminClient } from '../_shared/supabase-admin.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { AuthError, requireUser } from '../_shared/auth.ts';
import { AnthropicError, callAnthropicJson } from '../_shared/anthropic.ts';

interface Criterion {
  field: string;
  op: string;
  value: string;
}

interface RequestBody {
  criteria?: Criterion[];
  criteriaLogic?: 'and' | 'or';
  action?: string;
  existingRuleNames?: string[];
}

interface NameResponse {
  name: string;
  detail: string;
}

// In-memory token bucket per user_id. Workers are persistent (per_worker
// policy) so this gives soft rate-limiting against accidental client loops.
// Not a security control — abuse protection.
const bucket = new Map<string, { tokens: number; updatedAt: number }>();
const BUCKET_BURST = 3;
const BUCKET_REFILL_PER_SEC = 1;

function takeToken(userId: string): boolean {
  const now = Date.now();
  const entry = bucket.get(userId) ?? { tokens: BUCKET_BURST, updatedAt: now };
  const elapsed = (now - entry.updatedAt) / 1000;
  entry.tokens = Math.min(BUCKET_BURST, entry.tokens + elapsed * BUCKET_REFILL_PER_SEC);
  entry.updatedAt = now;
  if (entry.tokens < 1) {
    bucket.set(userId, entry);
    return false;
  }
  entry.tokens -= 1;
  bucket.set(userId, entry);
  return true;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    let user_id: string;
    try {
      user_id = await requireUser(req);
    } catch (err) {
      if (err instanceof AuthError) return jsonResponse({ error: err.message }, err.status);
      throw err;
    }

    if (!takeToken(user_id)) {
      return jsonResponse({ error: 'Rate limit exceeded' }, 429);
    }

    const body = await req.json().catch(() => ({})) as RequestBody;
    const criteria = Array.isArray(body.criteria)
      ? body.criteria.filter(c =>
          c && typeof c.field === 'string' && typeof c.op === 'string' && typeof c.value === 'string' && c.value.trim()
        )
      : [];
    const criteriaLogic: 'and' | 'or' = body.criteriaLogic === 'or' ? 'or' : 'and';
    const action = typeof body.action === 'string' ? body.action : 'archive';
    const existingRuleNames = Array.isArray(body.existingRuleNames)
      ? body.existingRuleNames.filter((n): n is string => typeof n === 'string').slice(0, 40)
      : [];

    if (criteria.length === 0) {
      return jsonResponse({ error: 'criteria is required' }, 400);
    }

    // Pull a tiny sample of matching emails to ground the name in real data.
    const sampleSenders = await fetchSampleSenders(user_id, criteria);

    const system = SYSTEM_PROMPT;
    const userPrompt = JSON.stringify({
      criteria,
      criteriaLogic,
      action,
      existingRuleNames,
      sampleSenders,
    });

    let result: NameResponse;
    try {
      result = await callAnthropicJson<NameResponse>({
        system,
        user: userPrompt,
        maxTokens: 200,
      });
    } catch (err) {
      if (err instanceof AnthropicError) {
        console.error('[suggest-rule-name] Anthropic error:', err.status, err.message);
        return jsonResponse({ error: 'LLM call failed', detail: err.message }, 502);
      }
      throw err;
    }

    const name = sanitizeShort(result?.name, 60) || 'Untitled rule';
    const detail = sanitizeShort(result?.detail, 120) || '';
    return jsonResponse({ name, detail });
  } catch (err) {
    console.error('[suggest-rule-name] error:', err);
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});

const SYSTEM_PROMPT = `You name email sweep rules for a power user's inbox app.

Input is JSON: { criteria, criteriaLogic, action, existingRuleNames, sampleSenders }.
- criteria: array of { field, op, value } describing what the rule matches.
- action: "archive" | "delete" | "keep_newest_archive" | "keep_newest_delete".
- existingRuleNames: names already in use — avoid collisions and match the user's stylistic conventions (title case vs lowercase, length, etc).
- sampleSenders: up to 5 example senders the rule currently matches. Use these to infer the semantic category (e.g. "stripe.com" + "paypal.com" -> payment receipts).

Return STRICT JSON: { "name": string, "detail": string }
- name: 1-4 words, human-friendly, the kind of thing a user would write themselves. Examples: "Stripe receipts", "Newsletters", "Marketing".
- detail: 1 short sentence describing what the rule does (action + scope). Example: "Archive payment confirmations after 24h".
- No markdown, no quotes around values, no trailing punctuation in the name.
- If sampleSenders strongly suggests a category, name by category, not by domain.
- If the rule looks like junk/promo, prefer category words like "Promotions", "Marketing", "Newsletters".

Output ONLY the JSON object, nothing else.`;

async function fetchSampleSenders(userId: string, criteria: Criterion[]): Promise<string[]> {
  try {
    const admin = createAdminClient();
    let query = admin
      .from('emails')
      .select('sender_email')
      .eq('user_id', userId)
      .limit(20);

    // Best-effort filter: use the first 'from' / 'subject' criterion to narrow.
    const fromC = criteria.find(c => c.field === 'from' && c.value.trim());
    if (fromC) {
      const v = fromC.value.replace(/^["']+|["']+$/g, '');
      query = query.ilike('sender_email', `%${v}%`);
    } else {
      const subjectC = criteria.find(c => c.field === 'subject' && c.value.trim());
      if (subjectC) {
        const v = subjectC.value.replace(/^["']+|["']+$/g, '');
        query = query.ilike('subject', `%${v}%`);
      }
    }

    const { data, error } = await query;
    if (error || !data) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const row of data) {
      const s = (row as { sender_email?: string | null }).sender_email;
      if (s && !seen.has(s)) {
        seen.add(s);
        out.push(s);
        if (out.length >= 5) break;
      }
    }
    return out;
  } catch {
    return [];
  }
}

function sanitizeShort(s: unknown, max: number): string {
  if (typeof s !== 'string') return '';
  return s.replace(/[\r\n]+/g, ' ').trim().slice(0, max);
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
