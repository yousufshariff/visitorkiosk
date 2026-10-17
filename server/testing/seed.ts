import type { Db } from '../db/client';
import { users } from '../db/schema';

let n = 0;

/** Insert an active host; every field can be overridden. */
export async function seedHost(db: Db, over: Partial<typeof users.$inferInsert> = {}) {
  n += 1;
  const [row] = await db
    .insert(users)
    .values({ fullName: `Host ${n}`, email: `host${n}@example.test`, ...over })
    .returning();
  return row!;
}
