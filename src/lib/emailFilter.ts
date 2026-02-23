import type { Criterion, Email } from '../types/index.ts';

/**
 * Check whether an email matches a set of column filter criteria.
 *
 * Criteria fields map to email properties:
 *   - "from"    → email.sender (display name) or email.senderEmail
 *   - "to"      → email.recipients (if available)
 *   - "subject" → email.subject
 *   - "label"   → email.labels (if available)
 *   - "snippet" → email.snippet
 *
 * Operations:
 *   - "contains" → case-insensitive substring match
 *   - "equals"   → case-insensitive exact match
 *   - "startsWith" → case-insensitive prefix match
 *   - "endsWith" → case-insensitive suffix match
 */
export function emailMatchesCriteria(
  email: Email,
  criteria: Criterion[],
  logic: 'and' | 'or',
): boolean {
  if (criteria.length === 0) return false;

  const matches = criteria.map((c) => matchSingleCriterion(email, c));

  return logic === 'and'
    ? matches.every(Boolean)
    : matches.some(Boolean);
}

function matchSingleCriterion(
  email: Email,
  criterion: Criterion,
): boolean {
  const { field, op, value } = criterion;
  const v = value.toLowerCase();

  switch (field) {
    case 'from': {
      const sender = email.sender.toLowerCase();
      const senderEmail = (email.senderEmail || '').toLowerCase();
      return matchOp(sender, op, v) || matchOp(senderEmail, op, v);
    }
    case 'to': {
      // For mock data, we don't have recipients, so check accountId as a fallback
      return matchOp((email.accountId || '').toLowerCase(), op, v);
    }
    case 'subject':
      return matchOp(email.subject.toLowerCase(), op, v);
    case 'label': {
      if (!email.labels) return false;
      return email.labels.some((l) => matchOp(l.toLowerCase(), op, v));
    }
    case 'snippet':
      return matchOp(email.snippet.toLowerCase(), op, v);
    default:
      return false;
  }
}

function matchOp(haystack: string, op: string, needle: string): boolean {
  switch (op) {
    case 'contains':
      return haystack.includes(needle);
    case 'equals':
      return haystack === needle;
    case 'startsWith':
      return haystack.startsWith(needle);
    case 'endsWith':
      return haystack.endsWith(needle);
    default:
      return haystack.includes(needle);
  }
}
