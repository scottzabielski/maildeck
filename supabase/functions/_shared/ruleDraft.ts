import { Anthropic, DRAFT_MODEL, costUsd, inputTokens, toCallError } from './claude.ts';
import type { AdminClient, Criterion } from './sweepMatching.ts';

/**
 * Plain-English sweep rules: turns the owner's description of a rule into
 * MailDeck's rule shape, and decides whether its regular conditions are
 * enough or it needs a Claude check (with the conditions as a pre-filter).
 * Used by the app's rule editor (draft-sweep-rule) and the mail MCP
 * (mcp-api rules.draft). The result is only a draft; saving it is a
 * separate, reviewed step.
 */

export class DraftError extends Error {}

export interface RuleDraft {
  name: string;
  criteria: Criterion[];
  logic: 'and' | 'or';
  action: 'archive' | 'delete' | 'keep_newest_archive' | 'keep_newest_delete';
  delay_hours: number;
  /** Null when the regular conditions are enough. */
  ai_check: { enabled: true; instruction: string } | null;
}

export interface DraftResult {
  draft: RuleDraft;
  explanation: string;
  warnings: string[];
  cost_usd: number;
}

const FIELDS = ['from', 'to', 'subject', 'body', 'label', 'bulk'] as const;
const OPS = ['contains', 'not_contains', 'equals', 'starts_with', 'ends_with'] as const;
const ACTIONS = ['archive', 'delete', 'keep_newest_archive', 'keep_newest_delete'] as const;
const UNSAFE_VALUE = /[,()"*\\]/;
const MAX_TOKENS = 6000;
export const MAX_DESCRIPTION = 1000;

const DRAFT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'conditions', 'logic', 'action', 'delay_hours', 'needs_claude_check', 'claude_instruction', 'explanation'],
  properties: {
    name: { type: 'string' },
    conditions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['field', 'op', 'value'],
        properties: {
          field: { type: 'string', enum: [...FIELDS] },
          op: { type: 'string', enum: [...OPS] },
          value: { type: 'string' },
        },
      },
    },
    logic: { type: 'string', enum: ['and', 'or'] },
    action: { type: 'string', enum: [...ACTIONS] },
    delay_hours: { type: 'integer' },
    needs_claude_check: { type: 'boolean' },
    claude_instruction: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    explanation: { type: 'string' },
  },
};

function systemPrompt(defaultDelay: number): string {
  return `You turn the owner's plain-English description of an email-cleanup rule into a MailDeck sweep rule. MailDeck archives (or deletes) inbox messages that match a rule, a set number of hours after each one arrives.

A rule has regular conditions, which MailDeck evaluates itself, and can also have a Claude check: a plain-English description that Claude reads each matching message against before it's swept. Regular conditions are free and instant. A Claude check costs a little per message and only runs on messages the conditions already matched.

Regular conditions, all case-insensitive:
- from: sender name or address. to: recipient addresses. subject. body: only the first ~200 characters of the message (its preview). label: a Gmail label id (CATEGORY_PROMOTIONS, CATEGORY_SOCIAL, CATEGORY_UPDATES, CATEGORY_FORUMS, IMPORTANT, STARRED) or an Outlook category name. bulk: "true" when the message came from a mailing list (it has List-Unsubscribe, List-Id or Precedence: bulk headers), "false" when it didn't.
- ops: contains, not_contains, equals, starts_with, ends_with. bulk always uses equals.
- Values are plain text of 2 to 200 characters and can't contain , ( ) " * or \\. There are no wildcards or regular expressions.
- Up to 10 conditions, all joined by "and" or all by "or", never mixed.

Decide whether regular conditions are enough:
- They are enough when the description names concrete things they can test: senders, domains, addresses, subject words, labels, bulk mail. Then use only regular conditions: needs_claude_check false, claude_instruction null.
- They are not enough when the description depends on meaning the conditions can't reliably capture: what kind of message it is, what it's for, who sent it in a human sense, or exceptions like "but not from people I know" or "unless it's a receipt". Then set needs_claude_check true, write claude_instruction, and make the conditions a pre-filter.
- A pre-filter must catch every message the rule is meant for while excluding most of the inbox, because every message it matches is sent to Claude. Good pre-filters are subject or body keywords, bulk equals true, a category label, or a sender domain. Never use one that would match most of the inbox.
- claude_instruction describes, for someone reading one message (its sender, subject, the start of its body and the bulk flag), which messages qualify and which don't. Write it as a description of the mail, not as a command, for example: "an automated survey or feedback request sent by a company's system, not a personal email from someone I know".

action: archive, unless the description asks to delete or trash. A rule with a Claude check always archives (MailDeck won't let a Claude-checked rule delete), so if they asked to delete mail that needs a check, archive and say so in the explanation. Use keep_newest_archive or keep_newest_delete when they want only the most recent matching message kept.
delay_hours: hours after arrival before sweeping, from the description ("after a week" is 168), at most 720. Default ${defaultDelay}. Use 0 for keep_newest actions.
name: 1 to 4 words, the way the owner would say it, without "emails" or "messages" (for example "Surveys" or "LinkedIn jobs").
explanation: one or two plain sentences for the owner saying what the rule does and why it does or doesn't need a Claude check.`;
}

