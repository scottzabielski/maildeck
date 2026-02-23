import { Reorder } from 'framer-motion';
import { Icons } from './ui/Icons.tsx';
import { useStore } from '../store/index.ts';

export function TopBar() {
  const { views, activeViewId, setActiveView, accounts, disabledAccountIds, toggleAccount, toggleSettings, reorderAccounts } = useStore();

  return (
    <div className="topbar">
      <div className="topbar-logo">
        <Icons.Mail />
        MailDeck
      </div>
      <div className="topbar-divider" />
      <div className="view-switcher">
        {views.map(v => (
          <button
            key={v.id}
            className={`view-tab ${v.id === activeViewId ? 'active' : ''}`}
            onClick={() => setActiveView(v.id)}
          >
            {v.name}
          </button>
        ))}
      </div>
      <Reorder.Group
        as="div"
        axis="x"
        values={accounts}
        onReorder={reorderAccounts}
        className="account-badges"
      >
        {accounts.map(a => (
          <Reorder.Item
            key={a.id}
            value={a}
            as="button"
            className={`account-badge ${disabledAccountIds.has(a.id) ? 'disabled' : ''}`}
            onClick={() => toggleAccount(a.id)}
            whileDrag={{ scale: 1.05, boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }}
          >
            <span className="account-dot" style={{ background: a.color }} />
            {a.name}
          </Reorder.Item>
        ))}
      </Reorder.Group>
      <button className="settings-btn" onClick={toggleSettings}>
        <Icons.Settings />
      </button>
    </div>
  );
}
