import type { Notifier } from './deps';
import { notifyDelivery, notifyVisitorArrival, type NotifyOptions } from './notifications';

/** Adapts the awaitable phase-1 notification functions to the fire-and-forget `Notifier` the services use. */
export function createNotifier(opts: NotifyOptions = {}): Notifier {
  const detach = (p: Promise<void>) => void p.catch((e: unknown) => console.error('[notifications] unexpected:', e instanceof Error ? e.message : 'unknown'));
  return {
    visitor: (a, t) => detach(notifyVisitorArrival(a, t, opts)),
    delivery: (d, t) => detach(notifyDelivery(d, t, opts)),
  };
}
