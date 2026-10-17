import { randomBytes } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { CheckInInput } from '../../shared/types';
import { users, visitors, visits } from '../db/schema';
import type { Deps } from '../deps';
import { AppError } from '../errors';
import { isUuid, now, requireActiveUser, safely, storePhoto, targetOf } from './common';
import { likePattern, MAX_RESULTS } from './search';

const newToken = (): string => randomBytes(24).toString('base64url');
const clean = (s: string | undefined): string | undefined => (s?.trim() ? s.trim() : undefined);

export async function checkIn(deps: Deps, input: CheckInInput): Promise<{ visitId: string }> {
  const fullName = clean(input.fullName);
  const email = clean(input.email);
  const phone = clean(input.phone);
  const company = clean(input.company);
  if (!fullName) throw new AppError(400, 'invalid_request', 'Please enter your name.');
  if (!email && !phone) throw new AppError(400, 'invalid_request', 'Please enter an email address or a phone number.');

  const host = await requireActiveUser(deps.db, input.hostId, 'That host');
  const photo = await storePhoto(deps, 'visits', input.photoBase64);
  const arrivedAt = now(deps);

  const visitId = await deps.db.transaction(async (tx) => {
    const [visitor] = email
      ? await tx
          .insert(visitors)
          .values({ fullName, company, email, phone })
          .onConflictDoUpdate({
            target: visitors.email,
            targetWhere: sql`${visitors.email} IS NOT NULL`,
            set: {
              fullName,
              company: sql`COALESCE(excluded.company, ${visitors.company})`,
              phone: sql`COALESCE(excluded.phone, ${visitors.phone})`,
            },
          })
          .returning({ id: visitors.id })
      : await tx.insert(visitors).values({ fullName, company, phone }).returning({ id: visitors.id });
    const [visit] = await tx
      .insert(visits)
      .values({ visitorId: visitor!.id, hostId: host.id, status: 'checked_in', qrToken: newToken(), photoUrl: photo?.key ?? null, checkedInAt: arrivedAt })
      .returning({ id: visits.id });
    return visit!.id;
  });

  safely(() =>
    deps.notify.visitor({ visitorName: fullName, company, hostName: host.fullName, arrivedAt, photoUrl: photo?.url }, targetOf(host)),
  );
  return { visitId };
}

export async function scanCheckIn(deps: Deps, qrToken: string): Promise<{ visitorName: string; hostName: string }> {
  const arrivedAt = now(deps);
  // The status guard in the UPDATE makes simultaneous scans of one code race safely: only one wins.
  const [claimed] = await deps.db
    .update(visits)
    .set({ status: 'checked_in', checkedInAt: arrivedAt })
    .where(and(eq(visits.qrToken, qrToken), eq(visits.status, 'pre_booked')))
    .returning({ visitorId: visits.visitorId, hostId: visits.hostId, photoUrl: visits.photoUrl });
  if (!claimed) {
    const [exists] = await deps.db.select({ id: visits.id }).from(visits).where(eq(visits.qrToken, qrToken)).limit(1);
    if (!exists) throw new AppError(404, 'not_found', 'That QR code was not recognised.');
    throw new AppError(409, 'already_used', 'That QR code has already been used or is no longer valid.');
  }
  const [visitor] = await deps.db.select().from(visitors).where(eq(visitors.id, claimed.visitorId));
  const [host] = await deps.db.select().from(users).where(eq(users.id, claimed.hostId));
  safely(() =>
    deps.notify.visitor(
      { visitorName: visitor!.fullName, company: visitor!.company ?? undefined, hostName: host!.fullName, arrivedAt },
      targetOf(host!),
    ),
  );
  return { visitorName: visitor!.fullName, hostName: host!.fullName };
}

export async function checkOut(deps: Deps, input: { qrToken?: string; visitId?: string }): Promise<void> {
  const { qrToken, visitId } = input;
  if (!qrToken && !visitId) throw new AppError(400, 'invalid_request', 'Please choose who is checking out.');
  if (visitId !== undefined && !isUuid(visitId)) throw new AppError(404, 'not_found', 'That visit could not be found.');
  const where = visitId ? eq(visits.id, visitId) : eq(visits.qrToken, qrToken!);
  const [visit] = await deps.db.select({ id: visits.id, status: visits.status }).from(visits).where(where).limit(1);
  if (!visit) throw new AppError(404, 'not_found', 'That visit could not be found.');
  if (visit.status === 'checked_out') return;
  if (visit.status !== 'checked_in') throw new AppError(409, 'not_checked_in', 'That visitor is not checked in.');
  await deps.db
    .update(visits)
    .set({ status: 'checked_out', checkedOutAt: now(deps) })
    .where(and(eq(visits.id, visit.id), eq(visits.status, 'checked_in')));
}

export async function searchOnSite(deps: Deps, q: string): Promise<{ visitId: string; visitorName: string }[]> {
  return deps.db
    .select({ visitId: visits.id, visitorName: visitors.fullName })
    .from(visits)
    .innerJoin(visitors, eq(visitors.id, visits.visitorId))
    .where(and(eq(visits.status, 'checked_in'), sql`${visitors.fullName} ILIKE ${likePattern(q)}`))
    .orderBy(desc(visits.checkedInAt))
    .limit(MAX_RESULTS);
}
