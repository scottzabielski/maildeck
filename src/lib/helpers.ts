// Formatting a date with options builds a formatter each time, which is slow enough to
// matter across a column of cards; these are built once.
const TIME = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: 'long' });
const MONTH_DAY = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

export function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();

  // Strip time to compare dates
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const emailDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.floor((today.getTime() - emailDay.getTime()) / 86400000);

  if (diffDays === 0) {
    // Today: show time like "2:30 PM"
    return TIME.format(date);
  }
  if (diffDays === 1) {
    return 'Yesterday';
  }
  if (diffDays < 7) {
    // Within the last week: show day name
    return WEEKDAY.format(date);
  }
  // Older: show date like "Feb 15"
  return MONTH_DAY.format(date);
}

export function formatCountdown(seconds: number): string {
  if (seconds >= 86400) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    return `${d}d ${h}h`;
  }
  if (seconds >= 3600) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  }
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function getCountdownClass(seconds: number): string {
  if (seconds < 60) return 'critical';
  if (seconds < 3600) return 'warning';
  return '';
}

/**
 * A sweep held by its rule's Claude check: waiting for Claude, or held after
 * an unsure verdict or a failed check. Held sweeps never run in the app.
 */
export function isClaudeHeld(email: { aiStatus?: string }): boolean {
  return email.aiStatus === 'pending' || email.aiStatus === 'unsure' || email.aiStatus === 'failed';
}

/** Badge text for a sweep a Claude check is holding (or has cleared). */
export function claudeCheckLabel(status: string): string {
  switch (status) {
    case 'pending': return 'Claude checking';
    case 'unsure': return 'Needs review';
    case 'failed': return 'Check failed';
    default: return 'Claude: match';
  }
}
