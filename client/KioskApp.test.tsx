// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { KioskApi } from '../shared/types';
import { KioskApp } from './KioskApp';

const PHOTO = 'data:image/jpeg;base64,PHOTO';

// Camera components are covered by their own tests; here they are replaced by buttons that drive the callbacks.
vi.mock('./PhotoCapture', () => ({
  PhotoCapture: ({ onCapture, onError, onRetake }: { onCapture: (s: string) => void; onError?: (e: Error) => void; onRetake?: () => void }) => (
    <div>
      <button onClick={() => onCapture('data:image/jpeg;base64,PHOTO')}>Mock take photo</button>
      <button onClick={() => onRetake?.()}>Mock retake</button>
      <button onClick={() => onError?.(new Error('no camera'))}>Mock camera fails</button>
    </div>
  ),
}));
vi.mock('./QRScanner', () => ({
  QRScanner: ({ onScan, paused }: { onScan: (s: string) => void; paused?: boolean }) =>
    paused ? null : <button onClick={() => onScan('tok-1')}>Mock scan QR</button>,
}));

type MockApi = { [K in keyof KioskApi]: ReturnType<typeof vi.fn> } & KioskApi;
function makeApi(): MockApi {
  return {
    searchHosts: vi.fn().mockResolvedValue([{ id: 'h1', fullName: 'Hana Host', department: 'Ops' }]),
    checkIn: vi.fn().mockResolvedValue({ visitId: 'v1' }),
    scanCheckIn: vi.fn().mockResolvedValue({ visitorName: 'Vic Visitor', hostName: 'Hana Host' }),
    checkOut: vi.fn().mockResolvedValue(undefined),
    searchOnSite: vi.fn().mockResolvedValue([{ visitId: 'v9', visitorName: 'Vic Visitor' }]),
    dropOff: vi.fn().mockResolvedValue({ deliveryId: 'd1' }),
  } as MockApi;
}

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const click = (name: string | RegExp, root: HTMLElement = document.body) =>
  act(async () => {
    fireEvent.click(within(root).getByRole('button', { name }));
  });
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const isWelcome = () => screen.queryByRole('heading', { name: /welcome/i }) !== null;
const group = (name: string) => screen.getByRole('group', { name });

async function startCheckIn() {
  await click(/^check in$/i);
}
async function fillDetails(over: { name?: string; company?: string; email?: string; phone?: string } = {}) {
  const v = { name: 'Vic Visitor', company: 'Acme', email: 'vic@example.com', phone: '', ...over };
  type('Full name', v.name);
  type('Company', v.company);
  type('Email', v.email);
  type('Phone', v.phone);
  await click('Next');
  await advance(300); // host list loads after the picker's debounce
}
async function completeCheckIn() {
  await startCheckIn();
  await fillDetails();
  await click(/Hana Host/);
  await click('Mock take photo');
  await click(/^check in$/i);
}

