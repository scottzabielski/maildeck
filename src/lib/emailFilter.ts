import type { Criterion, Email } from '../types/index.ts';
import { useStore } from '../store/index.ts';

/**
 * Check whether an email matches a set of column filter criteria.
 *
 * Criteria fields map to email properties:
 *   - "from"    → email.sender (display name) or email.senderEmail
 *   - "to"      → email.recipients (if available)
 *   - "subject" → email.subject
 *   - "label"   → email.labels (if available)
 *   - "snippet" → email.snippet
 *   - "stream"  → evaluates referenced column's criteria recursively
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
  return emailMatchesCriteriaInternal(email, criteria, logic, undefined);
}

function emailMatchesCriteriaInternal(
  email: Email,
  criteria: Criterion[],
  logic: 'and' | 'or',
  visitedStreams: Set<string> | undefined,
): boolean {
  if (criteria.length === 0) return false;

  const matches = criteria.map((c) => matchSingleCriterion(email, c, visitedStreams));

  return logic === 'and'
    ? matches.every(Boolean)
    : matches.some(Boolean);
}

function matchSingleCriterion(
  email: Email,
  criterion: Criterion,
  visitedStreams: Set<string> | undefined,
): boolean {
  const { field, op, value } = criterion;
  // Strip surrounding quotes if present (e.g. "quoted phrase" → quoted phrase)
  const stripped = value.replace(/^["']+|["']+$/g, '');
  const v = stripped.toLowerCase();

  switch (field) {
    case 'from': {
      const sender = email.sender.toLowerCase();
      const senderEmail = (email.senderEmail || '').toLowerCase();
      return matchOp(sender, op, v) || matchOp(senderEmail, op, v);
    }
    case 'to': {
      const toEmail = (email.toEmail || '').toLowerCase();
      const accountId = (email.accountId || '').toLowerCase();
      return matchOp(toEmail, op, v) || matchOp(accountId, op, v);
    }
    case 'subject':
      return matchOp(email.subject.toLowerCase(), op, v);
    case 'label': {
      if (!email.labels) return false;
      return email.labels.some((l) => matchOp(l.toLowerCase(), op, v));
    }
    case 'snippet':
      return matchOp(email.snippet.toLowerCase(), op, v);
    case 'body':
      return matchOp(email.snippet.toLowerCase(), op, v);
    case 'stream': {
      const cols = useStore.getState().columns;
      const target = cols.find(c => c.id === value || c.name.toLowerCase() === v);
      if (!target || target.criteria.length === 0) return false;
      if (visitedStreams?.has(target.id)) return false;
      const visited = new Set(visitedStreams);
      visited.add(target.id);
      return emailMatchesCriteriaInternal(email, target.criteria, target.criteriaLogic, visited);
    }
    default:
      return false;
  }
}

function matchOp(haystack: string, op: string, needle: string): boolean {
  switch (op) {
    case 'contains':
      return haystack.includes(needle);
    case 'not_contains':
      return !haystack.includes(needle);
    case 'equals':
      return haystack === needle;
    case 'startsWith':
    case 'starts_with':
      return haystack.startsWith(needle);
    case 'endsWith':
    case 'ends_with':
      return haystack.endsWith(needle);
    default:
      return haystack.includes(needle);
  }
}
