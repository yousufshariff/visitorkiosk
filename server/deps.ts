import type { DeliveryArrival, NotificationTarget, VisitorArrival } from '../shared/types';
import type { Db } from './db/client';
import type { PhotoStore } from './photos';

/** Fire-and-forget: implementations must not throw or make the caller wait. */
export interface Notifier {
  visitor(a: VisitorArrival, t: NotificationTarget): void;
  delivery(d: DeliveryArrival, t: NotificationTarget): void;
}

export interface Deps {
  db: Db;
  photos: PhotoStore;
  notify: Notifier;
  now?: () => Date;
  /** Longest to wait for photo storage before saving without the photo (default 8000). */
  photoTimeoutMs?: number;
}
