import { useState, useRef, useCallback } from 'react';
import { Icons } from '../../components/ui/Icons.tsx';
import { useStore } from '../../store/index.ts';
import { formatTime, formatCountdown, getCountdownClass } from '../../lib/helpers.ts';
import type { Email, Account } from '../../types/index.ts';

const txtArea = typeof document !== 'undefined' ? document.createElement('textarea') : null;
function decodeHTML(html: string): string {
  if (!txtArea) return html;
  txtArea.innerHTML = html;
  return txtArea.value;
}

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
  sweepSeconds?: number;
  sweepAction?: string;
  matchedSweepRule?: { action: string; delayHours: number };
  matchedStreams?: Array<{ id: string; accent: string }>;
}

export function MobileEmailListItem({
  email,
  accent,
  accounts,
  columnId,
  sourceAccountId,
  sweepSeconds,
  sweepAction,
  matchedSweepRule,
  matchedStreams,
}: MobileEmailListItemProps) {
  const selectEmail = useStore(s => s.selectEmail);
  const multiSelectedIds = useStore(s => s.multiSelectedIds);
  const toggleMultiSelect = useStore(s => s.toggleMultiSelect);
  const archiveEmail = useStore(s => s.archiveEmail);
  const deleteEmail = useStore(s => s.deleteEmail);
  const isExempted = useStore(s => s.exemptedEmailIds.has(email.id));
  const selectedEmailId = useStore(s => s.selectedEmail?.emailId ?? null);

  const account = accounts.find(a => a.id === email.accountId);
  const isMultiSelected = multiSelectedIds.has(email.id);
  const inMultiSelectMode = multiSelectedIds.size > 0;
  const isViewing = selectedEmailId === email.id;

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

  let effectiveSweepSeconds = sweepSeconds;
  let effectiveSweepAction = sweepAction;
  if (effectiveSweepSeconds == null && matchedSweepRule && !isExempted) {
    const ageSec = Math.floor((Date.now() - email.time) / 1000);
    const remaining = matchedSweepRule.delayHours * 3600 - ageSec;
    if (remaining > 0) {
      effectiveSweepSeconds = remaining;
      effectiveSweepAction = matchedSweepRule.action === 'delete' || matchedSweepRule.action === 'keep_newest_delete'
        ? 'delete'
        : 'archive';
    }
  }
  const hasSweep = effectiveSweepSeconds != null && effectiveSweepSeconds > 0;
  const hasSweepRule = hasSweep || (!!matchedSweepRule && !isExempted);

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
            <span className="mobile-email-sender">{decodeHTML(email.sender)}</span>
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
          <div className="mobile-email-subject">{decodeHTML(email.subject)}</div>
          <div className="mobile-email-snippet">{decodeHTML(email.snippet)}</div>
          {hasSweep && (
            <div className="mobile-email-sweep-row">
              <span className={`mobile-email-sweep-badge ${getCountdownClass(effectiveSweepSeconds!)}`}>
                <Icons.Clock />
                {effectiveSweepAction === 'delete' ? 'Delete' : 'Archive'} in {formatCountdown(effectiveSweepSeconds!)}
              </span>
            </div>
          )}
          {!hasSweep && matchedSweepRule && !isExempted && (
            <div className="mobile-email-sweep-row">
              <span className="mobile-email-sweep-badge rule-matched">
                <Icons.Sweep />
                {matchedSweepRule.action === 'delete' || matchedSweepRule.action === 'keep_newest_delete' ? 'Delete' : 'Archive'} (sweep rule)
              </span>
            </div>
          )}
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
}
