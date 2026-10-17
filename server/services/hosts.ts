import { and, asc, eq, sql } from 'drizzle-orm';
import type { Host } from '../../shared/types';
import type { Deps } from '../deps';
import { users } from '../db/schema';
import { likePattern, MAX_RESULTS } from './search';

/** Active hosts whose name contains `q`; returns only the fields the kiosk may show. */
export async function searchHosts({ db }: Deps, q: string): Promise<Host[]> {
  const rows = await db
    .select({ id: users.id, fullName: users.fullName, department: users.department })
    .from(users)
    .where(and(eq(users.isActive, true), sql`${users.fullName} ILIKE ${likePattern(q)}`))
    .orderBy(asc(sql`lower(${users.fullName})`))
    .limit(MAX_RESULTS);
  return rows.map((r) => (r.department ? { id: r.id, fullName: r.fullName, department: r.department } : { id: r.id, fullName: r.fullName }));
}
