import { useState } from 'react';
import type { CheckInInput, Host } from '../../shared/types';
import { PhotoCapture } from '../PhotoCapture';
import { Done } from './Done';
import { HostPicker } from './HostPicker';
import type { ViewProps } from './types';
import { BigButton, ErrorAlert, SubmitError, TextField } from './ui';

type Step = 'details' | 'host' | 'photo' | 'done';
interface Form {
  fullName: string;
  company: string;
  email: string;
  phone: string;
}
const EMPTY: Form = { fullName: '', company: '', email: '', phone: '' };

function validate(f: Form): string | null {
  if (!f.fullName.trim()) return 'Please enter your name.';
  const email = f.email.trim();
  if (!email && !f.phone.trim()) return 'Please enter an email or a phone number so we can reach you.';
  if (email && !/^\S+@\S+\.\S+$/.test(email)) return 'That email address doesn’t look right.';
  return null;
}

export function CheckIn({ api, onDone }: ViewProps) {
  const [step, setStep] = useState<Step>('details');
  const [form, setForm] = useState<Form>(EMPTY);
  const [host, setHost] = useState<Host | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [cameraFailed, setCameraFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const field = (key: keyof Form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const next = () => {
    const problem = validate(form);
    setError(problem);
    if (!problem) setStep('host');
  };

  const submit = async () => {
    if (!host || busy) return;
    const company = form.company.trim();
    const email = form.email.trim();
    const phone = form.phone.trim();
    const input: CheckInInput = {
      fullName: form.fullName.trim(),
      hostId: host.id,
      ...(company ? { company } : {}),
      ...(email ? { email } : {}),
      ...(phone ? { phone } : {}),
      ...(photo ? { photoBase64: photo } : {}),
    };
    setBusy(true);
    setError(null);
    try {
      await api.checkIn(input);
      setStep('done');
    } catch {
      setError('We couldn’t check you in. Please try again, or ask reception for help.');
    } finally {
      setBusy(false);
    }
  };

  if (step === 'done' && host) {
    const first = form.fullName.trim().split(/\s+/)[0] ?? '';
    return (
      <Done title={`Thanks, ${first}! You’re checked in.`} onDone={onDone}>
        {host.fullName} has been notified.
      </Done>
    );
  }

  if (step === 'details') {
    return (
      <section className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <h2 className="text-4xl font-bold">Tell us about yourself</h2>
        <TextField label="Full name" value={form.fullName} onChange={field('fullName')} autoComplete="name" />
        <TextField label="Company" value={form.company} onChange={field('company')} autoComplete="organization" />
        <TextField label="Email" type="email" inputMode="email" value={form.email} onChange={field('email')} autoComplete="email" />
        <TextField label="Phone" type="tel" inputMode="tel" value={form.phone} onChange={field('phone')} autoComplete="tel" />
        {error && <ErrorAlert>{error}</ErrorAlert>}
        <BigButton onClick={next}>Next</BigButton>
      </section>
    );
  }

  if (step === 'host') {
    return (
      <section className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <h2 className="text-4xl font-bold">Who are you here to see?</h2>
        <HostPicker
          api={api}
          label="Search by name"
          onPick={(h) => {
            setHost(h);
            setStep('photo');
          }}
        />
      </section>
    );
  }

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col items-center gap-6">
      <h2 className="text-4xl font-bold">Smile for the camera</h2>
      <PhotoCapture
        onCapture={(p) => {
          setPhoto(p);
          setCameraFailed(false);
        }}
        onError={() => setCameraFailed(true)}
      />
      {photo && (
        <BigButton onClick={() => void submit()} disabled={busy}>
          Check in
        </BigButton>
      )}
      {cameraFailed && !photo && (
        <BigButton variant="secondary" onClick={() => void submit()} disabled={busy}>
          Continue without photo
        </BigButton>
      )}
      {error && <SubmitError message={error} onRetry={() => void submit()} />}
    </section>
  );
}
