import { useEffect, useRef, useState } from 'react';
import { QRScanner } from '../QRScanner';
import { useDebouncedValue } from '../useDebouncedValue';
import { Done } from './Done';
import type { ViewProps } from './types';
import { BigButton, ErrorAlert, TextField } from './ui';

type Tab = 'name' | 'qr';
interface Match {
  visitId: string;
  visitorName: string;
}

export function CheckOut({ api, onDone }: ViewProps) {
  const [tab, setTab] = useState<Tab>('name');
  const [query, setQuery] = useState('');
  const q = useDebouncedValue(query.trim(), 250);
  const [matches, setMatches] = useState<Match[]>([]);
  const [signedOut, setSignedOut] = useState<{ name?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qrPaused, setQrPaused] = useState(false);
  const busy = useRef(false);

  useEffect(() => {
    if (q.length < 2) {
      setMatches([]);
      return;
    }
    let cancelled = false;
    api.searchOnSite(q).then(
      (found) => {
        if (!cancelled) setMatches(found);
      },
      () => {
        if (!cancelled) setError('We couldn’t search just now. Please try again.');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [api, q]);

  const finish = async (input: { qrToken?: string; visitId?: string }, name?: string) => {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    try {
      await api.checkOut(input);
      setSignedOut(name ? { name } : {});
    } catch {
      setError('We couldn’t sign you out. Please try again, or ask reception for help.');
    } finally {
      busy.current = false;
    }
  };

  if (signedOut) {
    return <Done title={`Goodbye${signedOut.name ? `, ${signedOut.name}` : ''}! You’re signed out.`} onDone={onDone} />;
  }

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <h2 className="text-4xl font-bold">Signing out?</h2>
      <div role="group" aria-label="How to find your visit" className="flex gap-4">
        <BigButton variant={tab === 'name' ? 'primary' : 'secondary'} aria-pressed={tab === 'name'} onClick={() => setTab('name')}>
          Find my name
        </BigButton>
        <BigButton variant={tab === 'qr' ? 'primary' : 'secondary'} aria-pressed={tab === 'qr'} onClick={() => setTab('qr')}>
          Scan QR code
        </BigButton>
      </div>

      {tab === 'name' ? (
        <>
          <TextField label="Your name" value={query} onChange={setQuery} autoComplete="off" />
          <ul className="flex flex-col gap-3">
            {matches.map((m) => (
              <li key={m.visitId}>
                <BigButton variant="secondary" className="w-full justify-start" onClick={() => void finish({ visitId: m.visitId }, m.visitorName)}>
                  {m.visitorName}
                </BigButton>
              </li>
            ))}
          </ul>
          {q.length >= 2 && matches.length === 0 && !error && (
            <p className="text-xl text-slate-500">No matching visitors are signed in. Check the spelling, or ask reception.</p>
          )}
        </>
      ) : (
        <>
          <QRScanner
            paused={qrPaused}
            onScan={(token) => {
              setQrPaused(true); // one attempt per scan; the camera restarts only on "Scan again"
              void finish({ qrToken: token });
            }}
          />
          {qrPaused && error && (
            <BigButton
              onClick={() => {
                setError(null);
                setQrPaused(false);
              }}
            >
              Scan again
            </BigButton>
          )}
        </>
      )}

      {error && <ErrorAlert>{error}</ErrorAlert>}
    </section>
  );
}
