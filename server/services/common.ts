import { and, eq } from 'drizzle-orm';
import type { NotificationTarget } from '../../shared/types';
import type { Db } from '../db/client';
import { users } from '../db/schema';
import type { Deps } from '../deps';
import { AppError } from '../errors';
import { PhotoError, type PhotoKind } from '../photos';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string): boolean => UUID.test(s);

export const now = (deps: Deps): Date => (deps.now ?? (() => new Date()))();

export type User = typeof users.$inferSelect;

/** An active user by id, or a 404 (a malformed id is simply "not found"). */
export async function requireActiveUser(db: Db, id: string, what: string): Promise<User> {
  const row = isUuid(id) ? (await db.select().from(users).where(and(eq(users.id, id), eq(users.isActive, true))).limit(1))[0] : undefined;
  if (!row) throw new AppError(404, 'not_found', `${what} could not be found.`);
  return row;
}

export function targetOf(u: User): NotificationTarget {
  return {
    slackWebhookUrl: u.slackWebhookUrl ?? undefined,
    teamsWebhookUrl: u.teamsWebhookUrl ?? undefined,
    slackUserId: u.slackUserId ?? undefined,
  };
}

/**
 * Store the photo. An invalid photo is the caller's mistake (rejected); a storage outage is not a reason
 * to turn a visitor away, so it is logged and the record is saved without a photo.
 */
export async function storePhoto(deps: Deps, kind: PhotoKind, dataUrl: string | undefined): Promise<{ key: string; url: string } | null> {
  if (!dataUrl) return null;
  let timer: NodeJS.Timeout | undefined;
  try {
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('photo upload timed out')), deps.photoTimeoutMs ?? 8_000);
    });
    return await Promise.race([deps.photos.put(kind, dataUrl), deadline]);
  } catch (e) {
    if (e instanceof PhotoError) throw new AppError(e.status, e.code, e.message);
    console.warn('[photos] upload failed; continuing without a photo:', e instanceof Error ? e.message : 'unknown error');
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Run a notification; whatever it does, the request is unaffected. */
export function safely(fn: () => void): void {
  try {
    fn();
  } catch (e) {
    console.warn('[notifications] could not start:', e instanceof Error ? e.message : 'unknown error');
  }
}
