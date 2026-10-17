import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { dbFromPool, type Db } from '../db/client';

const SCHEMA = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../db/schema.sql'), 'utf8');

export interface TestDb {
  pool: pg.Pool;
  db: Db;
  close(): Promise<void>;
}

function conn(database: string): pg.PoolConfig {
  const host = process.env.TEST_PG_SOCKET;
  if (!host) throw new Error('TEST_PG_SOCKET is not set; run through vitest (globalSetup starts Postgres)');
  return { host, port: Number(process.env.TEST_PG_PORT), user: 'postgres', database };
}

/** Creates a brand-new database from db/schema.sql; one per call so tests cannot see each other's rows. */
export async function freshDb(): Promise<TestDb> {
  const name = `t_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client(conn('postgres'));
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
  const pool = new pg.Pool({ ...conn(name), max: 5 });
  await pool.query(SCHEMA);
  return {
    pool,
    db: dbFromPool(pool),
    close: async () => {
      await pool.end();
    },
  };
}
