import type { AdminClient } from './sweepMatching.ts';
import { fetchGmailContent, fetchOutlookContent, isBulkMail, plainText } from './emailContent.ts';
import type {
  BodySource,
  CachedVerdict,
  CallLog,
  CheckStore,
  ClaimedCheck,
  EmailForCheck,
  RuleForCheck,
  Usage,
  VerdictUpdate,
} from './claudeCheck.ts';
import { BODY_CHARS } from './claudeCheck.ts';

/** The checker's storage on MailDeck's database (service role). */
export class SupabaseCheckStore implements CheckStore {
  constructor(private admin: AdminClient) {}

  async claim(limit: number): Promise<ClaimedCheck[]> {
    const { data, error } = await this.admin.rpc('claim_sweep_checks', { p_limit: limit, p_lease_seconds: 300 });
    if (error) throw error;
    return (data ?? []) as ClaimedCheck[];
  }

  async rules(ids: string[]): Promise<Map<string, RuleForCheck>> {
    if (ids.length === 0) return new Map();
    const { data, error } = await this.admin
      .from('sweep_rules')
      .select('id, ai_check_enabled, ai_instruction, ai_model')
      .in('id', ids);
    if (error) throw error;
    return new Map(((data ?? []) as RuleForCheck[]).map((r) => [r.id, r]));
  }

  async emails(ids: string[]): Promise<Map<string, EmailForCheck>> {
    if (ids.length === 0) return new Map();
    const { data, error } = await this.admin
      .from('emails')
      .select('id, account_id, provider_message_id, sender_name, sender_email, subject, snippet, body_text, body_html, is_bulk, is_archived, is_deleted')
      .in('id', ids);
    if (error) throw error;
    return new Map(((data ?? []) as EmailForCheck[]).map((e) => [e.id, e]));
  }

  async cachedVerdicts(emailIds: string[]): Promise<CachedVerdict[]> {
    if (emailIds.length === 0) return [];
    const { data, error } = await this.admin
      .from('sweep_ai_checks')
      .select('email_id, check_hash, verdict, reason, model')
      .in('email_id', emailIds)
      .not('verdict', 'is', null);
    if (error) throw error;
    return (data ?? []) as CachedVerdict[];
  }

  async usage(userId: string): Promise<Usage> {
    const { data, error } = await this.admin.rpc('claude_check_usage', { p_user_id: userId });
    if (error) throw error;
    const u = ((data ?? [])[0] ?? {}) as Record<string, unknown>;
    return {
      spentMonthUsd: Number(u.spent_month_usd ?? 0),
      checks24h: Number(u.checks_24h ?? 0),
      monthlyBudgetUsd: Number(u.monthly_budget_usd ?? 0),
      dailyCheckLimit: Number(u.daily_check_limit ?? 0),
    };
  }

  async logCall(row: CallLog): Promise<void> {
    const { error } = await this.admin.from('sweep_ai_checks').insert(row);
    // A verdict for this question was cached meanwhile (a preview and a sweep
    // raced): the first one stands.
    if (error && error.code !== '23505') throw error;
  }

  async applyVerdict(c: ClaimedCheck, v: VerdictUpdate): Promise<boolean> {
    const { data, error } = await this.held(c)
      .update({
        ai_status: v.verdict,
        ai_reason: v.reason,
        ai_model: v.model,
        ai_input_tokens: v.inputTokens,
        ai_output_tokens: v.outputTokens,
        ai_cost_usd: v.costUsd,
        ai_checked_at: new Date().toISOString(),
        ai_error: null,
        ai_claim_id: null,
        ai_claimed_until: null,
        // no_match exempts the message: it stays in the inbox for good.
        ...(v.verdict === 'no_match' ? { executed: true } : {}),
      })
      .select('id');
    if (error) throw error;
    return (data ?? []).length > 0;
  }

  async recordFailure(c: ClaimedCheck, attempts: number, message: string, final: boolean, next: Date | null): Promise<void> {
    const { error } = await this.held(c).update({
      ai_attempts: attempts,
      ai_error: message.slice(0, 300),
      ai_next_attempt_at: next?.toISOString() ?? null,
      ai_claim_id: null,
      ai_claimed_until: null,
      ...(final ? { ai_status: 'failed' } : {}),
    });
    if (error) throw error;
  }

  async release(checks: ClaimedCheck[]): Promise<void> {
    for (const c of checks) {
      const { error } = await this.admin
        .from('sweep_queue')
        .update({ ai_claim_id: null, ai_claimed_until: null })
        .eq('id', c.queue_id)
        .eq('ai_claim_id', c.claim_id);
      if (error) throw error;
    }
  }

  async cancel(c: ClaimedCheck): Promise<void> {
    const { error } = await this.held(c).delete();
    if (error) throw error;
  }

  async markDone(c: ClaimedCheck): Promise<void> {
    const { error } = await this.held(c).update({ executed: true, ai_claim_id: null, ai_claimed_until: null });
    if (error) throw error;
  }

  async setBulk(emailId: string, bulk: boolean): Promise<void> {
    await this.admin.from('emails').update({ is_bulk: bulk }).eq('id', emailId).is('is_bulk', null);
  }

  /** The claimed row, only while still claimed, waiting, and not swept. */
  private held(c: ClaimedCheck) {
    return {
      update: (values: Record<string, unknown>) =>
        this.admin.from('sweep_queue').update(values)
          .eq('id', c.queue_id).eq('ai_claim_id', c.claim_id).eq('ai_status', 'pending').eq('executed', false),
      delete: () =>
        this.admin.from('sweep_queue').delete()
          .eq('id', c.queue_id).eq('ai_claim_id', c.claim_id).eq('executed', false),
    };
  }
}

/**
 * Reads a message the way Claude sees it: the cached body if there is one,
 * otherwise from Gmail or Outlook (which also yields its headers, and so the
 * bulk flag for mail synced before the flag existed). Returns null when the
 * provider can't be reached; the caller falls back to the preview.
 */
export function providerBodySource(admin: AdminClient): BodySource {
  const tokens = new Map<string, Promise<{ provider: string; token: string } | null>>();
  const account = (accountId: string) => {
    if (!tokens.has(accountId)) {
      tokens.set(accountId, (async () => {
        const { data } = await admin
          .from('email_accounts')
          .select('provider, access_token_encrypted')
          .eq('id', accountId)
          .maybeSingle();
        if (!data?.access_token_encrypted) return null;
        const { data: token } = await admin.rpc('decrypt_token', { encrypted_text: data.access_token_encrypted });
        return token ? { provider: data.provider as string, token: token as string } : null;
      })().catch(() => null));
    }
    return tokens.get(accountId)!;
  };

  return async (email) => {
    if (email.body_text || email.body_html) {
      return { text: plainText({ text: email.body_text, html: email.body_html }).slice(0, BODY_CHARS * 2) };
    }
    const acct = await account(email.account_id);
    if (!acct) return null;
    const content = acct.provider === 'gmail'
      ? await fetchGmailContent(acct.token, email.provider_message_id)
      : await fetchOutlookContent(acct.token, email.provider_message_id, { preferText: true, withHeaders: true });
    return {
      text: plainText(content).slice(0, BODY_CHARS * 2),
      ...(content.headers ? { bulk: isBulkMail(content.headers) } : {}),
    };
  };
}
