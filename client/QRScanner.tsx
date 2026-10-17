import { useEffect, useId, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

const DUPLICATE_WINDOW_MS = 3_000;

export interface QRScannerProps {
  onScan: (text: string) => void;
  onError?: (err: Error) => void;
  facingMode?: 'user' | 'environment';
  /** While true the camera is released; un-pausing starts a fresh scanner. */
  paused?: boolean;
}

/**
 * Wraps html5-qrcode. The same code is reported at most once per 3 s (cameras re-decode
 * every frame), and the camera is always released on unmount, pause or failed start.
 * html5-qrcode renders its <video> with playsinline + muted, which iPad Safari requires.
 */
export function QRScanner({ onScan, onError, facingMode = 'user', paused = false }: QRScannerProps) {
  const id = `qr-${useId().replace(/:/g, '')}`;
  const [failure, setFailure] = useState<string | null>(null);

  const onScanRef = useRef(onScan);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onScanRef.current = onScan;
    onErrorRef.current = onError;
  });

  useEffect(() => {
    if (paused) return;
    let cancelled = false;
    let last: { text: string; at: number } | null = null;
    setFailure(null);

    const scanner = new Html5Qrcode(id);
    const started = scanner
      .start(
        { facingMode },
        { fps: 10, qrbox: 280 },
        (text) => {
          const now = Date.now();
          if (last && last.text === text && now - last.at < DUPLICATE_WINDOW_MS) return;
          last = { text, at: now };
          onScanRef.current(text);
        },
        () => {}, // per-frame "no QR found" notifications are expected
      )
      .then(
        () => true,
        (e: unknown) => {
          if (!cancelled) {
            setFailure('The camera could not be started for scanning. Please ask reception for help.');
            onErrorRef.current?.(e instanceof Error ? e : new Error(String(e)));
          }
          return false;
        },
      );

    return () => {
      cancelled = true;
      // Never stop() a scanner that did not start; wait out a start() that is still in flight.
      void started.then(async (ok) => {
        if (ok) {
          try {
            await scanner.stop();
          } catch {
            /* already stopped */
          }
        }
        try {
          scanner.clear();
        } catch {
          /* element already gone */
        }
      });
    };
  }, [id, facingMode, paused]);

  return (
    <div className="flex w-full flex-col items-center gap-4">
      <div id={id} className="w-full max-w-xl overflow-hidden rounded-3xl bg-black" />
      {failure && (
        <div role="alert" className="max-w-xl text-center text-xl text-red-600">
          {failure}
        </div>
      )}
    </div>
  );
}
