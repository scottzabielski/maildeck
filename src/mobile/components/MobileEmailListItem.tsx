import { memo, useState, useRef, useCallback, useMemo } from 'react';
import { Icons } from '../../components/ui/Icons.tsx';
import { Countdown } from '../../components/ui/Countdown.tsx';
import { useStore } from '../../store/index.ts';
import { formatTime, formatCountdown, getCountdownClass, claudeCheckLabel, isClaudeHeld } from '../../lib/helpers.ts';
import type { RuleMatch, StreamTag } from '../../lib/emailFilter.ts';
import type { Email, Account, SweepEmail } from '../../types/index.ts';

const txtArea = typeof document !== 'undefined' ? document.createElement('textarea') : null;
function decodeHTML(html: string): string {
  // Only entities need decoding, and most text has none.
  if (!txtArea || !html.includes('&')) return html;
  txtArea.innerHTML = html;
  return txtArea.value;
}

const isDeleteAction = (action: string) => action === 'delete' || action === 'keep_newest_delete';

const LONG_PRESS_MS = 500;
const MOVE_THRESHOLD = 10;
const SWIPE_START_THRESHOLD = 6;
const COMMIT_FRACTION = 0.4;

interface MobileEmailListItemProps {
  email: Email;
  accent: string;
  accounts: Account[];
  columnId: string;
  sourceAccountId?: string;
  /** The email's entry in the sweep queue, if it has one. */
  sweep?: SweepEmail;
  matchedSweepRule?: RuleMatch;
  matchedStreams?: StreamTag[];
}

