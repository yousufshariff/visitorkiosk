import type { KioskApi } from '../../shared/types';

export type KioskView = 'welcome' | 'checkin' | 'quick-scan' | 'checkout' | 'delivery';

export interface ViewProps {
  api: KioskApi;
  /** Return to the welcome screen and discard all state. */
  onDone: () => void;
  goTo: (view: KioskView) => void;
}