/** A draft condition, cleaned up; null if it can't be used. */
function cleanCondition(c: { field: string; op: string; value: string }): Criterion | null {
  if (!(FIELDS as readonly string[]).includes(c.field)) return null;
  const raw = c.value.trim();
  if (c.field === 'bulk') {
    const v = raw.toLowerCase();
    return v === 'true' || v === 'false' ? { field: 'bulk', op: 'equals', value: v } : null;
  }
  if (!(OPS as readonly string[]).includes(c.op)) return null;
  const value = raw.replace(/^['"]+|['"]+$/g, '').trim();
  if (value.length < 2 || value.length > 200 || UNSAFE_VALUE.test(value)) return null;
  return { field: c.field, op: c.op, value };
}

interface RawDraft {
  name: string;
  conditions: { field: string; op: string; value: string }[];
  logic: string;
  action: string;
  delay_hours: number;
  needs_claude_check: boolean;
  claude_instruction: string | null;
  explanation: string;
}

/** Turns the model's output into a rule MailDeck will accept, noting anything it had to change. */
export function finishDraft(raw: RawDraft, description: string, defaultDelay: number): { draft: RuleDraft; warnings: string[] } {
  const warnings: string[] = [];
  const criteria: Criterion[] = [];
  for (const c of (raw.conditions ?? []).slice(0, 10)) {
    const clean = cleanCondition(c);
    if (clean) criteria.push(clean);
    else warnings.push(`Dropped a condition MailDeck can't match: ${c.field} ${c.op} "${String(c.value).slice(0, 60)}".`);
  }
  if (criteria.length === 0) {
    throw new DraftError(
      "Couldn't turn that into conditions MailDeck can match. Mention a sender, a domain, or words to look for in the subject.",
    );
  }

  let action = (ACTIONS as readonly string[]).includes(raw.action) ? raw.action as RuleDraft['action'] : 'archive';
  let ai: RuleDraft['ai_check'] = null;
  if (raw.needs_claude_check) {
    const instruction = (raw.claude_instruction ?? '').trim();
    ai = { enabled: true, instruction: (instruction.length >= 10 ? instruction : description.trim()).slice(0, 1000) };
    if (action === 'delete' || action === 'keep_newest_delete') {
      action = action === 'delete' ? 'archive' : 'keep_newest_archive';
      warnings.push('A rule with a Claude check can only archive, so this one archives instead of deleting.');
    }
  }
  if (criteria.every((c) => c.op === 'not_contains')) {
    warnings.push('Every condition is "not contains", so this matches nearly everything else in the inbox.');
  }

  const delay = action.startsWith('keep_newest_')
    ? 0
    : Number.isInteger(raw.delay_hours) && raw.delay_hours >= 0 ? Math.min(raw.delay_hours, 720) : defaultDelay;
  const name = (raw.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'New rule';
  return {
    draft: { name, criteria, logic: raw.logic === 'or' ? 'or' : 'and', action, delay_hours: delay, ai_check: ai },
    warnings,
  };
}

/**
 * Drafts a rule from the owner's description. Counts against the monthly
 * Claude budget and is logged with the checks.
 */
export async function draftSweepRule(
  admin: AdminClient,
  client: Anthropic | null,
  userId: string,
  description: string,
): Promise<DraftResult> {
  const text = description.trim();
  if (text.length < 5) throw new DraftError('Describe the rule in a few words.');
  if (text.length > MAX_DESCRIPTION) throw new DraftError(`Keep the description under ${MAX_DESCRIPTION} characters.`);
  if (!client) throw new DraftError("Claude isn't set up for MailDeck (ANTHROPIC_API_KEY is missing).");

  const [profile, accounts, usage] = await Promise.all([
    admin.from('profiles').select('default_sweep_delay_hours').eq('id', userId).maybeSingle(),
    admin.from('email_accounts').select('email, provider').eq('user_id', userId),
    admin.rpc('claude_check_usage', { p_user_id: userId }),
  ]);
  if (usage.error) throw usage.error;
  const defaultDelay = Number.isInteger(profile.data?.default_sweep_delay_hours) ? profile.data!.default_sweep_delay_hours as number : 24;
  const u = ((usage.data ?? [])[0] ?? {}) as Record<string, unknown>;
  const worstCase = costUsd(DRAFT_MODEL, { input_tokens: 4000, output_tokens: MAX_TOKENS });
  if (Number(u.spent_month_usd ?? 0) + worstCase > Number(u.monthly_budget_usd ?? 0)) {
    throw new DraftError("This month's Claude budget is used up, so MailDeck can't draft rules until next month (or until the budget is raised in Settings).");
  }

  const mailboxes = ((accounts.data ?? []) as { email: string; provider: string }[])
    .map((a) => `${a.email} (${a.provider})`).join(', ') || 'none listed';
  const log = async (fields: { model: string; error: string | null; usage?: Anthropic.Beta.BetaUsage }) => {
    const { error } = await admin.from('sweep_ai_checks').insert({
      user_id: userId,
      check_hash: 'draft',
      model: fields.model,
      source: 'draft',
      error: fields.error,
      input_tokens: fields.usage ? inputTokens(fields.usage) : 0,
      output_tokens: fields.usage?.output_tokens ?? 0,
      cost_usd: fields.usage ? costUsd(fields.model, fields.usage) : 0,
    });
    if (error) console.error('[ruleDraft] log failed:', error.message);
  };

  let res: Anthropic.Beta.BetaMessage;
  try {
    res = await client.beta.messages.create({
      model: DRAFT_MODEL,
      max_tokens: MAX_TOKENS,
      // A refusal is re-run on Anthropic's recommended fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: DRAFT_SCHEMA } },
      system: systemPrompt(defaultDelay),
      messages: [{
        role: 'user',
        content: `<description>\n${text}\n</description>\n\nThe owner's mail accounts: ${mailboxes}.`,
      }],
    });
  } catch (err) {
    const failure = toCallError(err);
    await log({ model: DRAFT_MODEL, error: failure.message });
    throw new DraftError(`Couldn't draft the rule: ${failure.message}.`);
  }

  const cost = costUsd(res.model, res.usage);
  if (res.stop_reason === 'refusal' || res.stop_reason === 'max_tokens') {
    await log({ model: res.model, error: `stop_reason ${res.stop_reason}`, usage: res.usage });
    throw new DraftError(
      res.stop_reason === 'refusal' ? 'Claude declined to draft this rule.' : "Claude's draft was cut off. Try a shorter description.",
    );
  }
  let raw: RawDraft;
  try {
    const block = res.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text');
    raw = JSON.parse(block?.text ?? '') as RawDraft;
  } catch {
    await log({ model: res.model, error: 'unparseable draft', usage: res.usage });
    throw new DraftError("Claude's draft couldn't be read. Try again.");
  }
  await log({ model: res.model, error: null, usage: res.usage });

  const { draft, warnings } = finishDraft(raw, text, defaultDelay);
  const explanation = (raw.explanation ?? '').replace(/\s+/g, ' ').trim().slice(0, 500);
  return { draft, explanation, warnings, cost_usd: Number(cost.toFixed(6)) };
}