// Memoized, with its own selection state, so a tap redraws only the rows it changes.
export const MobileEmailListItem = memo(function MobileEmailListItem({
  email,
  accent,
  accounts,
  columnId,
  sourceAccountId,
  sweep,
  matchedSweepRule,
  matchedStreams,
}: MobileEmailListItemProps) {
  const selectEmail = useStore(s => s.selectEmail);
  const toggleMultiSelect = useStore(s => s.toggleMultiSelect);
  const archiveEmail = useStore(s => s.archiveEmail);
  const deleteEmail = useStore(s => s.deleteEmail);
  const isExempted = useStore(s => s.exemptedEmailIds.has(email.id));
  const isMultiSelected = useStore(s => s.multiSelectedIds.has(email.id));
  const inMultiSelectMode = useStore(s => s.multiSelectedIds.size > 0);
  const isViewing = useStore(s => s.selectedEmail?.emailId === email.id);
  const sender = useMemo(() => decodeHTML(email.sender), [email.sender]);
  const subject = useMemo(() => decodeHTML(email.subject), [email.subject]);
  const snippet = useMemo(() => decodeHTML(email.snippet), [email.snippet]);

  const account = accounts.find(a => a.id === email.accountId);

  const [offset, setOffset] = useState(0);

  // Pointer + gesture state
  const startRef = useRef<{ x: number; y: number; w: number; t: number } | null>(null);
  const axisRef = useRef<'h' | 'v' | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredRef = useRef(false);

  const clearLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const t = e.currentTarget as HTMLDivElement;
    startRef.current = { x: e.clientX, y: e.clientY, w: t.offsetWidth, t: Date.now() };
    axisRef.current = null;
    longPressFiredRef.current = false;
    setOffset(0);
    clearLongPress();

    // Don't fire long-press while in multi-select mode (tap toggles inclusion)
    if (!inMultiSelectMode) {
      longPressTimerRef.current = setTimeout(() => {
        longPressFiredRef.current = true;
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          try { navigator.vibrate(15); } catch { /* noop */ }
        }
        toggleMultiSelect(email.id);
      }, LONG_PRESS_MS);
    }
  }, [email.id, inMultiSelectMode, toggleMultiSelect]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!startRef.current) return;
    const dx = e.clientX - startRef.current.x;
    const dy = e.clientY - startRef.current.y;

    if (Math.abs(dx) > MOVE_THRESHOLD || Math.abs(dy) > MOVE_THRESHOLD) {
      clearLongPress();
    }

    // Lock to horizontal swipe once movement crosses the threshold (and is horizontal-leaning)
    if (axisRef.current == null) {
      if (Math.abs(dx) < SWIPE_START_THRESHOLD && Math.abs(dy) < SWIPE_START_THRESHOLD) return;
      axisRef.current = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
    }

    // Swipe disabled in multi-select mode
    if (axisRef.current !== 'h' || inMultiSelectMode) return;

    const maxAbs = startRef.current.w * 0.75;
    setOffset(Math.max(-maxAbs, Math.min(maxAbs, dx)));
  }, [inMultiSelectMode]);

  const commit = useCallback((finalOffset: number, width: number) => {
    const fraction = Math.abs(finalOffset) / width;
    if (fraction >= COMMIT_FRACTION) {
      if (finalOffset < 0) {
        deleteEmail(email.id);
      } else if (finalOffset > 0) {
        archiveEmail(email.id);
      }
    }
  }, [deleteEmail, archiveEmail, email.id]);

  const onPointerUp = useCallback((_e: React.PointerEvent) => {
    clearLongPress();
    if (!startRef.current) return;

    const width = startRef.current.w;
    const finalOffset = offset;
    const wasSwipe = axisRef.current === 'h' && Math.abs(finalOffset) > SWIPE_START_THRESHOLD;
    const wasLongPress = longPressFiredRef.current;

    if (wasSwipe && !inMultiSelectMode) {
      commit(finalOffset, width);
    } else if (!wasLongPress && axisRef.current !== 'v') {
      // Treat as tap
      if (inMultiSelectMode) {
        toggleMultiSelect(email.id);
      } else {
        selectEmail(email.id, columnId || email.columnId, sourceAccountId || email.accountId);
      }
    }

    setOffset(0);
    startRef.current = null;
    axisRef.current = null;
    longPressFiredRef.current = false;
  }, [offset, inMultiSelectMode, commit, toggleMultiSelect, selectEmail, email.id, email.columnId, email.accountId, columnId, sourceAccountId]);

  const onPointerCancel = useCallback(() => {
    clearLongPress();
    setOffset(0);
    startRef.current = null;
    axisRef.current = null;
    longPressFiredRef.current = false;
  }, []);

  // Suppress iOS Safari long-press context menu while we own the gesture
  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  // A sweep held by a Claude check shows its state instead of a countdown.
  const held = !!sweep && isClaudeHeld(sweep);
  let dueAt = held ? undefined : sweep?.dueAt;
  let sweepAction = sweep?.action || 'archive';
  if (dueAt == null && !held && matchedSweepRule && !matchedSweepRule.claude && !isExempted) {
    dueAt = email.time + matchedSweepRule.delayHours * 3_600_000;
    sweepAction = isDeleteAction(matchedSweepRule.action) ? 'delete' : 'archive';
  }
  const hasSweepRule = !!sweep || (!!matchedSweepRule && !isExempted);
  const ruleBadge = matchedSweepRule && !isExempted ? (
    <div className="mobile-email-sweep-row">
      <span className="mobile-email-sweep-badge rule-matched">
        <Icons.Sweep />
        {isDeleteAction(matchedSweepRule.action) ? 'Delete' : 'Archive'}
        {matchedSweepRule.claude ? ' if Claude agrees' : ' (sweep rule)'}
      </span>
    </div>
  ) : null;

  const className = [
    'mobile-email-row',
    email.unread ? 'unread' : '',
    email.starred ? 'starred' : '',
    isMultiSelected ? 'multi-selected' : '',
    isViewing ? 'viewing' : '',
    hasSweepRule ? 'has-sweep' : '',
    offset !== 0 ? 'swiping' : '',
  ].filter(Boolean).join(' ');

  // Slab on the right reveals what a left-swipe will do (delete).
  // Slab on the left reveals what a right-swipe will do (archive).
  const showingDelete = offset < 0;
  const showingArchive = offset > 0;

  return (
    <div className="mobile-email-row-wrap">
      {showingDelete && (
        <div className="mobile-email-row-action mobile-email-row-action-left">
          <Icons.Trash />
          <span>Delete</span>
        </div>
      )}
      {showingArchive && (
        <div className="mobile-email-row-action mobile-email-row-action-right">
          <Icons.Archive />
          <span>Archive</span>
        </div>
      )}
      <div
        className={className}
        style={{
          '--column-accent': accent,
          transform: offset !== 0 ? `translateX(${offset}px)` : undefined,
          transition: offset === 0 && startRef.current == null ? 'transform 0.18s ease-out' : 'none',
        } as React.CSSProperties}
        data-email-id={email.id}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerLeave={onPointerCancel}
        onContextMenu={onContextMenu}
      >
        {inMultiSelectMode && (
          <div className="mobile-email-row-check" aria-hidden>
            {isMultiSelected ? <Icons.Check /> : null}
          </div>
        )}
        <div className="mobile-email-row-content">
          <div className="mobile-email-row-top">
            <span className="mobile-email-sender">{sender}</span>
            {email.starred && <span className="mobile-email-star">{'★'}</span>}
            {account && (
              <span
                className="mobile-email-account-dot"
                style={{ background: account.color }}
                aria-hidden
                title={account.name}
              />
            )}
            <span className="mobile-email-time">{formatTime(email.time)}</span>
          </div>
          <div className="mobile-email-subject">{subject}</div>
          <div className="mobile-email-snippet">{snippet}</div>
          {held && (
            <div className="mobile-email-sweep-row">
              <span className={`mobile-email-sweep-badge claude-${sweep.aiStatus}`}>
                <Icons.Sparkle />
                {claudeCheckLabel(sweep.aiStatus!)}
              </span>
            </div>
          )}
          {dueAt != null ? (
            // Once the countdown runs out, the rule badge shows until the sweep removes the row.
            <Countdown dueAt={dueAt}>
              {seconds => seconds > 0 ? (
                <div className="mobile-email-sweep-row">
                  <span className={`mobile-email-sweep-badge ${getCountdownClass(seconds)}`}>
                    <Icons.Clock />
                    {sweepAction === 'delete' ? 'Delete' : 'Archive'} in {formatCountdown(seconds)}
                  </span>
                </div>
              ) : ruleBadge}
            </Countdown>
          ) : !held && ruleBadge}
        </div>
        {matchedStreams && matchedStreams.length > 0 && (
          <div className="mobile-email-stream-indicators" aria-hidden>
            {matchedStreams.map(s => (
              <span key={s.id} className="mobile-email-stream-indicator" style={{ background: s.accent }} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
});
