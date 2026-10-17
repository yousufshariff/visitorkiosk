import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parse } from 'csv-parse/sync';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { createDb, type Db } from '../server/db/client';
import { users } from '../server/db/schema';

const blank = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optional = <T extends z.ZodType>(s: T) => z.preprocess(blank, s.optional());
const https = z.string().trim().url().refine((u) => u.startsWith('https://'), 'must start with https://').max(500);

const Row = z.object({
  name: z.string().trim().min(1, 'name is required').max(200),
  email: z.string().trim().max(254).toLowerCase().pipe(z.email('email is not valid')),
  department: optional(z.string().trim().max(200)),
  slack_user_id: optional(z.string().trim().max(40)),
  slack_webhook_url: optional(https),
  teams_webhook_url: optional(https),
});

export interface ImportResult {
  upserted: number;
  errors: { line: number; message: string }[];
}

/** Upsert hosts from CSV text by email. Bad rows are skipped and reported by CSV line number. */
export async function importHosts(db: Db, csv: string): Promise<ImportResult> {
  const records = parse(csv, { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true, info: true }) as {
    record: Record<string, unknown>;
    info: { lines: number };
  }[];
  const result: ImportResult = { upserted: 0, errors: [] };
  for (const { record, info } of records) {
    const parsed = Row.safeParse(record);
    if (!parsed.success) {
      result.errors.push({ line: info.lines, message: parsed.error.issues.map((i) => `${i.path.join('.') || 'row'}: ${i.message}`).join('; ') });
      continue;
    }
    const r = parsed.data;
    const values = {
      fullName: r.name,
      email: r.email,
      department: r.department ?? null,
      slackUserId: r.slack_user_id ?? null,
      slackWebhookUrl: r.slack_webhook_url ?? null,
      teamsWebhookUrl: r.teams_webhook_url ?? null,
    };
    await db.insert(users).values(values).onConflictDoUpdate({ target: users.email, set: { ...values, email: sql`${users.email}` } });
    result.upserted += 1;
  }
  return result;
}

async function cli(): Promise<void> {
  const file = process.argv[2];
  const url = process.env.DATABASE_URL;
  if (!file || !url) {
    console.error('Usage: DATABASE_URL=... tsx scripts/import-hosts.ts users.csv');
    process.exit(2);
  }
  const { db, pool } = createDb(url);
  try {
    const r = await importHosts(db, readFileSync(file, 'utf8'));
    console.log(`Imported ${r.upserted} host(s).`);
    for (const e of r.errors) console.error(`line ${e.line}: ${e.message}`);
    process.exitCode = r.errors.length > 0 ? 1 : 0;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void cli();
