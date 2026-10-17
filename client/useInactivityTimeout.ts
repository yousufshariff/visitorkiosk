import { useEffect, useRef } from 'react';

const ACTIVITY_EVENTS = ['touchstart', 'pointerdown', 'click', 'scroll', 'keydown'] as const;

export interface InactivityOptions {
  /** Idle time before `onTimeout` fires. Default 45 000 ms. */
  timeoutMs?: number;
  /** Activity events closer together than this do not reset the timer. Default 1 000 ms. */
  throttleMs?: number;
  /** When false no listeners or timers are installed. Default true. */
  enabled?: boolean;
}

/**
 * Calls `onTimeout` after `timeoutMs` without touch/click/scroll/key activity.
 * Any later activity re-arms the timer, so it fires again after the next idle period.
 * The latest `onTimeout` is always used; changing it does not re-subscribe listeners.
 */
export function useInactivityTimeout(onTimeout: () => void, options: InactivityOptions = {}): void {
  const { timeoutMs = 45_000, throttleMs = 1_000, enabled = true } = options;

  const latest = useRef(onTimeout);
  useEffect(() => {
    latest.current = onTimeout;
  });

  useEffect(() => {
    if (!enabled) return;

    let timer: ReturnType<typeof setTimeout>;
    let lastReset = Date.now();
    const arm = () => {
      timer = setTimeout(() => latest.current(), timeoutMs);
    };
    const onActivity = () => {
      const now = Date.now();
      if (now - lastReset < throttleMs) return;
      lastReset = now;
      clearTimeout(timer);
      arm();
    };

    arm();
    for (const type of ACTIVITY_EVENTS) window.addEventListener(type, onActivity, { passive: true, capture: true });
    return () => {
      clearTimeout(timer);
      for (const type of ACTIVITY_EVENTS) window.removeEventListener(type, onActivity, { capture: true });
    };
  }, [timeoutMs, throttleMs, enabled]);
}
