// Mirror of src/lib/suggestionHash.ts for Deno edge functions.
// Keep the canonicalization rules in sync.

export type SuggestionKind = 'duplicate' | 'merge' | 'absorb' | 'redundant' | 'rename' | 'conflict';

export interface ProposedRule {
  name?: string;
  detail?: string;
  criteria?: { field: string; op: string; value: string }[];
  criteriaLogic?: 'and' | 'or';
  action?: string;
  delayHours?: number;
}

export async function computeSuggestionHash(input: {
  kind: SuggestionKind;
  ruleIds: string[];
  proposedRule?: ProposedRule;
}): Promise<string> {
  const canonical = {
    kind: input.kind,
    ruleIds: [...input.ruleIds].sort(),
    proposedRule: canonicalizeProposedRule(input.proposedRule),
  };
  const text = JSON.stringify(canonical);
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return bufferToHex(digest);
}

function canonicalizeProposedRule(p: ProposedRule | undefined): ProposedRule | null {
  if (!p) return null;
  const criteria = Array.isArray(p.criteria)
    ? [...p.criteria]
        .map(c => ({
          field: String(c.field || ''),
          op: String(c.op || ''),
          value: String(c.value || '').trim().toLowerCase(),
        }))
        .sort((a, b) => {
          if (a.field !== b.field) return a.field < b.field ? -1 : 1;
          if (a.op !== b.op) return a.op < b.op ? -1 : 1;
          return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
        })
    : undefined;
  return {
    name: p.name ?? undefined,
    detail: p.detail ?? undefined,
    criteria,
    criteriaLogic: p.criteriaLogic ?? undefined,
    action: p.action ?? undefined,
    delayHours: p.delayHours ?? undefined,
  };
}

function bufferToHex(buf: ArrayBuffer): string {
  const view = new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < view.length; i++) {
    out += view[i].toString(16).padStart(2, '0');
  }
  return out;
}
