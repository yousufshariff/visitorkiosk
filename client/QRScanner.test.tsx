// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QRScanner } from './QRScanner';

interface FakeScanner {
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
  emit: (text: string) => void;
  elementId: string;
  existedAtConstruction: boolean;
}

const h = vi.hoisted(() => ({
  instances: [] as FakeScanner[],
  startImpl: null as null | (() => Promise<void>),
}));

vi.mock('html5-qrcode', () => {
  class Html5Qrcode implements FakeScanner {
    private onSuccess: ((text: string) => void) | undefined;
    start = vi.fn(async (_cam: unknown, _cfg: unknown, ok: (text: string) => void) => {
      this.onSuccess = ok;
      if (h.startImpl) await h.startImpl();
    });
    stop = vi.fn(async () => {});
    clear = vi.fn();
    emit = (text: string) => this.onSuccess?.(text);
    existedAtConstruction: boolean;
    constructor(public elementId: string) {
      this.existedAtConstruction = document.getElementById(elementId) !== null;
      h.instances.push(this);
    }
  }
  return { Html5Qrcode };
});

beforeEach(() => {
  h.instances.length = 0;
  h.startImpl = null;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const started = () => waitFor(() => expect(h.instances[0]?.start).toHaveBeenCalled());

describe('QRScanner', () => {
  it("starts the camera with the default facingMode 'user' and with a given facingMode", async () => {
    render(<QRScanner onScan={vi.fn()} />);
    await started();
    expect(h.instances[0]?.start.mock.calls[0]?.[0]).toEqual({ facingMode: 'user' });
    cleanup();
    h.instances.length = 0;
    render(<QRScanner onScan={vi.fn()} facingMode="environment" />);
    await started();
    expect(h.instances[0]?.start.mock.calls[0]?.[0]).toEqual({ facingMode: 'environment' });
  });

  it('reports the decoded text through onScan', async () => {
    const onScan = vi.fn();
    render(<QRScanner onScan={onScan} />);
    await started();
    h.instances[0]?.emit('token-abc');
    expect(onScan).toHaveBeenCalledWith('token-abc');
  });

  it('ignores the same text again within 3000 ms, but accepts it afterwards and accepts different text at once', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const onScan = vi.fn();
    render(<QRScanner onScan={onScan} />);
    await started();
    const s = h.instances[0]!;
    s.emit('same');
    s.emit('same');
    expect(onScan).toHaveBeenCalledTimes(1);
    s.emit('other');
    expect(onScan).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(3_001);
    s.emit('other');
    expect(onScan).toHaveBeenCalledTimes(3);
  });

  it('on unmount calls stop() then clear(), and does not throw when stop() rejects', async () => {
    render(<QRScanner onScan={vi.fn()} />);
    await started();
    const s = h.instances[0]!;
    s.stop.mockRejectedValue(new Error('not running'));
    cleanup();
    await waitFor(() => expect(s.clear).toHaveBeenCalled());
    expect(s.stop).toHaveBeenCalledTimes(1);
    expect(s.stop.mock.invocationCallOrder[0]!).toBeLessThan(s.clear.mock.invocationCallOrder[0]!);
  });

  it('unmounting while start() is still pending stops the scanner once start resolves', async () => {
    let resolve!: () => void;
    h.startImpl = () => new Promise<void>((r) => (resolve = r));
    const { unmount } = render(<QRScanner onScan={vi.fn()} />);
    await started();
    unmount();
    expect(h.instances[0]?.stop).not.toHaveBeenCalled();
    resolve();
    await waitFor(() => expect(h.instances[0]?.stop).toHaveBeenCalledTimes(1));
    expect(h.instances[0]?.clear).toHaveBeenCalled();
  });

  it('start() rejecting calls onError, shows an alert, and never calls stop()', async () => {
    h.startImpl = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));
    const onError = vi.fn();
    const { unmount } = render(<QRScanner onScan={vi.fn()} onError={onError} />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/camera/i);
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    unmount();
    await waitFor(() => expect(h.instances[0]?.clear).toHaveBeenCalled());
    expect(h.instances[0]?.stop).not.toHaveBeenCalled();
  });

  it('paused stops the scanner and un-pausing starts a new one', async () => {
    const { rerender } = render(<QRScanner onScan={vi.fn()} paused={false} />);
    await started();
    rerender(<QRScanner onScan={vi.fn()} paused />);
    await waitFor(() => expect(h.instances[0]?.stop).toHaveBeenCalledTimes(1));
    rerender(<QRScanner onScan={vi.fn()} paused={false} />);
    await waitFor(() => expect(h.instances[1]?.start).toHaveBeenCalled());
  });

  it('each scanner run gets its own element, so a late cleanup cannot wipe the next run', async () => {
    const { rerender } = render(<QRScanner onScan={vi.fn()} paused={false} />);
    await started();
    rerender(<QRScanner onScan={vi.fn()} paused />);
    await waitFor(() => expect(h.instances[0]?.clear).toHaveBeenCalled());
    rerender(<QRScanner onScan={vi.fn()} paused={false} />);
    await waitFor(() => expect(h.instances[1]?.start).toHaveBeenCalled());
    const [first, second] = h.instances;
    expect(first!.existedAtConstruction).toBe(true);
    expect(second!.existedAtConstruction).toBe(true);
    expect(second!.elementId).not.toBe(first!.elementId);
    expect(document.getElementById(first!.elementId)).toBeNull(); // old element removed after cleanup
    expect(document.getElementById(second!.elementId)).not.toBeNull();
  });

  it('a parent re-render with new callbacks does not restart the scanner', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<QRScanner onScan={first} />);
    await started();
    rerender(<QRScanner onScan={second} />);
    expect(h.instances).toHaveLength(1);
    h.instances[0]?.emit('t');
    expect(second).toHaveBeenCalledWith('t');
    expect(first).not.toHaveBeenCalled();
  });
});
