import { useState } from 'react';
import { useAuth } from '../hooks/useAuth.ts';
import { useClaudeUsage, useUpdateClaudeLimits } from '../hooks/useClaudeChecks.ts';

/**
 * Settings for Claude checks on sweep rules: the monthly spend cap and the
 * daily check limit, with this month's spending. When either limit is
 * reached, checking stops and the sweeps waiting on it stay in the inbox.
 * Shared by the desktop and mobile settings screens.
 */
export function ClaudeBudgetSettings({ variant }: { variant: 'desktop' | 'mobile' }) {
  const { user } = useAuth();
  const usage = useClaudeUsage(user?.id);
  const update = useUpdateClaudeLimits();
  // What the user is typing, until it's saved; otherwise the saved values show.
  const [budgetDraft, setBudgetDraft] = useState<string | null>(null);
  const [limitDraft, setLimitDraft] = useState<string | null>(null);

  if (!user?.id || !usage.data) return null;
  const u = usage.data;
  const budget = budgetDraft ?? String(u.monthly_budget_usd);
  const limit = limitDraft ?? String(u.daily_check_limit);

  const save = () => {
    const b = Math.round(Number(budget) * 100) / 100;
    const l = Math.round(Number(limit));
    const changes: { ai_monthly_budget_usd?: number; ai_daily_check_limit?: number } = {};
    if (budget.trim() && Number.isFinite(b) && b >= 0 && b <= 1000 && b !== u.monthly_budget_usd) changes.ai_monthly_budget_usd = b;
    if (limit.trim() && Number.isFinite(l) && l >= 0 && l <= 20000 && l !== u.daily_check_limit) changes.ai_daily_check_limit = l;
    if (Object.keys(changes).length) update.mutate({ userId: user.id, ...changes });
    setBudgetDraft(null);
    setLimitDraft(null);
  };

  const paused = u.checks_24h >= u.daily_check_limit
    ? 'Daily limit reached: checks resume as the 24-hour window moves on.'
    : u.spent_month_usd >= u.monthly_budget_usd
    ? "Monthly budget reached: checks resume next month or when it's raised."
    : null;
  const spent = `$${u.spent_month_usd.toFixed(2)} of $${u.monthly_budget_usd.toFixed(2)} this month · ${u.checks_24h} of ${u.daily_check_limit} checks in the last 24 hours`;
  const m = variant === 'mobile';

  return (
    <div className={m ? 'mobile-settings-card' : 'settings-card'}>
      <div className={m ? 'mobile-settings-row' : 'settings-option'}>
        <div className={m ? 'mobile-settings-row-main' : 'settings-option-info'}>
          <div className={m ? 'mobile-settings-row-primary' : 'settings-option-label'}>Claude checks: monthly budget</div>
          <div className={m ? 'mobile-settings-row-secondary' : 'settings-option-desc'}>
            {spent}
            {paused && <div className="claude-budget-paused">{paused}</div>}
          </div>
        </div>
        <span className="claude-budget-input">
          $<input
            type="number"
            min={0}
            max={1000}
            step={1}
            value={budget}
            onChange={(e) => setBudgetDraft(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            aria-label="Monthly budget in dollars"
          />
        </span>
      </div>
      <div className={m ? 'mobile-settings-row' : 'settings-option'}>
        <div className={m ? 'mobile-settings-row-main' : 'settings-option-info'}>
          <div className={m ? 'mobile-settings-row-primary' : 'settings-option-label'}>Claude checks: daily limit</div>
          <div className={m ? 'mobile-settings-row-secondary' : 'settings-option-desc'}>
            Most messages Claude checks in 24 hours. Past either limit, sweeps waiting on a check stay in the inbox.
          </div>
        </div>
        <span className="claude-budget-input">
          <input
            type="number"
            min={0}
            max={20000}
            step={50}
            value={limit}
            onChange={(e) => setLimitDraft(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            aria-label="Daily check limit"
          />
        </span>
      </div>
    </div>
  );
}
