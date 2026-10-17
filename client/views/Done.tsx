import { useEffect, type ReactNode } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { BigButton } from './ui';

/** Confirmation screen; returns to welcome by itself after 8 s. */
export function Done({ title, children, onDone, delayMs = 8_000 }: { title: string; children?: ReactNode; onDone: () => void; delayMs?: number }) {
  useEffect(() => {
    const timer = setTimeout(onDone, delayMs);
    return () => clearTimeout(timer);
  }, [onDone, delayMs]);

  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
      <CheckCircle2 size={96} className="text-emerald-600" aria-hidden="true" />
      <h1 className="text-5xl font-bold">{title}</h1>
      {children && <p className="text-3xl text-slate-600">{children}</p>}
      <BigButton onClick={onDone}>Done</BigButton>
    </section>
  );
}
