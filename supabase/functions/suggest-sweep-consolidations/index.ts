import { createAdminClient } from '../_shared/supabase-admin.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { AuthError, requireUser } from '../_shared/auth.ts';
import { AnthropicError, callAnthropicJson } from '../_shared/anthropic.ts';
import { computeSuggestionHash, type ProposedRule, type SuggestionKind } from '../_shared/suggestionHash.ts';

interface Criterion {
  field: string;
  op: string;
  value: string;
}

interface DbRule {
  id: string;
  name: string;
  detail: string | null;
  is_enabled: boolean;
  criteria: Criterion[];
  criteria_logic: 'and' | 'or';
  action: string;
  delay_hours: number;
}

interface Suggestion {
  hash: string;
  kind: SuggestionKind;
  ruleIds: string[];
  proposedRule?: ProposedRule;
  keepRuleId?: string;
  rationale: string;
  confidence: 'high' | 'medium' | 'low';
  source: 'deterministic' | 'llm';
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

    const admin = createAdminClient();

    const { data: ruleRows, error: rulesErr } = await admin
      .from('sweep_rules')
      .select('id, name, detail, is_enabled, criteria, criteria_logic, action, delay_hours')
      .eq('user_id', user_id)
      .order('created_at', { ascending: true });
    if (rulesErr) throw rulesErr;
    const rules: DbRule[] = (ruleRows ?? []).map(normalizeRule).filter(r => r.criteria.length > 0);

    if (rules.length < 2) {
      return jsonResponse({ suggestions: [] });
    }

    const { data: dismissalRows } = await admin
      .from('sweep_suggestion_dismissals')
      .select('suggestion_hash')
      .eq('user_id', user_id);
    const dismissed = new Set((dismissalRows ?? []).map(r => (r as { suggestion_hash: string }).suggestion_hash));

    const suggestions: Suggestion[] = [];

    // Deterministic pre-pass: exact duplicates and action conflicts.
    suggestions.push(...detectDuplicatesAndConflicts(rules));

    // LLM pass — gated so we can ship the deterministic checks alone.
    const llmEnabled = Deno.env.get('SUGGEST_LLM_ENABLED') === 'true';
    console.log('[suggest-sweep-consolidations] rules:', rules.length, 'deterministic:', suggestions.length, 'llmEnabled:', llmEnabled);
    if (llmEnabled) {
      try {
        const sampleSendersByRule = await fetchSampleSendersByRule(admin, user_id, rules);
        const llmSuggestions = await runLlmPass(rules, sampleSendersByRule, suggestions);
        suggestions.push(...llmSuggestions);
      } catch (err) {
        if (err instanceof AnthropicError) {
          console.error('[suggest-sweep-consolidations] LLM error:', err.status, err.message);
        } else {
          console.error('[suggest-sweep-consolidations] LLM exception:', err);
        }
        // Deterministic suggestions still ship even if LLM fails.
      }
    }

    // Compute hashes, drop dismissed, de-dup by hash.
    const seen = new Set<string>();
    const out: Suggestion[] = [];
    for (const s of suggestions) {
      const hash = await computeSuggestionHash({
        kind: s.kind,
        ruleIds: s.ruleIds,
        proposedRule: s.proposedRule,
      });
      if (dismissed.has(hash) || seen.has(hash)) continue;
      seen.add(hash);
      out.push({ ...s, hash });
    }

    return jsonResponse({ suggestions: out });
  } catch (err) {
    console.error('[suggest-sweep-consolidations] error:', err);
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});

function normalizeRule(row: Record<string, unknown>): DbRule {
  const criteria = Array.isArray(row.criteria)
    ? (row.criteria as unknown[]).filter((c): c is Criterion =>
        !!c && typeof c === 'object' &&
        typeof (c as Criterion).field === 'string' &&
        typeof (c as Criterion).op === 'string' &&
        typeof (c as Criterion).value === 'string'
      )
    : [];
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    detail: typeof row.detail === 'string' ? row.detail : null,
    is_enabled: !!row.is_enabled,
    criteria,
    criteria_logic: row.criteria_logic === 'or' ? 'or' : 'and',
    action: String(row.action ?? 'archive'),
    delay_hours: Number(row.delay_hours ?? 24),
  };
}

