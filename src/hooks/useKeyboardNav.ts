import { useEffect } from 'react';
import { useStore } from '../store/index.ts';
import { getColumnEntries, getColumnEntry } from '../lib/columnRegistry.ts';

export function useKeyboardNav() {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip when focus is in an input/textarea or when modals are open
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const state = useStore.getState();
      if (state.isSettingsOpen || state.sweepRuleEditor || state.editingColumnId || state.creatingColumn) return;
      if (state.contextMenu || state.columnContextMenu) return;

      const { highlightedEmail, selectedEmail } = state;
      const viewerOpen = !!selectedEmail;

      if (e.key === 'Escape') {
        if (state.multiSelectedIds.size > 0) {
          state.clearMultiSelect();
        } else if (viewerOpen) {
          state.deselectEmail();
        } else if (highlightedEmail) {
          state.clearHighlight();
        }
        return;
      }

      if (e.key === 'Enter') {
        if (highlightedEmail && !viewerOpen) {
          state.selectEmail(highlightedEmail.emailId, highlightedEmail.columnId, highlightedEmail.accountId);
        }
        return;
      }

      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const direction = e.key === 'ArrowUp' ? -1 : 1;

        if (!highlightedEmail) {
          // Nothing highlighted — highlight the first email of the first column
          const entries = getColumnEntries();
          for (const entry of entries) {
            if (entry.emailIds.length > 0) {
              const emailId = entry.emailIds[0];
              state.highlightEmail(emailId, entry.columnId, entry.accountId || '');
              scrollToEmail(emailId);
              if (viewerOpen) {
                state.selectEmail(emailId, entry.columnId, entry.accountId || '');
              }
              return;
            }
          }
          return;
        }

        const entry = getColumnEntry(highlightedEmail.columnId);
        if (!entry) return;

        const currentIdx = entry.emailIds.indexOf(highlightedEmail.emailId);
        if (currentIdx === -1) return;

        const nextIdx = currentIdx + direction;
        if (nextIdx < 0 || nextIdx >= entry.emailIds.length) return;

        const nextEmailId = entry.emailIds[nextIdx];
        state.highlightEmail(nextEmailId, entry.columnId, entry.accountId || highlightedEmail.accountId);
        scrollToEmail(nextEmailId);

        if (viewerOpen) {
          state.selectEmail(nextEmailId, entry.columnId, entry.accountId || highlightedEmail.accountId);
        }
        return;
      }

      if (e.key === 'z' && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
        e.preventDefault();
        state.undoLastAction();
        return;
      }

      if (e.key === 'r' && !e.metaKey && !e.ctrlKey) {
        if (state.multiSelectedIds.size > 0) {
          // Determine majority state: if most are unread, mark all read; otherwise mark all unread
          const selectedEmails = state.emails.filter(e => state.multiSelectedIds.has(e.id));
          const unreadCount = selectedEmails.filter(e => e.unread).length;
          if (unreadCount > selectedEmails.length / 2) {
            state.markSelectedRead();
          } else {
            state.markSelectedUnread();
          }
          return;
        }
        const targetId = highlightedEmail?.emailId || selectedEmail?.emailId;
        if (targetId) {
          state.toggleRead(targetId);
        }
        return;
      }

      if (e.key === 'a' && !e.metaKey && !e.ctrlKey) {
        if (state.multiSelectedIds.size > 0) {
          state.archiveSelected();
          return;
        }
        const targetId = highlightedEmail?.emailId || selectedEmail?.emailId;
        if (!targetId) return;
        // In list mode (no viewer), advance highlight to next email before archiving
        if (!viewerOpen && highlightedEmail) {
          const entry = getColumnEntry(highlightedEmail.columnId);
          if (entry) {
            const idx = entry.emailIds.indexOf(targetId);
            // Prefer next email, fall back to previous
            const nextId = entry.emailIds[idx + 1] || entry.emailIds[idx - 1];
            if (nextId) {
              state.highlightEmail(nextId, highlightedEmail.columnId, highlightedEmail.accountId);
              scrollToEmail(nextId);
            }
          }
        }
        state.archiveEmail(targetId);
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (state.multiSelectedIds.size > 0) {
          e.preventDefault();
          state.deleteSelected();
          return;
        }
        const targetId = highlightedEmail?.emailId || selectedEmail?.emailId;
        if (!targetId) return;
        e.preventDefault();
        // Advance highlight to next email before deleting
        if (!viewerOpen && highlightedEmail) {
          const entry = getColumnEntry(highlightedEmail.columnId);
          if (entry) {
            const idx = entry.emailIds.indexOf(targetId);
            const nextId = entry.emailIds[idx + 1] || entry.emailIds[idx - 1];
            if (nextId) {
              state.highlightEmail(nextId, highlightedEmail.columnId, highlightedEmail.accountId);
              scrollToEmail(nextId);
            }
          }
        }
        state.deleteEmail(targetId);
        return;
      }

      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        // Disabled when viewer is open
        if (viewerOpen) return;
        e.preventDefault();

        const entries = getColumnEntries();
        if (entries.length === 0) return;

        if (!highlightedEmail) {
          // Highlight first email of the first column
          const first = entries.find(en => en.emailIds.length > 0);
          if (first) {
            const emailId = first.emailIds[0];
            state.highlightEmail(emailId, first.columnId, first.accountId || '');
            scrollToEmail(emailId);
          }
          return;
        }

        const colIdx = entries.findIndex(en => en.columnId === highlightedEmail.columnId);
        if (colIdx === -1) return;

        const direction = e.key === 'ArrowLeft' ? -1 : 1;
        const nextColIdx = colIdx + direction;
        if (nextColIdx < 0 || nextColIdx >= entries.length) return;

        const nextCol = entries[nextColIdx];
        if (nextCol.emailIds.length === 0) return;

        // Try to keep the same index, clamped to the new column's length
        const currentEntry = entries[colIdx];
        const currentRowIdx = currentEntry.emailIds.indexOf(highlightedEmail.emailId);
        const targetIdx = Math.min(Math.max(currentRowIdx, 0), nextCol.emailIds.length - 1);
        const nextEmailId = nextCol.emailIds[targetIdx];

        state.highlightEmail(nextEmailId, nextCol.columnId, nextCol.accountId || '');
        scrollToEmail(nextEmailId);
        return;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);
}

function scrollToEmail(emailId: string) {
  // Use requestAnimationFrame so the DOM has had a chance to update
  requestAnimationFrame(() => {
    const el = document.querySelector(`[data-email-id="${emailId}"]`);
    if (el) {
      el.scrollIntoView({ block: 'nearest' });
    }
  });
}
