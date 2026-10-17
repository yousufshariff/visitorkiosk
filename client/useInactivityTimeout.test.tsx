// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useInactivityTimeout } from './useInactivityTimeout';

const EVENTS = ['touchstart', 'pointerdown', 'click', 'scroll', 'keydown'] as const;
const fire = (type: string) => window.dispatchEvent(new Event(type));

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useInactivityTimeout', () => {
  it('calls onTimeout once after 45 000 ms with no events', () => {
    const cb = vi.fn();
    renderHook(() => useInactivityTimeout(cb));
    vi.advanceTimersByTime(44_999);
    expect(cb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('a touchstart at 30 000 ms pushes the timeout to 75 000 ms', () => {
    const cb = vi.fn();
    renderHook(() => useInactivityTimeout(cb));
    vi.advanceTimersByTime(30_000);
    fire('touchstart');
    vi.advanceTimersByTime(44_999);
    expect(cb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('100 pointerdown events within one second cause at most one timer reset', () => {
    const cb = vi.fn();
    renderHook(() => useInactivityTimeout(cb));
    vi.advanceTimersByTime(2_000);
    const spy = vi.spyOn(globalThis, 'setTimeout');
    for (let i = 0; i < 100; i++) fire('pointerdown');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it.each(EVENTS)('%s resets the timer', (type) => {
    const cb = vi.fn();
    renderHook(() => useInactivityTimeout(cb));
    vi.advanceTimersByTime(2_000);
    fire(type);
    vi.advanceTimersByTime(44_000); // 46 000 ms since mount: would have fired without the reset
    expect(cb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('fires again after later activity (second idle period)', () => {
    const cb = vi.fn();
    renderHook(() => useInactivityTimeout(cb));
    vi.advanceTimersByTime(45_000);
    expect(cb).toHaveBeenCalledTimes(1);
    fire('touchstart');
    vi.advanceTimersByTime(45_000);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('leaves no timer and no listener after unmount', () => {
    const cb = vi.fn();
    const remove = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useInactivityTimeout(cb));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    for (const type of EVENTS) expect(remove).toHaveBeenCalledWith(type, expect.any(Function), expect.anything());
    vi.advanceTimersByTime(100_000);
    expect(cb).not.toHaveBeenCalled();
  });

  it('enabled: false never calls onTimeout and arms no timer', () => {
    const cb = vi.fn();
    renderHook(() => useInactivityTimeout(cb, { enabled: false }));
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(100_000);
    expect(cb).not.toHaveBeenCalled();
  });

  it('uses the latest callback without re-subscribing listeners', () => {
    const first = vi.fn();
    const second = vi.fn();
    const add = vi.spyOn(window, 'addEventListener');
    const { rerender } = renderHook(({ cb }) => useInactivityTimeout(cb), { initialProps: { cb: first } });
    const subscribed = add.mock.calls.length;
    rerender({ cb: second });
    expect(add.mock.calls.length).toBe(subscribed);
    vi.advanceTimersByTime(45_000);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });
});
