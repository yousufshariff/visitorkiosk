import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDb, type TestDb } from '../testing/pg';
import { deliveries, deliveryStatus, deliveryType, users, visitors, visitStatus, visits } from './schema';

let t: TestDb;
beforeAll(async () => {
  t = await freshDb();
});
afterAll(async () => {
  await t.close();
});

const tables: [string, PgTable][] = [
  ['users', users],
  ['visitors', visitors],
  ['visits', visits],
  ['deliveries', deliveries],
];

describe('drizzle schema matches db/schema.sql', () => {
  it.each(tables)('%s has the same columns and nullability', async (name, table) => {
    const r = await t.pool.query<{ column_name: string; is_nullable: string }>(
      'SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = $1',
      [name],
    );
    const dbCols = r.rows.map((c) => `${c.column_name}:${c.is_nullable === 'NO' ? 'notnull' : 'null'}`).sort();
    const orm = getTableConfig(table).columns.map((c) => `${c.name}:${c.notNull ? 'notnull' : 'null'}`).sort();
    expect(orm).toEqual(dbCols);
  });

  it.each([
    ['visit_status', visitStatus],
    ['delivery_status', deliveryStatus],
    ['delivery_type', deliveryType],
  ] as const)('enum %s has the same labels', async (name, e) => {
    const r = await t.pool.query<{ enumlabel: string }>(
      'SELECT enumlabel FROM pg_enum JOIN pg_type ON pg_type.oid = enumtypid WHERE typname = $1 ORDER BY enumsortorder',
      [name],
    );
    expect([...e.enumValues]).toEqual(r.rows.map((x) => x.enumlabel));
  });
});
