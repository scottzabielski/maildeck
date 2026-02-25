import { LayoutGroup, AnimatePresence } from 'framer-motion';
import { InboxColumn } from './InboxColumn.tsx';
import { EmailViewer } from './EmailViewer.tsx';
import { useStore } from '../store/index.ts';

export function InboxesLayout() {
  const accounts = useStore(s => s.accounts);
  const disabledAccountIds = useStore(s => s.disabledAccountIds);
  const selectedEmail = useStore(s => s.selectedEmail);
  const isViewing = selectedEmail && selectedEmail.viewMode === 'inboxes';

  if (isViewing) {
    const sourceAccountId = selectedEmail.sourceAccountId;
    return (
      <LayoutGroup>
        <div className="deck-layout deck-layout--viewing">
          <InboxColumn key={sourceAccountId || 'all-inboxes'} accountId={sourceAccountId} columnOrder={0} />
          <AnimatePresence mode="wait">
            <EmailViewer key={'viewer-' + selectedEmail.emailId} />
          </AnimatePresence>
        </div>
      </LayoutGroup>
    );
  }

  return (
    <LayoutGroup>
      <div className="deck-layout">
        <InboxColumn key="all-inboxes" accountId={null} columnOrder={0} />
        {accounts.filter(a => !disabledAccountIds.has(a.id)).map((a, idx) => (
          <InboxColumn key={a.id} accountId={a.id} columnOrder={idx + 1} />
        ))}
      </div>
    </LayoutGroup>
  );
}