let api: MockApi;
beforeEach(() => {
  vi.useFakeTimers();
  api = makeApi();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('welcome and navigation', () => {
  it('shows four large choices', () => {
    render(<KioskApp api={api} />);
    for (const name of [/^check in$/i, /i have a qr code/i, /^check out$/i, /^delivery$/i]) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
  });

  it.each([
    [/^check in$/i, 'Full name'],
    [/i have a qr code/i, 'Mock scan QR'],
    [/^check out$/i, 'Your name'],
    [/^delivery$/i, 'Mock take photo'],
  ])('%s opens its view, which has a Home button that returns to welcome', async (button, marker) => {
    render(<KioskApp api={api} />);
    await click(button);
    expect(isWelcome()).toBe(false);
    expect(screen.queryByLabelText(marker) ?? screen.queryByText(marker)).toBeTruthy();
    await click(/home/i);
    expect(isWelcome()).toBe(true);
  });
});

describe('inactivity', () => {
  it('45 s idle in check-in returns to welcome and the form comes back empty', async () => {
    render(<KioskApp api={api} />);
    await startCheckIn();
    type('Full name', 'Vic Visitor');
    await advance(44_999);
    expect(isWelcome()).toBe(false);
    await advance(1);
    expect(isWelcome()).toBe(true);
    await startCheckIn();
    expect((screen.getByLabelText('Full name') as HTMLInputElement).value).toBe('');
  });
});

describe('check-in', () => {
  it('without email or phone shows a validation error and goes no further', async () => {
    render(<KioskApp api={api} />);
    await startCheckIn();
    type('Full name', 'Vic Visitor');
    await click('Next');
    expect(screen.getByRole('alert').textContent).toMatch(/email or a phone/i);
    expect(api.searchHosts).not.toHaveBeenCalled();
    expect(api.checkIn).not.toHaveBeenCalled();
  });

  it('submits the typed values, host and photo, then thanks the visitor and returns to welcome after 8 s', async () => {
    render(<KioskApp api={api} />);
    await completeCheckIn();
    expect(api.checkIn).toHaveBeenCalledTimes(1);
    expect(api.checkIn).toHaveBeenCalledWith({
      fullName: 'Vic Visitor',
      company: 'Acme',
      email: 'vic@example.com',
      hostId: 'h1',
      photoBase64: PHOTO,
    });
    expect(screen.getByRole('heading', { name: /thank/i })).toBeTruthy();
    await advance(7_999);
    expect(isWelcome()).toBe(false);
    await advance(1);
    expect(isWelcome()).toBe(true);
  });

  it('on API failure shows an error with Retry and keeps the entered data', async () => {
    api.checkIn.mockRejectedValueOnce(new Error('503'));
    render(<KioskApp api={api} />);
    await completeCheckIn();
    expect(screen.getByRole('alert').textContent).toMatch(/couldn.t check you in/i);
    await click('Retry');
    expect(api.checkIn).toHaveBeenCalledTimes(2);
    expect(api.checkIn.mock.calls[1]?.[0]).toEqual(api.checkIn.mock.calls[0]?.[0]);
    expect(screen.getByRole('heading', { name: /thank/i })).toBeTruthy();
  });

  it('Retake discards the photo: Check in is not offered until a new photo is taken', async () => {
    render(<KioskApp api={api} />);
    await startCheckIn();
    await fillDetails();
    await click(/Hana Host/);
    await click('Mock take photo');
    expect(screen.getByRole('button', { name: /^check in$/i })).toBeTruthy();
    await click('Mock retake');
    expect(screen.queryByRole('button', { name: /^check in$/i })).toBeNull();
  });

  it('when the camera fails, "Continue without photo" still checks the visitor in', async () => {
    render(<KioskApp api={api} />);
    await startCheckIn();
    await fillDetails();
    await click(/Hana Host/);
    expect(screen.queryByRole('button', { name: /continue without photo/i })).toBeNull();
    await click('Mock camera fails');
    await click(/continue without photo/i);
    expect(api.checkIn).toHaveBeenCalledTimes(1);
    expect(api.checkIn.mock.calls[0]?.[0]).not.toHaveProperty('photoBase64');
  });
});

describe('quick scan', () => {
  it('checks in a scanned token once and shows visitor and host', async () => {
    render(<KioskApp api={api} />);
    await click(/i have a qr code/i);
    await click('Mock scan QR');
    expect(api.scanCheckIn).toHaveBeenCalledTimes(1);
    expect(api.scanCheckIn).toHaveBeenCalledWith('tok-1');
    expect(document.body.textContent).toMatch(/Vic Visitor/);
    expect(document.body.textContent).toMatch(/Hana Host/);
  });

  it('on a rejected token shows the error and offers manual check-in', async () => {
    api.scanCheckIn.mockRejectedValue(new Error('expired'));
    render(<KioskApp api={api} />);
    await click(/i have a qr code/i);
    await click('Mock scan QR');
    expect(screen.getByRole('alert').textContent).toMatch(/invitation/i);
    await click(/check in manually/i);
    expect(screen.getByLabelText('Full name')).toBeTruthy();
  });
});

describe('delivery', () => {
  async function chooseCarrierHostType() {
    await advance(300);
    await click('UPS', group('Carrier'));
    await click(/Hana Host/);
    await click('Package', group('Item type'));
  }

  it('enables Drop off only when carrier, recipient, type and photo are set, then submits them', async () => {
    render(<KioskApp api={api} />);
    await click(/^delivery$/i);
    await chooseCarrierHostType();
    const submit = () => screen.getByRole('button', { name: /drop off/i }) as HTMLButtonElement;
    expect(submit().disabled).toBe(true);
    await click('Mock take photo');
    expect(submit().disabled).toBe(false);
    await click(/drop off/i);
    expect(api.dropOff).toHaveBeenCalledWith({ carrier: 'UPS', type: 'package', recipientId: 'h1', photoBase64: PHOTO });
  });

  it('Retake disables Drop off again until a new photo is taken', async () => {
    render(<KioskApp api={api} />);
    await click(/^delivery$/i);
    await chooseCarrierHostType();
    await click('Mock take photo');
    const submit = () => screen.getByRole('button', { name: /drop off/i }) as HTMLButtonElement;
    expect(submit().disabled).toBe(false);
    await click('Mock retake');
    expect(submit().disabled).toBe(true);
  });

  it('a camera failure lets the courier drop off without a photo', async () => {
    render(<KioskApp api={api} />);
    await click(/^delivery$/i);
    await chooseCarrierHostType();
    await click('Mock camera fails');
    await click(/drop off/i);
    expect(api.dropOff).toHaveBeenCalledTimes(1);
    expect(api.dropOff.mock.calls[0]?.[0]).not.toHaveProperty('photoBase64');
  });
});

describe('check-out', () => {
  it('debounces the name search by 250 ms, then signs out the tapped visit', async () => {
    render(<KioskApp api={api} />);
    await click(/^check out$/i);
    type('Your name', 'Vi');
    await advance(100);
    type('Your name', 'Vic');
    await advance(249);
    expect(api.searchOnSite).not.toHaveBeenCalled();
    await advance(1);
    expect(api.searchOnSite).toHaveBeenCalledTimes(1);
    expect(api.searchOnSite).toHaveBeenCalledWith('Vic');
    await click(/Vic Visitor/);
    expect(api.checkOut).toHaveBeenCalledWith({ visitId: 'v9' });
    expect(document.body.textContent).toMatch(/signed out/i);
  });

  it('a failed QR check-out pauses the scanner (no repeat calls) until "Scan again"', async () => {
    api.checkOut.mockRejectedValueOnce(new Error('expired'));
    render(<KioskApp api={api} />);
    await click(/^check out$/i);
    await click(/scan qr code/i);
    await click('Mock scan QR');
    expect(api.checkOut).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert').textContent).toMatch(/sign you out/i);
    expect(screen.queryByText('Mock scan QR')).toBeNull();
    await click(/scan again/i);
    expect(screen.getByText('Mock scan QR')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('signs out by scanned QR code', async () => {
    render(<KioskApp api={api} />);
    await click(/^check out$/i);
    await click(/scan qr/i);
    await click('Mock scan QR');
    expect(api.checkOut).toHaveBeenCalledWith({ qrToken: 'tok-1' });
  });
});
