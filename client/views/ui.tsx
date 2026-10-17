import { useId, type ButtonHTMLAttributes, type ReactNode } from 'react';

type BigButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' };

/** Touch-first button: at least 64 px tall. */
export function BigButton({ variant = 'primary', className = '', ...props }: BigButtonProps) {
  const colors = variant === 'primary' ? 'bg-slate-900 text-white' : 'bg-slate-200 text-slate-900';
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex min-h-16 touch-manipulation items-center justify-center gap-3 rounded-2xl px-8 text-2xl font-semibold transition active:scale-95 disabled:opacity-40 ${colors} ${className}`}
    />
  );
}

interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'email' | 'tel';
  inputMode?: 'text' | 'email' | 'tel';
  autoComplete?: string;
}

export function TextField({ label, value, onChange, type = 'text', inputMode, autoComplete }: TextFieldProps) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-xl font-medium">
        {label}
      </label>
      <input
        id={id}
        type={type}
        inputMode={inputMode}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-16 rounded-2xl border-2 border-slate-300 bg-white px-5 text-2xl"
      />
    </div>
  );
}

export function ErrorAlert({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="rounded-2xl bg-red-50 px-6 py-4 text-xl text-red-700">
      {children}
    </div>
  );
}

/** Error plus a Retry button; keeps whatever the visitor already entered. */
export function SubmitError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-4">
      <ErrorAlert>{message}</ErrorAlert>
      <BigButton variant="secondary" onClick={onRetry}>
        Retry
      </BigButton>
    </div>
  );
}
