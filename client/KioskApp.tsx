import { useCallback, useState } from 'react';
import { Home } from 'lucide-react';
import type { KioskApi } from '../shared/types';
import { useInactivityTimeout } from './useInactivityTimeout';
import { CheckIn } from './views/CheckIn';
import { CheckOut } from './views/CheckOut';
import { Delivery } from './views/Delivery';
import { QuickScan } from './views/QuickScan';
import { Welcome } from './views/Welcome';
import type { KioskView } from './views/types';
import { BigButton } from './views/ui';

export type { KioskView } from './views/types';

/**
 * Top-level kiosk shell. The view is a plain state value (a kiosk has no URLs or back button).
 * Going Home, finishing a flow, or 45 s of inactivity all call `reset`, which returns to
 * welcome and bumps `session` so every view remounts empty — form data and camera streams are gone.
 */
export function KioskApp({ api }: { api: KioskApi }) {
  const [view, setView] = useState<KioskView>('welcome');
  const [session, setSession] = useState(0);

  const reset = useCallback(() => {
    setView('welcome');
    setSession((s) => s + 1);
  }, []);
  useInactivityTimeout(reset);

  const props = { api, onDone: reset, goTo: setView };

  return (
    <main className="flex min-h-dvh select-none flex-col gap-6 bg-slate-50 p-8 text-slate-900">
      {view !== 'welcome' && (
        <div>
          <BigButton variant="secondary" onClick={reset}>
            <Home size={28} aria-hidden="true" /> Home
          </BigButton>
        </div>
      )}
      <div key={`${session}:${view}`} className="flex flex-1 flex-col">
        {view === 'welcome' && <Welcome onSelect={setView} />}
        {view === 'checkin' && <CheckIn {...props} />}
        {view === 'quick-scan' && <QuickScan {...props} />}
        {view === 'checkout' && <CheckOut {...props} />}
        {view === 'delivery' && <Delivery {...props} />}
      </div>
    </main>
  );
}
