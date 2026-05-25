import type { MobileNavApi } from './hooks/useMobileNavStack.ts';

/**
 * The full set of mobile screen frames. Add to this union as new screens come
 * online.
 */
export type MobileFrame =
  | { type: 'inboxes' }
  | { type: 'streams' }
  | { type: 'email' }
  | { type: 'settings' }
  | { type: 'settings-accounts' }
  | { type: 'settings-columns' }
  | { type: 'settings-sweep' }
  | { type: 'settings-appearance' }
  | { type: 'settings-notifications' }
  | { type: 'column-editor' }
  | { type: 'sweep-rule-editor' };

export type MobileNav = MobileNavApi<MobileFrame>;