function canonicalCriteriaKey(criteria: Criterion[], logic: 'and' | 'or'): string {
  const items = criteria
    .filter(c => c.value.trim())
    .map(c => `${c.field}|${c.op}|${c.value.trim().toLowerCase()}`)
    .sort();
  return `${logic}::${items.join('\n')}`;
}

function detectDuplicatesAndConflicts(rules: DbRule[]): Suggestion[] {
  const out: Suggestion[] = [];

  // Group by criteria-key. Within a group:
  //  - same action+delay => duplicate
  //  - different action  => conflict
  const groups = new Map<string, DbRule[]>();
  for (const r of rules) {
    const key = canonicalCriteriaKey(r.criteria, r.criteria_logic);
    const arr = groups.get(key) ?? [];
    arr.push(r);
    groups.set(key, arr);
  }

  for (const arr of groups.values()) {
    if (arr.length < 2) continue;

    // Subgroup by action+delay
    const byAction = new Map<string, DbRule[]>();
    for (const r of arr) {
      const k = `${r.action}::${r.delay_hours}`;
      const list = byAction.get(k) ?? [];
      list.push(r);
      byAction.set(k, list);
    }

    // Duplicates within same action+delay
    for (const list of byAction.values()) {
      if (list.length >= 2) {
        list.sort((a, b) => a.id.localeCompare(b.id));
        const keep = list[0];
        out.push({
          hash: '',
          kind: 'duplicate',
          ruleIds: list.map(r => r.id),
          keepRuleId: keep.id,
          rationale: `${list.length} rules have identical criteria and the same action. Keep one.`,
          confidence: 'high',
          source: 'deterministic',
        });
      }
    }

    // Conflicts across different actions
    if (byAction.size >= 2) {
      const ruleIds = arr.map(r => r.id).sort();
      out.push({
        hash: '',
        kind: 'conflict',
        ruleIds,
        rationale: 'These rules match the same emails but apply different actions. The first to run wins, which can lead to unexpected behavior.',
        confidence: 'high',
        source: 'deterministic',
      });
    }
  }

  return out;
}

