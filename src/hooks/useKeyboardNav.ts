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
        if (viewerOpen) {
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

      if (e.key === 'Delete' || e.key === 'Backspace') {
        const targetId = highlightedEmail?.emailId || selectedEmail?.emailId;
        if (targetId) {
          e.preventDefault();
          state.deleteEmail(targetId);
        }
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
