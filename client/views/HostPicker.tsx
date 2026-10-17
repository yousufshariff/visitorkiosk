import { useEffect, useState } from 'react';
import type { Host, KioskApi } from '../../shared/types';
import { useDebouncedValue } from '../useDebouncedValue';
import { ErrorAlert, TextField } from './ui';

interface HostPickerProps {
  api: KioskApi;
  label: string;
  onPick: (host: Host) => void;
  selectedId?: string;
}

/** Type-ahead list of hosts. Lists everyone first; searches 250 ms after typing stops. */
export function HostPicker({ api, label, onPick, selectedId }: HostPickerProps) {
  const [query, setQuery] = useState('');
  const q = useDebouncedValue(query.trim(), 250);
  const [hosts, setHosts] = useState<Host[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    api.searchHosts(q).then(
      (found) => {
        if (!cancelled) setHosts(found);
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [api, q]);

  return (
    <div className="flex flex-col gap-4">
      <TextField label={label} value={query} onChange={setQuery} autoComplete="off" />
      {failed && <ErrorAlert>We couldn’t load the staff list. Type to search again.</ErrorAlert>}
      {!failed && hosts.length === 0 && <p className="text-xl text-slate-500">No one found. Try a different name.</p>}
      <ul className="grid gap-3 sm:grid-cols-2">
        {hosts.map((h) => (
          <li key={h.id}>
            <button
              type="button"
              aria-pressed={selectedId === h.id}
              onClick={() => onPick(h)}
              className={`min-h-16 w-full touch-manipulation rounded-2xl border-2 px-5 py-3 text-left text-2xl active:scale-95 ${
                selectedId === h.id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white'
              }`}
            >
              {h.fullName}
              {h.department && <span className="ml-3 text-lg opacity-70">{h.department}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
