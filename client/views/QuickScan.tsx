import { useCallback, useRef, useState } from 'react';
import { QRScanner } from '../QRScanner';
import { Done } from './Done';
import type { ViewProps } from './types';
import { BigButton, ErrorAlert } from './ui';

type State =
  | { kind: 'scanning' }
  | { kind: 'working' }
  | { kind: 'done'; visitorName: string; hostName: string }
  | { kind: 'error' };

export function QuickScan({ api, onDone, goTo }: ViewProps) {
  const [state, setState] = useState<State>({ kind: 'scanning' });
  const busy = useRef(false);

  const handleScan = useCallback(
    async (token: string) => {
      if (busy.current) return;
      busy.current = true;
      setState({ kind: 'working' });
      try {
        const { visitorName, hostName } = await api.scanCheckIn(token);
        setState({ kind: 'done', visitorName, hostName });
      } catch {
        setState({ kind: 'error' });
      } finally {
        busy.current = false;
      }
    },
    [api],
  );

  if (state.kind === 'done') {
    return (
      <Done title={`You’re checked in, ${state.visitorName}!`} onDone={onDone}>
        {state.hostName} has been notified.
      </Done>
    );
  }

  if (state.kind === 'error') {
    return (
      <section className="mx-auto flex w-full max-w-2xl flex-col items-start gap-6">
        <ErrorAlert>We couldn’t find that invitation. It may have expired or already been used.</ErrorAlert>
        <div className="flex gap-4">
          <BigButton onClick={() => setState({ kind: 'scanning' })}>Try again</BigButton>
          <BigButton variant="secondary" onClick={() => goTo('checkin')}>
            Check in manually
          </BigButton>
        </div>
      </section>
    );
  }

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col items-center gap-6">
      <h2 className="text-4xl font-bold">Hold your QR code up to the camera</h2>
      <p className="text-2xl text-slate-600">It’s in the invitation email we sent you.</p>
      <QRScanner onScan={(t) => void handleScan(t)} paused={state.kind !== 'scanning'} />
    </section>
  );
}
