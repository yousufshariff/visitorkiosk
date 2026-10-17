import { LogOut, Package, QrCode, UserPlus } from 'lucide-react';
import type { KioskView } from './types';
import { BigButton } from './ui';

const CHOICES = [
  { view: 'checkin', label: 'Check In', Icon: UserPlus },
  { view: 'quick-scan', label: 'I Have a QR Code', Icon: QrCode },
  { view: 'checkout', label: 'Check Out', Icon: LogOut },
  { view: 'delivery', label: 'Delivery', Icon: Package },
] as const;

export function Welcome({ onSelect }: { onSelect: (view: KioskView) => void }) {
  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-10">
      <div className="text-center">
        <h1 className="text-6xl font-bold">Welcome</h1>
        <p className="mt-3 text-3xl text-slate-600">How can we help you today?</p>
      </div>
      <div className="grid w-full max-w-4xl grid-cols-2 gap-6">
        {CHOICES.map(({ view, label, Icon }) => (
          <BigButton key={view} onClick={() => onSelect(view)} className="min-h-40 flex-col text-3xl">
            <Icon size={56} aria-hidden="true" />
            {label}
          </BigButton>
        ))}
      </div>
    </section>
  );
}
