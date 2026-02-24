import { useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { EmailCard } from './EmailCard.tsx';
import { useStore } from '../store/index.ts';
import { emailMatchesCriteria } from '../lib/emailFilter.ts';

interface InboxColumnProps {
  accountId: string | null;
}

export function InboxColumn({ accountId }: InboxColumnProps) {
  const { emails, accounts, disabledAccountIds, selectedEmail, sweepEmails, columns, _fetchNextPage, _hasNextPage, _isFetchingNextPage } = useStore();
  const selectedEmailId = selectedEmail ? selectedEmail.emailId : null;

  const columnEmails = useMemo(() => {
    let filtered;
    if (accountId) {
      filtered = emails.filter(e => e.accountId === accountId && !disabledAccountIds.has(e.accountId));
    } else {
      filtered = emails.filter(e => !disabledAccountIds.has(e.accountId));
    }
    return [...filtered].sort((a, b) => b.time - a.time);
  }, [emails, accountId, disabledAccountIds]);

  const sweepLookup = useMemo(() => {
    const map = new Map<string, { seconds: number; action: string }>();
    for (const s of sweepEmails) {
      map.set(s.id, { seconds: s.sweepSeconds, action: s.action || 'archive' });
    }
    return map;
  }, [sweepEmails]);

  const enabledStreams = useMemo(
    () => columns.filter(c => c.enabled !== false && c.criteria.length > 0),
    [columns]
  );

  const matchedStreamsMap = useMemo(() => {
    const map = new Map<string, Array<{ id: string; accent: string }>>();
    for (const email of columnEmails) {
      const matched: Array<{ id: string; accent: string }> = [];
      for (const col of enabledStreams) {
        if (emailMatchesCriteria(email, col.criteria, col.criteriaLogic)) {
          matched.push({ id: col.id, accent: col.accent });
        }
      }
      if (matched.length > 0) {
        map.set(email.id, matched);
      }
    }
    return map;
  }, [columnEmails, enabledStreams]);

  const account = accountId ? accounts.find(a => a.id === accountId) : null;
  const accent = account ? account.color : '#3b82f6';
  const icon = account
    ? <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: account.color }} />
    : '📥';
  const name = account ? account.name : 'All Inboxes';
  const unreadCount = columnEmails.filter(e => e.unread).length;
  const layoutKey = accountId ? 'inbox-' + accountId : 'inbox-all';

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
      if (_hasNextPage && !_isFetchingNextPage) _fetchNextPage?.();
    }
  }, [_fetchNextPage, _hasNextPage, _isFetchingNextPage]);

  return (
    <motion.div
      className="column"
      style={{ '--column-accent': accent } as React.CSSProperties}
      layoutId={layoutKey}
      layout
      transition={{ layout: { duration: 0.4, ease: [0.4, 0, 0.2, 1] } }}
    >
      <div className="column-header" style={{ borderTopColor: 'transparent' }}>
        <span className="column-icon">{icon}</span>
        <span className="column-name">
          {name}
          {account && (
            <span style={{ display: 'block', fontSize: '0.7rem', opacity: 0.6, fontWeight: 400 }}>
              {account.email}
            </span>
          )}
        </span>
        <span className="column-count">{unreadCount > 0 ? unreadCount : columnEmails.length}</span>
      </div>
      <div className="column-emails" onScroll={handleScroll}>
        <AnimatePresence initial={false}>
          {columnEmails.map(email => (
            <EmailCard
              key={email.id}
              email={email}
              accent={accent}
              accounts={accounts}
              columnId={accountId || 'all-inboxes'}
              sourceAccountId={accountId || undefined}
              selectedEmailId={selectedEmailId}
              sweepSeconds={sweepLookup.get(email.id)?.seconds}
              sweepAction={sweepLookup.get(email.id)?.action}
              matchedStreams={matchedStreamsMap.get(email.id)}
            />
          ))}
        </AnimatePresence>
        {_isFetchingNextPage && <div className="column-load-more" />}
      </div>
    </motion.div>
  );
}
