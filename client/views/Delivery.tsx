import { useState } from 'react';
import type { DeliveryType, Host } from '../../shared/types';
import { PhotoCapture } from '../PhotoCapture';
import { Done } from './Done';
import { HostPicker } from './HostPicker';
import type { ViewProps } from './types';
import { BigButton, SubmitError } from './ui';

const CARRIERS = ['UPS', 'FedEx', 'USPS', 'DHL', 'Amazon', 'Other'] as const;
const TYPES: { value: DeliveryType; label: string }[] = [
  { value: 'package', label: 'Package' },
  { value: 'envelope', label: 'Envelope' },
  { value: 'pallet', label: 'Pallet' },
  { value: 'food', label: 'Food' },
  { value: 'flowers', label: 'Flowers' },
  { value: 'other', label: 'Other' },
];

function Chips<T extends string>({ label, options, value, onChange }: { label: string; options: { value: T; label: string }[]; value: T | null; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-2xl font-semibold">{label}</h2>
      <div role="group" aria-label={label} className="flex flex-wrap gap-3">
        {options.map((o) => (
          <BigButton key={o.value} variant={value === o.value ? 'primary' : 'secondary'} aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
            {o.label}
          </BigButton>
        ))}
      </div>
    </div>
  );
}

export function Delivery({ api, onDone }: ViewProps) {
  const [carrier, setCarrier] = useState<string | null>(null);
  const [type, setType] = useState<DeliveryType | null>(null);
  const [host, setHost] = useState<Host | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [cameraFailed, setCameraFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const ready = Boolean(carrier && type && host && (photo || cameraFailed));

  const submit = async () => {
    if (!carrier || !type || !host || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.dropOff({ carrier, type, recipientId: host.id, ...(photo ? { photoBase64: photo } : {}) });
      setDone(true);
    } catch {
      setError('We couldn’t record the delivery. Please try again, or ask reception for help.');
    } finally {
      setBusy(false);
    }
  };

  if (done && host) {
    return (
      <Done title="Thank you!" onDone={onDone}>
        {host.fullName} has been notified.
      </Done>
    );
  }

  return (
    <section className="mx-auto grid w-full max-w-6xl gap-8 lg:grid-cols-2">
      <div className="flex flex-col gap-8">
        <Chips label="Carrier" options={CARRIERS.map((c) => ({ value: c, label: c }))} value={carrier} onChange={setCarrier} />
        <HostPicker api={api} label="Who is it for?" selectedId={host?.id} onPick={setHost} />
        <Chips label="Item type" options={TYPES} value={type} onChange={setType} />
      </div>
      <div className="flex flex-col items-center gap-6">
        <h2 className="text-2xl font-semibold">Show us the delivery</h2>
        <PhotoCapture
          showFaceGuide={false}
          onCapture={(p) => {
            setPhoto(p);
            setCameraFailed(false);
          }}
          onRetake={() => setPhoto(null)}
          onError={() => setCameraFailed(true)}
        />
        <BigButton onClick={() => void submit()} disabled={!ready || busy}>
          Drop off
        </BigButton>
        {error && <SubmitError message={error} onRetry={() => void submit()} />}
      </div>
    </section>
  );
}