async function fetchSampleSendersByRule(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  rules: DbRule[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  // Cap to keep token budget bounded; LLM only needs a few samples per rule.
  const subset = rules.slice(0, 50);
  for (const rule of subset) {
    const from = rule.criteria.find(c => c.field === 'from' && c.value.trim());
    if (!from) {
      out.set(rule.id, []);
      continue;
    }
    const v = from.value.replace(/^["']+|["']+$/g, '');
    const { data } = await admin
      .from('emails')
      .select('sender_email')
      .eq('user_id', userId)
      .ilike('sender_email', `%${v}%`)
      .limit(15);
    const senders = new Set<string>();
    for (const row of data ?? []) {
      const s = (row as { sender_email?: string | null }).sender_email;
      if (s) senders.add(s);
      if (senders.size >= 5) break;
    }
    out.set(rule.id, [...senders]);
  }
  return out;
}

interface LlmRulePayload {
  id: string;
  name: string;
  criteria: Criterion[];
  criteriaLogic: 'and' | 'or';
  action: string;
  delayHours: number;
  sampleSenders: string[];
}

interface LlmSuggestionPayload {
  kind: SuggestionKind;
  ruleIds: string[];
  proposedRule?: ProposedRule;
  keepRuleId?: string;
  rationale: string;
  confidence: 'high' | 'medium' | 'low';
}

const LLM_SYSTEM_PROMPT = `You are a "rule librarian" for an email sweep system. The user has a list of rules that auto-archive or auto-delete email. Your job is to find organizational improvements.

Input JSON: { rules: [{ id, name, criteria, criteriaLogic, action, delayHours, sampleSenders }], existingSuggestionHashes }

Each criterion has shape { field: 'from'|'to'|'subject'|'body'|'label'|'stream', op: 'contains'|'not_contains'|'equals'|'starts_with'|'ends_with', value: string }.

Return STRICT JSON: { "suggestions": LlmSuggestion[] }
LlmSuggestion has shape: { kind, ruleIds, proposedRule?, keepRuleId?, rationale, confidence }
- kind: one of "merge" | "absorb" | "redundant" | "rename".
- ruleIds: the rules involved by id.
- proposedRule: required for merge/absorb/rename. Partial rule object — { name, detail, criteria, criteriaLogic, action, delayHours } as appropriate.
  - merge: full proposed merged rule (criteria = union, criteriaLogic = 'or' unless all sources are AND identical, action+delayHours must match across sources).
  - absorb: { criteria } — full new criteria array for the absorber rule (existing + the new criterion). Include name only if you want to also rename it.
  - rename: only { name } and optionally { detail }.
- keepRuleId: required for redundant — which rule is the keeper.
- rationale: one short sentence, plain prose.
- confidence: 'high' if you're certain, 'medium' if reasonable, 'low' if it's a hunch. Be conservative — emit nothing if unsure.

STRICT RULES:
- NEVER suggest merging rules with different "action" values or different "delayHours".
- NEVER duplicate a suggestion whose hash is in existingSuggestionHashes (skip it silently).
- NEVER propose changes that broaden a rule beyond its sampleSenders' likely intent.
- "absorb" only applies when one rule is a narrow specialization of another (e.g. Substack -> Newsletters). The proposedRule.criteria MUST be the broader rule's criteria with one criterion added.
- "rename" only when the current name is mechanical/auto-generated ("From contains X") and you can offer a clearly better semantic name based on sampleSenders.
- Output ONLY the JSON object.

If there are no high-quality suggestions, return { "suggestions": [] }.`;

async function runLlmPass(
  rules: DbRule[],
  sampleSendersByRule: Map<string, string[]>,
  existingSuggestions: Suggestion[],
): Promise<Suggestion[]> {
  const payload = {
    rules: rules.slice(0, 50).map<LlmRulePayload>(r => ({
      id: r.id,
      name: r.name,
      criteria: r.criteria,
      criteriaLogic: r.criteria_logic,
      action: r.action,
      delayHours: r.delay_hours,
      sampleSenders: sampleSendersByRule.get(r.id) ?? [],
    })),
    existingSuggestionHashes: existingSuggestions.map(s => s.hash).filter(Boolean),
  };

  const result = await callAnthropicJson<{ suggestions: LlmSuggestionPayload[] }>({
    system: LLM_SYSTEM_PROMPT,
    user: JSON.stringify(payload),
    maxTokens: 3000,
  });

  if (!result || !Array.isArray(result.suggestions)) return [];

  const ruleIdSet = new Set(rules.map(r => r.id));
  const out: Suggestion[] = [];
  for (const s of result.suggestions) {
    if (!s || typeof s !== 'object') continue;
    if (!['merge', 'absorb', 'redundant', 'rename'].includes(s.kind)) continue;
    if (!Array.isArray(s.ruleIds) || s.ruleIds.length === 0) continue;
    if (!s.ruleIds.every(id => typeof id === 'string' && ruleIdSet.has(id))) continue;

    // Enforce: never merge across different actions/delays.
    if (s.kind === 'merge' || s.kind === 'absorb') {
      const involved = rules.filter(r => s.ruleIds.includes(r.id));
      const actions = new Set(involved.map(r => r.action));
      const delays = new Set(involved.map(r => r.delay_hours));
      if (actions.size > 1 || delays.size > 1) continue;
    }

    const confidence = ['high', 'medium', 'low'].includes(s.confidence) ? s.confidence : 'medium';
    out.push({
      hash: '',
      kind: s.kind,
      ruleIds: s.ruleIds,
      proposedRule: s.proposedRule,
      keepRuleId: typeof s.keepRuleId === 'string' ? s.keepRuleId : undefined,
      rationale: typeof s.rationale === 'string' ? s.rationale.slice(0, 280) : '',
      confidence,
      source: 'llm',
    });
  }
  return out;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
