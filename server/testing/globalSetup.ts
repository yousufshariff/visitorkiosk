import { execFileSync } from 'node:child_process';
import { chmodSync, chownSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PGBIN = process.env.PGBIN ?? '/usr/lib/postgresql/16/bin';
const PORT = 54330;

/** Starts a throwaway local Postgres (unix socket only) for the DB-backed tests. */
export default function setup(): () => void {
  if (process.env.TEST_PG_SOCKET) return () => {}; // caller supplied a server
  const tmp = mkdtempSync(join(tmpdir(), 'kiosk-pg-'));
  const pw = execFileSync('id', ['-u', 'postgres']).toString().trim();
  chownSync(tmp, Number(pw), Number(execFileSync('id', ['-g', 'postgres']).toString().trim()));
  chmodSync(tmp, 0o755);
  const asPg = (cmd: string, args: string[]) =>
    execFileSync('runuser', ['-u', 'postgres', '--', cmd, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    asPg(`${PGBIN}/initdb`, ['-D', `${tmp}/data`, '-A', 'trust']);
    asPg(`${PGBIN}/pg_ctl`, ['-D', `${tmp}/data`, '-o', `-p ${PORT} -k ${tmp} -c listen_addresses='' -c fsync=off`, '-l', `${tmp}/log`, '-w', 'start']);
  } catch (e) {
    rmSync(tmp, { recursive: true, force: true });
    throw new Error(`Could not start a local Postgres for tests (looked in ${PGBIN}): ${e instanceof Error ? e.message : e}`);
  }
  process.env.TEST_PG_SOCKET = tmp;
  process.env.TEST_PG_PORT = String(PORT);
  return () => {
    try {
      asPg(`${PGBIN}/pg_ctl`, ['-D', `${tmp}/data`, '-m', 'immediate', 'stop']);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  };
}
