import { afterAll, describe, expect, it } from 'vitest';
import { freshDb } from './pg';

const opened: Awaited<ReturnType<typeof freshDb>>[] = [];
afterAll(async () => {
  await Promise.all(opened.map((d) => d.close()));
});

describe('freshDb', () => {
  it('creates a database with the schema applied', async () => {
    const d = await freshDb();
    opened.push(d);
    const r = await d.pool.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name IN ('users','visitors','visits','deliveries')");
    expect(r.rows[0].n).toBe(4);
  });
  it('gives each call an isolated database', async () => {
    const a = await freshDb();
    const b = await freshDb();
    opened.push(a, b);
    await a.pool.query("INSERT INTO users(full_name,email) VALUES ('A','a@x.test')");
    const r = await b.pool.query('SELECT count(*)::int AS n FROM users');
    expect(r.rows[0].n).toBe(0);
  });
});
